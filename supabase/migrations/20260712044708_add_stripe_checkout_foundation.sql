-- Store secure server-side checkout context for online reservations.
--
-- The browser receives a random access token only in the reservation
-- response. A future Edge Function will require both the booking ID and
-- this token before it creates a Stripe Checkout Session.

alter table public.bookings
add column if not exists checkout_access_token uuid;

alter table public.bookings
add column if not exists checkout_total numeric(10, 2);

alter table public.bookings
add column if not exists checkout_currency text;


alter table public.bookings
drop constraint if exists bookings_checkout_total_check;

alter table public.bookings
add constraint bookings_checkout_total_check
check (
    checkout_total is null
    or checkout_total > 0
);


alter table public.bookings
drop constraint if exists bookings_checkout_currency_check;

alter table public.bookings
add constraint bookings_checkout_currency_check
check (
    checkout_currency is null
    or checkout_currency ~ '^[a-z]{3}$'
);


alter table public.bookings
drop constraint if exists bookings_checkout_context_check;

alter table public.bookings
add constraint bookings_checkout_context_check
check (
    (
        checkout_access_token is null
        and checkout_total is null
        and checkout_currency is null
    )
    or
    (
        checkout_access_token is not null
        and checkout_total is not null
        and checkout_currency is not null
        and payment_method = 'online'
    )
);


create unique index if not exists
bookings_checkout_access_token_unique
on public.bookings (
    checkout_access_token
)
where checkout_access_token is not null;


-- Browser users must not choose or modify the trusted checkout context.

revoke insert (
    checkout_access_token,
    checkout_total,
    checkout_currency
)
on table public.bookings
from anon, authenticated;

revoke update (
    checkout_access_token,
    checkout_total,
    checkout_currency
)
on table public.bookings
from anon, authenticated;


comment on column public.bookings.checkout_access_token
is
'Random capability token required by the server before creating Stripe Checkout for an anonymous online reservation.';

comment on column public.bookings.checkout_total
is
'Immutable trusted total captured when an online reservation hold is created.';

comment on column public.bookings.checkout_currency
is
'Trusted lowercase ISO currency captured when an online reservation hold is created.';


-- The return shape gains checkout_access_token. PostgreSQL requires the
-- existing function to be dropped before changing a table return type.

drop function public.create_booking_reservation(
    uuid,
    date,
    time without time zone,
    integer,
    text,
    text,
    integer,
    text
);


create function public.create_booking_reservation(
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
    trusted_currency text,
    checkout_access_token uuid
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

    new_checkout_access_token uuid;
    new_checkout_total numeric(10, 2);
    new_checkout_currency text;
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

        new_checkout_access_token :=
            gen_random_uuid();

        new_checkout_total :=
            calculated_total;

        new_checkout_currency :=
            lower(course_settings.currency);
    else
        new_reservation_status :=
            'reserved';

        new_payment_status :=
            'unpaid';

        new_expiration :=
            null;

        new_checkout_access_token :=
            null;

        new_checkout_total :=
            null;

        new_checkout_currency :=
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
        reservation_expires_at,
        checkout_access_token,
        checkout_total,
        checkout_currency
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
        new_expiration,
        new_checkout_access_token,
        new_checkout_total,
        new_checkout_currency
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
        course_settings.currency,
        new_checkout_access_token;
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
'Atomically validates a booking, reserves capacity, freezes trusted online checkout context, and returns a one-time checkout capability token.';
