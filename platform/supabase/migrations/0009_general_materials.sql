-- =====================================================================
-- 0009 — مواد عامة، محو المحذوفات بعد أسبوع، وإضافة عضو يدويًا
--   (ملاحظات ٦٩ و٧٤ و٦٩أ)
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) الكتب والمطويات والإعلانات والتوجيهات عامة لا تتبع مسجدًا (ملاحظة ٦٩)
-- ---------------------------------------------------------------------
alter table public.materials drop constraint if exists materials_mosque_check;
alter table public.materials
  add constraint materials_mosque_check check (mosque in ('makkah', 'madinah', 'general'));

comment on column public.materials.mosque
  is 'makkah أو madinah للخطب والدروس، و general للمواد العامة (كتب، مطويات، إعلانات، توجيهات)';

-- ---------------------------------------------------------------------
-- ٢) محو المحذوفات نهائيًا بعد أسبوع (ملاحظة ٧٤)
--    يُستدعى من مهمة ليلية على الخادم.
-- ---------------------------------------------------------------------
create or replace function public.purge_deleted_archive(p_days int default 7)
returns table (materials_purged int, tracks_purged int, objects_purged int)
language plpgsql security definer set search_path = public as $$
declare
  v_cut timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 7), 1));
  v_paths text[];
  v_m int := 0; v_t int := 0; v_o int := 0;
begin
  -- ملفات المواد والمسارات التي انقضت مهلتها: المصادر والتسجيلات الصوتية
  select coalesce(array_agg(p), '{}') into v_paths from (
    select m.source_pdf_path as p from public.materials m
      where m.deleted_at is not null and m.deleted_at < v_cut and m.source_pdf_path is not null
    union all
    select s.path from public.material_sources s join public.materials m on m.id = s.material_id
      where m.deleted_at is not null and m.deleted_at < v_cut and s.path is not null
    union all
    select t.audio_path from public.tracks t
      where t.deleted_at is not null and t.deleted_at < v_cut and t.audio_path is not null
    union all
    select a.path from public.track_audios a join public.tracks t on t.id = a.track_id
      where t.deleted_at is not null and t.deleted_at < v_cut and a.path is not null
  ) q;

  delete from storage.objects o where o.name = any (v_paths);
  get diagnostics v_o = row_count;

  -- المسارات المحذوفة وحدها (مادتها باقية)
  delete from public.tracks t
   where t.deleted_at is not null and t.deleted_at < v_cut
     and not exists (select 1 from public.materials m where m.id = t.material_id and m.deleted_at is not null);
  get diagnostics v_t = row_count;

  -- المواد المحذوفة بكل ما يتبعها (cascade)
  delete from public.materials m where m.deleted_at is not null and m.deleted_at < v_cut;
  get diagnostics v_m = row_count;

  return query select v_m, v_t, v_o;
end $$;

revoke all on function public.purge_deleted_archive(int) from public, anon, authenticated;

comment on function public.purge_deleted_archive(int)
  is 'محو نهائي لما مضى على حذفه أكثر من المهلة — يُشغّل من مهمة ليلية على الخادم وحدها';

-- ---------------------------------------------------------------------
-- ٣) مدير المشروع ينشئ حساب عضو يدويًا (ملاحظة ٦٨)
--    الحساب مفعّل مباشرة وبريده مؤكَّد، ويغيّر كلمته من «نسيت كلمة المرور».
-- ---------------------------------------------------------------------
create or replace function public.admin_create_member(
  p_email       text,
  p_password    text,
  p_full_name   text,
  p_role        public.app_role default 'translator',
  p_whatsapp    text default null,
  p_nationality text default null,
  p_national_id text default null,
  p_residence   text default null,
  p_languages   text[] default null
) returns uuid language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_id    uuid := gen_random_uuid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_nid   text := nullif(trim(coalesce(p_national_id, '')), '');
  v_lang  text;
begin
  if not public.is_manager() then
    raise exception 'إنشاء الحسابات لمدير المشروع وحده' using errcode = '42501';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'البريد الإلكتروني غير صحيح';
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'هذا البريد مسجَّل بالفعل';
  end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'كلمة المرور ٨ أحرف على الأقل'; end if;
  if length(trim(coalesce(p_full_name, ''))) < 3 then raise exception 'اكتب الاسم الكامل'; end if;
  if v_nid is not null and v_nid !~ '^[12][0-9]{9}$' then
    raise exception 'رقم الهوية أو الإقامة يبدأ بـ ١ أو ٢ ويتكوّن من عشرة أرقام';
  end if;

  -- خدمة الحسابات تقرأ حقول الرموز نصًّا لا فراغًا، فتُملأ بسلاسل فارغة
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          confirmation_token, recovery_token, email_change,
                          email_change_token_new, email_change_token_current,
                          phone_change, phone_change_token, reauthentication_token,
                          created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          v_email, crypt(p_password, gen_salt('bf')),
          now(), '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('full_name', trim(p_full_name)),
          '', '', '', '', '', '', '', '',
          now(), now());

  -- المحفّز أنشأ صف الملف الشخصي؛ نكمل بياناته ونفعّله
  update public.profiles set full_name = trim(p_full_name), role = p_role, status = 'active' where id = v_id;
  insert into public.profile_private (id) values (v_id) on conflict (id) do nothing;
  update public.profile_private set
    whatsapp    = nullif(trim(coalesce(p_whatsapp, '')), ''),
    nationality = nullif(trim(coalesce(p_nationality, '')), ''),
    national_id = v_nid,
    residence   = nullif(trim(coalesce(p_residence, '')), ''),
    applied_as  = case when p_role = 'translator' then 'translator' else 'coordinator' end
  where id = v_id;

  foreach v_lang in array coalesce(p_languages, '{}') loop
    insert into public.member_languages (member_id, language_code)
    select v_id, v_lang where exists (select 1 from public.languages where code = v_lang and is_active)
    on conflict do nothing;
  end loop;

  return v_id;
end $$;

grant execute on function public.admin_create_member(text, text, text, public.app_role, text, text, text, text, text[]) to authenticated;

comment on function public.admin_create_member(text, text, text, public.app_role, text, text, text, text, text[])
  is 'إنشاء حساب عضو يدويًا من شاشة فريق العمل — لمدير المشروع وحده، الحساب مفعّل وبريده مؤكَّد';
