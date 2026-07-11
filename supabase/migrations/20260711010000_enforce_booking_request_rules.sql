-- Enforce the current CoursePilot booking-request rules.
--
-- These constraints protect the database even if a request
-- bypasses the normal website interface.

alter table public.bookings
add constraint bookings_name_length_check
check (
    char_length(trim(name))
    between 2 and 100
);

alter table public.bookings
add constraint bookings_day_format_check
check (
    case
        when day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        then
            to_char(
                to_date(day, 'YYYY-MM-DD'),
                'YYYY-MM-DD'
            ) = day
        else false
    end
);

alter table public.bookings
add constraint bookings_time_rules_check
check (
    case
        when time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        then
            time::time >= time '08:04'
            and time::time <= time '18:20'
            and mod(
                (
                    extract(
                        epoch from (
                            time::time - time '08:04'
                        )
                    ) / 60
                )::integer,
                8
            ) = 0
        else false
    end
);

alter table public.bookings
add constraint bookings_players_check
check (
    players ~ '^[1-4]$'
);