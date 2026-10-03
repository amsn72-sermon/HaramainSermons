-- =====================================================================
-- 0068 — الصلاحياتُ والنطاقُ والمدينة (ملاحظات ٢١١، ٢١٣، ٢١٤، ٢٢١، ٢٢٢)
--
--   ٢١١ — مسحُ تسجيل التحقق بخطوتين لمن يملك صلاحية الفريق، لا لمدير
--         المشروع وحده، فلا يتعطّل عضوٌ بانتظاره.
--   ٢١٣ — قائمةُ الصلاحيات لا يراها صاحبُها: يضبطها مديرُ المشروع ولا
--         تُعرَض على المنسق ولا على مدير المشروع من الهيئة.
--   ٢١٤ — «حذف الحساب» صلاحيةٌ تُمنح وتُمنع، ومغلقةٌ ابتداءً لأن الحذف
--         لا يُستدرك. وهذا يقتضي أن تعرف قائمةُ المفاتيح أصلَ كل مفتاح:
--         مفتوحٌ حتى يُغلق، أو مغلقٌ حتى يُفتح.
--   ٢٢١ — قائدُ الفريق الميداني: نطاقُه مدينةٌ ووردية، لا يرى ولا يكتب
--         إلا فيمن هم في نطاقه.
--   ٢٢٢ — بنيةُ الفرق: المرشدون المكانيون وإجابةُ السائلين في مكة
--         والمدينة، والمترجمون المتخصصون أصلُهم مكة وفيهم من يعمل عن
--         بُعد — فتُطلب المدينةُ من الجميع، ويُسأل كلٌّ عن موقعه.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) أصلُ المفتاح: مفتوحٌ حتى يُغلق، أو مغلقٌ حتى يُفتح (ملاحظة ٢١٤)
-- ---------------------------------------------------------------------
alter table public.perm_keys
  add column if not exists default_open boolean not null default true;

comment on column public.perm_keys.default_open is
  'أصلُ المفتاح: مفتوحٌ حتى يُغلق (الغالب)، أو مغلقٌ حتى يُفتح كالحذف (ملاحظة ٢١٤)';

insert into public.perm_keys (key, label, sort, default_open)
values ('delete_member', 'حذف حسابات الأعضاء',
        coalesce((select max(sort) + 1 from public.perm_keys), 1), false)
on conflict (key) do update set label = excluded.label, default_open = excluded.default_open;

-- الفحصُ يرجع إلى أصل المفتاح لا إلى «مفتوحٍ دائمًا»
create or replace function public.has_perm(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_manager() then true
    else coalesce(
      (select (p.perms ->> p_key)::boolean from public.profiles p where p.id = auth.uid()),
      (select k.default_open from public.perm_keys k where k.key = p_key),
      true)
  end;
$$;

-- والضبطُ يحفظ ما خالف الأصل: المغلقَ من المفتوح، والمفتوحَ من المغلق
create or replace function public.set_member_perms(p_member uuid, p_perms jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text; v_clean jsonb := '{}'::jsonb; v_k text; v_def boolean; v_val boolean;
begin
  if not public.is_manager() then
    raise exception 'ضبط الصلاحيات لمدير المشروع' using errcode = '42501';
  end if;
  select role into v_role from public.profiles where id = p_member;
  if v_role is null then raise exception 'العضو غير موجود'; end if;
  if v_role not in ('coordinator', 'supervisor', 'field_lead') then
    raise exception 'قائمة الصلاحيات للمنسقين ومديري المشروع من الهيئة وقادة الفرق';
  end if;

  for v_k in select jsonb_object_keys(coalesce(p_perms, '{}'::jsonb)) loop
    select k.default_open into v_def from public.perm_keys k where k.key = v_k;
    if v_def is null then raise exception 'صلاحية غير معروفة: %', v_k; end if;
    v_val := (p_perms ->> v_k)::boolean;
    if v_val is distinct from v_def then
      v_clean := v_clean || jsonb_build_object(v_k, v_val);
    end if;
  end loop;

  update public.profiles set perms = v_clean where id = p_member;
end $$;
grant execute on function public.set_member_perms(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- ٢) مسحُ تسجيل التحقق لصاحب صلاحية الفريق (ملاحظة ٢١١)
--    وحذفُ الحساب لصاحب صلاحية الحذف (ملاحظة ٢١٤)
-- ---------------------------------------------------------------------
create or replace function public.admin_clear_mfa(p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if not public.is_admin_for('team') then
    raise exception 'مسحُ تسجيل التحقق لمن يملك صلاحية بيانات الأعضاء' using errcode = '42501';
  end if;
  select full_name into v_name from public.profiles where id = p_member;
  if v_name is null then raise exception 'العضو غير موجود'; end if;

  delete from auth.mfa_factors where user_id = p_member;
  delete from public.mfa_recovery where user_id = p_member;
  update public.profiles set mfa_reset_at = now() where id = p_member;
end $$;

create or replace function public.admin_delete_member(p_member uuid, p_name text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_p public.profiles; v_open int;
begin
  if not public.is_admin_for('delete_member') then
    raise exception 'حذفُ الحسابات لمن مُنح صلاحية الحذف' using errcode = '42501';
  end if;
  if p_member = auth.uid() then
    raise exception 'لا يحذف أحدٌ حسابَ نفسه';
  end if;

  select * into v_p from public.profiles where id = p_member;
  if not found then raise exception 'العضو غير موجود'; end if;
  if v_p.role = 'manager' and not public.is_manager() then
    raise exception 'حذفُ حساب مدير المشروع لمدير المشروع' using errcode = '42501';
  end if;

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

  begin
    delete from auth.users where id = p_member;
  exception when foreign_key_violation then
    raise exception 'لهذا العضو سجلٌّ في المنصة لا يُمحى — عطّل حسابه بدل حذفه';
  end;

  if exists (select 1 from public.profiles where id = p_member) then
    delete from public.profiles where id = p_member;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- ٣) نطاقُ قائد الفريق الميداني: مدينةٌ ووردية (ملاحظة ٢٢١)
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists lead_city   text,
  add column if not exists lead_period text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_lead_city_check') then
    alter table public.profiles add constraint profiles_lead_city_check
      check (lead_city is null or lead_city in ('makkah', 'madinah'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_lead_period_check') then
    alter table public.profiles add constraint profiles_lead_period_check
      check (lead_period is null or lead_period in ('morning', 'evening', 'night'));
  end if;
end $$;

comment on column public.profiles.lead_city is
  'مدينةُ قائد الفريق الميداني — لا يرى غيرها (ملاحظة ٢٢١)';
comment on column public.profiles.lead_period is
  'ورديةُ قائد الفريق الميداني: صباحية أو مسائية أو ليلية (ملاحظة ٢٢١)';

create or replace function public.is_field_lead()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'field_lead', false)
$$;
grant execute on function public.is_field_lead() to authenticated;

-- أهلُ نطاقي: الفريقان الميدانيان في مدينتي، ومن له مناوبةٌ في ورديتي
create or replace function public.in_my_lead_scope(p_member uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.profiles me, public.profiles m
     where me.id = auth.uid() and me.role = 'field_lead'
       and m.id = p_member
       and m.track in ('field', 'answers')
       and (me.lead_city is null or m.city = me.lead_city)
       and (me.lead_period is null or exists (
             select 1 from public.shifts s
              where s.member_id = m.id
                and public.shift_period(s.start_at) = me.lead_period))
  )
$$;
grant execute on function public.in_my_lead_scope(uuid) to authenticated;

-- فريقي: ما يراه القائد في شاشته
create or replace function public.my_field_team()
returns table (id uuid, full_name text, email text, track text, city text,
               member_no integer, status public.member_status, may_translate boolean)
language sql security definer set search_path = public as $$
  select p.id, p.full_name, p.email, p.track, p.city, p.member_no, p.status, p.may_translate
    from public.profiles p
   where public.is_field_lead() and public.in_my_lead_scope(p.id)
   order by p.full_name
$$;
grant execute on function public.my_field_team() to authenticated;

-- وضبطُ النطاق لمدير المشروع وحده
create or replace function public.set_lead_scope(p_member uuid, p_city text, p_period text)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  if not public.is_manager() then
    raise exception 'ضبطُ نطاق القيادة لمدير المشروع' using errcode = '42501';
  end if;
  if p_city is not null and p_city not in ('makkah', 'madinah') then
    raise exception 'المدينة: مكة المكرمة أو المدينة المنورة';
  end if;
  if p_period is not null and p_period not in ('morning', 'evening', 'night') then
    raise exception 'الوردية: صباحية أو مسائية أو ليلية';
  end if;
  select role into v_role from public.profiles where id = p_member;
  if v_role is null then raise exception 'العضو غير موجود'; end if;
  if v_role <> 'field_lead' and (p_city is not null or p_period is not null) then
    raise exception 'النطاقُ لقادة الفرق الميدانية';
  end if;
  update public.profiles set lead_city = p_city, lead_period = p_period where id = p_member;
end $$;
grant execute on function public.set_lead_scope(uuid, text, text) to authenticated;

-- ومن خرج من قيادة الفريق سقط عنه نطاقُه
create or replace function public.drop_lead_scope() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role::text <> 'field_lead' and (new.lead_city is not null or new.lead_period is not null) then
    new.lead_city := null; new.lead_period := null;
  end if;
  return new;
end $$;

drop trigger if exists on_role_drops_lead_scope on public.profiles;
create trigger on_role_drops_lead_scope before update of role on public.profiles
  for each row execute function public.drop_lead_scope();

-- ---------------------------------------------------------------------
-- ٤) المدينةُ تُطلب من الفريقين الميدانيين (ملاحظة ٢٢٢)
-- ---------------------------------------------------------------------
create or replace function public.set_member_city(p_member uuid, p_city text)
returns void language plpgsql security definer set search_path = public as $$
declare v_track text;
begin
  if not public.is_admin_for('team') then
    raise exception 'تحديد المدينة للمنسق ومدير المشروع' using errcode = '42501';
  end if;
  if p_city is not null and p_city not in ('makkah', 'madinah') then
    raise exception 'المدينة: مكة المكرمة أو المدينة المنورة';
  end if;
  select track into v_track from public.profiles where id = p_member;
  if v_track is null then raise exception 'العضو غير موجود'; end if;
  -- تُطلب من الجميع: ففي المترجمين المتخصصين من يعمل عن بُعد (ملاحظة ٢٢٢)
  update public.profiles set city = p_city where id = p_member;
end $$;

notify pgrst, 'reload schema';

-- المدينةُ لازمةٌ للفريقين الميدانيين، واللغاتُ كذلك — فإجابةُ السائلين
-- تنقل السؤال وجوابَه بلغةِ سائله (ملاحظة ٢٢٢)
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
      where p.id = p_id and p.track in ('translation', 'field', 'answers')
        and not exists (select 1 from public.member_languages ml where ml.member_id = p_id)
    union all
    select 'المدينة' from public.profiles p
      where p.id = p_id and p.city is null
  ) q;
$$;

-- وكشفُ تدقيق المستندات يتبع القاعدة نفسَها (ملاحظة ٢٢٢)
create or replace function public.member_data_matrix()
returns table (member_id uuid, full_name text, email text, member_no text,
               role text, track text, city text, status text,
               photo text, iqama text, national_id text, whatsapp text,
               nationality text, residence text, languages text, city_state text,
               bank text, data_status text, data_note text,
               missing int, waiting int, complete boolean,
               reminded_at timestamptz, remind_count int)
language sql stable security definer set search_path = public as $$
  with base as (
    select p.id, p.full_name, p.email, p.member_no, p.role::text as role,
           coalesce(p.track, 'translation') as track, p.city, p.status::text as status,
           v.photo_path, v.photo_status::text as photo_status,
           v.iqama_path, v.iqama_status::text as iqama_status,
           v.national_id, v.whatsapp, v.nationality, v.residence,
           v.data_status, v.data_note, v.reminded_at, coalesce(v.remind_count, 0) as remind_count,
           (select count(*) from public.member_languages ml where ml.member_id = p.id) as lang_n,
           (b.member_id is not null) as has_bank, (b.verified_at is not null) as bank_ok
      from public.profiles p
      left join public.profile_private v on v.id = p.id
      left join public.bank_accounts b on b.member_id = p.id
     where public.is_admin() and p.status <> 'disabled'
  ), st as (
    select b.*,
      case when b.photo_path is null then 'none'
           when coalesce(b.photo_status, 'pending') = 'approved' then 'ok'
           when b.photo_status = 'rejected' then 'bad'
           else 'review' end as photo_s,
      case when b.iqama_path is null then 'none'
           when coalesce(b.iqama_status, 'pending') = 'approved' then 'ok'
           when b.iqama_status = 'rejected' then 'bad'
           else 'review' end as iqama_s,
      case when coalesce(trim(b.national_id), '') = '' then 'none' else 'ok' end as nid_s,
      case when coalesce(trim(b.whatsapp), '') = '' then 'none' else 'ok' end as wa_s,
      case when coalesce(trim(b.nationality), '') = '' then 'none' else 'ok' end as nat_s,
      case when coalesce(trim(b.residence), '') = '' then 'none' else 'ok' end as res_s,
      case when b.track not in ('translation', 'field', 'answers') then 'na'
           when b.lang_n > 0 then 'ok' else 'none' end as lang_s,
      case when b.city is not null then 'ok' else 'none' end as city_s,
      case when not b.has_bank then 'none'
           when b.bank_ok then 'ok' else 'review' end as bank_s
    from base b
  )
  select id, full_name, email, member_no, role, track, city, status,
         photo_s, iqama_s, nid_s, wa_s, nat_s, res_s, lang_s, city_s, bank_s,
         coalesce(data_status, 'none'), data_note,
         (select count(*) from unnest(array[photo_s, iqama_s, nid_s, wa_s, nat_s,
                                            res_s, lang_s, city_s]) x
           where x in ('none', 'bad'))::int,
         (select count(*) from unnest(array[photo_s, iqama_s, bank_s]) x
           where x = 'review')::int,
         not exists (select 1 from unnest(array[photo_s, iqama_s, nid_s, wa_s, nat_s,
                                                res_s, lang_s, city_s]) x
                      where x in ('none', 'bad', 'review')),
         reminded_at, remind_count
    from st
   order by (select count(*) from unnest(array[photo_s, iqama_s, nid_s, wa_s, nat_s,
                                               res_s, lang_s, city_s]) x
              where x in ('none', 'bad')) desc,
            full_name
$$;

notify pgrst, 'reload schema';
