-- =====================================================================
-- 0072 — بوابةُ التحقق بخطوتين: علامةٌ للجلسة، وإعفاءٌ صريح، وتسجيلٌ واحد
--   (ملاحظات ٢٢٣ و٢٢٤ و٢٢٥)
--
--   ٢٢٣) كان البابُ يُفتح بمستوى التوثيق في رمز الجلسة (aal2) وحدَه، فإذا
--        لم يبلغ الرمزُ ذلك المستوى — لاختلاف إصدارِ خدمة الحسابات أو
--        لتجديدٍ أسقطه — ارتدَّ العضو إلى شاشة التحقق بعد أن قيل له
--        «تم التحقق». فجُعلت للتحقق علامةٌ تُكتب في قاعدة البيانات
--        مربوطةً بمعرّف الجلسة نفسِه، فإمّا aal2 وإمّا العلامةُ — وأيُّهما
--        كان كفى. والعلامةُ تسقط بإسقاط التسجيل فلا تُغني عن تحققٍ جديد.
--
--   ٢٢٤) «إلغاء التحقق بخطوتين» حلًّا جذريًّا: تُسقَط العواملُ كلُّها
--        ورموزُ الاسترداد وعلاماتُ الجلسات، ويُعفى الحسابُ صراحةً فيدخل
--        بكلمة المرور وحدها، حتى يُعاد إلزامُه متى شيء. فللحساب ثلاثُ
--        حالات: مُلزَمٌ، ومعفًى، وعلى الأصل (يتبع الإلزامَ العام).
--
--   ٢٢٥) تسجيلٌ واحدٌ للحساب: ما سبق من عواملَ يسقط عند كل تفعيلٍ جديد،
--        فلا يجتمع في تطبيق المصادقة سجلّانِ لا يُدرى أيُّهما العامل.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) الإعفاءُ الصريح
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists mfa_exempt boolean not null default false;

comment on column public.profiles.mfa_exempt is
  'إعفاءٌ صريحٌ من التحقق بخطوتين، يعلو على الإلزام العام (ملاحظة ٢٢٤)';

-- ---------------------------------------------------------------------
-- ٢) علامةُ الجلسة
-- ---------------------------------------------------------------------
create table if not exists public.mfa_sessions (
  user_id    uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, session_id)
);
alter table public.mfa_sessions enable row level security;
revoke all on public.mfa_sessions from anon, authenticated;

comment on table public.mfa_sessions is
  'جلساتٌ استوفت التحقق بخطوتين — مخرجٌ من التعويل على aal وحدَه (ملاحظة ٢٢٣)';

-- معرّفُ الجلسة من رمزها: يُقرأ من الدعاوى كاملةً أو من الدعوى المفردة
create or replace function public.jwt_session_id()
returns uuid language sql stable as $$
  select nullif(coalesce(
           current_setting('request.jwt.claim.session_id', true),
           nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id'
         ), '')::uuid
$$;

-- تُكتب العلامةُ بعد تحققٍ ناجح
create or replace function public.mfa_mark_session()
returns boolean language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_sid uuid := public.jwt_session_id();
begin
  if v_uid is null then raise exception 'لا جلسة' using errcode = '42501'; end if;
  if v_sid is null then return false; end if;   -- رمزٌ بلا معرّف جلسة: يُكتفى بـ aal
  insert into public.mfa_sessions (user_id, session_id) values (v_uid, v_sid)
    on conflict (user_id, session_id) do update set created_at = now();
  return true;
end $$;
grant execute on function public.mfa_mark_session() to authenticated;

-- وتُقرأ عند البوابة: تُعتبر ما لم يُسقط التسجيلُ بعد كتابتها
create or replace function public.mfa_session_ok()
returns boolean language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_sid uuid := public.jwt_session_id();
        v_at timestamptz; v_reset timestamptz;
begin
  if v_uid is null or v_sid is null then return false; end if;
  select created_at into v_at from public.mfa_sessions
   where user_id = v_uid and session_id = v_sid;
  if v_at is null then return false; end if;
  select mfa_reset_at into v_reset from public.profiles where id = v_uid;
  return v_reset is null or v_at > v_reset;
end $$;
grant execute on function public.mfa_session_ok() to authenticated;

-- ---------------------------------------------------------------------
-- ٣) تسجيلٌ واحدٌ للحساب (ملاحظة ٢٢٥)
-- ---------------------------------------------------------------------
create or replace function public.mfa_keep_one_factor(p_keep uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_n integer;
begin
  if v_uid is null then raise exception 'لا جلسة' using errcode = '42501'; end if;
  if p_keep is null then return 0; end if;
  delete from auth.mfa_factors where user_id = v_uid and id <> p_keep;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
grant execute on function public.mfa_keep_one_factor(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ٤) إلغاءُ التحقق حلًّا جذريًّا (ملاحظة ٢٢٤)
--    يُسقط كلَّ أثرٍ للتحقق ويُعفي الحساب، فلا يبقى شيءٌ يمنع الدخول
-- ---------------------------------------------------------------------
create or replace function public.admin_clear_mfa(p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if not public.is_admin_for('team') then
    raise exception 'إلغاءُ التحقق لمن له صلاحيةُ الفريق' using errcode = '42501';
  end if;
  select full_name into v_name from public.profiles where id = p_member;
  if v_name is null then raise exception 'العضو غير موجود'; end if;

  delete from auth.mfa_factors   where user_id = p_member;
  delete from public.mfa_recovery where user_id = p_member;
  delete from public.mfa_sessions where user_id = p_member;
  update public.profiles
     set mfa_reset_at  = now(),
         mfa_required  = false,     -- يسقط الإلزامُ الخاص
         mfa_exempt    = true       -- ويُعفى صراحةً فلا يردّه الإلزامُ العام
   where id = p_member;
end $$;
grant execute on function public.admin_clear_mfa(uuid) to authenticated;

-- وإعادةُ الإلزام ترفع الإعفاء، وإيقافُه يُرجع الحسابَ إلى الأصل
create or replace function public.set_member_mfa_required(p_member uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin_for('team') then
    raise exception 'إلزامُ التحقق لمن له صلاحيةُ الفريق' using errcode = '42501';
  end if;
  update public.profiles
     set mfa_required = coalesce(p_on, false),
         mfa_exempt   = case when coalesce(p_on, false) then false else mfa_exempt end
   where id = p_member;
end $$;
grant execute on function public.set_member_mfa_required(uuid, boolean) to authenticated;

-- ورفعُ الإعفاء وحدَه: يعود الحسابُ إلى الأصل بلا إلزامٍ خاص
create or replace function public.set_member_mfa_exempt(p_member uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin_for('team') then
    raise exception 'إعفاءُ التحقق لمن له صلاحيةُ الفريق' using errcode = '42501';
  end if;
  update public.profiles
     set mfa_exempt   = coalesce(p_on, false),
         mfa_required = case when coalesce(p_on, false) then false else mfa_required end
   where id = p_member;
end $$;
grant execute on function public.set_member_mfa_exempt(uuid, boolean) to authenticated;

-- ورمزُ الاسترداد يُسقط العلاماتِ أيضًا، فلا تُغني عن تسجيلٍ جديد
create or replace function public.use_recovery_code(p_code text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'لا جلسة' using errcode = '42501'; end if;

  select id into v_id from public.mfa_recovery
   where user_id = v_uid and used_at is null
     and code_hash = public.mfa_code_hash(p_code)
   limit 1;
  if v_id is null then return false; end if;

  update public.mfa_recovery set used_at = now() where id = v_id;
  delete from auth.mfa_factors where user_id = v_uid;
  delete from public.mfa_sessions where user_id = v_uid;
  update public.profiles set mfa_reset_at = now() where id = v_uid;
  return true;
end $$;
grant execute on function public.use_recovery_code(text) to authenticated;

-- ---------------------------------------------------------------------
-- ٥) حالُ حسابي في سطرٍ واحد — تقرؤها البوابةُ بطلبٍ واحد
-- ---------------------------------------------------------------------
create or replace function public.my_mfa_gate()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_p record; v_admins boolean; v_n integer;
begin
  if v_uid is null then return jsonb_build_object('ok', true); end if;
  select mfa_required, mfa_exempt, role, status into v_p from public.profiles where id = v_uid;
  select coalesce(mfa_required_admins, false) into v_admins from public.platform_settings limit 1;
  select count(*)::int into v_n from auth.mfa_factors
   where user_id = v_uid and status = 'verified';

  return jsonb_build_object(
    'enrolled',  v_n > 0,
    'exempt',    coalesce(v_p.mfa_exempt, false),
    'required',  coalesce(v_p.mfa_required, false),
    'admins',    coalesce(v_admins, false),
    'session_ok', public.mfa_session_ok());
end $$;
grant execute on function public.my_mfa_gate() to authenticated;

notify pgrst, 'reload schema';
