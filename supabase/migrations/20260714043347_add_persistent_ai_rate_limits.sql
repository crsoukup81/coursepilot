-- Persist Edge Function request counters so limits survive function restarts
-- and remain effective when multiple function instances are running.

create table public.edge_rate_limit_buckets (
    scope text not null,
    identifier_hash text not null,
    window_start timestamp with time zone not null,
    window_seconds integer not null,
    request_count integer not null default 0,
    updated_at timestamp with time zone not null default clock_timestamp(),
    primary key (
        scope,
        identifier_hash,
        window_start,
        window_seconds
    ),
    constraint edge_rate_limit_buckets_scope_check
        check (scope ~ '^[a-z][a-z0-9:_-]{0,63}$'),
    constraint edge_rate_limit_buckets_identifier_hash_check
        check (identifier_hash ~ '^[0-9a-f]{64}$'),
    constraint edge_rate_limit_buckets_window_seconds_check
        check (window_seconds between 1 and 86400),
    constraint edge_rate_limit_buckets_request_count_check
        check (request_count between 0 and 100000)
);

create index edge_rate_limit_buckets_window_start_idx
on public.edge_rate_limit_buckets (window_start);

alter table public.edge_rate_limit_buckets enable row level security;

revoke all
on table public.edge_rate_limit_buckets
from public, anon, authenticated;


create or replace function public.consume_edge_rate_limit(
    p_scope text,
    p_identifier_hash text,
    p_window_seconds integer,
    p_request_limit integer
)
returns table (
    allowed boolean,
    remaining integer,
    retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_window_start timestamp with time zone;
    v_window_end timestamp with time zone;
    v_request_count integer;
    v_was_consumed boolean;
begin
    if p_scope is null
       or p_scope !~ '^[a-z][a-z0-9:_-]{0,63}$'
       or p_identifier_hash is null
       or p_identifier_hash !~ '^[0-9a-f]{64}$'
       or p_window_seconds not between 1 and 86400
       or p_request_limit not between 1 and 100000 then
        raise exception 'Invalid rate-limit parameters.'
            using errcode = '22023';
    end if;

    v_window_start := to_timestamp(
        floor(
            extract(epoch from clock_timestamp())
            / p_window_seconds
        ) * p_window_seconds
    );
    v_window_end := v_window_start
        + make_interval(secs => p_window_seconds);

    insert into public.edge_rate_limit_buckets (
        scope,
        identifier_hash,
        window_start,
        window_seconds,
        request_count,
        updated_at
    )
    values (
        p_scope,
        p_identifier_hash,
        v_window_start,
        p_window_seconds,
        1,
        clock_timestamp()
    )
    on conflict (
        scope,
        identifier_hash,
        window_start,
        window_seconds
    ) do update
    set request_count =
            public.edge_rate_limit_buckets.request_count + 1,
        updated_at = clock_timestamp()
    where public.edge_rate_limit_buckets.request_count
        < p_request_limit
    returning request_count
    into v_request_count;

    v_was_consumed := v_request_count is not null;

    if v_request_count is null then
        select bucket.request_count
        into v_request_count
        from public.edge_rate_limit_buckets as bucket
        where bucket.scope = p_scope
          and bucket.identifier_hash = p_identifier_hash
          and bucket.window_start = v_window_start
          and bucket.window_seconds = p_window_seconds;
    end if;

    return query
    select
        v_was_consumed,
        greatest(p_request_limit - v_request_count, 0),
        case
            when v_was_consumed then 0
            else greatest(
                1,
                ceil(
                    extract(
                        epoch from (
                            v_window_end - clock_timestamp()
                        )
                    )
                )::integer
            )
        end;
end;
$$;

revoke execute
on function public.consume_edge_rate_limit(
    text,
    text,
    integer,
    integer
)
from public, anon, authenticated;

grant execute
on function public.consume_edge_rate_limit(
    text,
    text,
    integer,
    integer
)
to service_role;
