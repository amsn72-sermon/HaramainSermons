-- =====================================================================
-- 0083 — اللغةُ الأمُّ ولغاتُ الإسناد والدورُ الافتراضي (ملاحظتا ٢٤٩ و٢٥٠)
--
--   كان للعضو قائمةُ لغاتٍ واحدة، لا تفرّق بين لسانه الذي وُلد عليه وبين
--   لغةٍ تعلّمها، ولا بين ما يُحسنه وما أذنت له الإدارةُ بالترجمة به.
--   والموادُّ المهمّةُ — الخطبُ والتوجيهات — تُرجَّح فيها اللغةُ الأمّ.
--
--   فصارت ثلاثةً:
--     اللغةُ الأمّ      — واحدةٌ لا غير، حقلٌ إلزاميٌّ كالبريد والهوية.
--     اللغاتُ المُتقَنة — ما يُحسنه العضو، يعلنه عن نفسه.
--     لغاتُ الإسناد     — ما أذنت به الإدارة، ومنها وحدَها يُسنَد إليه.
--
--   ولكلِّ لغةٍ من لغات إسناده دورٌ افتراضيٌّ من المراحل الستّ وأولويةٌ
--   في الدور، فتملأ المنصةُ المراحلَ اقتراحًا ويعتمده المنسّق.
-- =====================================================================

-- ١) اللغةُ الأمّ
alter table public.profiles
  add column if not exists native_lang text references public.languages (code) on update cascade;

comment on column public.profiles.native_lang is 'اللغةُ الأمّ — واحدةٌ لا غير (ملاحظة ٢٤٩)';

-- ٢) على كلِّ لغةٍ للعضو: أمعتمدةٌ للإسناد؟ وما دورُه فيها؟ وما أولويتُه؟
alter table public.member_languages
  add column if not exists assignable    boolean  not null default true,
  add column if not exists default_stage text,
  add column if not exists priority      smallint not null default 100;

comment on column public.member_languages.assignable is
  'أذنت الإدارةُ بالإسناد في هذه اللغة (ملاحظة ٢٤٩)';
comment on column public.member_languages.default_stage is
  'الدورُ الافتراضيُّ في هذه اللغة من مراحل العمل (ملاحظة ٢٥٠)';
comment on column public.member_languages.priority is
  'أولويةُ الدور: الأصغرُ أولًا (ملاحظة ٢٥٠)';

-- الأعضاءُ الحاليّون: لغتُهم الأولى تصير لغتَهم الأمَّ حتى تُراجَع
update public.profiles p
   set native_lang = (
     select ml.language_code from public.member_languages ml
      where ml.member_id = p.id order by ml.language_code limit 1)
 where p.native_lang is null;

-- ٣) حفظُ اللغات لا يمحو ما أذنت به الإدارةُ ولا الأدوار
create or replace function public.set_member_langs(p_member uuid, p_languages text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_manager() or public.my_role() = 'coordinator' or p_member = auth.uid()) then
    raise exception 'ليست لك صلاحية تعديل لغات هذا العضو' using errcode = '42501';
  end if;
  if p_languages is null then return; end if;

  delete from public.member_languages
   where member_id = p_member and language_code <> all (coalesce(p_languages, '{}'));

  -- اللغةُ الجديدةُ معتمدةٌ للإسناد حتى تسحبها الإدارة: فالأصلُ أنّ من
  -- أعلن لغةً يُسنَد إليه فيها، والتضييقُ قرارٌ يُتَّخذ لا حالٌ افتراضية.
  insert into public.member_languages (member_id, language_code, assignable)
  select p_member, l, true from unnest(p_languages) l
  where exists (select 1 from public.languages where code = l)
  on conflict (member_id, language_code) do nothing;

  -- اللغةُ الأمُّ معتمدةٌ للإسناد دائمًا
  update public.member_languages ml set assignable = true
    from public.profiles p
   where ml.member_id = p_member and p.id = p_member and ml.language_code = p.native_lang;
end $$;

grant execute on function public.set_member_langs(uuid, text[]) to authenticated;

-- ٤) اللغةُ الأمّ: يضعها العضوُ لنفسه، أو الإدارةُ له
create or replace function public.set_native_lang(p_member uuid, p_lang text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_manager() or public.my_role() = 'coordinator' or p_member = auth.uid()) then
    raise exception 'ليست لك صلاحية تعديل اللغة الأم' using errcode = '42501';
  end if;
  if p_lang is not null and not exists (select 1 from public.languages where code = p_lang) then
    raise exception 'لغةٌ غير مسجَّلة';
  end if;

  update public.profiles set native_lang = p_lang where id = p_member;

  if p_lang is not null then
    insert into public.member_languages (member_id, language_code, assignable)
    values (p_member, p_lang, true)
    on conflict (member_id, language_code) do update set assignable = true;
  end if;
end $$;

grant execute on function public.set_native_lang(uuid, text) to authenticated;

-- ٥) لغاتُ الإسناد: بيد الإدارة وحدَها
create or replace function public.set_assignable_langs(p_member uuid, p_languages text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_manager() or public.my_role() = 'coordinator') then
    raise exception 'اعتمادُ لغات الإسناد لمدير المشروع والمنسّقين' using errcode = '42501';
  end if;
  update public.member_languages
     set assignable = (language_code = any (coalesce(p_languages, '{}')))
   where member_id = p_member;
end $$;

grant execute on function public.set_assignable_langs(uuid, text[]) to authenticated;

-- ٦) الدورُ الافتراضيُّ والأولوية
create or replace function public.set_lang_role(
  p_member uuid, p_lang text, p_stage text default null, p_priority int default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_manager() or public.my_role() = 'coordinator') then
    raise exception 'ضبطُ الأدوار لمدير المشروع والمنسّقين' using errcode = '42501';
  end if;
  if p_stage is not null and not exists (select 1 from public.workflow_stages where key = p_stage) then
    raise exception 'مرحلةٌ غير معروفة';
  end if;
  update public.member_languages
     set default_stage = coalesce(p_stage, default_stage),
         priority      = coalesce(p_priority::smallint, priority)
   where member_id = p_member and language_code = p_lang;
end $$;

grant execute on function public.set_lang_role(uuid, text, text, int) to authenticated;

-- ٧) جدولُ اللغة: من فيها، وبأيِّ دورٍ وأيِّ أولوية، وكم عملًا عنده
drop function if exists public.lang_roster(text);
create or replace function public.lang_roster(p_lang text)
returns table (member_id uuid, full_name text, role text, native boolean,
               assignable boolean, default_stage text, priority int, open_works int)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role::text,
         coalesce(p.native_lang = ml.language_code, false),
         ml.assignable, ml.default_stage, ml.priority::int,
         (select count(*)::int from public.track_stages s
            join public.tracks t on t.id = s.track_id
           where s.assignee_id = p.id and s.status <> 'done' and t.status <> 'completed')
    from public.member_languages ml
    join public.profiles p on p.id = ml.member_id
   where ml.language_code = p_lang and p.status = 'active'
   order by ml.priority asc, coalesce(p.native_lang = ml.language_code, false) desc, p.full_name
$$;

grant execute on function public.lang_roster(text) to authenticated;

-- ٨) اقتراحُ الإسناد: لكلِّ مرحلةٍ أولُ صاحبِ دورٍ فيها، وإلا فأقلُّهم حملًا
drop function if exists public.suggest_assignees(text);
create or replace function public.suggest_assignees(p_lang text)
returns table (stage_key text, member_id uuid, full_name text, native boolean, why text)
language sql stable security definer set search_path = public as $$
  with roster as (
    select p.id, p.full_name, p.role::text as role, ml.default_stage, ml.priority,
           coalesce(p.native_lang = ml.language_code, false) as native,
           (select count(*) from public.track_stages s
              join public.tracks t on t.id = s.track_id
             where s.assignee_id = p.id and s.status <> 'done' and t.status <> 'completed') as load
      from public.member_languages ml
      join public.profiles p on p.id = ml.member_id
     where ml.language_code = p_lang and ml.assignable and p.status = 'active'
  ),
  picked as (
    select w.key as stage_key, r.id, r.full_name, r.native,
           case when r.default_stage is not distinct from w.key then 'دورُه الافتراضي'
                else 'أقلُّهم حملًا' end as why,
           -- الترتيبُ بـ desc يقدّم الفارغَ في PostgreSQL، فتُسوّى القيمُ أولًا
           row_number() over (
             partition by w.key
             order by coalesce(r.default_stage = w.key, false) desc,
                      r.priority asc,
                      coalesce(r.native, false) desc,
                      r.load asc, r.full_name
           ) as rn
      from public.workflow_stages w
      join roster r
        on (w.assignee_role = 'translator')
        or (w.assignee_role = 'coordinator' and r.role in ('coordinator','manager'))
        or (w.assignee_role = 'manager' and r.role = 'manager')
     where w.is_active
  )
  select stage_key, id, full_name, native, why from picked where rn = 1
$$;

grant execute on function public.suggest_assignees(text) to authenticated;

-- ٩) تعديلُ العضو من شاشة الفريق: لا يمحو الأدوارَ ولا إذنَ الإسناد
--    تُرقَّع الدالّةُ القائمةُ في موضع اللغات وحدَه، فلا تضيع أسوارُها
--    التي بُنيت على مرّ الترحيلات (الصلاحياتُ وحدودُ المنسّق وغيرها).
do $$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_update_member'
     and pg_get_function_identity_arguments(p.oid)
         = 'p_member uuid, p_status member_status, p_role app_role, p_languages text[]';
  if v_src is null then
    raise notice 'admin_update_member غير موجودة — تُخطّي الترقيع';
    return;
  end if;
  if position('set_member_langs' in v_src) > 0 then return; end if;   -- رُقّعت من قبل

  v_new := regexp_replace(
    v_src,
    'delete from public\.member_languages where member_id = p_member;\s*'
    || 'insert into public\.member_languages \(member_id, language_code\)\s*'
    || 'select p_member, l from unnest\(p_languages\) l\s*'
    || 'where exists \(select 1 from public\.languages where code = l\);',
    'perform public.set_member_langs(p_member, p_languages);',
    'g');

  if v_new = v_src then
    raise exception 'لم يُعرف موضعُ اللغات في admin_update_member — راجِعْ يدويًّا';
  end if;
  execute v_new;
end $$;

-- ١٠) الإسنادُ لا يقع إلا في لغةٍ أذنت بها الإدارة
create or replace function public.may_assign_lang(p_member uuid, p_lang text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.member_languages
                  where member_id = p_member and language_code = p_lang and assignable)
$$;

grant execute on function public.may_assign_lang(uuid, text) to authenticated;

-- وأهليةُ المسؤول تُقاس بلغات الإسناد لا بما أعلنه عن نفسه
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
  if v_ws.assignee_role = 'manager' and v_assignee.role <> 'manager' then
    raise exception 'مرحلة «%» تُسند لمدير المشروع', v_ws.name_ar;
  end if;
end $$;

revoke execute on function public.check_assignee(public.workflow_stages, public.profiles, text)
  from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ١١) اقتراحُ الإسناد للغات كلِّها في طلبٍ واحد (ملاحظة ٢٥٠)
--     شاشةُ الإضافة تحتاجها قبل أن يختار المنسّقُ لغته، فلا يُترك
--     الاقتراحُ يصل متأخّرًا فيُزيح ما اختاره بيده.
drop function if exists public.suggest_assignees_all();
create or replace function public.suggest_assignees_all()
returns table (language_code text, stage_key text, member_id uuid, full_name text,
               native boolean, why text)
language sql stable security definer set search_path = public as $$
  with roster as (
    select ml.language_code, p.id, p.full_name, p.role::text as role,
           ml.default_stage, ml.priority,
           coalesce(p.native_lang = ml.language_code, false) as native,
           (select count(*) from public.track_stages s
              join public.tracks t on t.id = s.track_id
             where s.assignee_id = p.id and s.status <> 'done' and t.status <> 'completed') as load
      from public.member_languages ml
      join public.profiles p on p.id = ml.member_id
     where ml.assignable and p.status = 'active'
  ),
  picked as (
    select r.language_code, w.key as stage_key, r.id, r.full_name, r.native,
           case when r.default_stage is not distinct from w.key then 'دورُه الافتراضي'
                else 'أقلُّهم حملًا' end as why,
           row_number() over (
             partition by r.language_code, w.key
             order by coalesce(r.default_stage = w.key, false) desc,
                      r.priority asc,
                      coalesce(r.native, false) desc,
                      r.load asc, r.full_name
           ) as rn
      from public.workflow_stages w
      join roster r
        on (w.assignee_role = 'translator')
        or (w.assignee_role = 'coordinator' and r.role in ('coordinator','manager'))
        or (w.assignee_role = 'manager' and r.role = 'manager')
     where w.is_active
  )
  select language_code, stage_key, id, full_name, native, why from picked where rn = 1
$$;

grant execute on function public.suggest_assignees_all() to authenticated;

notify pgrst, 'reload schema';
