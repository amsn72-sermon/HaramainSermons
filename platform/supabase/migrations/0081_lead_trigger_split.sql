-- =====================================================================
-- 0081 — تفريقُ فريق من خرج من القيادة: بعد التحديث لا قبله
--
--   كان مُشغِّلُ «قبل التحديث» يُسقط صفةَ القيادة ويُفرّق الفريقَ في عملٍ
--   واحد، وتفريقُ الفريق تحديثٌ لصفوفٍ أخرى من الجدول نفسِه. فإذا جرى
--   تحديثٌ يشمل تلك الصفوفَ أيضًا — كتحديثٍ يمسُّ الفريقَ كلَّه — اصطدم
--   الأمرُ بنفسه وردَّه الخادم:
--     tuple to be updated was already modified by an operation
--     triggered by the current command
--   فقُسم العملُ قسمين: «قبل التحديث» يصحّح صفَّ العضو نفسِه لا غير،
--   و«بعد التحديث» يُفرّق فريقَه. وهو ما يوصي به الخادمُ في تنبيهه.
-- =====================================================================

-- ١) قبلَ التحديث: صفُّ العضو وحدَه
create or replace function public.drop_lead_scope() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role::text <> 'field_lead' and new.lead_kind = 'field' then
    new.lead_kind := null;
  end if;
  if new.role::text <> 'field_lead'
     and (new.lead_city is not null or new.lead_period is not null) then
    new.lead_city := null; new.lead_period := null;
  end if;
  return new;
end $$;

-- ٢) بعدَه: من لم يبقَ قائدًا تفرّق فريقُه
create or replace function public.orphan_lead_team() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.lead_kind is not null and new.lead_kind is null then
    update public.profiles set lead_id = null
     where lead_id = new.id and lead_id is not null;
  end if;
  return null;
end $$;

drop trigger if exists profiles_drop_lead_scope on public.profiles;
create trigger profiles_drop_lead_scope
  before update of role, lead_kind on public.profiles
  for each row execute function public.drop_lead_scope();

drop trigger if exists profiles_orphan_lead_team on public.profiles;
create trigger profiles_orphan_lead_team
  after update of role, lead_kind on public.profiles
  for each row execute function public.orphan_lead_team();

notify pgrst, 'reload schema';
