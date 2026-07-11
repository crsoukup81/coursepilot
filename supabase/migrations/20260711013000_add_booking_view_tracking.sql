-- Track when a manager first reviews a booking request.
--
-- A null viewed_at value means the request is new.
-- A timestamp means the request has been seen.

alter table public.bookings
add column viewed_at timestamptz;

-- Authenticated course members may update viewed_at.
-- The existing UPDATE RLS policy still limits them to
-- bookings belonging to their assigned golf course.

grant update (viewed_at)
on table public.bookings
to authenticated;