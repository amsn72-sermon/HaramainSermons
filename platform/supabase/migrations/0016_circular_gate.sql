-- =====================================================================
-- 0016 — التعميم الملزِم: يُعرض بعلامة مائية ولا يُتابَع العمل قبل
--        التوقيع عليه (ملاحظة ٨٩)
--   المرفق لا يُنزَّل ولا يُطبع: يُعرض صفحةً صفحة داخل المنصة بعلامة
--   مائية تحمل هوية المستطلِع، ويُطالَب بالتوقيع عند كل دخول.
-- =====================================================================

alter table public.circulars add column if not exists blocking boolean not null default false;

comment on column public.circulars.blocking
  is 'تعميم ملزم: لا يتابع العضو مهامه قبل الاطّلاع والتوقيع (ملاحظة ٨٩)';

-- ---------------------------------------------------------------------
-- الإرسال: خيار الإلزام مع اشتراط التوقيع
-- النسخة القديمة تُحذف حتى لا تلتبس باستدعاء واحد (توقيعان لدالة واحدة)
-- ---------------------------------------------------------------------
drop function if exists public.send_circular(text, text, text, text, text, uuid[], boolean);

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
  -- الإلزام بلا توقيع لا معنى له
  if p_blocking and not p_require_ack then
    raise exception 'التعميم الملزم يشترط التوقيع بالعلم';
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
       or (v_aud = 'translators'  and p.role = 'translator')
       or (v_aud = 'coordinators' and p.role in ('coordinator', 'manager'))
       or (v_aud = 'selected'     and p.id = any (coalesce(p_members, '{}'::uuid[]))))
  on conflict do nothing;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    delete from public.circulars where id = v_id;
    raise exception 'لا مستقبِلين لهذه الرسالة';
  end if;
  return v_id;
end $$;

grant execute on function public.send_circular(text, text, text, text, text, uuid[], boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- ما يمنع متابعة العمل: تعاميم ملزمة لم يوقّع عليها
-- ---------------------------------------------------------------------
create or replace function public.my_blocking_circulars()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.circular_recipients r
    join public.circulars c on c.id = r.circular_id
   where r.member_id = auth.uid() and r.acked_at is null
     and c.require_ack and c.blocking
$$;

grant execute on function public.my_blocking_circulars() to authenticated;

-- ---------------------------------------------------------------------
-- تسجيل كل اطّلاع على المرفق: أثر يُرجع إليه عند التسريب
-- ---------------------------------------------------------------------
create table if not exists public.circular_views (
  id          bigint generated always as identity primary key,
  circular_id uuid not null references public.circulars (id) on delete cascade,
  member_id   uuid not null references public.profiles (id) on delete cascade,
  viewed_at   timestamptz not null default now()
);

create index if not exists circular_views_idx on public.circular_views (circular_id, member_id);

alter table public.circular_views enable row level security;
drop policy if exists "see circular views" on public.circular_views;
create policy "see circular views" on public.circular_views for select
  using (member_id = auth.uid() or public.is_admin());
grant select on public.circular_views to authenticated;

create or replace function public.log_circular_view(p_circular uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.circular_recipients
                  where circular_id = p_circular and member_id = auth.uid()) then
    raise exception 'هذه الرسالة ليست إليك' using errcode = '42501';
  end if;
  insert into public.circular_views (circular_id, member_id) values (p_circular, auth.uid());
  update public.circular_recipients set read_at = coalesce(read_at, now())
   where circular_id = p_circular and member_id = auth.uid();
end $$;

grant execute on function public.log_circular_view(uuid) to authenticated;

comment on table public.circular_views
  is 'سجل مرات فتح مرفق التعميم: من فتحه ومتى (ملاحظة ٨٩)';
