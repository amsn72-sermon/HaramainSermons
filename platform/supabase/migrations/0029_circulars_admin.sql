-- =====================================================================
-- 0029 — إصلاح توجيه المراسلات وإدارتها (ملاحظة ١١٩)
--   ١) «فريق الإرشاد المكاني» لم يكن له مستقبِلون أصلًا، فكانت الرسالة
--      تُرفض بعد كتابتها ويضيع ما كُتب. وكذلك «المترجمون» كانت تشمل
--      المرشدين المكانيين خلافًا لفصل المسارين (ملاحظة ٩٩).
--   ٢) الأرشفة: تُخفى الرسالة عن الفريق ويبقى سجلها وتواقيعها للإدارة،
--      فلا يُضطر المدير إلى الحذف النهائي.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) الأرشفة
-- ---------------------------------------------------------------------
alter table public.circulars add column if not exists archived_at timestamptz;
alter table public.circulars add column if not exists archived_by uuid references public.profiles (id);

comment on column public.circulars.archived_at
  is 'وقت أرشفة الرسالة: تُخفى عن الفريق ويبقى سجلها للإدارة (ملاحظة ١١٩)';

-- العضو لا يرى المؤرشف، والإدارة ترى كل شيء
drop policy if exists "see circulars" on public.circulars;
create policy "see circulars" on public.circulars for select using (
  public.is_admin() or (archived_at is null and exists (
    select 1 from public.circular_recipients r
     where r.circular_id = id and r.member_id = auth.uid()))
);

create or replace function public.archive_circular(p_id uuid, p_on boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'أرشفة المراسلات للمنسق ومدير المشروع' using errcode = '42501'; end if;
  update public.circulars
     set archived_at = case when coalesce(p_on, true) then now() else null end,
         archived_by = case when coalesce(p_on, true) then auth.uid() else null end
   where id = p_id;
  if not found then raise exception 'الرسالة غير موجودة'; end if;
end $$;

grant execute on function public.archive_circular(uuid, boolean) to authenticated;

-- المؤرشف لا يُطالَب به العضو ولا يُعدّ في شارته
create or replace function public.my_pending_circulars()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.circular_recipients r
    join public.circulars c on c.id = r.circular_id
   where r.member_id = auth.uid() and r.acked_at is null and c.require_ack
     and c.archived_at is null
$$;

create or replace function public.my_blocking_circulars()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.circular_recipients r
    join public.circulars c on c.id = r.circular_id
   where r.member_id = auth.uid() and r.acked_at is null
     and c.require_ack and c.blocking and c.archived_at is null
$$;

revoke all on function public.my_pending_circulars() from public;
revoke all on function public.my_blocking_circulars() from public;
grant execute on function public.my_pending_circulars() to authenticated;
grant execute on function public.my_blocking_circulars() to authenticated;

-- ---------------------------------------------------------------------
-- ٢) الإرسال: كل فئة ومن فيها، والمرشدون المكانيون فئة مستقلة
-- ---------------------------------------------------------------------
drop function if exists public.send_circular(text, text, text, text, text, uuid[], boolean, boolean);

create or replace function public.send_circular(
  p_title    text,
  p_kind     text default 'notice',
  p_body     text default null,
  p_pdf_path text default null,
  p_audience text default 'all',
  p_members  uuid[] default null,
  p_require_ack boolean default true,
  p_blocking boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_aud text := coalesce(nullif(trim(p_audience), ''), 'all'); v_n int;
begin
  if not public.is_admin() then raise exception 'إرسال المراسلات للمنسقين ومدير المشروع' using errcode = '42501'; end if;
  if length(trim(coalesce(p_title, ''))) < 3 then raise exception 'اكتب عنوان الرسالة'; end if;
  if nullif(trim(coalesce(p_body, '')), '') is null and p_pdf_path is null then
    raise exception 'اكتب نص الرسالة أو أرفق ملف PDF';
  end if;
  if p_blocking and not p_require_ack then
    raise exception 'التعميم الملزم يشترط التوقيع بالعلم';
  end if;
  if v_aud not in ('all', 'translators', 'field', 'coordinators', 'selected') then
    raise exception 'فئة المرسَل إليهم غير معروفة';
  end if;

  insert into public.circulars (kind, title, body, pdf_path, audience, require_ack, blocking, sent_by)
  values (coalesce(nullif(trim(p_kind), ''), 'notice'), trim(p_title),
          nullif(trim(coalesce(p_body, '')), ''), p_pdf_path, v_aud,
          coalesce(p_require_ack, true), coalesce(p_blocking, false), auth.uid())
  returning id into v_id;

  insert into public.circular_recipients (circular_id, member_id)
  select v_id, p.id from public.profiles p
   where p.status = 'active'
     and (v_aud = 'all'
       or (v_aud = 'translators'  and p.role = 'translator' and coalesce(p.track, 'translation') <> 'field')
       or (v_aud = 'field'        and coalesce(p.track, 'translation') = 'field')
       or (v_aud = 'coordinators' and p.role in ('coordinator', 'manager'))
       or (v_aud = 'selected'     and p.id = any (coalesce(p_members, '{}'::uuid[]))))
  on conflict do nothing;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    delete from public.circulars where id = v_id;
    raise exception 'لا أعضاء مفعّلين في الفئة المختارة، فاختر فئة أخرى أو حدّد الأعضاء';
  end if;
  return v_id;
end $$;

grant execute on function public.send_circular(text, text, text, text, text, uuid[], boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- ٣) كشف من وُجّهت إليهم: من وقّع ومتى، ومن لم يوقّع
-- ---------------------------------------------------------------------
create or replace function public.circular_recipients_list(p_circular uuid)
returns table (member_id uuid, full_name text, role text, member_no text,
               read_at timestamptz, acked_at timestamptz, signed_name text, signature_path text)
language sql stable security definer set search_path = public as $$
  select r.member_id, p.full_name, p.role, p.member_no,
         r.read_at, r.acked_at, r.signed_name, r.signature_path
    from public.circular_recipients r
    join public.profiles p on p.id = r.member_id
   where r.circular_id = p_circular and public.is_admin()
   order by (r.acked_at is null) desc, p.full_name
$$;

grant execute on function public.circular_recipients_list(uuid) to authenticated;
