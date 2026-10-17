drop policy if exists "anyone can read" on public.shared_rooms;
drop policy if exists "anyone can create" on public.shared_rooms;
drop policy if exists "anyone can upload photos" on storage.objects;
revoke insert, update, delete on public.shared_rooms from anon, authenticated;
create or replace function public.get_room(p_id text) returns jsonb
language sql stable security definer set search_path = public as
$$ select data from public.shared_rooms where id = p_id $$;
revoke all on function public.get_room(text) from public;
grant execute on function public.get_room(text) to anon, authenticated;
update storage.buckets set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'] where id = 'room-photos';
