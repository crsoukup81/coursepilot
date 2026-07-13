-- Release tee-time capacity when a Stripe Checkout Session expires
-- or a delayed payment fails.
--
-- The Stripe webhook calls this function with the service-role key.
-- Keeping the capacity and booking updates in one database function
-- prevents a partial release if either update fails.

create or replace function public.release_stripe_checkout_hold(
    p_booking_id bigint,
    p_course_id uuid,
    p_stripe_checkout_session_id text,
    p_payment_status text
)
returns table (
    booking_id bigint,
    released boolean
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
    booking_to_release record;
begin
    if p_booking_id is null
        or p_course_id is null
        or coalesce(
            btrim(p_stripe_checkout_session_id),
            ''
        ) = ''
    then
        raise exception
            'Stripe checkout identity is required.';
    end if;

    if p_payment_status not in (
        'cancelled',
        'failed'
    ) then
        raise exception
            'Invalid Stripe checkout release status.';
    end if;

    select
        bookings.id,
        bookings.tee_time_id,
        bookings.players::integer
            as player_count,
        bookings.payment_status,
        bookings.reservation_status

    into booking_to_release

    from public.bookings

    where bookings.id = p_booking_id

      and bookings.course_id = p_course_id

      and bookings.stripe_checkout_session_id =
            p_stripe_checkout_session_id

    for update;

    if not found then
        return query
        select null::bigint, false;

        return;
    end if;

    if booking_to_release.payment_status <> 'pending'
        or booking_to_release.reservation_status <> 'held'
    then
        return query
        select booking_to_release.id, false;

        return;
    end if;

    update public.tee_times
    set reserved_players = greatest(
        0,
        reserved_players -
            booking_to_release.player_count
    )
    where tee_times.id =
        booking_to_release.tee_time_id;

    if not found then
        raise exception
            'The booking tee time could not be released.';
    end if;

    update public.bookings
    set
        reservation_status = 'released',
        reservation_expires_at = null,
        payment_status = p_payment_status
    where bookings.id = booking_to_release.id;

    return query
    select booking_to_release.id, true;
end;
$function$;


-- Supabase projects can grant new public-schema functions directly
-- to API roles. Remove those grants explicitly and allow only the
-- server-side service role to invoke this Stripe helper.

revoke all
on function public.release_stripe_checkout_hold(
    bigint,
    uuid,
    text,
    text
)
from public, anon, authenticated;

grant execute
on function public.release_stripe_checkout_hold(
    bigint,
    uuid,
    text,
    text
)
to service_role;


-- Restore the intended permissions on the older internal helper.
-- The availability and reservation functions call it as their
-- security-definer owner; browser roles do not need direct access.

revoke all
on function public.release_expired_booking_holds(
    uuid,
    date
)
from public, anon, authenticated;

grant execute
on function public.release_expired_booking_holds(
    uuid,
    date
)
to service_role;
