-- =====================================================================
-- 0066 — حذفُ حسابِ عضو (ملاحظة ٢٠٧)
--   كان في المنصة تعطيلٌ ولا حذف: فمن سُجّل خطأً، أو كرّر التسجيل،
--   أو لم يُباشر العمل أصلًا، بقي اسمُه في القوائم أبدًا. فجُعل الحذف
--   لمدير المشروع وحده، بثلاثة أسوارٍ تحفظ السجلّ:
--
--     ١) لا يحذف أحدٌ حسابَ نفسه.
--     ٢) ولا يُحذف من في يده عملٌ لم يُنجز — يُنقل عمله أولًا.
--     ٣) ومن له سجلٌّ في المنصة — ترجمةٌ أو توقيعٌ أو مناوبةٌ أو تقييم —
--        لا يُمحى، لأن محوه يُفسد ما بُني عليه. وإنما يُعطَّل حسابُه.
--
--   والمحذوفُ يُقيَّد اسمُه وبريدُه ومن حذفه ومتى، فلا يضيع الخبر.
-- =====================================================================

create table if not exists public.removed_members (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  email       text,
  role        text,
  track       text,
  member_no   integer,
  removed_by  uuid references public.profiles (id),
  removed_at  timestamptz not null default now(),
  reason      text
);
alter table public.removed_members enable row level security;
drop policy if exists "admins read removed" on public.removed_members;
create policy "admins read removed" on public.removed_members
  for select using (public.is_admin());
grant select on public.removed_members to authenticated;

comment on table public.removed_members is
  'قيدُ من حُذفت حساباتهم: اسمُه وبريدُه ومن حذفه ومتى (ملاحظة ٢٠٧)';

-- تسويةُ الاسم للمقارنة: الفراغاتُ المتوالية واحدة، والأطرافُ تُقَصّ
create or replace function public.name_norm(p text)
returns text language sql immutable as $$
  select regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g')
$$;

create or replace function public.admin_delete_member(p_member uuid, p_name text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_p public.profiles; v_open int;
begin
  if not public.is_manager() then
    raise exception 'حذف الحسابات لمدير المشروع' using errcode = '42501';
  end if;
  if p_member = auth.uid() then
    raise exception 'لا يحذف أحدٌ حسابَ نفسه';
  end if;

  select * into v_p from public.profiles where id = p_member;
  if not found then raise exception 'العضو غير موجود'; end if;

  -- اسمُه يُكتب كما هو مسجَّل، فلا يقع الحذفُ بزلّة ضغطة
  if public.name_norm(p_name) <> public.name_norm(v_p.full_name) then
    raise exception 'اكتب اسم العضو كما هو مسجَّل لتأكيد الحذف';
  end if;

  select count(*) into v_open from public.track_stages
   where assignee_id = p_member and status <> 'done'::stage_status;
  if v_open > 0 then
    raise exception 'في يده % عملًا لم يُنجز — انقلها إلى غيره أولًا', v_open;
  end if;

  insert into public.removed_members (full_name, email, role, track, member_no, removed_by, reason)
  values (v_p.full_name, v_p.email, v_p.role::text, v_p.track, v_p.member_no, auth.uid(),
          nullif(trim(coalesce(p_reason, '')), ''));

  -- حذفُ الحساب من خدمة الحسابات يُسقط ملفَّه وما تعلّق به مما يَسقط،
  -- ويمتنع إن كان له سجلٌّ لا يَسقط — فيُبيَّن للمدير أن التعطيل هو الوجه
  begin
    delete from auth.users where id = p_member;
  exception when foreign_key_violation then
    raise exception 'لهذا العضو سجلٌّ في المنصة لا يُمحى — عطّل حسابه بدل حذفه';
  end;

  if exists (select 1 from public.profiles where id = p_member) then
    delete from public.profiles where id = p_member;
  end if;
end $$;
grant execute on function public.admin_delete_member(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
