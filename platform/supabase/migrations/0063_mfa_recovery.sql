-- =====================================================================
-- 0063 — مخرجٌ من التحقق بخطوتين (ملاحظة ٢٠٥)
--   من فقد جوّاله أو حذف الحسابَ من تطبيق المصادقة أُغلق عليه الباب:
--   لا يدخل المنصة فيُلغي التسجيل، ولا يُلغيه عنه أحد. فجُعل له مخرجان:
--     ١) رموزُ استرداد: ثمانيةٌ تُعرض مرةً واحدةً عند التفعيل، لا يُحفظ
--        منها إلا بصمتُها، ويُستعمل الواحدُ مرةً فيُسقط التسجيلَ القائم
--        فيعود العضو فيسجّل من جديد.
--     ٢) زرٌّ بيد مدير المشروع يمسح تسجيلَ العضو.
--   ولا يُمسّ في الحالين شيءٌ من كلمة المرور.
-- =====================================================================

alter table public.profiles
  add column if not exists mfa_reset_at timestamptz;
comment on column public.profiles.mfa_reset_at is
  'آخر مرةٍ أُسقط فيها تسجيلُ التحقق بخطوتين لهذا الحساب (ملاحظة ٢٠٥)';

create table if not exists public.mfa_recovery (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  code_hash  text not null,
  created_at timestamptz not null default now(),
  used_at    timestamptz
);
create index if not exists mfa_recovery_user_idx on public.mfa_recovery (user_id);
alter table public.mfa_recovery enable row level security;
-- لا سياسةَ لأحد: لا يُقرأ هذا الجدول ولا يُكتب إلا من الدوال أدناه
revoke all on public.mfa_recovery from anon, authenticated;

comment on table public.mfa_recovery is
  'بصماتُ رموز الاسترداد للتحقق بخطوتين — لا يُحفظ الرمز نفسُه (ملاحظة ٢٠٥)';

-- ---------------------------------------------------------------------
-- تسويةُ صيغة الرمز: حروفٌ وأرقامٌ فقط بحالةٍ واحدة، فلا تضرّ الشرطةُ ولا المسافة
-- ---------------------------------------------------------------------
create or replace function public.mfa_code_norm(p_code text)
returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g'))
$$;

create or replace function public.mfa_code_hash(p_code text)
returns text language sql stable set search_path = public, extensions as $$
  select encode(digest(public.mfa_code_norm(p_code), 'sha256'), 'hex')
$$;

-- ---------------------------------------------------------------------
-- توليدُ ثمانيةِ رموز: تُعاد مرةً واحدةً ثم لا سبيل إلى معرفتها
-- ---------------------------------------------------------------------
create or replace function public.make_recovery_codes()
returns setof text language plpgsql security definer set search_path = public, extensions as $$
declare v_uid uuid := auth.uid(); v_code text; i int;
begin
  if v_uid is null then raise exception 'لا جلسة' using errcode = '42501'; end if;

  -- ما لم يُستعمل من رموزٍ سابقةٍ يسقط: الجديدةُ وحدها هي المعتبَرة
  delete from public.mfa_recovery where user_id = v_uid and used_at is null;

  for i in 1..8 loop
    -- عشرةُ محارفَ من الست عشري: لا لبس فيها عند النسخ باليد
    v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10));
    insert into public.mfa_recovery (user_id, code_hash)
      values (v_uid, public.mfa_code_hash(v_code));
    return next substr(v_code, 1, 5) || '-' || substr(v_code, 6, 5);
  end loop;
end $$;
grant execute on function public.make_recovery_codes() to authenticated;

-- كم بقي منها، ليُنبَّه العضو إذا قاربت النفاد
create or replace function public.recovery_codes_left()
returns integer language sql security definer set search_path = public as $$
  select count(*)::int from public.mfa_recovery
   where user_id = auth.uid() and used_at is null
$$;
grant execute on function public.recovery_codes_left() to authenticated;

-- ---------------------------------------------------------------------
-- استعمالُ رمزٍ: يُسقط التسجيلَ القائم فيعود الحسابُ إلى كلمة المرور،
-- ثم تَطلب منه المنصةُ التسجيلَ من جديد
-- ---------------------------------------------------------------------
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
  update public.profiles set mfa_reset_at = now() where id = v_uid;
  return true;
end $$;
grant execute on function public.use_recovery_code(text) to authenticated;

-- ---------------------------------------------------------------------
-- مسحُ التسجيل بيد مدير المشروع: لمن فقد جوّاله ورموزَه معًا
-- ---------------------------------------------------------------------
create or replace function public.admin_clear_mfa(p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if not public.is_manager() then
    raise exception 'مسحُ تسجيل التحقق لمدير المشروع' using errcode = '42501';
  end if;
  select full_name into v_name from public.profiles where id = p_member;
  if v_name is null then raise exception 'العضو غير موجود'; end if;

  delete from auth.mfa_factors where user_id = p_member;
  delete from public.mfa_recovery where user_id = p_member;
  update public.profiles set mfa_reset_at = now() where id = p_member;
end $$;
grant execute on function public.admin_clear_mfa(uuid) to authenticated;

notify pgrst, 'reload schema';
