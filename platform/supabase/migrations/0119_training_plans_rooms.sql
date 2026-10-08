-- =====================================================================
-- 0119 — التدريبُ: الخطةُ بابٌ قائمٌ بنفسه (ملاحظات ٣٦٠–٣٦٣)
--
--   كانت الشاشةُ ثلاثَ بطاقاتٍ متجاورة: الخططُ، ثم مكتبةُ موادَّ واحدةٌ
--   للجميع، ثم سجلُّ تأهيلٍ واحد. فإذا أُضيفت مادةٌ لم يُعرَف لأيِّ خطةٍ
--   هي إلا بعمود، وإذا كثرت الخططُ اختلطت موادُّها.
--
--   فصارت الخطةُ بابًا: تُفتَح صفحةً فيها وحداتُها ومكتبتُها وسجلُّها
--   ومستهدَفوها وقاعتُها. والقاعةُ تُنشَأ معها تلقائيًّا باسمها، وتبقى
--   قاعاتُ الاجتماعات والتدريب العامّةُ للاجتماعات الدورية.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) المستهدَفون وقاعةُ الخطة
-- ---------------------------------------------------------------------
alter table public.training_plans
  add column if not exists targets jsonb not null default '{}'::jsonb,
  add column if not exists room_id uuid references public.rooms (id) on delete set null;

comment on column public.training_plans.targets is
  'مستهدَفو الخطة: {"groups":["admins","translators",…],"members":[uuid,…]} (ملاحظة ٣٦٠)';
comment on column public.training_plans.room_id is
  'قاعةُ الخطة الخاصّةُ باسمها، تُنشَأ معها تلقائيًّا (ملاحظتا ٣٦٢ و٣٦٣)';

-- وللقاعة أن تُنسَب إلى خطتها، فلا تُخلَط بقاعات الاجتماعات الدورية
alter table public.rooms
  add column if not exists plan_id uuid references public.training_plans (id) on delete set null;

comment on column public.rooms.plan_id is
  'إن كانت القاعةُ قاعةَ خطةٍ تدريبيةٍ بعينها (ملاحظة ٣٦٢)';

-- ---------------------------------------------------------------------
-- ٢) حفظُ الخطة: يحمل المستهدَفين، ويُنشئ قاعتَها ويُتابع اسمَها
-- ---------------------------------------------------------------------
create or replace function public.plan_room_name(p_title text)
returns text language sql immutable set search_path = public as $$
  select 'قاعة: ' || btrim(coalesce(p_title, 'خطة'))
$$;
grant execute on function public.plan_room_name(text) to authenticated;

create or replace function public.ensure_plan_room(p_plan uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_title text; v_room uuid; v_name text; v_try text; v_i int := 1;
begin
  select title, room_id into v_title, v_room from public.training_plans where id = p_plan;
  if v_title is null then return null; end if;
  v_name := public.plan_room_name(v_title);

  if v_room is not null and exists (select 1 from public.rooms where id = v_room) then
    -- اسمُ القاعة يتبع اسمَ الخطة متى غُيِّر، إلا أن يكون الاسمُ مأخوذًا
    if not exists (select 1 from public.rooms where name = v_name and id <> v_room) then
      update public.rooms set name = v_name, plan_id = p_plan where id = v_room;
    end if;
    return v_room;
  end if;

  -- اسمُ القاعة فريدٌ في الجدول، فإن تشابه عنوانان أُلحق به رقم
  v_try := v_name;
  while exists (select 1 from public.rooms where name = v_try) loop
    v_i := v_i + 1;
    v_try := v_name || ' (' || v_i || ')';
  end loop;

  insert into public.rooms (name, description, kind, audience, sort, plan_id, created_by)
  values (v_try, 'قاعةُ خطةٍ تدريبيةٍ — دوراتُها وحدَها', 'training', 'all', 50,
          p_plan, auth.uid())
  returning id into v_room;

  update public.training_plans set room_id = v_room where id = p_plan;
  return v_room;
end $$;
grant execute on function public.ensure_plan_room(uuid) to authenticated;

do $do$
declare src text;
begin
  select pg_get_functiondef(oid) into src from pg_proc
   where proname = 'save_training_plan' and pronargs = 1;
  if src is null then return; end if;

  -- المستهدَفون يُحفَظون مع الخطة إن ذُكروا، وإلا بقوا على حالهم
  if position('targets' in src) = 0 then
    src := replace(src,
      'values (v_title, nullif(trim(coalesce(p ->> ''goal'', '''')), ''''),',
      'values (v_title, nullif(trim(coalesce(p ->> ''goal'', '''')), ''''),');
    src := replace(src,
      '  if p ? ''units'' then',
      '  if p ? ''targets'' then'
      || E'\n    update public.training_plans set targets = coalesce(p -> ''targets'', ''{}''::jsonb)'
      || E'\n     where id = v_id;'
      || E'\n  end if;'
      || E'\n'
      || E'\n  -- وقاعةُ الخطة تُنشَأ معها تلقائيًّا باسمها (ملاحظتا ٣٦٢ و٣٦٣)'
      || E'\n  perform public.ensure_plan_room(v_id);'
      || E'\n'
      || E'\n  if p ? ''units'' then');
    execute src;
  end if;
end $do$;

-- وقاعاتُ الخطط القائمةِ تُستحدَث مرةً واحدة
do $do$
declare r record;
begin
  for r in select id from public.training_plans where room_id is null loop
    begin
      perform public.ensure_plan_room(r.id);
    exception when others then
      raise warning 'تعذّر إنشاءُ قاعة الخطة %: %', r.id, sqlerrm;
    end;
  end loop;
end $do$;

-- ---------------------------------------------------------------------
-- ٣) بطاقاتُ الخطط: مربَّعاتٌ بإحصائها (ملاحظة ٣٦٠)
-- ---------------------------------------------------------------------
create or replace function public.training_plan_tiles()
returns table (id uuid, title text, goal text, audience text, level text,
               hours numeric, is_active boolean, units int, materials int,
               enrolled int, done int, room_id uuid, room_name text,
               targets jsonb)
language sql stable security definer set search_path = public as $$
  select p.id, p.title, p.goal, p.audience, p.level, p.hours, p.is_active,
         (select count(*)::int from public.training_units u where u.plan_id = p.id),
         (select count(*)::int from public.training_materials m where m.plan_id = p.id),
         (select count(*)::int from public.member_training t where t.plan_id = p.id),
         (select count(*)::int from public.member_training t
           where t.plan_id = p.id and t.status = 'done'),
         p.room_id,
         (select r.name from public.rooms r where r.id = p.room_id),
         p.targets
    from public.training_plans p
   where public.my_role() is not null
   order by p.is_active desc, p.level, p.title
$$;
grant execute on function public.training_plan_tiles() to authenticated;

comment on function public.training_plan_tiles() is
  'خططُ التدريب مربَّعاتٍ بإحصاء وحداتها وموادِّها وملتحقيها (ملاحظة ٣٦٠)';

-- ---------------------------------------------------------------------
-- ٤) الخطةُ الواحدة: وحداتُها ومستهدَفوها وقاعتُها
-- ---------------------------------------------------------------------
create or replace function public.training_plan(p_id uuid)
returns table (id uuid, title text, goal text, audience text, level text,
               hours numeric, is_active boolean, room_id uuid, room_name text,
               targets jsonb, units jsonb, target_names jsonb)
language sql stable security definer set search_path = public as $$
  select p.id, p.title, p.goal, p.audience, p.level, p.hours, p.is_active,
         p.room_id, (select r.name from public.rooms r where r.id = p.room_id),
         p.targets,
         (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', u.id, 'title', u.title, 'outline', u.outline,
                    'hours', u.hours, 'sort', u.sort) order by u.sort), '[]'::jsonb)
            from public.training_units u where u.plan_id = p.id),
         (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.full_name)
                    order by f.full_name), '[]'::jsonb)
            from public.profiles f
           where f.id::text in (
             select jsonb_array_elements_text(coalesce(p.targets -> 'members', '[]'::jsonb))))
    from public.training_plans p
   where public.my_role() is not null and p.id = p_id
$$;
grant execute on function public.training_plan(uuid) to authenticated;

-- سجلُّ تأهيلِ خطةٍ بعينها — يُعرَض داخلَها (ملاحظة ٣٦١)
create or replace function public.training_plan_record(p_plan uuid)
returns table (id uuid, member_id uuid, full_name text, plan_id uuid, plan_title text,
               level text, trainer_id uuid, trainer_name text, status text,
               started_at date, done_at date, note text)
language sql stable security definer set search_path = public as $$
  select t.id, t.member_id, m.full_name, t.plan_id, p.title, p.level,
         t.trainer_id, tr.full_name, t.status, t.started_at, t.done_at, t.note
    from public.member_training t
    join public.profiles m on m.id = t.member_id
    join public.training_plans p on p.id = t.plan_id
    left join public.profiles tr on tr.id = t.trainer_id
   where (public.may_train() or public.is_admin() or t.member_id = auth.uid())
     and t.plan_id = p_plan
   order by m.full_name
$$;
grant execute on function public.training_plan_record(uuid) to authenticated;

-- وموادُّ خطةٍ بعينها بمشاركاتها
create or replace function public.training_plan_materials(p_plan uuid)
returns table (id uuid, title text, kind text, file_path text, note text,
               size_bytes bigint, created_at timestamptz, shares int, dl_shares int)
language sql stable security definer set search_path = public as $$
  select m.id, m.title, m.kind, m.file_path, m.note, m.size_bytes, m.created_at,
         (select count(*)::int from public.training_shares s where s.material_id = m.id),
         (select count(*)::int from public.training_shares s
           where s.material_id = m.id and s.may_download)
    from public.training_materials m
   where (public.may_train() or public.is_admin()) and m.plan_id = p_plan
   order by m.created_at desc
$$;
grant execute on function public.training_plan_materials(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ٥) الالتحاقُ الجماعيُّ بمستهدَفي الخطة: الزرُّ يُغني عن إدخالهم فردًا فردًا
-- ---------------------------------------------------------------------
create or replace function public.enroll_plan_targets(p_plan uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_t jsonb; v_n int := 0; r record;
begin
  if not public.may_train() then
    raise exception 'الالتحاقُ بالخطط للإدارة وللمدرِّبين' using errcode = '42501';
  end if;
  select targets into v_t from public.training_plans where id = p_plan;
  if v_t is null then raise exception 'الخطة غير موجودة'; end if;

  for r in
    select f.id from public.profiles f
     where f.status = 'active'
       and (
         f.id::text in (select jsonb_array_elements_text(coalesce(v_t -> 'members', '[]'::jsonb)))
         or (v_t -> 'groups' ? 'admins'
             and f.role in ('manager', 'coordinator', 'supervisor', 'field_lead'))
         or (v_t -> 'groups' ? 'translators' and f.role = 'translator')
         or (v_t -> 'groups' ? 'specialists' and coalesce(f.is_trainer, false))
         or (v_t -> 'groups' ? 'field'       and f.track = 'field')
       )
  loop
    insert into public.member_training (member_id, plan_id, trainer_id, status)
    values (r.id, p_plan, auth.uid(), 'enrolled')
    on conflict do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;
grant execute on function public.enroll_plan_targets(uuid) to authenticated;

comment on function public.enroll_plan_targets(uuid) is
  'يُلحِق مستهدَفي الخطة بها دفعةً واحدة (ملاحظة ٣٦٠)';

notify pgrst, 'reload schema';
