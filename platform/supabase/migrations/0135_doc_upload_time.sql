-- =====================================================================
-- ٠١٣٥ — وقتُ رفع المستند، فيُعرَف أنَّ المعادَ قد أُعيد (ملاحظة ٤٨٤)
--
--   أُعيدت هويةُ عضوٍ إليه فصحَّحها ورفعها، ثم لم تجدِ الإدارةُ زرَّ
--   اعتمادها. والسببُ أنَّ الشاشة كانت تُظهِر الاعتمادَ للمنتظِر
--   وحدَه، فإن بقيت الحالُ «أُعيدت» لسببٍ ما — رفعٌ من طريقٍ قديمٍ لا
--   يُبدِّل الحال، أو صفحةٌ لم تُحدَّث — انسدَّ البابُ على المدقِّق
--   فلا اعتمادَ ولا إعادةَ إلى التدقيق.
--
--   والعلاجُ شقّان: الشاشةُ تفتح الاعتمادَ في الحالين، وهذا الترحيلُ
--   يحفظ وقتَ آخر رفعٍ للصورة. فإذا كان الرفعُ بعد قرار الإعادة بان
--   أنَّ العضو قد أعادها، ويُكتَب ذلك في بطاقته بيِّنًا لا يُجتهَد فيه.
-- =====================================================================

alter table public.profile_private
  add column if not exists iqama_uploaded_at timestamptz,
  add column if not exists photo_uploaded_at timestamptz;

comment on column public.profile_private.iqama_uploaded_at is
  'وقتُ آخر رفعٍ لصورة الهوية — به يُعرَف أنَّ المعادَ قد أُعيد (ملاحظة ٤٨٤)';
comment on column public.profile_private.photo_uploaded_at is
  'وقتُ آخر رفعٍ للصورة الشخصية (ملاحظة ٤٨٤)';

-- ـــ ١) رفعُ العضو يكتب وقتَه
create or replace function public.set_my_iqama(p_path text)
returns void language plpgsql security definer set search_path = public as $$
declare v_path text := nullif(btrim(coalesce(p_path, '')), '');
begin
  if auth.uid() is null then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  if v_path is null then raise exception 'لا مسارَ للصورة'; end if;
  -- ولا يرفع إلا في مجلَّده هو
  if split_part(v_path, '/', 1) <> auth.uid()::text then
    raise exception 'لا تُرفَع صورةُ غيرك' using errcode = '42501';
  end if;
  insert into public.profile_private (id) values (auth.uid()) on conflict (id) do nothing;
  update public.profile_private
     set iqama_path = v_path, iqama_status = 'pending', iqama_note = null,
         iqama_by = null, iqama_at = null, iqama_uploaded_at = now()
   where id = auth.uid();
end $$;

comment on function public.set_my_iqama(text) is
  'رفعُ العضو صورةَ هويته أو إعادتُها بعد ردِّها، فتعود إلى التدقيق بوقتها (ملاحظتا ٤٤٧ و٤٨٤)';

-- ـــ ٢) ورفعُ الإدارة عنه كذلك: يعيدها إلى التدقيق ويكتب وقتَها
--   (كانت ٠١٢٦ قد رقَّعتها لتُعيد الحال، وهذه تُثبِّتها نصًّا واحدًا
--    لا يُرقَّع، وتزيد عليه الوقت)
create or replace function public.admin_set_iqama(p_member uuid, p_path text)
returns void language plpgsql security definer set search_path = public as $$
declare v_target public.profiles; v_path text := nullif(btrim(coalesce(p_path, '')), '');
begin
  -- والصلاحيةُ المفصَّلةُ باقيةٌ كما ربطها الترحيلان ٠٠٤٧ و٠٠٩٩: من
  --   أُغلق عنه مفتاحُ تعديل الفريق لا يرفع هويةَ غيره
  if not public.is_admin_for('tm_edit') then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  select * into v_target from public.profiles where id = p_member;
  if not found then raise exception 'العضو غير موجود'; end if;
  if not public.is_manager() and v_target.role <> 'translator' then
    raise exception 'هذا الإجراء لمدير المشروع فقط' using errcode = '42501';
  end if;
  if v_path is null then raise exception 'لا مسارَ للصورة'; end if;
  insert into public.profile_private (id) values (p_member) on conflict (id) do nothing;
  update public.profile_private
     set iqama_path = v_path, iqama_status = 'pending', iqama_note = null,
         iqama_by = null, iqama_at = null, iqama_uploaded_at = now()
   where id = p_member;
end $$;

comment on function public.admin_set_iqama(uuid, text) is
  'رفعُ الإدارة صورةَ هوية عضوٍ، فتعود إلى التدقيق بوقتها (ملاحظتا ٤٤٧ و٤٨٤)';

-- ـــ ٣) وقتُ الرفع يُضاف إلى ما تقرؤه شاشةُ الفريق — والهويةُ فيها
--   تبقى لمن يملك مفتاحَها كما قرَّر الترحيل ٠١٣٣
drop function if exists public.team_private();
create or replace function public.team_private()
returns table (
  id uuid, whatsapp text, residence text, applied_as text,
  photo_path text, photo_status text, photo_note text, photo_at timestamptz,
  iqama_status text, iqama_note text, iqama_at timestamptz,
  iqama_uploaded_at timestamptz, photo_uploaded_at timestamptz,
  data_status text, data_note text, data_at timestamptz,
  signature_path text, signature_at timestamptz,
  reminded_at timestamptz, remind_count int,
  -- ما لا يُعرَض إلا لمن يملك مفتاحَ الاطّلاع على الهوية
  national_id text, nationality text, iqama_path text,
  id_type text, id_expiry date
) language sql stable security definer set search_path = public as $$
  select pp.id, pp.whatsapp, pp.residence, pp.applied_as,
         pp.photo_path, pp.photo_status, pp.photo_note, pp.photo_at,
         pp.iqama_status, pp.iqama_note, pp.iqama_at,
         pp.iqama_uploaded_at, pp.photo_uploaded_at,
         pp.data_status, pp.data_note, pp.data_at,
         pp.signature_path, pp.signature_at,
         pp.reminded_at, pp.remind_count,
         case when public.is_admin_for('docs_id_view') then pp.national_id end,
         case when public.is_admin_for('docs_id_view') then pp.nationality end,
         case when public.is_admin_for('docs_id_view') then pp.iqama_path end,
         case when public.is_admin_for('docs_id_view') then pp.id_type end,
         case when public.is_admin_for('docs_id_view') then pp.id_expiry end
    from public.profile_private pp
   where public.is_admin() or pp.id = auth.uid()
$$;
grant execute on function public.team_private() to authenticated;

comment on function public.team_private() is
  'بياناتُ الفريق الخاصّة بقدر صلاحية السائل، ومعها وقتُ رفع المستندات (فحصٌ أمنيّ ٠١٣٣ وملاحظة ٤٨٤)';

-- ودالّةُ شاشة الهويات: تُعيد وقتَ الرفع ليُقابَل بوقت القرار، فيبين
--   للمدقِّق أنَّ العضو أعاد إرسالها بعد ردِّها. ومعها يدخل فريقُ إجابة
--   السائلين في فئة الميدان، فقد كان يسقط من الكشف إذ لا هو مترجمٌ
--   متخصصٌ ولا فريقُه «field».
drop function if exists public.identity_sheet(text);
create or replace function public.identity_sheet(p_group text default 'all')
returns table (
  member_id uuid, full_name text, email text, role public.app_role, track text,
  member_no int, status public.member_status,
  id_type text, national_id text, nationality text, id_expiry date,
  iqama_path text, iqama_status public.doc_status, iqama_note text, iqama_at timestamptz,
  iqama_uploaded_at timestamptz,
  days_left int, renewal_open boolean, renewal_reason text
) language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email, p.role, p.track, p.member_no, p.status,
         pp.id_type, pp.national_id, pp.nationality, pp.id_expiry,
         pp.iqama_path, pp.iqama_status, pp.iqama_note, pp.iqama_at,
         pp.iqama_uploaded_at,
         case when pp.id_expiry is null then null
              else (pp.id_expiry - current_date)::int end,
         exists (select 1 from public.doc_renewals r
                  where r.member_id = p.id and r.kind = 'iqama' and r.state = 'open'),
         (select r.reason from public.doc_renewals r
           where r.member_id = p.id and r.kind = 'iqama' and r.state = 'open' limit 1)
    from public.profiles p
    left join public.profile_private pp on pp.id = p.id
   where public.is_admin_for('docs_id_view')
     and (p_group is null or p_group = 'all'
          or (p_group = 'admins'      and p.role in ('manager', 'coordinator', 'supervisor', 'viewer'))
          or (p_group = 'translators' and p.role = 'translator'
              and coalesce(p.track, '') not in ('field', 'answers'))
          -- وفئةُ الميدان تجمعهما، ولكلٍّ فرعُه إن طُلب وحدَه، وقائدُ
          --   الفريق الميدانيِّ منهم وإلّا سقط من التبويبات كلِّها
          or (p_group = 'field'       and (coalesce(p.track, '') in ('field', 'answers')
                                           or p.role = 'field_lead'))
          or (p_group = 'answers'     and coalesce(p.track, '') = 'answers'))
   order by (pp.iqama_status is null) desc,
            (pp.iqama_status = 'pending') desc,
            coalesce(pp.id_expiry, date '9999-12-31'), p.full_name
$$;
grant execute on function public.identity_sheet(text) to authenticated;

comment on function public.identity_sheet(text) is
  'كشفُ الهويات: كلُّ أعضاء الفئة، ومعها وقتُ رفع الصورة (ملاحظات ٣٠٧ و٣١٧ و٤٨٤)';

notify pgrst, 'reload schema';
