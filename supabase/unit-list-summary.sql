-- Room-list preview for the signed-in owner.
-- Read-only projection of public.user_docs. security_invoker: RLS on user_docs
-- still applies (a row is visible only when user_id = auth.uid()).
-- No anon policy and no writes. The view runs as the invoker, not as its owner.
--
-- Rollback (one line):
--   drop view if exists public.unit_list_summary;

drop view if exists public.unit_list_summary;

create view public.unit_list_summary
with (security_invoker = true) as
with covers as (
  select distinct on (data->>'unitId')
    data->>'unitId' as unit_id,
    id as cover_id,
    data->>'url' as cover_url,
    case when coalesce(data->>'tsz', '') ~ '^[0-9]+$' then (data->>'tsz')::int else 0 end as cover_tsz,
    case when coalesce(data->>'fsz', '') ~ '^[0-9]+$' then (data->>'fsz')::int else 0 end as cover_fsz
  from public.user_docs
  where kind = 'photo'
    and not deleted
    and coalesce(data->>'unitId', '') <> ''
  order by data->>'unitId',
    case when lower(coalesce(data->>'cover', '')) in ('true', 't', '1') then 1 else 0 end desc,
    case when coalesce(data->>'order', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then (data->>'order')::numeric else null end nulls last,
    id
),
counts as (
  select data->>'unitId' as unit_id, count(*)::int as photo_n
  from public.user_docs
  where kind = 'photo'
    and not deleted
    and coalesce(data->>'unitId', '') <> ''
  group by 1
)
select
  u.id,
  u.rev,
  u.server_at,
  u.data->>'project' as project,
  u.data->>'building' as building,
  u.data->>'room' as room,
  u.data->>'floor' as floor,
  u.data->>'rent' as rent,
  u.data->>'salePrice' as sale_price,
  u.data->>'type' as type,
  u.data->>'bath' as bath,
  u.data->>'size' as size,
  u.data->>'view' as view,
  u.data->>'status' as status,
  u.data->>'station' as station,
  u.data->>'stationDist' as station_dist,
  case when lower(coalesce(u.data->>'fav', '')) in ('true', 't', '1') then true else false end as fav,
  case when coalesce(u.data->>'createdAt', '') ~ '^[0-9]+$' then (u.data->>'createdAt')::bigint else null end as created_at,
  case when coalesce(u.data->>'lastPosted', '') ~ '^[0-9]+$' then (u.data->>'lastPosted')::bigint else null end as last_posted,
  case when coalesce(u.data->>'postCount', '') ~ '^[0-9]+$' then (u.data->>'postCount')::int else 0 end as post_count,
  u.data->>'notes' as notes,
  u.data->>'sourceUrl' as source_url,
  u.data->>'owner' as owner,
  u.data->>'ownerPhone' as owner_phone,
  u.data->>'ownerLine' as owner_line,
  u.data->>'start' as start_date,
  u.data->>'end' as end_date,
  c.cover_id,
  c.cover_url,
  coalesce(c.cover_tsz, 0) as cover_tsz,
  coalesce(c.cover_fsz, 0) as cover_fsz,
  coalesce(n.photo_n, 0) as photo_n
from public.user_docs u
left join covers c on c.unit_id = u.id
left join counts n on n.unit_id = u.id
where u.kind = 'unit'
  and not u.deleted;

revoke all on table public.unit_list_summary from public, anon, authenticated, service_role;
grant select on table public.unit_list_summary to authenticated;

comment on view public.unit_list_summary is
  'Read-only room list for the signed-in user. security_invoker, RLS on user_docs. Rollback: drop view if exists public.unit_list_summary;';
