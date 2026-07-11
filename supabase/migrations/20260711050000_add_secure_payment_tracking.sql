-- Add secure payment tracking to CoursePilot bookings.
--
-- Public users may choose a payment method, but they cannot
-- mark a booking as paid or write Stripe identifiers.
-- Those protected fields will only be updated by the
-- server-side Stripe integration.

alter table public.bookings
add column if not exists payment_status text
    not null
    default 'unpaid';

alter table public.bookings
add column if not exists stripe_checkout_session_id text;

alter table public.bookings
add column if not exists stripe_payment_intent_id text;

alter table public.bookings
add column if not exists paid_amount numeric(10, 2);

alter table public.bookings
add column if not exists paid_currency text;

alter table public.bookings
add column if not exists paid_at timestamptz;


alter table public.bookings
drop constraint if exists bookings_payment_status_check;

alter table public.bookings
add constraint bookings_payment_status_check
check (
    payment_status in (
        'unpaid',
        'pending',
        'paid',
        'failed',
        'cancelled',
        'refunded'
    )
);


alter table public.bookings
drop constraint if exists bookings_paid_amount_check;

alter table public.bookings
add constraint bookings_paid_amount_check
check (
    paid_amount is null
    or (
        paid_amount > 0
        and paid_amount <= 12000
    )
);


alter table public.bookings
drop constraint if exists bookings_paid_currency_check;

alter table public.bookings
add constraint bookings_paid_currency_check
check (
    paid_currency is null
    or paid_currency ~ '^[a-z]{3}$'
);


alter table public.bookings
drop constraint if exists bookings_paid_details_check;

alter table public.bookings
add constraint bookings_paid_details_check
check (
    (
        payment_status in (
            'paid',
            'refunded'
        )
        and paid_amount is not null
        and paid_currency is not null
        and paid_at is not null
        and stripe_checkout_session_id is not null
        and stripe_payment_intent_id is not null
    )
    or
    (
        payment_status in (
            'unpaid',
            'pending',
            'failed',
            'cancelled'
        )
        and paid_amount is null
        and paid_currency is null
        and paid_at is null
    )
);


create unique index if not exists
bookings_stripe_checkout_session_id_unique
on public.bookings (
    stripe_checkout_session_id
)
where stripe_checkout_session_id is not null;


create unique index if not exists
bookings_stripe_payment_intent_id_unique
on public.bookings (
    stripe_payment_intent_id
)
where stripe_payment_intent_id is not null;


-- Remove the old table-wide insert permission.
-- Otherwise a browser user could attempt to insert fake
-- payment statuses or fake Stripe identifiers.

revoke insert
on table public.bookings
from anon, authenticated;


-- Public users may insert only normal booking-request fields.
-- Payment confirmation fields are intentionally excluded.

grant insert (
    course_id,
    name,
    day,
    time,
    players,
    customer_phone,
    holes,
    price_per_player,
    estimated_total,
    payment_method
)
on table public.bookings
to anon, authenticated;


-- Explicitly prevent browser users from modifying protected
-- payment fields. The future Edge Function will use secure
-- server credentials to update them.

revoke update (
    payment_status,
    stripe_checkout_session_id,
    stripe_payment_intent_id,
    paid_amount,
    paid_currency,
    paid_at
)
on table public.bookings
from anon, authenticated;


comment on column public.bookings.payment_status
is
'Server-managed payment state. Browser clients must not mark bookings as paid.';

comment on column public.bookings.stripe_checkout_session_id
is
'Unique Stripe Checkout Session identifier created by the server.';

comment on column public.bookings.stripe_payment_intent_id
is
'Unique Stripe PaymentIntent identifier received from a verified webhook.';

comment on column public.bookings.paid_amount
is
'Actual successfully paid amount, recorded by the verified Stripe webhook.';

comment on column public.bookings.paid_currency
is
'Three-letter lowercase currency code for the completed payment.';

comment on column public.bookings.paid_at
is
'Time when a verified payment was completed.';
