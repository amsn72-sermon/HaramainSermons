-- =====================================================================
-- 0047 — ثلاثٌ بيد مدير المشروع (ملاحظات ١٧١ و١٧٢ و١٧٣):
--   ١) إلزام التحقق بخطوتين لحسابٍ بعينه، لا للإدارة كلها.
--   ٢) قائمة صلاحيات لكل حساب إداري: الأصل فيها الفتح، ويُغلق ما يشاء.
--   ٣) المتميّز من المرشدين المكانيين تُسنَد إليه الترجمة بحسب لغته،
--      والأصل في فريق الإرشاد ألّا تُسنَد إليه.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) إلزام التحقق بخطوتين لحسابٍ بعينه (ملاحظة ١٧١)
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists mfa_required boolean not null default false;

comment on column public.profiles.mfa_required
  is 'يُلزَم هذا الحساب بالتحقق بخطوتين وإن لم يكن الإلزام عامًّا (ملاحظة ١٧١)';

create or replace function public.set_member_mfa_required(p_member uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then
    raise exception 'إلزام التحقق بخطوتين لمدير المشروع' using errcode = '42501';
  end if;
  update public.profiles set mfa_required = coalesce(p_on, false) where id = p_member;
  if not found then raise exception 'العضو غير موجود'; end if;
end $$;
grant execute on function public.set_member_mfa_required(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- ٢) قائمة الصلاحيات (ملاحظة ١٧٢)
--    perms جدولُ مفاتيحَ مغلقة: ما لم يُذكر فيه فهو مفتوح، فلا يتغيّر
--    شيء على الحسابات القائمة.
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists perms jsonb not null default '{}'::jsonb;

comment on column public.profiles.perms
  is 'الصلاحيات المغلقة على هذا الحساب — الأصل الفتح (ملاحظة ١٧٢)';

create table if not exists public.perm_keys (
  key   text primary key,
  label text not null,
  sort  int  not null default 0
);
alter table public.perm_keys enable row level security;
drop policy if exists "read perm keys" on public.perm_keys;
create policy "read perm keys" on public.perm_keys for select to authenticated using (true);
comment on table public.perm_keys is 'مفاتيح الصلاحيات وأسماؤها في الشاشة (ملاحظة ١٧٢)';

insert into public.perm_keys (key, label, sort) values
  ('materials',      'إضافة المواد وإسنادها وإعادتها',           1),
  ('approve',        'الاعتماد وإغلاق المراجعات والتسجيلات',      2),
  ('team',           'بيانات الأعضاء وتقييمهم ووثائقهم',          3),
  ('cards',          'بطاقات العمل وإصدارها',                     4),
  ('payroll',        'الرواتب والمستحقات',                        5),
  ('banks',          'الحسابات المصرفية',                         6),
  ('circulars',      'المراسلات الداخلية',                        7),
  ('shifts',         'الحضور والانصراف',                          8),
  ('evaluation',     'تقييم المرشدين المكانيين',                  9),
  ('interpretation', 'سجلّ الترجمة الفورية',                     10),
  ('glossary',       'اعتماد الدليل المصطلحي',                   11),
  ('rooms',          'القاعات واللقاءات وجدولتها',               12),
  ('settings',       'اللغات والخطباء وإعداد سير العمل',         13),
  ('reports',        'دليل الإنتاج والأرشيف والتصدير',           14)
on conflict (key) do update set label = excluded.label, sort = excluded.sort;

-- هل يملك الحسابُ الحالي هذه الصلاحية؟ ومدير المشروع يملكها كلها دائمًا
create or replace function public.has_perm(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_manager() then true
    else coalesce((select (p.perms ->> p_key)::boolean
                     from public.profiles p where p.id = auth.uid()), true)
  end;
$$;
grant execute on function public.has_perm(text) to authenticated;

create or replace function public.is_admin_for(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() and public.has_perm(p_key);
$$;
grant execute on function public.is_admin_for(text) to authenticated;

-- ضبط صلاحيات حساب — لمدير المشروع، وعلى المنسقين ومديري المشروع من الهيئة
create or replace function public.set_member_perms(p_member uuid, p_perms jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text; v_clean jsonb := '{}'::jsonb; v_k text;
begin
  if not public.is_manager() then
    raise exception 'ضبط الصلاحيات لمدير المشروع' using errcode = '42501';
  end if;
  select role into v_role from public.profiles where id = p_member;
  if v_role is null then raise exception 'العضو غير موجود'; end if;
  if v_role not in ('coordinator', 'supervisor') then
    raise exception 'قائمة الصلاحيات للمنسقين ومديري المشروع من الهيئة';
  end if;

  -- لا يُحفظ إلا المغلق، وبمفاتيح معروفة
  for v_k in select jsonb_object_keys(coalesce(p_perms, '{}'::jsonb)) loop
    if not exists (select 1 from public.perm_keys k where k.key = v_k) then
      raise exception 'صلاحية غير معروفة: %', v_k;
    end if;
    if (p_perms ->> v_k) = 'false' then
      v_clean := v_clean || jsonb_build_object(v_k, false);
    end if;
  end loop;

  update public.profiles set perms = v_clean where id = p_member;
end $$;
grant execute on function public.set_member_perms(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- ربط الصلاحيات بالدوال: تُعاد كتابة كل دالة مرةً واحدة، فيصير حارسها
-- is_admin_for('مفتاحها') بدل is_admin(). ومدير المشروع لا يتأثر.
-- ---------------------------------------------------------------------
do $$
declare
  v_map jsonb := jsonb_build_object(
    'create_material', 'materials', 'reassign_stage', 'materials', 'return_stage', 'materials',
    'reopen_material', 'materials', 'cancel_track', 'materials', 'add_source_version', 'materials',
    'set_source_audio_seconds', 'materials',
    'close_revision', 'approve', 'reopen_revision', 'approve', 'add_revision_mark', 'approve',
    'delete_revision_mark', 'approve', 'set_audio_duration', 'approve',
    'admin_update_member', 'team', 'admin_update_contact', 'team', 'admin_set_iqama', 'team',
    'set_member_track', 'team', 'set_member_photo', 'team', 'review_member_doc', 'team',
    'rate_member', 'team', 'delete_rating', 'team',
    'issue_member_cards', 'cards', 'save_card_settings', 'cards',
    'build_payroll', 'payroll', 'set_payroll_item', 'payroll',
    'save_bank_account', 'banks', 'set_bank_doc', 'banks',
    'send_circular', 'circulars', 'update_circular', 'circulars', 'archive_circular', 'circulars',
    'remind_circular', 'circulars',
    'save_shift', 'shifts', 'delete_shift', 'shifts', 'save_shift_crew', 'shifts',
    'delete_shift_crew', 'shifts', 'set_shift_status', 'shifts',
    'save_field_evaluation', 'evaluation', 'delete_field_evaluation', 'evaluation',
    'save_interpretation', 'interpretation', 'delete_interpretation', 'interpretation',
    'approve_glossary_term', 'glossary', 'delete_glossary_term', 'glossary',
    'save_room', 'rooms', 'save_meeting', 'rooms', 'cancel_meeting', 'rooms');
  r record; v_src text; v_key text; v_new text;
begin
  for r in
    select p.oid, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (select jsonb_object_keys(v_map))
  loop
    v_key := v_map ->> r.proname;
    v_src := pg_get_functiondef(r.oid);
    continue when position('is_admin_for' in v_src) > 0;   -- رُبطت من قبل
    v_new := replace(v_src, 'public.is_admin()', format('public.is_admin_for(%L)', v_key));
    v_new := regexp_replace(v_new, '(?<![._[:alnum:]])is_admin\(\)',
                            format('public.is_admin_for(%L)', v_key), 'g');
    if v_new <> v_src then execute v_new; end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- ٣) المتميّز من المرشدين المكانيين يترجم بلغته (ملاحظة ١٧٣)
--    الأصل في فريق الإرشاد ألّا تُسنَد إليه ترجمة، وهذا استثناءٌ بعينه.
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists may_translate boolean not null default false;

comment on column public.profiles.may_translate
  is 'مرشدٌ مكاني متميّز تُسنَد إليه الترجمة بحسب لغته، استثناءً (ملاحظة ١٧٣)';

create or replace function public.set_member_may_translate(p_member uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_track text; v_langs int;
begin
  if not public.is_admin_for('team') then
    raise exception 'إتاحة الترجمة للمرشد لمن يملك صلاحية الفريق' using errcode = '42501';
  end if;
  select track into v_track from public.profiles where id = p_member;
  if v_track is null then raise exception 'العضو غير موجود'; end if;
  if v_track <> 'field' then
    raise exception 'هذه الإتاحة لفريق الإرشاد المكاني وحده';
  end if;
  if coalesce(p_on, false) then
    select count(*) into v_langs from public.member_languages where member_id = p_member;
    if v_langs = 0 then
      raise exception 'سجّل لغات المرشد أولًا، فالإسناد يكون بحسب لغته';
    end if;
  end if;
  update public.profiles set may_translate = coalesce(p_on, false) where id = p_member;
end $$;
grant execute on function public.set_member_may_translate(uuid, boolean) to authenticated;

-- الحاجز يبقى قائمًا، ويُفتح للمتميّز في لغته وحدها
create or replace function public.block_field_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_may boolean; v_lang text;
begin
  select p.may_translate into v_may
    from public.profiles p
   where p.id = new.assignee_id and p.track = 'field';
  if not found then return new; end if;          -- ليس من فريق الإرشاد

  if not coalesce(v_may, false) then
    raise exception 'فريق الإرشاد المكاني لا تُسنَد إليه أعمال ترجمة';
  end if;

  select t.language_code into v_lang from public.tracks t where t.id = new.track_id;
  if v_lang is null or not exists (
       select 1 from public.member_languages ml
        where ml.member_id = new.assignee_id and ml.language_code = v_lang) then
    raise exception 'المرشد المتميّز تُسنَد إليه الترجمة بلغته المسجَّلة وحدها';
  end if;
  return new;
end $$;

-- ومن رُفعت عنه الإتاحة لا تبقى له أعمالٌ مفتوحة بلا علم الإدارة:
-- يُمنع رفعها ما دام في يده مرحلة لم تُنجز.
create or replace function public.guard_may_translate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- ومن خرج من فريق الإرشاد لا معنى لإتاحته، فتُرفع بلا حاجز
  if new.track = 'field' and old.may_translate and not new.may_translate and exists (
       select 1 from public.track_stages s
        where s.assignee_id = new.id and s.status <> 'done'::stage_status) then
    raise exception 'للمرشد أعمال ترجمة لم تُنجز — أنهِها أو انقلها أولًا';
  end if;
  return new;
end $$;

drop trigger if exists guard_may_translate on public.profiles;
create trigger guard_may_translate
  before update of may_translate on public.profiles
  for each row execute function public.guard_may_translate();

notify pgrst, 'reload schema';
