-- Keep the CoursePilot demo useful without manually reseeding fixed dates.
-- External booking providers will supply their own live inventory instead.

create extension if not exists pg_cron
with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;


create schema if not exists private;

revoke all
on schema private
from public, anon, authenticated;

grant usage
on schema private
to service_role;


create or replace function private.refresh_demo_tee_times(
    p_days_ahead integer default 14
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
    v_inserted_rows integer;
begin
    if p_days_ahead not between 1 and 60 then
        raise exception 'Days ahead must be between 1 and 60.'
            using errcode = '22023';
    end if;

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
            timezone(
                settings.timezone,
                clock_timestamp()
            )::date
            + day_offsets.day_offset
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
        p_days_ahead
    ) as day_offsets(day_offset)

    cross join lateral generate_series(
        (
            timezone(
                settings.timezone,
                clock_timestamp()
            )::date
            + day_offsets.day_offset
        ) + settings.booking_start_time,

        (
            timezone(
                settings.timezone,
                clock_timestamp()
            )::date
            + day_offsets.day_offset
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

    get diagnostics v_inserted_rows = row_count;

    return v_inserted_rows;
end;
$$;

revoke execute
on function private.refresh_demo_tee_times(integer)
from public, anon, authenticated;

grant execute
on function private.refresh_demo_tee_times(integer)
to service_role;


-- Seed the live demo immediately.
select private.refresh_demo_tee_times(14);


-- Refresh at 04:15 UTC each day. Existing tee-time rows remain unchanged,
-- preserving manager blocks, reservations, and booking history.
do $$
begin
    if not exists (
        select 1
        from cron.job
        where jobname =
            'coursepilot-refresh-demo-tee-times'
    ) then
        perform cron.schedule(
            'coursepilot-refresh-demo-tee-times',
            '15 4 * * *',
            'select private.refresh_demo_tee_times(14);'
        );
    end if;
end;
$$;
