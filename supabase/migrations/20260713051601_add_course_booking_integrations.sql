-- Store the booking provider used by each CoursePilot course.
-- Provider credentials must never be stored in this table. Keep secrets in
-- Supabase Edge Function secrets (or Vault when database access is required).

create table public.course_booking_integrations (
    course_id uuid primary key
        references public.courses(id)
        on delete cascade,

    provider_key text not null default 'coursepilot',

    external_course_id text,

    is_active boolean not null default true,

    created_at timestamptz not null default now(),

    constraint course_booking_integrations_provider_key_check
        check (
            provider_key ~ '^[a-z][a-z0-9_]{0,49}$'
        ),

    constraint course_booking_integrations_external_course_id_check
        check (
            external_course_id is null
            or (
                external_course_id = btrim(external_course_id)
                and char_length(external_course_id) between 1 and 200
            )
        )
);

comment on table public.course_booking_integrations is
    'Non-secret booking provider routing for each course.';

comment on column public.course_booking_integrations.external_course_id is
    'Provider-side course identifier only. Never store credentials here.';

alter table public.course_booking_integrations
enable row level security;

revoke all privileges
on table public.course_booking_integrations
from anon, authenticated;

grant select
on table public.course_booking_integrations
to authenticated;

grant select, insert, update, delete
on table public.course_booking_integrations
to service_role;

create policy "Course members can view booking integrations"
on public.course_booking_integrations
for select
to authenticated
using (
    exists (
        select 1
        from public.course_members
        where course_members.course_id =
            course_booking_integrations.course_id
          and course_members.user_id = (
              select auth.uid()
          )
    )
);

insert into public.course_booking_integrations (
    course_id,
    provider_key,
    is_active
)
select
    courses.id,
    'coursepilot',
    true
from public.courses
where courses.slug = 'demo-course'
on conflict (course_id) do nothing;
