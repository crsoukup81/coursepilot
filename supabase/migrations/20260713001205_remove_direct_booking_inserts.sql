-- Booking creation now goes through create_booking_reservation(), which
-- validates pricing and reserves tee-time capacity atomically. Browser roles
-- must not bypass that protected workflow with direct table inserts.

drop policy if exists "Public can submit booking requests"
on public.bookings;

revoke insert
on table public.bookings
from anon, authenticated;

revoke insert (
    id,
    course_id,
    name,
    day,
    time,
    players,
    customer_phone,
    holes,
    price_per_player,
    estimated_total,
    payment_method,
    payment_status,
    stripe_checkout_session_id,
    stripe_payment_intent_id,
    paid_amount,
    paid_currency,
    paid_at,
    created_at,
    viewed_at,
    tee_time_id,
    reservation_status,
    reserved_at,
    reservation_expires_at,
    checkout_access_token,
    checkout_total,
    checkout_currency,
    status
)
on table public.bookings
from anon, authenticated;
