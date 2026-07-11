-- Allow booking submissions even when the browser
-- already has an authenticated Supabase session.

grant insert
on table public.bookings
to authenticated;

alter policy "Public can submit booking requests"
on public.bookings
to anon, authenticated
with check (true);