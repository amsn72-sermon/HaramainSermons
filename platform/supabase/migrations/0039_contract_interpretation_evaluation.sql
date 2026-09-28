-- =====================================================================
-- 0039 — ما بنته المرحلتان الثانية والثالثة من ملاحظات العقد:
--   ١) سجلّ الترجمة الفورية بالساعات                      (ملاحظة ١٤٧)
--   ٢) بنود العقد السبعة وكمياتها — مرجعًا لا حسابًا       (ملاحظة ١٤٨)
--   ٣) التقييم الأسبوعي الوارد من مشرفي الهيئة             (ملاحظة ١٤٩)
--   ٤) الدليل المصطلحي الشرعي الموحَّد                     (ملاحظة ١٥٠)
--   ٥) صلاحية «مشرف الهيئة»: اطّلاعٌ لا تعديل، وسجلُّ اطّلاع (ملاحظة ١٤٦)
--   ٦) مسودّة المستخلص الشهري بالكميات                     (ملاحظة ١٥١)
-- =====================================================================

-- ---------------------------------------------------------------------
-- ٠) مشرف الهيئة: يرى ولا يكتب
-- ---------------------------------------------------------------------
create or replace function public.is_supervisor()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'supervisor', false)
$$;

-- من يرى التقارير: الإدارة ومشرف الهيئة
create or replace function public.can_view_reports()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_supervisor()
$$;

grant execute on function public.is_supervisor(), public.can_view_reports() to anon, authenticated;

-- الأعمال والمواد: يطّلع عليها المشرف كما تطّلع الإدارة، بلا تعديل
-- تعريف 0002 كما هو، ومعه المشرف: العضو يرى ما بيده الآن، والمشرف يرى الكل
create or replace function public.can_see_track(p_track uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_supervisor() or (public.my_role() is not null and exists (
    select 1 from public.tracks t
    join public.track_stages s on s.track_id = t.id
    where t.id = p_track and s.assignee_id = auth.uid() and (
      (s.status = 'active' and t.current_stage_id = s.id)
      or (t.status = 'awaiting_receipt' and s.sort = (select min(sort) from public.track_stages x where x.track_id = t.id))
    )
  ))
$$;

drop policy if exists "see materials" on public.materials;
create policy "see materials" on public.materials for select using (
  public.is_admin() or public.is_supervisor()
  or exists (select 1 from public.tracks t where t.material_id = materials.id and public.can_see_track(t.id))
);

-- سجلّ اطّلاع المشرف: كل فتحٍ لشاشة يُقيَّد
create table if not exists public.supervisor_views (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.profiles (id) on delete cascade,
  screen     text not null,
  viewed_at  timestamptz not null default now()
);

create index if not exists supervisor_views_when_idx on public.supervisor_views (viewed_at desc);

comment on table public.supervisor_views is 'سجلّ اطّلاع مشرف الهيئة: أي شاشة فُتحت ومتى (ملاحظة ١٤٦)';

alter table public.supervisor_views enable row level security;
drop policy if exists "read supervisor views" on public.supervisor_views;
create policy "read supervisor views" on public.supervisor_views for select using (public.is_manager());

create or replace function public.log_supervisor_view(p_screen text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_supervisor() then return; end if;
  insert into public.supervisor_views (member_id, screen)
  values (auth.uid(), left(coalesce(p_screen, '—'), 120));
end $$;

grant execute on function public.log_supervisor_view(text) to authenticated;

-- ---------------------------------------------------------------------
-- ١) سجلّ الترجمة الفورية — بالساعة، يدوّنها المنسق بعد إتمامها
-- ---------------------------------------------------------------------
create table if not exists public.interpretations (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.profiles (id) on delete restrict,
  language_code text not null references public.languages (code) on update cascade,
  held_on       date not null,
  hours         numeric(5, 2) not null check (hours > 0 and hours <= 24),
  event_type    text not null check (event_type in ('درس علمي', 'مؤتمر', 'ندوة', 'أخرى')),
  venue         text not null default 'makkah' check (venue in ('makkah', 'madinah', 'other')),
  venue_note    text,
  title         text not null,
  speaker       text,
  youtube_url   text,
  note          text,
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles (id),
  updated_at    timestamptz
);

create index if not exists interpretations_when_idx on public.interpretations (held_on desc);
create index if not exists interpretations_member_idx on public.interpretations (member_id, held_on desc);

comment on table public.interpretations
  is 'الترجمة الفورية للدروس والندوات والمؤتمرات: ساعاتها وبياناتها (ملاحظة ١٤٧)';

alter table public.interpretations enable row level security;
drop policy if exists "see interpretations" on public.interpretations;
create policy "see interpretations" on public.interpretations for select
  using (member_id = auth.uid() or public.can_view_reports());

create or replace function public.save_interpretation(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
        v_member uuid := nullif(p ->> 'member_id', '')::uuid;
        v_hours numeric := nullif(p ->> 'hours', '')::numeric;
        v_venue text := coalesce(nullif(p ->> 'venue', ''), 'makkah');
begin
  if not public.is_admin() then
    raise exception 'تدوين الترجمة الفورية للمنسق ومدير المشروع' using errcode = '42501';
  end if;
  if v_member is null then raise exception 'اختر المترجم'; end if;
  if nullif(trim(coalesce(p ->> 'language_code', '')), '') is null then raise exception 'اختر اللغة'; end if;
  if nullif(p ->> 'held_on', '') is null then raise exception 'حدّد تاريخ الفعالية'; end if;
  if v_hours is null or v_hours <= 0 then raise exception 'اكتب عدد الساعات'; end if;
  if v_hours > 24 then raise exception 'عدد الساعات لا يتجاوز ٢٤ في اليوم الواحد'; end if;
  if nullif(trim(coalesce(p ->> 'title', '')), '') is null then raise exception 'اكتب عنوان الفعالية'; end if;
  if v_venue = 'other' and nullif(trim(coalesce(p ->> 'venue_note', '')), '') is null then
    raise exception 'اكتب اسم المكان';
  end if;
  if not exists (select 1 from public.member_languages
                  where member_id = v_member and language_code = p ->> 'language_code') then
    raise exception 'المترجم غير مقيَّد على هذه اللغة';
  end if;

  if v_id is null then
    insert into public.interpretations (member_id, language_code, held_on, hours, event_type, venue,
                                        venue_note, title, speaker, youtube_url, note, created_by)
    values (v_member, p ->> 'language_code', (p ->> 'held_on')::date, v_hours,
            coalesce(nullif(p ->> 'event_type', ''), 'درس علمي'), v_venue,
            nullif(trim(coalesce(p ->> 'venue_note', '')), ''), trim(p ->> 'title'),
            nullif(trim(coalesce(p ->> 'speaker', '')), ''), nullif(trim(coalesce(p ->> 'youtube_url', '')), ''),
            nullif(trim(coalesce(p ->> 'note', '')), ''), auth.uid())
    returning id into v_id;
  else
    update public.interpretations
       set member_id = v_member, language_code = p ->> 'language_code', held_on = (p ->> 'held_on')::date,
           hours = v_hours, event_type = coalesce(nullif(p ->> 'event_type', ''), event_type),
           venue = v_venue, venue_note = nullif(trim(coalesce(p ->> 'venue_note', '')), ''),
           title = trim(p ->> 'title'), speaker = nullif(trim(coalesce(p ->> 'speaker', '')), ''),
           youtube_url = nullif(trim(coalesce(p ->> 'youtube_url', '')), ''),
           note = nullif(trim(coalesce(p ->> 'note', '')), ''),
           updated_by = auth.uid(), updated_at = now()
     where id = v_id;
    if not found then raise exception 'السجل غير موجود'; end if;
  end if;
  return v_id;
end $$;

grant execute on function public.save_interpretation(jsonb) to authenticated;

create or replace function public.delete_interpretation(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'حذف سجلّ الترجمة الفورية للمنسق ومدير المشروع' using errcode = '42501';
  end if;
  delete from public.interpretations where id = p_id;
end $$;

grant execute on function public.delete_interpretation(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ٢) بنود العقد السبعة — مرجعٌ من الكراسة، لا يُطبَّق على أحد آليًّا
-- ---------------------------------------------------------------------
create table if not exists public.contract_items (
  code           int primary key,
  name           text not null,
  unit           text not null,
  unit_price     numeric(12, 4),
  qty_contracted numeric(16, 2),
  total_value    numeric(16, 2),
  measure        text not null default 'manual'
                 check (measure in ('sermon', 'sermon_audio', 'sermon_sharia',
                                    'interpretation_hours', 'words', 'words_review', 'manual')),
  note           text
);

comment on table public.contract_items
  is 'بنود العقد وكمياته وأسعاره كما في كراسة المواصفات — مرجعٌ للتقارير لا حساب على الأعضاء (ملاحظة ١٤٨)';

alter table public.contract_items enable row level security;
drop policy if exists "read contract items" on public.contract_items;
create policy "read contract items" on public.contract_items for select using (public.can_view_reports());

insert into public.contract_items (code, name, unit, unit_price, qty_contracted, total_value, measure, note) values
  (1, 'ترجمة خطب الحرمين تحريريًّا', 'الخطبة لكل لغة',  2500,       2666,           6665000,     'sermon',               'كل لغة خطبةٌ مستقلة'),
  (2, 'التسجيل والأداء الصوتي للخطب', 'الخطبة لكل لغة',  400,        2666,           1066400,     'sermon_audio',         'يُحتسب بالخطبة التي اعتُمد تسجيلها'),
  (3, 'المراجعة والتدقيق الشرعي للخطب', 'الخطبة لكل لغة', 575,       2666,           1532950,     'sermon_sharia',        'يُحتسب بالخطبة التي تمّت مراجعتها الشرعية'),
  (4, 'الترجمة الفورية للدروس والندوات والمؤتمرات', 'الساعة', 20,    9800,           196000,      'interpretation_hours', 'من سجلّ الترجمة الفورية'),
  (5, 'الترجمة التحريرية للنصوص والكتب والمطويات', 'الكلمة', 0.05,   20266666.67,    1013333.34,  'words',                'كلمات الأصل العربي لكل لغة'),
  (6, 'مراجعة وتدقيق النصوص المترجَمة', 'الكلمة',        0.03,       20266666.67,    608000,      'words_review',         'كلمات الأصل العربي لكل لغة مراجَعة'),
  (7, 'الإرشاد المكاني وإجابة السائلين', 'الفرد × الفترة', null,     null,           25889166.66, 'manual',               'كميته تُحدَّد من جدول الورديات والفترات')
on conflict (code) do nothing;

-- صفٌّ لكل عمل بما يخصّ بنود العقد
create or replace view public.contract_rows with (security_invoker = true) as
select t.id                   as track_id,
       m.id                   as material_id,
       m.material_type,
       m.sermon_type,
       m.sermon_date,
       t.language_code,
       t.status,
       t.completed_at,
       (m.material_type = 'خطب')                                        as is_sermon,
       case when public.plain_text(m.source_html) = '' then 0
            else array_length(regexp_split_to_array(public.plain_text(m.source_html), '\s+'), 1) end as source_words,
       exists (select 1 from public.track_audios a
                where a.track_id = t.id and a.is_approved)              as has_audio,
       exists (select 1 from public.track_stages s
                where s.track_id = t.id and s.stage_key = 'sharia_review'
                  and s.status = 'done')                                as has_sharia
  from public.tracks t
  join public.materials m on m.id = t.material_id
 where t.deleted_at is null and m.deleted_at is null;

comment on view public.contract_rows
  is 'كل عمل بما يُحتسب به في بنود العقد: خطبة، أو تسجيلًا، أو مراجعةً، أو كلمات (ملاحظة ١٤٨)';

-- المنجَز في مدة (أو من أول العقد حين تُترك المدة فارغة)
create or replace function public.contract_progress(p_from date default null, p_to date default null)
returns table (code int, name text, unit text, unit_price numeric, qty_contracted numeric,
               qty_done numeric, total_value numeric, note text)
language sql stable security definer set search_path = public as $$
  with done as (
    select * from public.contract_rows
     where status = 'completed'
       and (p_from is null or coalesce(completed_at::date, sermon_date) >= p_from)
       and (p_to   is null or coalesce(completed_at::date, sermon_date) <= p_to)
  ), hours as (
    select coalesce(sum(i.hours), 0) as h from public.interpretations i
     where (p_from is null or i.held_on >= p_from) and (p_to is null or i.held_on <= p_to)
  )
  select c.code, c.name, c.unit, c.unit_price, c.qty_contracted,
         case c.measure
           when 'sermon'               then (select count(*) from done where is_sermon)
           when 'sermon_audio'         then (select count(*) from done where is_sermon and has_audio)
           when 'sermon_sharia'        then (select count(*) from done where is_sermon and has_sharia)
           when 'interpretation_hours' then (select h from hours)
           when 'words'                then (select coalesce(sum(source_words), 0) from done where not is_sermon)
           when 'words_review'         then (select coalesce(sum(source_words), 0) from done where not is_sermon)
           else 0 end::numeric as qty_done,
         c.total_value, c.note
    from public.contract_items c
   where public.can_view_reports()
   order by c.code
$$;

grant execute on function public.contract_progress(date, date) to authenticated;

-- مسودّة المستخلص الشهري: الكميات، والقيم مرجعًا من الكراسة
create or replace function public.claim_month(p_month date)
returns table (code int, name text, unit text, unit_price numeric, qty_done numeric, amount numeric)
language sql stable security definer set search_path = public as $$
  select p.code, p.name, p.unit, p.unit_price, p.qty_done,
         round(coalesce(p.unit_price, 0) * p.qty_done, 2)
    from public.contract_progress(date_trunc('month', p_month)::date,
                                  (date_trunc('month', p_month) + interval '1 month - 1 day')::date) p
$$;

grant execute on function public.claim_month(date) to authenticated;

-- ---------------------------------------------------------------------
-- ٣) التقييم الأسبوعي — يصدر من مشرفي الهيئة، والمنصة تسجّله فقط
-- ---------------------------------------------------------------------
create table if not exists public.field_evaluations (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null references public.profiles (id) on delete cascade,
  week_start      date not null,
  appearance      int not null check (appearance  between 0 and 5),
  attendance      int not null check (attendance  between 0 and 5),
  interaction     int not null check (interaction between 0 and 5),
  language_skill  int not null check (language_skill between 0 and 5),
  compliance      int not null check (compliance  between 0 and 5),
  supervisor_name text not null,
  evaluated_on    date,
  notes           text,
  form_path       text,
  created_by      uuid references public.profiles (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  unique (member_id, week_start)
);

comment on table public.field_evaluations
  is 'التقييم الأسبوعي للمرشدين كما ورد من مشرف الهيئة — تسجيلٌ لا احتساب (ملاحظة ١٤٩)';

alter table public.field_evaluations enable row level security;
drop policy if exists "see evaluations" on public.field_evaluations;
create policy "see evaluations" on public.field_evaluations for select
  using (member_id = auth.uid() or public.can_view_reports());

create or replace function public.save_field_evaluation(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
        v_member uuid := nullif(p ->> 'member_id', '')::uuid;
        v_week date := nullif(p ->> 'week_start', '')::date;
        v int;
begin
  if not public.is_admin() then
    raise exception 'تسجيل التقييم للمنسق ومدير المشروع' using errcode = '42501';
  end if;
  if v_member is null then raise exception 'اختر المرشد'; end if;
  if v_week is null then raise exception 'حدّد أسبوع التقييم'; end if;
  if nullif(trim(coalesce(p ->> 'supervisor_name', '')), '') is null then
    raise exception 'اكتب اسم مشرف الهيئة الذي أصدر التقييم';
  end if;
  foreach v in array array[
      coalesce((p ->> 'appearance')::int, -1), coalesce((p ->> 'attendance')::int, -1),
      coalesce((p ->> 'interaction')::int, -1), coalesce((p ->> 'language_skill')::int, -1),
      coalesce((p ->> 'compliance')::int, -1)] loop
    if v < 0 or v > 5 then raise exception 'درجة كل معيار من صفر إلى خمسة'; end if;
  end loop;

  insert into public.field_evaluations (id, member_id, week_start, appearance, attendance, interaction,
                                        language_skill, compliance, supervisor_name, evaluated_on,
                                        notes, form_path, created_by)
  values (coalesce(v_id, gen_random_uuid()), v_member, date_trunc('week', v_week)::date,
          (p ->> 'appearance')::int, (p ->> 'attendance')::int, (p ->> 'interaction')::int,
          (p ->> 'language_skill')::int, (p ->> 'compliance')::int,
          trim(p ->> 'supervisor_name'), nullif(p ->> 'evaluated_on', '')::date,
          nullif(trim(coalesce(p ->> 'notes', '')), ''), nullif(trim(coalesce(p ->> 'form_path', '')), ''),
          auth.uid())
  on conflict (member_id, week_start) do update
    set appearance = excluded.appearance, attendance = excluded.attendance,
        interaction = excluded.interaction, language_skill = excluded.language_skill,
        compliance = excluded.compliance, supervisor_name = excluded.supervisor_name,
        evaluated_on = excluded.evaluated_on, notes = excluded.notes,
        form_path = coalesce(excluded.form_path, public.field_evaluations.form_path),
        updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

grant execute on function public.save_field_evaluation(jsonb) to authenticated;

create or replace function public.delete_field_evaluation(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'حذف التقييم للمنسق ومدير المشروع' using errcode = '42501';
  end if;
  delete from public.field_evaluations where id = p_id;
end $$;

grant execute on function public.delete_field_evaluation(uuid) to authenticated;

-- متوسط الشهر ونسبة الصرف المقابلة في جدول العقد — بيانٌ لا تطبيق
create or replace function public.evaluation_month(p_month date)
returns table (member_id uuid, full_name text, weeks int, total int, monthly numeric,
               percent int, warning boolean)
language sql stable security definer set search_path = public as $$
  with e as (
    select v.member_id, count(*)::int as weeks,
           sum(v.appearance + v.attendance + v.interaction + v.language_skill + v.compliance)::int as total
      from public.field_evaluations v
     where v.week_start >= date_trunc('month', p_month)::date
       and v.week_start <  (date_trunc('month', p_month) + interval '1 month')::date
     group by v.member_id
  ), m as (
    select e.*, round(e.total::numeric * 4 / greatest(e.weeks, 1), 1) as monthly from e
  )
  select m.member_id, p.full_name, m.weeks, m.total, m.monthly,
         case when m.monthly >= 90 then 100 when m.monthly >= 80 then 90
              when m.monthly >= 70 then 80 else 70 end,
         m.monthly < 70
    from m join public.profiles p on p.id = m.member_id
   where public.can_view_reports() or m.member_id = auth.uid()
   order by m.monthly desc, p.full_name
$$;

grant execute on function public.evaluation_month(date) to authenticated;

-- ---------------------------------------------------------------------
-- ٤) الدليل المصطلحي الشرعي الموحَّد — التزامٌ في العقد
-- ---------------------------------------------------------------------
create table if not exists public.glossary_terms (
  id          uuid primary key default gen_random_uuid(),
  term_ar     text not null unique,
  category    text not null default 'عام' check (category in ('عقدي', 'فقهي', 'دعوي', 'عام')),
  explanation text not null,
  status      text not null default 'مقترح' check (status in ('مقترح', 'معتمد')),
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  approved_by uuid references public.profiles (id),
  approved_at timestamptz
);

create table if not exists public.glossary_translations (
  term_id       uuid not null references public.glossary_terms (id) on delete cascade,
  language_code text not null references public.languages (code) on update cascade,
  term_tr       text not null,
  note          text,
  primary key (term_id, language_code)
);

comment on table public.glossary_terms
  is 'الدليل المصطلحي الشرعي الموحَّد: المصطلح وشرحه وحال اعتماده (ملاحظة ١٥٠)';

alter table public.glossary_terms enable row level security;
alter table public.glossary_translations enable row level security;
drop policy if exists "read glossary" on public.glossary_terms;
create policy "read glossary" on public.glossary_terms for select using (public.my_role() is not null);
drop policy if exists "read glossary tr" on public.glossary_translations;
create policy "read glossary tr" on public.glossary_translations for select using (public.my_role() is not null);

create or replace function public.save_glossary_term(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
        v_tr jsonb := coalesce(p -> 'translations', '[]'::jsonb);
        v_row jsonb;
        v_mine boolean;
begin
  if public.my_role() is null or public.is_supervisor() then
    raise exception 'الدليل المصطلحي للفريق' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p ->> 'term_ar', '')), '') is null then raise exception 'اكتب المصطلح العربي'; end if;
  if nullif(trim(coalesce(p ->> 'explanation', '')), '') is null then
    raise exception 'اكتب شرحًا مختصرًا يوضّح المعنى الشرعي';
  end if;

  if v_id is not null then
    select (created_by = auth.uid()) into v_mine from public.glossary_terms where id = v_id;
    if v_mine is null then raise exception 'المصطلح غير موجود'; end if;
    -- المعتمد لا يعدّله إلا الإدارة
    if not public.is_admin() and (select status from public.glossary_terms where id = v_id) = 'معتمد' then
      raise exception 'المصطلح المعتمد يعدّله المنسق ومدير المشروع' using errcode = '42501';
    end if;
    update public.glossary_terms
       set term_ar = trim(p ->> 'term_ar'),
           category = coalesce(nullif(p ->> 'category', ''), category),
           explanation = trim(p ->> 'explanation')
     where id = v_id;
  else
    insert into public.glossary_terms (term_ar, category, explanation, status, created_by)
    values (trim(p ->> 'term_ar'), coalesce(nullif(p ->> 'category', ''), 'عام'),
            trim(p ->> 'explanation'), 'مقترح', auth.uid())
    returning id into v_id;
  end if;

  if jsonb_array_length(v_tr) > 0 then
    delete from public.glossary_translations where term_id = v_id;
    for v_row in select jsonb_array_elements(v_tr) loop
      if nullif(trim(coalesce(v_row ->> 'term_tr', '')), '') is not null then
        insert into public.glossary_translations (term_id, language_code, term_tr, note)
        values (v_id, v_row ->> 'language_code', trim(v_row ->> 'term_tr'),
                nullif(trim(coalesce(v_row ->> 'note', '')), ''))
        on conflict (term_id, language_code) do update
          set term_tr = excluded.term_tr, note = excluded.note;
      end if;
    end loop;
  end if;
  return v_id;
end $$;

grant execute on function public.save_glossary_term(jsonb) to authenticated;

create or replace function public.approve_glossary_term(p_id uuid, p_on boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'اعتماد المصطلح للمنسق ومدير المشروع' using errcode = '42501';
  end if;
  update public.glossary_terms
     set status = case when p_on then 'معتمد' else 'مقترح' end,
         approved_by = case when p_on then auth.uid() end,
         approved_at = case when p_on then now() end
   where id = p_id;
  if not found then raise exception 'المصطلح غير موجود'; end if;
end $$;

grant execute on function public.approve_glossary_term(uuid, boolean) to authenticated;

create or replace function public.delete_glossary_term(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'حذف المصطلح للمنسق ومدير المشروع' using errcode = '42501';
  end if;
  delete from public.glossary_terms where id = p_id;
end $$;

grant execute on function public.delete_glossary_term(uuid) to authenticated;

-- المصطلح بمقابلاته في سطر واحد — لشاشة الترجمة وللتصدير
create or replace view public.glossary_rows with (security_invoker = true) as
select g.id, g.term_ar, g.category, g.explanation, g.status, g.approved_at,
       coalesce(jsonb_agg(jsonb_build_object('language_code', tr.language_code, 'term_tr', tr.term_tr,
                                             'note', tr.note) order by tr.language_code)
                filter (where tr.term_id is not null), '[]'::jsonb) as translations
  from public.glossary_terms g
  left join public.glossary_translations tr on tr.term_id = g.id
 group by g.id;

comment on view public.glossary_rows is 'المصطلح بمقابلاته في كل لغة (ملاحظة ١٥٠)';

-- ---------------------------------------------------------------------
-- ٧) الدقائق الصوتية موثَّقة بكل تسجيل على حدة — قسمٌ مستقل في الدليل
--    (تفصيلٌ أكّده المستخدم: تبقى وتُوثَّق ببيانات كل تسجيل)
-- ---------------------------------------------------------------------
create or replace view public.audio_rows with (security_invoker = true) as
select a.id, a.track_id, a.path, a.created_at, a.duration_seconds, a.is_approved, a.stage_key,
       m.title, m.material_type, m.sermon_type, m.sermon_date,
       t.language_code,
       p.full_name as uploaded_by_name
  from public.track_audios a
  join public.tracks t on t.id = a.track_id
  join public.materials m on m.id = t.material_id
  left join public.profiles p on p.id = a.uploaded_by
 where t.deleted_at is null and m.deleted_at is null;

comment on view public.audio_rows
  is 'كل تسجيل صوتي ببياناته ومدته وحاله — ليخرج تقرير الدقائق واضحًا (ملاحظة ١٤٧)';

notify pgrst, 'reload schema';
