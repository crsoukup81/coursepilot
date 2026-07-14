-- Booking requests now reach these privileged functions only through the
-- validated booking-api Edge Function, which uses the service role.
-- Browser roles must not be able to bypass that API by calling the RPCs
-- directly through PostgREST.

revoke execute
on function public.get_available_tee_times(
    uuid,
    date,
    integer
)
from public, anon, authenticated;

grant execute
on function public.get_available_tee_times(
    uuid,
    date,
    integer
)
to service_role;


revoke execute
on function public.create_booking_reservation(
    uuid,
    date,
    time without time zone,
    integer,
    text,
    text,
    integer,
    text
)
from public, anon, authenticated;

grant execute
on function public.create_booking_reservation(
    uuid,
    date,
    time without time zone,
    integer,
    text,
    text,
    integer,
    text
)
to service_role;
