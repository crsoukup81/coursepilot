-- Require customer phone numbers to use the format 000-000-0000.

alter table public.bookings
drop constraint if exists bookings_customer_phone_check;

alter table public.bookings
add constraint bookings_customer_phone_check
check (
    customer_phone ~ '^[0-9]{3}-[0-9]{3}-[0-9]{4}$'
);
