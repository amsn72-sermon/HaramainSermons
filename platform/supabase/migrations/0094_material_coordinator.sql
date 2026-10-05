-- =====================================================================
-- 0094 — من أنشأ تَبِع: المنسقُ المسؤولُ عن المادة هو مُنشئُها
--        (ملاحظة ٢٦٩)
--
--   وُجد أن منسقًا أنشأ مهمّةً وحدّد منسقًا آخر يستلمها. والأصلُ أن
--   من أنشأ تابَع: فلا يُلقي عملَه على غيره. ومديرُ المشروع وحدَه —
--   ومن مُنح مفتاحَ الإسناد — يختار من يشاء.
--
--   والحكمُ في الخادم لا في الواجهة، فلا يُلتفَّ عليه.
-- =====================================================================

create or replace function public.check_assignee(
  v_ws public.workflow_stages, v_assignee public.profiles, p_lang text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if v_assignee.status <> 'active' then raise exception '«%» غير مفعّل', v_assignee.full_name; end if;
  if v_ws.assignee_role = 'translator' and not public.may_assign_lang(v_assignee.id, p_lang) then
    raise exception '«%» لم تُعتمد له هذه اللغة للإسناد (%)', v_assignee.full_name, p_lang;
  end if;
  if v_ws.assignee_role = 'coordinator' and v_assignee.role not in ('coordinator', 'manager') then
    raise exception 'مرحلة «%» تُسند لمنسق', v_ws.name_ar;
  end if;
  -- ملاحظة ٢٦٩: ولا يُسنِد المنسقُ مرحلتَه إلى منسّقٍ غيرِه
  if v_ws.assignee_role = 'coordinator'
     and v_assignee.id <> auth.uid()
     and not public.is_manager()
     and not public.has_perm('mat_assign_coord') then
    raise exception 'من أنشأ المادةَ تابَعها: إسنادُها إلى منسّقٍ آخر بيد مدير المشروع'
      using errcode = '42501';
  end if;
  if v_ws.assignee_role = 'manager' and v_assignee.role <> 'manager' then
    raise exception 'مرحلة «%» تُسند لمدير المشروع', v_ws.name_ar;
  end if;
end $$;

revoke execute on function public.check_assignee(public.workflow_stages, public.profiles, text)
  from public, anon, authenticated;

-- والمسؤولُ عن المادة يُسجَّل عند إنشائها
create or replace function public.material_coordinator_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.coordinator_id is null then new.coordinator_id := coalesce(new.created_by, auth.uid()); end if;
  return new;
end $$;

drop trigger if exists materials_coordinator on public.materials;
create trigger materials_coordinator before insert on public.materials
  for each row execute function public.material_coordinator_trg();

notify pgrst, 'reload schema';
