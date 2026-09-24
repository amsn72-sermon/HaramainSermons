-- =====================================================================
-- 0005 — تعديل بيانات العضو من شاشة فريق العمل (ملاحظة ٥٢)
--   المنسق يعدّل بيانات المترجمين، ومدير المشروع يعدّل الجميع:
--   رقم الواتس آب، الجنسية، رقم الهوية أو الإقامة، مكان الإقامة، والاسم.
-- =====================================================================

create or replace function public.admin_update_contact(
  p_member uuid,
  p_full_name text default null,
  p_whatsapp text default null,
  p_nationality text default null,
  p_national_id text default null,
  p_residence text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_target public.profiles; v_nid text;
begin
  if not public.is_admin() then raise exception 'غير مصرح' using errcode = '42501'; end if;
  select * into v_target from public.profiles where id = p_member for update;
  if not found then raise exception 'العضو غير موجود'; end if;

  -- المنسق يدير المترجمين فقط
  if not public.is_manager() and v_target.role <> 'translator' then
    raise exception 'تعديل بيانات المنسقين والمديرين لمدير المشروع فقط' using errcode = '42501';
  end if;

  v_nid := nullif(trim(coalesce(p_national_id, '')), '');
  if v_nid is not null and v_nid !~ '^[12][0-9]{9}$' then
    raise exception 'رقم الهوية أو الإقامة يبدأ بـ ١ أو ٢ ويتكوّن من عشرة أرقام';
  end if;

  if nullif(trim(coalesce(p_full_name, '')), '') is not null then
    if length(trim(p_full_name)) < 3 then raise exception 'الاسم قصير'; end if;
    update public.profiles set full_name = trim(p_full_name) where id = p_member;
  end if;

  insert into public.profile_private (id) values (p_member) on conflict (id) do nothing;
  update public.profile_private set
    whatsapp    = coalesce(nullif(trim(coalesce(p_whatsapp, '')), ''), whatsapp),
    nationality = coalesce(nullif(trim(coalesce(p_nationality, '')), ''), nationality),
    national_id = coalesce(v_nid, national_id),
    residence   = coalesce(nullif(trim(coalesce(p_residence, '')), ''), residence)
  where id = p_member;
end $$;

grant execute on function public.admin_update_contact(uuid, text, text, text, text, text) to authenticated;

-- المنسق ومدير المشروع يرفعان صورة الهوية نيابةً عن العضو عند الحاجة
create or replace function public.admin_set_iqama(p_member uuid, p_path text)
returns void language plpgsql security definer set search_path = public as $$
declare v_target public.profiles;
begin
  if not public.is_admin() then raise exception 'غير مصرح' using errcode = '42501'; end if;
  select * into v_target from public.profiles where id = p_member;
  if not found then raise exception 'العضو غير موجود'; end if;
  if not public.is_manager() and v_target.role <> 'translator' then
    raise exception 'هذا الإجراء لمدير المشروع فقط' using errcode = '42501';
  end if;
  insert into public.profile_private (id) values (p_member) on conflict (id) do nothing;
  update public.profile_private set iqama_path = p_path where id = p_member;
end $$;

grant execute on function public.admin_set_iqama(uuid, text) to authenticated;

comment on function public.admin_update_contact(uuid, text, text, text, text, text)
  is 'تعديل بيانات العضو من شاشة فريق العمل: المنسق للمترجمين والمدير للجميع (ملاحظة ٥٢)';
