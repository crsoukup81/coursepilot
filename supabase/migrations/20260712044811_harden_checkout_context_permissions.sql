-- Public booking clients create reservations through the secured RPC.
-- They never need to update booking rows directly.

revoke update
on table public.bookings
from anon;
