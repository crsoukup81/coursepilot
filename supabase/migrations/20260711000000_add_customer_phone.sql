-- Add customer contact information to booking requests.
--
-- This starts as nullable because existing test bookings
-- were created before CoursePilot collected phone numbers.

alter table public.bookings
add column customer_phone text;

alter table public.bookings
add constraint bookings_customer_phone_check
check (
    customer_phone is null
    or length(trim(customer_phone)) between 7 and 30
);