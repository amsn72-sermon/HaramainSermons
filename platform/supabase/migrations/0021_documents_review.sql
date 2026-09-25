-- =====================================================================
-- 0021 — تدقيق مستندات العضو (ملاحظة ٩٨)
--   الصورة الشخصية وصورة الهوية لا تُعتمدان إلا بمراجعة الإدارة،
--   ولها أن تعيدهما بسبب مكتوب فيرفع العضو غيرهما.
--   والحساب البنكي يبقى «تحت المراجعة» حتى يُطابَق بخطاب البنك.
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'doc_status') then
    create type public.doc_status as enum ('pending', 'approved', 'rejected');
  end if;
end $$;

alter table public.profile_private add column if not exists photo_status public.doc_status not null default 'pending';
alter table public.profile_private add column if not exists photo_note   text;
alter table public.profile_private add column if not exists photo_by     uuid references public.profiles (id);
alter table public.profile_private add column if not exists photo_at     timestamptz;

alter table public.profile_private add column if not exists iqama_status public.doc_status not null default 'pending';
alter table public.profile_private add column if not exists iqama_note   text;
alter table public.profile_private add column if not exists iqama_by     uuid references public.profiles (id);
alter table public.profile_private add column if not exists iqama_at     timestamptz;

comment on column public.profile_private.photo_status is 'حالة الصورة الشخصية: بانتظار المراجعة، معتمدة، أو معادة بسبب (ملاحظة ٩٨)';
comment on column public.profile_private.iqama_status is 'حالة صورة الهوية أو الإقامة';

-- رفع صورة جديدة يعيدها إلى المراجعة
create or replace function public.set_member_photo(p_path text, p_member uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_member uuid := coalesce(p_member, auth.uid());
begin
  if auth.uid() is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if v_member <> auth.uid() and not public.is_admin() then
    raise exception 'لا تُعدّل صورة غيرك' using errcode = '42501';
  end if;
  insert into public.profile_private (id) values (v_member) on conflict (id) do nothing;
  update public.profile_private
     set photo_path = nullif(trim(coalesce(p_path, '')), ''),
         photo_status = 'pending', photo_note = null, photo_by = null, photo_at = null
   where id = v_member;
end $$;

grant execute on function public.set_member_photo(text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- قرار الإدارة على المستند: اعتماد أو إعادة بسبب
-- ---------------------------------------------------------------------
create or replace function public.review_member_doc(
  p_member uuid, p_kind text, p_decision text, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_target public.profiles; v_status public.doc_status;
begin
  if not public.is_admin() then raise exception 'تدقيق المستندات للمنسق ومدير المشروع' using errcode = '42501'; end if;
  select * into v_target from public.profiles where id = p_member;
  if not found then raise exception 'العضو غير موجود'; end if;
  if p_kind not in ('photo', 'iqama') then raise exception 'نوع مستند غير معروف'; end if;

  v_status := case p_decision when 'approved' then 'approved'::public.doc_status
                              when 'rejected' then 'rejected'::public.doc_status
                              else 'pending'::public.doc_status end;
  if v_status = 'rejected' and nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'اكتب سبب الإعادة ليعرف العضو ما يصحّحه';
  end if;

  insert into public.profile_private (id) values (p_member) on conflict (id) do nothing;
  if p_kind = 'photo' then
    update public.profile_private
       set photo_status = v_status, photo_note = nullif(trim(coalesce(p_note, '')), ''),
           photo_by = auth.uid(), photo_at = now()
     where id = p_member;
  else
    update public.profile_private
       set iqama_status = v_status, iqama_note = nullif(trim(coalesce(p_note, '')), ''),
           iqama_by = auth.uid(), iqama_at = now()
     where id = p_member;
  end if;
end $$;

grant execute on function public.review_member_doc(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- ما ينتظر تدقيق الإدارة: عدّاد سريع لشاشة شؤون الفريق
-- ---------------------------------------------------------------------
create or replace function public.pending_reviews()
returns table (photos int, iqamas int, banks int, joins int)
language sql stable security definer set search_path = public as $$
  select
    (select count(*)::int from public.profile_private p join public.profiles f on f.id = p.id
      where p.photo_path is not null and p.photo_status = 'pending' and f.status = 'active'),
    (select count(*)::int from public.profile_private p join public.profiles f on f.id = p.id
      where p.iqama_path is not null and p.iqama_status = 'pending' and f.status = 'active'),
    (select count(*)::int from public.bank_accounts where verified_at is null),
    (select count(*)::int from public.profiles where status = 'pending')
  where public.is_admin()
$$;

grant execute on function public.pending_reviews() to authenticated;

-- الإدارة ترى صور الأعضاء كلها لتدققها
drop policy if exists "own photo read" on storage.objects;
create policy "own photo read" on storage.objects for select using (
  bucket_id = 'member-photos' and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text)
);
