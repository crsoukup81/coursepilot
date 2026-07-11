-- Safely expose available tee times without exposing
-- the complete tee_times table to public users.

create or replace function public.get_available_tee_times(
    p_course_id uuid,
    p_tee_date date,
    p_players integer
)
returns table (
    slot_time time without time zone,
    remaining_players integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
    select
        tee_times.tee_time as slot_time,

        (
            tee_times.capacity -
            tee_times.reserved_players
        )::integer as remaining_players

    from public.tee_times

    join public.course_public_settings
        on course_public_settings.course_id =
            tee_times.course_id

    where tee_times.course_id = p_course_id

      and tee_times.tee_date = p_tee_date

      and tee_times.status = 'open'

      and p_players between
          1 and course_public_settings.max_players

      and (
          tee_times.capacity -
          tee_times.reserved_players
      ) >= p_players

      -- Do not return tee times that have already passed
      -- in the golf course's configured time zone.
      and (
          tee_times.tee_date +
          tee_times.tee_time
      ) > (
          now() at time zone
          course_public_settings.timezone
      )

    order by tee_times.tee_time;
$function$;


-- Remove the default ability for every database role
-- to execute the function.

revoke all
on function public.get_available_tee_times(
    uuid,
    date,
    integer
)
from public;


-- The public booking page and signed-in managers
-- may call this restricted function.

grant execute
on function public.get_available_tee_times(
    uuid,
    date,
    integer
)
to anon, authenticated;


comment on function public.get_available_tee_times(
    uuid,
    date,
    integer
)
is
'Returns safe public tee-time availability for a course, date, and requested group size.';
