-- MAX Agent private cloud sync (per-user documents + private photo bucket)
create table if not exists public.user_docs (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (char_length(kind) <= 20),
  id text not null check (char_length(id) <= 120),
  data jsonb,
  rev bigint not null,
  deleted boolean not null default false,
  server_at timestamptz not null default clock_timestamp(),
  primary key (user_id, kind, id)
);
create index if not exists user_docs_pull on public.user_docs (user_id, server_at);
alter table public.user_docs enable row level security;
drop policy if exists "own docs" on public.user_docs;
create policy "own docs" on public.user_docs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.user_docs from anon;
grant select, insert, update, delete on public.user_docs to authenticated;

create or replace function public.user_docs_touch() returns trigger language plpgsql as $$
begin new.server_at := clock_timestamp(); return new; end $$;
drop trigger if exists user_docs_touch on public.user_docs;
create trigger user_docs_touch before insert or update on public.user_docs for each row execute function public.user_docs_touch();

-- Push a batch; a row only overwrites the server copy when its rev is newer (last-write-wins).
-- Returns the keys that were NOT applied because the server copy is newer.
drop function if exists public.sync_push(jsonb);
create or replace function public.sync_push(p_rows jsonb) returns table(r_kind text, r_id text)
language plpgsql security invoker set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  insert into public.user_docs as d (user_id, kind, id, data, rev, deleted)
  select uid, r->>'kind', r->>'id', case when coalesce((r->>'deleted')::boolean,false) then null else r->'data' end, (r->>'rev')::bigint, coalesce((r->>'deleted')::boolean,false)
  from jsonb_array_elements(p_rows) r
  on conflict on constraint user_docs_pkey do update set data = excluded.data, rev = excluded.rev, deleted = excluded.deleted
  where d.rev < excluded.rev;
  return query select d.kind, d.id from public.user_docs d join jsonb_array_elements(p_rows) r on d.user_id = uid and d.kind = r->>'kind' and d.id = r->>'id' where d.rev > (r->>'rev')::bigint;
end $$;
revoke all on function public.sync_push(jsonb) from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;

-- Private bucket: user-photos/<uid>/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('user-photos', 'user-photos', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['image/jpeg','image/png','image/webp'];
drop policy if exists "user-photos own read" on storage.objects;
drop policy if exists "user-photos own insert" on storage.objects;
drop policy if exists "user-photos own update" on storage.objects;
drop policy if exists "user-photos own delete" on storage.objects;
create policy "user-photos own read" on storage.objects for select to authenticated using (bucket_id = 'user-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "user-photos own insert" on storage.objects for insert to authenticated with check (bucket_id = 'user-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "user-photos own update" on storage.objects for update to authenticated using (bucket_id = 'user-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "user-photos own delete" on storage.objects for delete to authenticated using (bucket_id = 'user-photos' and (storage.foldername(name))[1] = auth.uid()::text);
