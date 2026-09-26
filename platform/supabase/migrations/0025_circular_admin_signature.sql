-- =====================================================================
-- 0025 — تحكّم الإدارة في المراسلات، والتوقيع اليدوي (ملاحظتا ١٠٩ و١١٠)
--   الإدارة تعدّل ما أرسلته وتذكّر من لم يوقّع وتوقف الإلزام وتحذف
--   الرسالة عند الحاجة، وكل ذلك بأثر مسجَّل.
--   والعضو يرسم توقيعه مرة واحدة فيُحفظ، ثم يُدرَج مع التوقيع
--   الإلكتروني (الاسم والوقت) عند كل توقيع بالعلم.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) التوقيع اليدوي المحفوظ في ملف العضو
-- ---------------------------------------------------------------------
alter table public.profile_private add column if not exists signature_path text;
alter table public.profile_private add column if not exists signature_at timestamptz;

comment on column public.profile_private.signature_path
  is 'توقيع العضو المرسوم بيده، يُدرَج على ما يوقّع عليه (ملاحظة ١١٠)';

create or replace function public.set_my_signature(p_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  insert into public.profile_private (id) values (auth.uid()) on conflict (id) do nothing;
  update public.profile_private
     set signature_path = nullif(trim(coalesce(p_path, '')), ''),
         signature_at = case when nullif(trim(coalesce(p_path, '')), '') is null then null else now() end
   where id = auth.uid();
end $$;

grant execute on function public.set_my_signature(text) to authenticated;

-- حاوية التواقيع: خاصة، لكل عضو مجلده، والإدارة تطّلع
insert into storage.buckets (id, name, public) values ('signatures', 'signatures', false)
on conflict (id) do nothing;

drop policy if exists "own signature write" on storage.objects;
create policy "own signature write" on storage.objects for insert to authenticated with check (
  bucket_id = 'signatures' and (storage.foldername(name))[1] = auth.uid()::text
);
drop policy if exists "own signature update" on storage.objects;
create policy "own signature update" on storage.objects for update to authenticated using (
  bucket_id = 'signatures' and (storage.foldername(name))[1] = auth.uid()::text
);
drop policy if exists "own signature read" on storage.objects;
create policy "own signature read" on storage.objects for select to authenticated using (
  bucket_id = 'signatures' and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text)
);

-- ---------------------------------------------------------------------
-- ٢) التوقيع بالعلم يحمل صورة التوقيع وقت التوقيع
-- ---------------------------------------------------------------------
alter table public.circular_recipients add column if not exists signature_path text;

-- النسخة القديمة تُحذف حتى لا يلتبس الاستدعاء بتوقيعين لدالة واحدة
drop function if exists public.ack_circular(uuid, text);

create or replace function public.ack_circular(p_circular uuid, p_name text, p_signature text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_sig text := nullif(trim(coalesce(p_signature, '')), '');
begin
  if length(trim(coalesce(p_name, ''))) < 3 then raise exception 'اكتب اسمك الكامل توقيعًا بالعلم'; end if;
  -- التوقيع المرسوم يُؤخذ من ملف العضو إن لم يُمرَّر
  if v_sig is null then select signature_path into v_sig from public.profile_private where id = auth.uid(); end if;
  update public.circular_recipients
     set read_at = coalesce(read_at, now()), acked_at = coalesce(acked_at, now()),
         signed_name = trim(p_name), signature_path = coalesce(signature_path, v_sig)
   where circular_id = p_circular and member_id = auth.uid();
  if not found then raise exception 'هذه الرسالة ليست موجّهة إليك'; end if;
end $$;

grant execute on function public.ack_circular(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- ٣) تحكّم الإدارة: تعديل، تذكير، إيقاف الإلزام، حذف — بأثر مسجَّل
-- ---------------------------------------------------------------------
alter table public.circulars add column if not exists edited_at timestamptz;
alter table public.circulars add column if not exists edited_by uuid references public.profiles (id);
alter table public.circulars add column if not exists reminded_at timestamptz;

create or replace function public.update_circular(
  p_id uuid, p_title text default null, p_body text default null, p_kind text default null,
  p_require_ack boolean default null, p_blocking boolean default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_c public.circulars;
begin
  if not public.is_admin() then raise exception 'تعديل المراسلات للمنسق ومدير المشروع' using errcode = '42501'; end if;
  select * into v_c from public.circulars where id = p_id for update;
  if not found then raise exception 'الرسالة غير موجودة'; end if;
  if p_title is not null and length(trim(p_title)) < 3 then raise exception 'اكتب عنوان الرسالة'; end if;

  update public.circulars
     set title = coalesce(nullif(trim(coalesce(p_title, '')), ''), title),
         body  = case when p_body is null then body else nullif(trim(p_body), '') end,
         kind  = coalesce(nullif(trim(coalesce(p_kind, '')), ''), kind),
         require_ack = coalesce(p_require_ack, require_ack),
         blocking = case when coalesce(p_require_ack, require_ack) then coalesce(p_blocking, blocking) else false end,
         edited_at = now(), edited_by = auth.uid()
   where id = p_id;
end $$;

grant execute on function public.update_circular(uuid, text, text, text, boolean, boolean) to authenticated;

-- تذكير من لم يوقّع: إشعار جديد لكل من لم يوقّع بعد
create or replace function public.remind_circular(p_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_c public.circulars; v_n int := 0; v_r record;
begin
  if not public.is_admin() then raise exception 'التذكير للمنسق ومدير المشروع' using errcode = '42501'; end if;
  select * into v_c from public.circulars where id = p_id;
  if not found then raise exception 'الرسالة غير موجودة'; end if;

  for v_r in select r.member_id from public.circular_recipients r
              join public.profiles p on p.id = r.member_id
             where r.circular_id = p_id and r.acked_at is null and p.status = 'active'
  loop
    perform public.enqueue_notification(
      v_r.member_id, 'returned',
      format('تذكير: %s', v_c.title),
      format(E'ما زالت هذه الرسالة بانتظار اطّلاعك وتوقيعك بالعلم في منصة ترجمة الحرمين.\n\nالعنوان: %s\n\nادخل المنصة ← المراسلات.', v_c.title),
      null);
    v_n := v_n + 1;
  end loop;

  update public.circulars set reminded_at = now() where id = p_id;
  return v_n;
end $$;

grant execute on function public.remind_circular(uuid) to authenticated;

-- حذف الرسالة: لمدير المشروع وحده، ويمضي معها سجل مستقبليها
create or replace function public.delete_circular(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'حذف المراسلات لمدير المشروع وحده' using errcode = '42501'; end if;
  delete from public.circulars where id = p_id;
  if not found then raise exception 'الرسالة غير موجودة'; end if;
end $$;

grant execute on function public.delete_circular(uuid) to authenticated;
