-- Store the selected round length and estimated pricing
-- directly on each booking record.

alter table public.bookings
add column if not exists holes smallint;

alter table public.bookings
add column if not exists price_per_player numeric(10, 2);

alter table public.bookings
add column if not exists estimated_total numeric(10, 2);


alter table public.bookings
drop constraint if exists bookings_holes_check;

alter table public.bookings
add constraint bookings_holes_check
check (
    holes is null
    or holes in (9, 18)
);


alter table public.bookings
drop constraint if exists bookings_price_per_player_check;

alter table public.bookings
add constraint bookings_price_per_player_check
check (
    price_per_player is null
    or (
        price_per_player >= 0
        and price_per_player <= 1000
    )
);


alter table public.bookings
drop constraint if exists bookings_estimated_total_check;

alter table public.bookings
add constraint bookings_estimated_total_check
check (
    estimated_total is null
    or (
        estimated_total >= 0
        and estimated_total <= 12000
    )
);


-- The three round-detail fields must either all be present
-- or all be absent. This keeps each booking internally consistent.

alter table public.bookings
drop constraint if exists bookings_round_details_complete_check;

alter table public.bookings
add constraint bookings_round_details_complete_check
check (
    (
        holes is null
        and price_per_player is null
        and estimated_total is null
    )
    or
    (
        holes is not null
        and price_per_player is not null
        and estimated_total is not null
    )
);


-- Ensure the stored total matches the group size and
-- the stored per-player price.

alter table public.bookings
drop constraint if exists bookings_estimated_total_math_check;

alter table public.bookings
add constraint bookings_estimated_total_math_check
check (
    estimated_total is null
    or estimated_total = (
        price_per_player *
        players::numeric
    )
);
