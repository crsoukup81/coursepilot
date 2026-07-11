-- Store the customer's intended payment method.
--
-- Existing bookings remain null because they were created
-- before CoursePilot collected a payment preference.

alter table public.bookings
add column if not exists payment_method text;


alter table public.bookings
drop constraint if exists bookings_payment_method_check;


alter table public.bookings
add constraint bookings_payment_method_check
check (
    payment_method is null
    or payment_method in (
        'pay_at_course',
        'online'
    )
);


comment on column public.bookings.payment_method
is
'Customer payment preference: pay_at_course or online. This does not prove that an online payment was completed.';
