-- Mock tee-sheet inventory for CoursePilot.
--
-- Each row represents one tee-time slot for one course and date.
-- Public customers cannot access this table directly yet.
-- Managers can view and manage slots for their own course.

create table public.tee_times (
    id uuid primary key
        default gen_random_uuid(),

    course_id uuid not null
        references public.courses(id)
        on delete cascade,

    tee_date date not null,

    tee_time time not null,

    capacity integer not null,

    reserved_players integer
        not null
        default 0,

    status text
        not null
        default 'open',

    provider_slot_id text,

    created_at timestamptz
        not null
        default now(),

    constraint tee_times_unique_slot
        unique (
            course_id,
            tee_date,
            tee_time
        ),

    constraint tee_times_capacity_check
        check (
            capacity between 1 and 12
        ),

    constraint tee_times_reserved_players_check
        check (
            reserved_players between 0 and capacity
        ),

    constraint tee_times_status_check
        check (
            status in (
                'open',
                'blocked'
            )
        )
);


create index tee_times_course_date_status_idx
on public.tee_times (
    course_id,
    tee_date,
    status,
    tee_time
);


alter table public.tee_times
enable row level security;


revoke all
on table public.tee_times
from anon, authenticated;


grant select, insert, update, delete
on table public.tee_times
to authenticated;


-- Course staff can view tee-time slots belonging
-- to courses where they are members.

create policy "Course members can view tee times"
on public.tee_times
for select
to authenticated
using (
    exists (
        select 1
        from public.course_members
        where course_members.course_id =
            tee_times.course_id
          and course_members.user_id =
            auth.uid()
    )
);


-- Only owners and managers can create tee-time slots.

create policy "Course managers can create tee times"
on public.tee_times
for insert
to authenticated
with check (
    exists (
        select 1
        from public.course_members
        where course_members.course_id =
            tee_times.course_id
          and course_members.user_id =
            auth.uid()
          and course_members.role in (
              'owner',
              'manager'
          )
    )
);


-- Only owners and managers can modify tee-time slots.

create policy "Course managers can update tee times"
on public.tee_times
for update
to authenticated
using (
    exists (
        select 1
        from public.course_members
        where course_members.course_id =
            tee_times.course_id
          and course_members.user_id =
            auth.uid()
          and course_members.role in (
              'owner',
              'manager'
          )
    )
)
with check (
    exists (
        select 1
        from public.course_members
        where course_members.course_id =
            tee_times.course_id
          and course_members.user_id =
            auth.uid()
          and course_members.role in (
              'owner',
              'manager'
          )
    )
);


-- Only owners and managers can delete tee-time slots.

create policy "Course managers can delete tee times"
on public.tee_times
for delete
to authenticated
using (
    exists (
        select 1
        from public.course_members
        where course_members.course_id =
            tee_times.course_id
          and course_members.user_id =
            auth.uid()
          and course_members.role in (
              'owner',
              'manager'
          )
    )
);


-- Generate seven days of mock tee-time inventory
-- for the current demo course.
--
-- The times, interval, and maximum group size come
-- from course_public_settings instead of being
-- hard-coded here.

insert into public.tee_times (
    course_id,
    tee_date,
    tee_time,
    capacity,
    reserved_players,
    status
)
select
    settings.course_id,

    (
        current_date +
        day_offsets.day_offset
    )::date,

    generated.slot_timestamp::time,

    settings.max_players,

    0,

    'open'
from public.course_public_settings
    as settings

join public.courses
    as course
    on course.id = settings.course_id

cross join generate_series(
    1,
    7
) as day_offsets(day_offset)

cross join lateral generate_series(
    (
        current_date +
        day_offsets.day_offset
    ) + settings.booking_start_time,

    (
        current_date +
        day_offsets.day_offset
    ) + settings.booking_end_time,

    make_interval(
        mins =>
            settings.tee_interval_minutes
    )
) as generated(slot_timestamp)

where course.slug = 'demo-course'

on conflict (
    course_id,
    tee_date,
    tee_time
)
do nothing;