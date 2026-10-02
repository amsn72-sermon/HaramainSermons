-- =====================================================================
-- 0062 — صفتا مدير العمليات التشغيلية ومساعده (ملاحظة ٢٠٠)
--   يُراد حسابان في الفريق: «مدير العمليات التشغيلية» و«مساعد مدير
--   العمليات»، صلاحيتُهما صلاحيةُ المنسق نفسُها لا تزيد ولا تنقص.
--   فلا يُحدَث لهما دورٌ ثالث في النظام — إذ لو أُحدث لوجب مراجعةُ كل
--   موضعٍ يسأل عن الدور في قاعدة البيانات، وفيه مظنّةُ خللٍ في الصلاحيات.
--   وإنما تُجعل صفةً تُكتب على حساب المنسق: يراها الناس في الشاشات
--   والبطاقات، ويبقى الدورُ في قاعدة البيانات «منسقًا» فتبقى صلاحيتُه
--   كما هي بيقين.
--
--   ولا تظهر الصفتان في التسجيل: لا يختارهما المسجِّل لنفسه، وإنما
--   يحوّل إليهما مديرُ المشروع وحده من شاشة الفريق.
-- =====================================================================

alter table public.profiles
  add column if not exists admin_title text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_admin_title_check') then
    alter table public.profiles add constraint profiles_admin_title_check
      check (admin_title is null or admin_title in ('ops_manager', 'ops_deputy'));
  end if;
end $$;

comment on column public.profiles.admin_title is
  'صفةٌ تُكتب على حساب المنسق: مدير العمليات التشغيلية أو مساعده — والصلاحية صلاحيةُ المنسق نفسُها (ملاحظة ٢٠٠)';

-- ---------------------------------------------------------------------
-- التحويل إليها لمدير المشروع وحده، ولا تكون إلا على منسق
-- ---------------------------------------------------------------------
create or replace function public.set_admin_title(p_member uuid, p_title text)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text; v_name text;
begin
  if not public.is_manager() then
    raise exception 'التحويل إلى صفات العمليات لمدير المشروع' using errcode = '42501';
  end if;
  if p_title is not null and p_title not in ('ops_manager', 'ops_deputy') then
    raise exception 'الصفة غير معروفة';
  end if;

  select role::text, full_name into v_role, v_name from public.profiles where id = p_member;
  if v_role is null then raise exception 'العضو غير موجود'; end if;
  if p_title is not null and v_role <> 'coordinator' then
    raise exception 'الصفة للمنسقين: حوِّل «%» إلى منسقٍ أولًا', v_name;
  end if;

  update public.profiles set admin_title = p_title where id = p_member;
end $$;
grant execute on function public.set_admin_title(uuid, text) to authenticated;

-- ومتى خرج من التنسيق سقطت عنه الصفة، فلا تبقى على غير أهلها
create or replace function public.drop_admin_title() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role::text <> 'coordinator' and new.admin_title is not null then
    new.admin_title := null;
  end if;
  return new;
end $$;

drop trigger if exists on_role_drops_title on public.profiles;
create trigger on_role_drops_title before update of role on public.profiles
  for each row execute function public.drop_admin_title();

notify pgrst, 'reload schema';
