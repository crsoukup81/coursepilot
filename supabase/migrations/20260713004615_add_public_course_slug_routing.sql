-- Expose only the public identity fields needed to resolve booking URLs.
alter table public.courses enable row level security;

revoke all privileges on table public.courses
from anon, authenticated;

grant select (id, name, slug) on table public.courses
to anon, authenticated;

drop policy if exists "Public can view course booking identities"
on public.courses;

create policy "Public can view course booking identities"
on public.courses
for select
to anon, authenticated
using (true);
