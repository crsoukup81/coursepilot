-- This helper is invoked internally by the ensure_rls event trigger.
-- Browser roles must not be able to call the privileged function directly.

revoke execute
on function public.rls_auto_enable()
from public, anon, authenticated;
