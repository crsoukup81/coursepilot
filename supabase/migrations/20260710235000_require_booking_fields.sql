-- Require every booking request to include its core details.

alter table public.bookings
alter column name set not null;

alter table public.bookings
alter column day set not null;

alter table public.bookings
alter column time set not null;

alter table public.bookings
alter column players set not null;