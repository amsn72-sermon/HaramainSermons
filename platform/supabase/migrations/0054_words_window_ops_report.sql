-- =====================================================================
-- 0054 — الاحتساب على أصل العقد، ونافذة الخطبة، والتقرير الشهري
--   ١) الكلمات تُحتسب من النص العربي الأصل، تُستخرج مرةً واحدة للمادة
--      ويصحّحها المنسق إن أخطأت الآلة (ملاحظة ١٨٨).
--   ٢) الخطبة تصل الثلاثاء أو الأربعاء وتُسلَّم قبل الجمعة، فمدد المراحل
--      تُحتسب من النافذة الباقية لا من أرقامٍ ثابتة (ملاحظة ١٨٩).
--   ٣) تقريرٌ شهري على صيغة التكاليف التشغيلية في كراسة المنافسة:
--      بندٌ بندًا بعدده وتكلفته، والتقصير بالأيام وحسمياته، ثم الإجمالي
--      والضريبة والصافي (ملاحظة ١٩٠). ولمدير المشروع وحده.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) كلمات الأصل العربي: مرةً واحدة للمادة، آليًّا ثم بتصحيح المنسق
-- ---------------------------------------------------------------------
alter table public.materials
  add column if not exists source_words      int,
  add column if not exists source_words_auto int,
  add column if not exists source_words_by   uuid references public.profiles (id),
  add column if not exists source_words_at   timestamptz;

comment on column public.materials.source_words is
  'كلمات النص العربي الأصل: ما يُحتسب به في العقد، مرةً واحدة للمادة (ملاحظة ١٨٨)';
comment on column public.materials.source_words_auto is
  'ما أحصته المنصة بنفسها — يُحفظ بجانب المصحَّح للمقارنة';

-- إحصاءٌ آليٌّ من النص المكتوب، وما جاء ملفًّا يُحصى في الشاشة ويُحفظ هنا
create or replace function public.count_words(p_text text)
returns int language sql immutable set search_path = public as $$
  select case when coalesce(trim(p_text), '') = '' then 0
              else array_length(regexp_split_to_array(trim(regexp_replace(p_text, '\s+', ' ', 'g')), ' '), 1)
         end
$$;
grant execute on function public.count_words(text) to authenticated;

create or replace function public.set_material_words(p_material uuid, p_words int,
                                                     p_auto int default null)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin_for('materials') then
    raise exception 'تصحيح عدد الكلمات للمنسق ومدير المشروع' using errcode = '42501';
  end if;
  if p_words is not null and (p_words < 0 or p_words > 5000000) then
    raise exception 'عدد الكلمات غير معقول';
  end if;
  update public.materials
     set source_words = p_words,
         source_words_auto = coalesce(p_auto, source_words_auto),
         source_words_by = auth.uid(), source_words_at = now()
   where id = p_material and deleted_at is null;
  if not found then raise exception 'المادة غير موجودة'; end if;
  return p_words;
end $$;
grant execute on function public.set_material_words(uuid, int, int) to authenticated;

-- والموجود يُملأ مرةً من نصّه المكتوب، فلا يبدأ التقرير فارغًا
update public.materials m
   set source_words = public.count_words(public.plain_text(m.source_html)),
       source_words_auto = public.count_words(public.plain_text(m.source_html))
 where m.source_words is null
   and coalesce(public.plain_text(m.source_html), '') <> '';

-- والصفّ يقرأ المحفوظ، فإن لم يكن أحصى النصّ المكتوب — ولا يُحصى المترجَم
drop view if exists public.contract_rows;
create view public.contract_rows with (security_invoker = true) as
select t.id                   as track_id,
       m.id                   as material_id,
       m.material_type,
       m.sermon_type,
       m.sermon_date,
       t.language_code,
       t.status,
       t.completed_at,
       (m.material_type = 'خطب')                                        as is_sermon,
       coalesce(m.source_words,
                public.count_words(public.plain_text(m.source_html)))    as source_words,
       (m.source_words is null
        and coalesce(public.plain_text(m.source_html), '') = '')         as words_missing,
       exists (select 1 from public.track_audios a
                where a.track_id = t.id and a.is_approved)              as has_audio,
       exists (select 1 from public.track_stages s
                where s.track_id = t.id and s.stage_key = 'sharia_review'
                  and s.status = 'done')                                as has_sharia
  from public.tracks t
  join public.materials m on m.id = t.material_id
 where t.deleted_at is null and m.deleted_at is null;

comment on view public.contract_rows
  is 'كل عمل بما يُحتسب به في بنود العقد، والكلمات من الأصل العربي (ملاحظتا ١٤٨ و١٨٨)';
grant select on public.contract_rows to authenticated;

-- وكم مادةً لم يُحصَ أصلُها بعد — ليُستدرك لا ليُنسى
create or replace function public.words_pending()
returns table (material_id uuid, title text, material_type text, sermon_date date, langs int)
language sql stable security definer set search_path = public as $$
  select m.id, m.title, m.material_type, m.sermon_date,
         (select count(*)::int from public.tracks t
           where t.material_id = m.id and t.deleted_at is null)
    from public.materials m
   where public.is_admin_for('materials')
     and m.deleted_at is null
     and m.material_type <> 'خطب'
     and m.source_words is null
   order by m.created_at desc
$$;
grant execute on function public.words_pending() to authenticated;

-- ---------------------------------------------------------------------
-- ٢) نافذة الخطبة: من وصولها إلى ما قبل الجمعة، ومدد المراحل منها
-- ---------------------------------------------------------------------
alter table public.platform_settings
  add column if not exists sermon_cutoff_hours int not null default 6;

comment on column public.platform_settings.sermon_cutoff_hours is
  'ساعات الأمان قبل خطبة الجمعة: يُنتهى من العمل قبلها (ملاحظة ١٨٩)';

-- الخطبة تصل الثلاثاء أو الأربعاء، وموعد الجمعة ظهرًا
create or replace function public.sermon_window(p_sermon_date date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cut int; v_due timestamptz; v_minutes int; v_total numeric;
        v_split jsonb := '{}'::jsonb; v_ws public.workflow_stages;
begin
  select coalesce(sermon_cutoff_hours, 6) into v_cut from public.platform_settings where id;
  if p_sermon_date is null then return null; end if;

  -- التسليم: قبل الخطبة بساعات الأمان، والخطبة نحو الظهر بتوقيت الرياض
  v_due := (p_sermon_date::timestamp + interval '12 hours') at time zone 'Asia/Riyadh'
           - make_interval(hours => v_cut);
  v_minutes := greatest(0, floor(extract(epoch from (v_due - now())) / 60))::int;

  select coalesce(sum(weight), 0) into v_total
    from public.workflow_stages where is_active and not outside_sla and weight > 0;

  for v_ws in select * from public.workflow_stages
               where is_active and not outside_sla and weight > 0 order by sort loop
    v_split := v_split || jsonb_build_object(
      v_ws.key,
      case when v_total > 0 then greatest(15, round(v_minutes * v_ws.weight / v_total))
           else 60 end);
  end loop;

  return jsonb_build_object(
    'due_at', v_due,
    'minutes', v_minutes,
    'hours', round(v_minutes / 60.0, 1),
    'cutoff_hours', v_cut,
    'arrived_on_time', extract(isodow from current_date) in (2, 3),
    'tight', v_minutes < 24 * 60,
    'split', v_split);
end $$;
grant execute on function public.sermon_window(date) to authenticated;

-- ---------------------------------------------------------------------
-- ٣) التقرير الشهري: التكاليف التشغيلية على صيغة الكراسة
-- ---------------------------------------------------------------------
create table if not exists public.ops_items (
  code        int primary key,
  name        text not null,
  staff_count int  not null default 1,
  unit_cost   numeric(14,2) not null,       -- التكلفة الشهرية للفرد، من الكراسة
  role_key    text,                          -- للربط بالفريق عند احتساب التقصير
  lang_code   text references public.languages (code),
  sort        int not null default 0,
  is_active   boolean not null default true
);

comment on table public.ops_items is
  'بنود التكاليف التشغيلية للفريق كما في كراسة المنافسة — مرجعٌ لا يُربط بالواقع من نفسه (ملاحظة ١٩٠)';

alter table public.ops_items enable row level security;
drop policy if exists "manager reads ops items" on public.ops_items;
create policy "manager reads ops items" on public.ops_items for select using (public.is_manager());

-- شهرٌ بعينه: عدده وتقصيره وحسمياته — يُحتسب ثم يصحّحه مدير المشروع
create table if not exists public.ops_month (
  month       date not null,
  code        int  not null references public.ops_items (code) on delete cascade,
  staff_count int,
  short_days  numeric(8,2) not null default 0,
  deduction   numeric(14,2),
  note        text,
  updated_by  uuid references public.profiles (id),
  updated_at  timestamptz not null default now(),
  primary key (month, code)
);

comment on table public.ops_month is
  'ما يخصّ شهرًا من كل بند: العدد والتقصير بالأيام والحسميات (ملاحظة ١٩٠)';

alter table public.ops_month enable row level security;
drop policy if exists "manager reads ops month" on public.ops_month;
create policy "manager reads ops month" on public.ops_month for select using (public.is_manager());

-- بنود الكراسة
insert into public.ops_items (code, name, staff_count, unit_cost, role_key, lang_code, sort) values
  (1,  'مدير المشروع',                1, 23254.88, 'manager',     null, 1),
  (2,  'منسق المشروع',                1, 17441.16, 'coordinator', null, 2),
  (3,  'مترجمو اللغة الإنجليزية',     4, 31975.46, 'translator',  'en', 3),
  (4,  'مترجمو اللغة الفرنسية',       4, 31975.46, 'translator',  'fr', 4),
  (5,  'مترجمو اللغة الأردية',        4, 26161.74, 'translator',  'ur', 5),
  (6,  'مترجمو لغة الملايو',          4, 26161.74, 'translator',  'ms', 6),
  (7,  'مترجمو لغة الهوسا',           4, 23254.88, 'translator',  'ha', 7),
  (8,  'مترجمو اللغة التركية',        4, 26161.74, 'translator',  'tr', 8),
  (9,  'مترجمو اللغة الصينية',        4, 30522.03, 'translator',  'zh', 9),
  (10, 'مترجمو اللغة البنغالية',      4, 20348.02, 'translator',  'bn', 10),
  (11, 'مترجمو اللغة الفارسية',       4, 29068.60, 'translator',  'fa', 11),
  (12, 'مترجمو اللغة الروسية',        4, 34882.32, 'translator',  'ru', 12),
  (13, 'مشرف الإرشاد المكاني',        1,  6459.69, 'field_lead',  null, 13),
  (14, 'المرشدون المكانيون',         40,  3068.35, 'field',       null, 14)
on conflict (code) do update
  set name = excluded.name, staff_count = excluded.staff_count,
      unit_cost = excluded.unit_cost, role_key = excluded.role_key,
      lang_code = excluded.lang_code, sort = excluded.sort;

-- اللغة إن لم تكن مفعّلة عندنا تُترك بلا ربط، فلا يسقط البند
update public.ops_items o set lang_code = null
 where o.lang_code is not null
   and not exists (select 1 from public.languages l where l.code = o.lang_code);

-- التقصير المحتسَب آليًّا: ورديةٌ مجدولة لم يُحضَر فيها (ملاحظة ١٩٠)
create or replace function public.ops_short_days(p_month date, p_code int)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v_from date; v_to date; v_item public.ops_items; v_n numeric := 0;
begin
  select * into v_item from public.ops_items where code = p_code;
  if not found then return 0; end if;
  v_from := date_trunc('month', p_month)::date;
  v_to   := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;

  -- الإرشاد المكاني وحده له ورديات تُقاس بها أيام الحضور
  if v_item.role_key in ('field', 'field_lead') then
    select count(*) into v_n
      from public.shifts s
      join public.profiles p on p.id = s.member_id
     where s.shift_date between v_from and v_to
       and p.track = 'field'
       and s.check_in_at is null
       and s.status <> 'cancelled';
  end if;
  return coalesce(v_n, 0);
end $$;
grant execute on function public.ops_short_days(date, int) to authenticated;

-- التقرير نفسه: سطرٌ لكل بند، ثم الإجمالي والضريبة والصافي في الشاشة
create or replace function public.ops_report(p_month date)
returns table (code int, name text, staff_count int, unit_cost numeric,
               total_cost numeric, short_days numeric, deduction numeric,
               net numeric, note text, is_manual boolean)
language sql stable security definer set search_path = public as $$
  with m as (select date_trunc('month', p_month)::date as mo)
  select o.code, o.name,
         coalesce(om.staff_count, o.staff_count)                              as staff_count,
         o.unit_cost,
         round(o.unit_cost * coalesce(om.staff_count, o.staff_count), 2)       as total_cost,
         coalesce(om.short_days, public.ops_short_days(p_month, o.code))       as short_days,
         coalesce(om.deduction,
                  round(o.unit_cost / 30.0
                        * coalesce(om.short_days, public.ops_short_days(p_month, o.code)), 2)) as deduction,
         round(o.unit_cost * coalesce(om.staff_count, o.staff_count), 2)
           - coalesce(om.deduction,
                      round(o.unit_cost / 30.0
                            * coalesce(om.short_days, public.ops_short_days(p_month, o.code)), 2)) as net,
         om.note,
         (om.deduction is not null)                                           as is_manual
    from public.ops_items o
    cross join m
    left join public.ops_month om on om.code = o.code and om.month = m.mo
   where o.is_active and public.is_manager()
   order by o.sort, o.code
$$;
grant execute on function public.ops_report(date) to authenticated;

-- ومدير المشروع يصحّح عدد البند أو تقصيره أو حسمياته
create or replace function public.set_ops_month(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_mo date := date_trunc('month', (p ->> 'month')::date)::date;
        v_code int := (p ->> 'code')::int;
begin
  if not public.is_manager() then
    raise exception 'التقرير الشهري لمدير المشروع' using errcode = '42501';
  end if;
  if v_mo is null or v_code is null then raise exception 'حدّد الشهر والبند'; end if;
  if not exists (select 1 from public.ops_items where code = v_code) then
    raise exception 'بندٌ غير معروف';
  end if;

  insert into public.ops_month (month, code, staff_count, short_days, deduction, note, updated_by)
  values (v_mo, v_code,
          nullif(p ->> 'staff_count', '')::int,
          coalesce(nullif(p ->> 'short_days', '')::numeric, 0),
          nullif(p ->> 'deduction', '')::numeric,
          nullif(trim(coalesce(p ->> 'note', '')), ''),
          auth.uid())
  on conflict (month, code) do update
    set staff_count = excluded.staff_count,
        short_days  = excluded.short_days,
        deduction   = excluded.deduction,
        note        = excluded.note,
        updated_by  = excluded.updated_by,
        updated_at  = now();
end $$;
grant execute on function public.set_ops_month(jsonb) to authenticated;

-- وما صُحِّح يُعاد إلى المحتسَب آليًّا بمحوه
create or replace function public.clear_ops_month(p_month date, p_code int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then
    raise exception 'التقرير الشهري لمدير المشروع' using errcode = '42501';
  end if;
  delete from public.ops_month
   where month = date_trunc('month', p_month)::date and code = p_code;
end $$;
grant execute on function public.clear_ops_month(date, int) to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- ٤) أرقام الإنتاج على أساس العقد: كلمات الأصل العربي مرةً واحدة للمادة،
--    بجانب كلمات الترجمة المسلَّمة — فلا يُخلَط الأساسان (ملاحظتا ١٨٨ و١٩١)
-- ---------------------------------------------------------------------
create or replace function public.production_contract()
returns table (source_words bigint, material_words bigint, sermons int,
               texts int, lang_tracks int, interp_hours numeric, missing int)
language sql stable security definer set search_path = public as $$
  with mats as (
    select m.id, m.material_type,
           coalesce(m.source_words,
                    public.count_words(public.plain_text(m.source_html))) as sw,
           (m.source_words is null
            and coalesce(public.plain_text(m.source_html), '') = '')       as no_count
      from public.materials m
     where m.deleted_at is null
       and exists (select 1 from public.tracks t
                    where t.material_id = m.id and t.deleted_at is null
                      and t.status = 'completed')
  )
  select coalesce(sum(sw), 0)::bigint,
         coalesce(sum(case when material_type <> 'خطب' then sw else 0 end), 0)::bigint,
         count(*) filter (where material_type = 'خطب')::int,
         count(*) filter (where material_type <> 'خطب')::int,
         (select count(*)::int from public.tracks t
           where t.deleted_at is null and t.status = 'completed'),
         (select coalesce(sum(i.hours), 0) from public.interpretations i),
         count(*) filter (where no_count)::int
    from mats
$$;
grant execute on function public.production_contract() to authenticated;

notify pgrst, 'reload schema';
