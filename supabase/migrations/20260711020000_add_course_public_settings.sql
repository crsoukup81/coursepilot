-- Public booking settings for each golf course.
--
-- These values are safe for the public booking page to read.
-- Secret provider credentials must never be stored in this table.

create table public.course_public_settings (
    course_id uuid primary key
        references public.courses(id)
        on delete cascade,

    timezone text
        not null
        default 'America/Detroit',

    booking_start_time time
        not null
        default time '08:04',

    booking_end_time time
        not null
        default time '18:20',

    tee_interval_minutes integer
        not null
        default 8,

    max_players integer
        not null
        default 4,

    created_at timestamptz
        not null
        default now(),

    constraint course_settings_time_range_check
        check (
            booking_end_time >
            booking_start_time
        ),

    constraint course_settings_interval_check
        check (
            tee_interval_minutes
            between 1 and 60
        ),

    constraint course_settings_max_players_check
        check (
            max_players
            between 1 and 12
        )
);

alter table public.course_public_settings
enable row level security;

revoke all
on table public.course_public_settings
from anon, authenticated;

grant select
on table public.course_public_settings
to anon, authenticated;

create policy "Anyone can view public course settings"
on public.course_public_settings
for select
to anon, authenticated
using (true);


-- Create the settings row for the current demo course.

insert into public.course_public_settings (
    course_id,
    timezone,
    booking_start_time,
    booking_end_time,
    tee_interval_minutes,
    max_players
)
select
    id,
    'America/Detroit',
    time '08:04',
    time '18:20',
    8,
    4
from public.courses
where slug = 'demo-course'
on conflict (course_id)
do update set
    timezone = excluded.timezone,
    booking_start_time =
        excluded.booking_start_time,
    booking_end_time =
        excluded.booking_end_time,
    tee_interval_minutes =
        excluded.tee_interval_minutes,
    max_players =
        excluded.max_players;