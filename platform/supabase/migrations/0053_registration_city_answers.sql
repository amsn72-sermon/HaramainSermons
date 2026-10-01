-- =====================================================================
-- 0053 — التسجيل الخفيف، ومدينة المرشد، وفريق إجابة السائلين
--   ١) التسجيل أربعة بيانات لا غير: الاسم والبريد ورقم الهوية والجوال،
--      وما عداها يُستكمل بعد التفعيل، ويدقّقه المنسق ويقبله (ملاحظة ١٧٩).
--   ٢) المرشد المكاني يحدّد عند التسجيل: مكة المكرمة أو المدينة المنورة،
--      فيُدعى إلى ما يخصّ مدينته (ملاحظة ١٨٥).
--   ٣) فريقٌ ثالث: المخصَّصون لإجابة السائلين — لا يُسجَّل فيه أحد،
--      بل ينقل إليه المنسق أو مدير المشروع من يراه (ملاحظة ١٨٦).
--      وليس لأحدٍ من الفريق فتوى البتّة: ينقل السؤال ثم ينقل الجواب.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) الفريق الثالث ومدينة العضو
-- ---------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_track_check;
alter table public.profiles add constraint profiles_track_check
  check (track in ('translation', 'field', 'answers'));

alter table public.profiles add column if not exists city text;
alter table public.profiles drop constraint if exists profiles_city_check;
alter table public.profiles add constraint profiles_city_check
  check (city is null or city in ('makkah', 'madinah'));

comment on column public.profiles.city is 'مدينة المرشد المكاني: مكة المكرمة أو المدينة المنورة (ملاحظة ١٨٥)';
comment on column public.profiles.track is 'الترجمة التخصصية أو الإرشاد المكاني أو إجابة السائلين (ملاحظة ١٨٦)';

-- النقل بين الفرق الثلاثة — ولا يُسجَّل أحدٌ في «إجابة السائلين» ابتداءً
create or replace function public.set_member_track(p_member uuid, p_track text)
returns void language plpgsql security definer set search_path = public as $$
declare v_target public.profiles;
begin
  if not public.is_admin_for('team') then
    raise exception 'نقل الأعضاء بين الفرق للمنسق ومدير المشروع' using errcode = '42501';
  end if;
  if p_track not in ('translation', 'field', 'answers') then raise exception 'فريق غير معروف'; end if;
  select * into v_target from public.profiles where id = p_member for update;
  if not found then raise exception 'العضو غير موجود'; end if;
  if not public.is_manager() and v_target.role <> 'translator' then
    raise exception 'نقل المنسقين والمديرين لمدير المشروع وحده' using errcode = '42501';
  end if;
  -- لا يُنقل عن الترجمة من لديه مهمةٌ قائمة
  if p_track <> 'translation' and exists (
    select 1 from public.track_stages s
     where s.assignee_id = p_member and s.status in ('waiting', 'active')
  ) then
    raise exception 'لا يُنقل عضو لديه مهمة ترجمة قائمة — أعد إسناد مهامه أولًا';
  end if;
  update public.profiles set track = p_track where id = p_member;
end $$;
grant execute on function public.set_member_track(uuid, text) to authenticated;

create or replace function public.set_member_city(p_member uuid, p_city text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin_for('team') then
    raise exception 'تحديد المدينة للمنسق ومدير المشروع' using errcode = '42501';
  end if;
  if p_city is not null and p_city not in ('makkah', 'madinah') then
    raise exception 'المدينة: مكة المكرمة أو المدينة المنورة';
  end if;
  update public.profiles set city = p_city where id = p_member;
  if not found then raise exception 'العضو غير موجود'; end if;
end $$;
grant execute on function public.set_member_city(uuid, text) to authenticated;

-- وفريق إجابة السائلين لا تُسنَد إليه ترجمةٌ كفريق الإرشاد
create or replace function public.block_field_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_may boolean; v_track text; v_lang text;
begin
  select p.may_translate, p.track into v_may, v_track
    from public.profiles p
   where p.id = new.assignee_id and p.track in ('field', 'answers');
  if not found then return new; end if;          -- من فريق الترجمة

  if not coalesce(v_may, false) then
    raise exception 'هذا الفريق لا تُسنَد إليه أعمال ترجمة';
  end if;

  select t.language_code into v_lang from public.tracks t where t.id = new.track_id;
  if v_lang is null or not exists (
       select 1 from public.member_languages ml
        where ml.member_id = new.assignee_id and ml.language_code = v_lang) then
    raise exception 'المتميّز تُسنَد إليه الترجمة بلغته المسجَّلة وحدها';
  end if;
  return new;
end $$;

create or replace function public.guard_may_translate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.track in ('field', 'answers') and old.may_translate and not new.may_translate and exists (
       select 1 from public.track_stages s
        where s.assignee_id = new.id and s.status <> 'done'::stage_status) then
    raise exception 'له أعمال ترجمة لم تُنجز — أنهِها أو انقلها أولًا';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- ٢) استكمال البيانات بعد التفعيل، وتدقيقها وقبولها
-- ---------------------------------------------------------------------
alter table public.profile_private
  add column if not exists data_status text not null default 'incomplete',
  add column if not exists data_note   text,
  add column if not exists data_by     uuid references public.profiles (id),
  add column if not exists data_at     timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profile_private_data_status_check') then
    alter table public.profile_private add constraint profile_private_data_status_check
      check (data_status in ('incomplete', 'submitted', 'accepted', 'returned'));
  end if;
end $$;

comment on column public.profile_private.data_status is
  'حال بيانات العضو: ناقصة، مرفوعة للتدقيق، مقبولة، أو مُعادة بملاحظة (ملاحظة ١٧٩)';

-- ما ينقص العضوَ من بياناته — قائمةٌ بأسمائها كما تُعرض له
create or replace function public.profile_missing(p_id uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(x order by x), '{}'::text[]) from (
    select 'الجنسية' as x from public.profile_private pv
      where pv.id = p_id and coalesce(trim(pv.nationality), '') = ''
    union all
    select 'مكان الإقامة' from public.profile_private pv
      where pv.id = p_id and coalesce(trim(pv.residence), '') = ''
    union all
    select 'صورة الهوية أو الإقامة' from public.profile_private pv
      where pv.id = p_id and coalesce(trim(pv.iqama_path), '') = ''
    union all
    select 'الصورة الشخصية' from public.profile_private pv
      where pv.id = p_id and coalesce(trim(pv.photo_path), '') = ''
    union all
    select 'اللغات' from public.profiles p
      where p.id = p_id and p.track in ('translation', 'field')
        and not exists (select 1 from public.member_languages ml where ml.member_id = p_id)
    union all
    select 'المدينة' from public.profiles p
      where p.id = p_id and p.track = 'field' and p.city is null
  ) q;
$$;
grant execute on function public.profile_missing(uuid) to authenticated;

-- العضو يرفع بياناته للتدقيق متى اكتملت
create or replace function public.submit_profile_data()
returns text language plpgsql security definer set search_path = public as $$
declare v_missing text[];
begin
  if auth.uid() is null then raise exception 'ادخل أولًا' using errcode = '42501'; end if;
  v_missing := public.profile_missing(auth.uid());
  if array_length(v_missing, 1) is not null then
    raise exception 'بقي عليك: %', array_to_string(v_missing, '، ');
  end if;
  update public.profile_private
     set data_status = 'submitted', data_note = null, data_at = now(), data_by = null
   where id = auth.uid();
  return 'submitted';
end $$;
grant execute on function public.submit_profile_data() to authenticated;

-- ولغاته يختارها بنفسه وهو يستكمل، فإذا قُبلت بياناته صارت بيد المنسق
create or replace function public.set_my_languages(p_codes text[])
returns int language plpgsql security definer set search_path = public as $$
declare v_st text; v_code text; v_n int := 0;
begin
  if auth.uid() is null then raise exception 'ادخل أولًا' using errcode = '42501'; end if;
  select data_status into v_st from public.profile_private where id = auth.uid();
  if coalesce(v_st, 'incomplete') = 'accepted' then
    raise exception 'دُقِّقت بياناتك وقُبلت — تعديل اللغات من المنسق';
  end if;
  if coalesce(array_length(p_codes, 1), 0) = 0 then
    raise exception 'اختر لغةً واحدة على الأقل';
  end if;

  delete from public.member_languages
   where member_id = auth.uid() and language_code <> all (p_codes);
  foreach v_code in array p_codes loop
    insert into public.member_languages (member_id, language_code)
    select auth.uid(), v_code
     where exists (select 1 from public.languages where code = v_code and is_active)
    on conflict do nothing;
  end loop;
  select count(*) into v_n from public.member_languages where member_id = auth.uid();
  return v_n;
end $$;
grant execute on function public.set_my_languages(text[]) to authenticated;

-- والمنسق ومدير المشروع يدقّقان ويقبلان أو يُعيدان بملاحظة
create or replace function public.review_profile_data(p_id uuid, p_accept boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin_for('team') then
    raise exception 'تدقيق البيانات للمنسق ومدير المشروع' using errcode = '42501';
  end if;
  if not p_accept and coalesce(trim(p_note), '') = '' then
    raise exception 'اكتب ما ينقص العضو ليستدركه';
  end if;
  update public.profile_private
     set data_status = case when p_accept then 'accepted' else 'returned' end,
         data_note = nullif(trim(coalesce(p_note, '')), ''),
         data_by = auth.uid(), data_at = now()
   where id = p_id;
  if not found then raise exception 'العضو غير موجود'; end if;

  insert into public.notifications (member_id, kind, subject, body)
  values (p_id, case when p_accept then 'reminder' else 'returned' end,
          case when p_accept then 'قُبلت بياناتك' else 'بياناتك تحتاج استكمالًا' end,
          case when p_accept then 'دُقِّقت بياناتك وقُبلت، فجزاك الله خيرًا.'
               else 'راجع بياناتك: ' || coalesce(nullif(trim(p_note), ''), 'ينقصها شيء') end);
end $$;
grant execute on function public.review_profile_data(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- ٣) التسجيل: أربعة بيانات لازمة لا غير
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_lang text;
  v_as   text := nullif(trim(m ->> 'applied_as'), '');
  v_type text := nullif(trim(m ->> 'id_type'), '');
  v_name text := nullif(trim(coalesce(m ->> 'full_name', '')), '');
  v_nid  text := nullif(upper(trim(coalesce(m ->> 'national_id', ''))), '');
  v_ph   text := nullif(trim(coalesce(m ->> 'whatsapp', '')), '');
  v_city text := nullif(trim(coalesce(m ->> 'city', '')), '');
begin
  if not public.registration_open() and not public.is_manager() then
    raise exception 'التسجيل مغلق حاليًّا — راجع إدارة المشروع';
  end if;

  -- مدير المشروع يُنشئ حسابًا بالبريد وحده، والمسجِّل يأتي بالأربعة
  if not public.is_manager() then
    if v_name is null then raise exception 'اكتب اسمك الكامل'; end if;
    if v_nid  is null then raise exception 'اكتب رقم الهوية أو الإقامة'; end if;
    if v_ph   is null then raise exception 'اكتب رقم الجوال'; end if;
  end if;

  -- التسجيل في فريقين لا غير، والثالث يُنقل إليه المنسق (ملاحظة ١٨٦)
  if v_as is not null and v_as not in ('translator', 'coordinator', 'field') then v_as := null; end if;
  if v_type is null or v_type not in ('national', 'passport') then v_type := 'national'; end if;
  if v_city is not null and v_city not in ('makkah', 'madinah') then v_city := null; end if;
  if v_as = 'field' and v_city is null and not public.is_manager() then
    raise exception 'حدّد مدينتك: مكة المكرمة أو المدينة المنورة';
  end if;

  insert into public.profiles (id, full_name, email, track, city)
  values (new.id, coalesce(v_name, split_part(new.email, '@', 1)), new.email,
          case when v_as = 'field' then 'field' else 'translation' end,
          case when v_as = 'field' then v_city else null end);

  insert into public.profile_private (id, whatsapp, nationality, national_id, residence, applied_as, id_type)
  values (new.id, v_ph, m ->> 'nationality', v_nid, m ->> 'residence', v_as, v_type);

  for v_lang in select jsonb_array_elements_text(coalesce(m -> 'languages', '[]'::jsonb)) loop
    insert into public.member_languages (member_id, language_code)
    select new.id, v_lang where exists (select 1 from public.languages where code = v_lang and is_active)
    on conflict do nothing;
  end loop;
  return new;
end $$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- ٤) عدّادات التدقيق تعرف الفريق الثالث، وتعدّ البيانات المرفوعة
-- ---------------------------------------------------------------------
-- العدّاد يزيد عمودًا، فيُسقَط أولًا: «استبدال» لا يغيّر نوع المُخرَج
drop function if exists public.pending_reviews_by_group();
create function public.pending_reviews_by_group()
returns table (grp text, photos int, iqamas int, banks int, joins int, data int)
language sql stable security definer set search_path = public as $$
  select case when p.role in ('manager', 'coordinator') then 'admins'
              when coalesce(p.track, 'translation') = 'field' then 'field'
              when coalesce(p.track, 'translation') = 'answers' then 'answers'
              else 'translators' end as grp,
         count(*) filter (where v.photo_path is not null and v.photo_status = 'pending')::int,
         count(*) filter (where v.iqama_path is not null and v.iqama_status = 'pending')::int,
         count(*) filter (where b.member_id is not null and b.verified_at is null)::int,
         count(*) filter (where p.status = 'pending')::int,
         count(*) filter (where v.data_status = 'submitted')::int
    from public.profiles p
    left join public.profile_private v on v.id = p.id
    left join public.bank_accounts b on b.member_id = p.id
   where public.is_admin() and p.status <> 'disabled'
   group by 1
$$;
grant execute on function public.pending_reviews_by_group() to authenticated;

notify pgrst, 'reload schema';
