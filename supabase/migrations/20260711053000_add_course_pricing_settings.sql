-- Store trusted course pricing and tax settings.
--
-- The website may display these values publicly, but the future
-- Stripe backend will calculate payment amounts directly from
-- the database instead of trusting browser-submitted prices.

alter table public.course_public_settings
add column if not exists price_9_holes numeric(10, 2)
    not null
    default 29.00;

alter table public.course_public_settings
add column if not exists price_18_holes numeric(10, 2)
    not null
    default 49.00;

alter table public.course_public_settings
add column if not exists sales_tax_rate numeric(6, 5)
    not null
    default 0.06000;

alter table public.course_public_settings
add column if not exists currency text
    not null
    default 'usd';


alter table public.course_public_settings
drop constraint if exists course_settings_price_9_check;

alter table public.course_public_settings
add constraint course_settings_price_9_check
check (
    price_9_holes > 0
    and price_9_holes <= 1000
);


alter table public.course_public_settings
drop constraint if exists course_settings_price_18_check;

alter table public.course_public_settings
add constraint course_settings_price_18_check
check (
    price_18_holes > 0
    and price_18_holes <= 1000
);


alter table public.course_public_settings
drop constraint if exists course_settings_price_order_check;

alter table public.course_public_settings
add constraint course_settings_price_order_check
check (
    price_18_holes >= price_9_holes
);


alter table public.course_public_settings
drop constraint if exists course_settings_sales_tax_rate_check;

alter table public.course_public_settings
add constraint course_settings_sales_tax_rate_check
check (
    sales_tax_rate >= 0
    and sales_tax_rate <= 0.25
);


alter table public.course_public_settings
drop constraint if exists course_settings_currency_check;

alter table public.course_public_settings
add constraint course_settings_currency_check
check (
    currency ~ '^[a-z]{3}$'
);


update public.course_public_settings
set
    price_9_holes = 29.00,
    price_18_holes = 49.00,
    sales_tax_rate = 0.06000,
    currency = 'usd'
where course_id = (
    select id
    from public.courses
    where slug = 'demo-course'
);


comment on column public.course_public_settings.price_9_holes
is 'Trusted per-player price for a 9-hole round.';

comment on column public.course_public_settings.price_18_holes
is 'Trusted per-player price for an 18-hole round.';

comment on column public.course_public_settings.sales_tax_rate
is 'Configured decimal tax rate used for estimates and payment calculations.';

comment on column public.course_public_settings.currency
is 'Three-letter lowercase payment currency code.';
