-- Add atomic tee-time reservations to CoursePilot.
--
-- This migration creates a secure database function that:
-- 1. Validates the booking request.
-- 2. Locks the requested tee-time slot.
-- 3. Rechecks capacity while the slot is locked.
-- 4. Calculates trusted pricing from course settings.
-- 5. Creates the booking.
-- 6. Reserves the requested player capacity.
--
-- The current browser insert remains available temporarily.
-- It will be removed after index.html is switched to this function.

alter table public.bookings
add column if not exists tee_time_id uuid
    references public.tee_times(id)
    on delete set null;

alter table public.bookings
add column if not exists reservation_status text
    not null
    default 'request';

alter table public.bookings
add column if not exists reserved_at timestamptz;

alter table public.bookings
add column if not exists reservation_expires_at timestamptz;


alter table public.bookings
drop constraint if exists bookings_reservation_status_check;

alter table public.bookings
add constraint bookings_reservation_status_check
check (
    reservation_status in (
        'request',
        'held',
        'reserved',
        'released',
        'cancelled'
    )
);


alter table public.bookings
drop constraint if exists bookings_active_reservation_details_check;

alter table public.bookings
add constraint bookings_active_reservation_details_check
check (
    (
        reservation_status = 'held'
        and tee_time_id is not null
        and reserved_at is not null
        and reservation_expires_at is not null
    )
    or
    (
        reservation_status = 'reserved'
        and tee_time_id is not null
        and reserved_at is not null
        and reservation_expires_at is null
    )
    or
    reservation_status in (
        'request',
        'released',
        'cancelled'
    )
);


create index if not exists
bookings_tee_time_reservation_idx
on public.bookings (
    tee_time_id,
    reservation_status
);


create index if not exists
bookings_expiring_holds_idx
on public.bookings (
    reservation_expires_at
)
where reservation_status = 'held';


-- Release online-payment holds that have expired.
--
-- This is an internal helper. Public users cannot call it
-- directly, but the availability and reservation functions can.

create or replace function public.release_expired_booking_holds(
    p_course_id uuid,
    p_tee_date date
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
    expired_booking record;
    released_count integer := 0;
begin
    for expired_booking in
        select
            bookings.id,
            bookings.tee_time_id,
            bookings.players::integer
                as player_count
        from public.bookings

        join public.tee_times
            on tee_times.id =
                bookings.tee_time_id

        where tee_times.course_id =
                p_course_id

          and tee_times.tee_date =
                p_tee_date

          and bookings.reservation_status =
                'held'

          and bookings.reservation_expires_at
                <= now()

        for update of bookings
        skip locked
    loop
        update public.tee_times
        set reserved_players =
            greatest(
                0,
                reserved_players -
                    expired_booking.player_count
            )
        where id =
            expired_booking.tee_time_id;

        update public.bookings
        set
            reservation_status = 'released',
            reservation_expires_at = null,

            payment_status =
                case
                    when payment_status = 'pending'
                        then 'cancelled'
                    else payment_status
                end

        where id =
            expired_booking.id;

        released_count :=
            released_count + 1;
    end loop;

    return released_count;
end;
$function$;


revoke all
on function public.release_expired_booking_holds(
    uuid,
    date
)
from public;


-- Replace the public availability function.
--
-- It now releases expired online-payment holds before
-- returning available slots.

create or replace function public.get_available_tee_times(
    p_course_id uuid,
    p_tee_date date,
    p_players integer
)
returns table (
    slot_time time without time zone,
    remaining_players integer
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
    course_timezone text;
    maximum_players integer;
begin
    select
        course_public_settings.timezone,
        course_public_settings.max_players
    into
        course_timezone,
        maximum_players
    from public.course_public_settings
    where course_public_settings.course_id =
        p_course_id;

    if not found then
        return;
    end if;

    if (
        p_players is null
        or p_players < 1
        or p_players > maximum_players
    ) then
        return;
    end if;

    perform public.release_expired_booking_holds(
        p_course_id,
        p_tee_date
    );

    return query
    select
        tee_times.tee_time,

        (
            tee_times.capacity -
            tee_times.reserved_players
        )::integer

    from public.tee_times

    where tee_times.course_id =
            p_course_id

      and tee_times.tee_date =
            p_tee_date

      and tee_times.status =
            'open'

      and (
          tee_times.capacity -
          tee_times.reserved_players
      ) >= p_players

      and (
          tee_times.tee_date +
          tee_times.tee_time
      ) > (
          now() at time zone
          course_timezone
      )

    order by tee_times.tee_time;
end;
$function$;


revoke all
on function public.get_available_tee_times(
    uuid,
    date,
    integer
)
from public;

grant execute
on function public.get_available_tee_times(
    uuid,
    date,
    integer
)
to anon, authenticated;


-- Securely create a booking and reserve capacity.
--
-- Online payments receive a temporary 30-minute hold.
-- Pay-at-course bookings reserve capacity without expiring.

create or replace function public.create_booking_reservation(
    p_course_id uuid,
    p_tee_date date,
    p_tee_time time without time zone,
    p_players integer,
    p_name text,
    p_customer_phone text,
    p_holes integer,
    p_payment_method text
)
returns table (
    booking_id bigint,
    reservation_state text,
    hold_expires_at timestamptz,
    booking_payment_status text,
    trusted_price_per_player numeric,
    trusted_subtotal numeric,
    trusted_tax_rate numeric,
    trusted_tax_amount numeric,
    trusted_total numeric,
    trusted_currency text
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
    course_settings record;
    tee_time_slot record;

    clean_name text;
    clean_phone text;

    calculated_price_per_player
        numeric(10, 2);

    calculated_subtotal
        numeric(10, 2);

    calculated_tax
        numeric(10, 2);

    calculated_total
        numeric(10, 2);

    new_booking_id bigint;

    new_reservation_status text;
    new_payment_status text;
    new_expiration timestamptz;
begin
    clean_name :=
        btrim(coalesce(p_name, ''));

    clean_phone :=
        btrim(coalesce(
            p_customer_phone,
            ''
        ));

    if char_length(clean_name)
        not between 2 and 100
    then
        raise exception
            'Customer name must contain 2 through 100 characters.';
    end if;

    if clean_phone
        !~ '^[0-9]{3}-[0-9]{3}-[0-9]{4}$'
    then
        raise exception
            'Customer phone number must use the format 000-000-0000.';
    end if;

    if p_holes not in (9, 18) then
        raise exception
            'Round length must be either 9 or 18 holes.';
    end if;

    if p_payment_method not in (
        'pay_at_course',
        'online'
    ) then
        raise exception
            'Invalid payment method.';
    end if;

    select
        course_public_settings.timezone,
        course_public_settings.max_players,
        course_public_settings.price_9_holes,
        course_public_settings.price_18_holes,
        course_public_settings.sales_tax_rate,
        course_public_settings.currency

    into course_settings

    from public.course_public_settings

    where course_public_settings.course_id =
        p_course_id;

    if not found then
        raise exception
            'Course settings were not found.';
    end if;

    if (
        p_players is null
        or p_players < 1
        or p_players >
            course_settings.max_players
    ) then
        raise exception
            'Invalid number of golfers.';
    end if;

    if p_tee_date <
        (
            now() at time zone
                course_settings.timezone
        )::date
    then
        raise exception
            'The selected date has already passed.';
    end if;

    if (
        p_tee_date +
        p_tee_time
    ) <= (
        now() at time zone
            course_settings.timezone
    ) then
        raise exception
            'The selected tee time has already passed.';
    end if;

    perform public.release_expired_booking_holds(
        p_course_id,
        p_tee_date
    );

    select
        tee_times.id,
        tee_times.capacity,
        tee_times.reserved_players,
        tee_times.status

    into tee_time_slot

    from public.tee_times

    where tee_times.course_id =
            p_course_id

      and tee_times.tee_date =
            p_tee_date

      and tee_times.tee_time =
            p_tee_time

    for update;

    if not found then
        raise exception
            'The selected tee time does not exist.';
    end if;

    if tee_time_slot.status <> 'open' then
        raise exception
            'The selected tee time is blocked.';
    end if;

    if (
        tee_time_slot.capacity -
        tee_time_slot.reserved_players
    ) < p_players then
        raise exception
            'The selected tee time no longer has enough capacity.';
    end if;

    calculated_price_per_player :=
        case
            when p_holes = 9
                then course_settings.price_9_holes
            else course_settings.price_18_holes
        end;

    calculated_subtotal :=
        round(
            calculated_price_per_player *
            p_players,
            2
        );

    calculated_tax :=
        round(
            calculated_subtotal *
            course_settings.sales_tax_rate,
            2
        );

    calculated_total :=
        calculated_subtotal +
        calculated_tax;

    if p_payment_method = 'online' then
        new_reservation_status :=
            'held';

        new_payment_status :=
            'pending';

        new_expiration :=
            now() + interval '30 minutes';
    else
        new_reservation_status :=
            'reserved';

        new_payment_status :=
            'unpaid';

        new_expiration :=
            null;
    end if;

    insert into public.bookings (
        course_id,
        name,
        day,
        time,
        players,
        customer_phone,
        status,
        holes,
        price_per_player,
        estimated_total,
        payment_method,
        payment_status,
        tee_time_id,
        reservation_status,
        reserved_at,
        reservation_expires_at
    )
    values (
        p_course_id,
        clean_name,
        to_char(
            p_tee_date,
            'YYYY-MM-DD'
        ),
        to_char(
            p_tee_time,
            'HH24:MI'
        ),
        p_players::text,
        clean_phone,
        'pending',
        p_holes,
        calculated_price_per_player,
        calculated_subtotal,
        p_payment_method,
        new_payment_status,
        tee_time_slot.id,
        new_reservation_status,
        now(),
        new_expiration
    )
    returning id
    into new_booking_id;

    update public.tee_times
    set reserved_players =
        reserved_players +
        p_players
    where id =
        tee_time_slot.id;

    return query
    select
        new_booking_id,
        new_reservation_status,
        new_expiration,
        new_payment_status,
        calculated_price_per_player,
        calculated_subtotal,
        course_settings.sales_tax_rate,
        calculated_tax,
        calculated_total,
        course_settings.currency;
end;
$function$;


revoke all
on function public.create_booking_reservation(
    uuid,
    date,
    time without time zone,
    integer,
    text,
    text,
    integer,
    text
)
from public;

grant execute
on function public.create_booking_reservation(
    uuid,
    date,
    time without time zone,
    integer,
    text,
    text,
    integer,
    text
)
to anon, authenticated;


comment on function public.create_booking_reservation(
    uuid,
    date,
    time without time zone,
    integer,
    text,
    text,
    integer,
    text
)
is
'Atomically validates a booking, calculates trusted pricing, creates the booking, and reserves tee-time capacity.';
