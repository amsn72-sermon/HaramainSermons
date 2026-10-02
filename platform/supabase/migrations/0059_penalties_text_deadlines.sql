-- =====================================================================
-- 0059 — جزاءاتُ العقد ومواعيدُ النصوص (ملاحظة ١٩٧)
--   بقي من العقد بندان لم تعرفهما المنصة:
--
--   أولًا: جدولُ الجزاءات. يفرض العقد غرامةً على التأخير والتقصير، لكلِّ
--   نوعٍ مقدارُه: نسبةٌ من قيمة الخطبة أو الترجمة، أو مبلغٌ مقطوع عن
--   اليوم أو الساعة أو اللغة. ولا يتجاوز مجموعُها عُشرَ قيمة العقد
--   ومثلَه — عشرين في المئة. فتُسجَّل الواقعةُ بتاريخها ومادتها ولغتها،
--   وتحتسب المنصة مقدارَها من الجدول، ويبقى للمدير تثبيتُ غيره بسبب،
--   ويُنبَّه إذا قارب المجموعُ السقف.
--
--   ثانيًا: مواعيدُ الترجمة التحريرية. مدّةُ التسليم في العقد بعدد
--   الصفحات ونوع المهمة: اعتيادية وعاجلة وطارئة، لكلٍّ ثلاثُ درجاتٍ
--   بالصفحات. ومهلةُ المراجعة الشرعية ثمانِ ساعاتٍ للخطب وأربعٍ وعشرين
--   لما سواها. فتُعرف المدّةُ من المادة نفسها، ويُعرف ما قارب موعده
--   وما تجاوزه.
--
--   وفي جدول الطارئة ما يحتاج استيضاحًا من الهيئة: الصفحاتُ من إحدى
--   عشرة إلى عشرين مهلتُها عشرون ساعة، وهي أقلُّ من مهلة العشر الأُوَل
--   (أربعٌ وعشرون)، فالأكثرُ صفحاتٍ أقلُّ مهلة. وما زاد على العشرين
--   «من اثنتي عشرة إلى أربعٍ وعشرين ساعة» مدًى لا حدًّا. فالمنصة تُعلِم
--   هذين السطرين بوسم «يحتاج استيضاحًا» وتأخذ بأعلى المهلتين حتى يُبيَّن.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) أنواع الجزاءات كما نصّ العقد
-- ---------------------------------------------------------------------
create table if not exists public.penalty_kinds (
  code        int primary key,
  name        text not null,                  -- نوع المخالفة
  description text not null,                  -- الوصف كما في العقد
  basis       text not null                   -- على أيِّ قيمةٍ تُحتسب
              check (basis in ('sermon_value', 'task_value', 'translation_value',
                               'purchase_value', 'fixed')),
  rate        numeric,                        -- نسبةً من تلك القيمة
  amount      numeric,                        -- أو مبلغًا مقطوعًا بالريال
  per         text not null                   -- عن كلِّ ماذا
              check (per in ('once', 'hour', 'two_hours', 'day', 'language',
                             'hour_language')),
  per_label   text not null,
  urgency     text check (urgency in ('normal', 'urgent', 'emergency')),
  note        text,
  sort        int not null default 0,
  is_active   boolean not null default true
);

comment on table public.penalty_kinds is
  'أنواع الجزاءات ومقاديرها كما في بندَي الغرامات من العقد (ملاحظة ١٩٧)';

alter table public.penalty_kinds enable row level security;
drop policy if exists "read penalty kinds" on public.penalty_kinds;
create policy "read penalty kinds" on public.penalty_kinds for select
  using (public.is_manager());

insert into public.penalty_kinds
  (code, name, description, basis, rate, amount, per, per_label, urgency, note, sort)
values
  (1, 'ترجمة الخطب',
      'التأخير عن التقديم في الموعد المحدد أكثر من ساعتين',
      'sermon_value', 50, null, 'hour', 'عن كل ساعة تأخير', null,
      'العقد: غرامة ٥٠٪ من قيمة الخطبة عن كل ساعة', 1),
  (2, 'الأداء الحي والترجمة الفورية',
      'التأخير عن الموعد المحدد للحضور، المقدَّر بساعتين قبل المهمة',
      'task_value', 50, null, 'once', 'عن الواقعة', null,
      'العقد: غرامة ٥٠٪ من قيمة الخطبة أو الترجمة', 2),
  (3, 'الترجمة التحريرية — مهمة اعتيادية',
      'التأخير عن الموعد المحدد أكثر من ساعتين',
      'translation_value', 20, null, 'two_hours', 'عن كل ساعتين', 'normal',
      'العقد: ٢٠٪ من إجمالي قيمة الترجمة عن كل ساعتين', 3),
  (4, 'الترجمة التحريرية — مهمة عاجلة',
      'التأخير عن الموعد المحدد أكثر من ساعتين',
      'translation_value', 30, null, 'two_hours', 'عن كل ساعتين', 'urgent',
      'العقد: ٣٠٪ من إجمالي قيمة الترجمة عن كل ساعتين', 4),
  (5, 'الترجمة التحريرية — مهمة طارئة',
      'التأخير عن الموعد المحدد أكثر من ساعتين',
      'translation_value', 50, null, 'two_hours', 'عن كل ساعتين', 'emergency',
      'العقد: ٥٠٪ من إجمالي قيمة الترجمة عن كل ساعتين', 5),
  (6, 'مدير المشروع',
      'عدم توفير مدير مشروع',
      'fixed', null, 200, 'day', 'عن كل يوم', null,
      'العقد: ٢٠٠ ريال عن كل يوم', 6),
  (7, 'المراجعة والتدقيق الشرعي — تأخير',
      'التأخير في تسليم المراجعة والتدقيق الشرعي للخطب بعد الوقت المحدد',
      'fixed', null, 500, 'hour_language', 'عن كل ساعة تأخير لكل لغة', null,
      'العقد: ٥٠٠ ريال عن كل ساعة تأخير لكل لغة', 7),
  (8, 'المراجعة والتدقيق الشرعي — إسقاط لغة',
      'عدم مراجعة لغاتٍ محددة أو إسقاط إحدى اللغات',
      'fixed', null, 2000, 'language', 'عن كل لغة', null,
      'العقد: ٢٠٠٠ ريال لكل لغة', 8),
  (9, 'تفضيل المحتوى المحلي',
      'عدم إعطاء الأفضلية للمنتجات الوطنية عند الشراء',
      'purchase_value', 30, null, 'once', 'عن الواقعة', null,
      'العقد: ٣٠٪ من قيمة المشتريات محل التقصير', 9)
on conflict (code) do update
  set name = excluded.name, description = excluded.description, basis = excluded.basis,
      rate = excluded.rate, amount = excluded.amount, per = excluded.per,
      per_label = excluded.per_label, urgency = excluded.urgency,
      note = excluded.note, sort = excluded.sort, is_active = true;

-- ---------------------------------------------------------------------
-- ٢) الواقعة: تُسجَّل بتاريخها ويُحتسب مقدارُها
-- ---------------------------------------------------------------------
create table if not exists public.penalties (
  id          uuid primary key default gen_random_uuid(),
  kind_code   int  not null references public.penalty_kinds (code),
  happened_on date not null,
  material_id uuid references public.materials (id) on delete set null,
  lang_code   text references public.languages (code),
  units       numeric(10,2) not null default 1,     -- ساعاتٌ أو أيامٌ أو لغات
  base_amount numeric(14,2),                        -- قيمة الخطبة أو الترجمة
  amount      numeric(14,2) not null,
  is_manual   boolean not null default false,       -- أثبته المدير بغير المحتسَب
  state       text not null default 'draft'
              check (state in ('draft', 'notified', 'settled', 'waived')),
  note        text,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

create index if not exists penalties_date_idx on public.penalties (happened_on);

comment on table public.penalties is
  'وقائع الجزاءات بمقاديرها وحالاتها، ومجموعُها لا يتجاوز سقف العقد (ملاحظة ١٩٧)';
comment on column public.penalties.state is
  'مسودّة، ثم مُبلَّغة من الهيئة، ثم مُسوّاة — أو مُسقَطة إن أُسقطت';

alter table public.penalties enable row level security;
drop policy if exists "manager reads penalties" on public.penalties;
create policy "manager reads penalties" on public.penalties for select
  using (public.is_manager());

alter table public.platform_settings
  add column if not exists penalty_cap_pct numeric not null default 20;

comment on column public.platform_settings.penalty_cap_pct is
  'سقف مجموع الغرامات: عشرون في المئة من القيمة الإجمالية للعقد (ملاحظة ١٩٧)';

-- ---------------------------------------------------------------------
-- ٣) احتسابُ المقدار من الجدول
-- ---------------------------------------------------------------------
create or replace function public.penalty_amount(p_kind int, p_units numeric,
                                                 p_base numeric default null)
returns numeric language plpgsql stable set search_path = public as $$
declare k public.penalty_kinds; v_units numeric := greatest(0, coalesce(p_units, 1));
        v_base numeric;
begin
  select * into k from public.penalty_kinds where code = p_kind;
  if not found then return 0; end if;

  if k.basis = 'fixed' then
    return round(coalesce(k.amount, 0) * v_units, 2);
  end if;

  -- النسبةُ على قيمةٍ: تُؤخذ المثبتة، وإلا فسعرُ الوحدة من بنود العقد
  v_base := p_base;
  if v_base is null then
    v_base := case k.basis
      when 'sermon_value' then (select unit_price from public.contract_items where code = 1)
      when 'task_value'   then (select unit_price from public.contract_items where code = 1)
      else null end;
  end if;
  if v_base is null then return 0; end if;
  return round(v_base * coalesce(k.rate, 0) / 100.0 * v_units, 2);
end $$;
grant execute on function public.penalty_amount(int, numeric, numeric) to authenticated;

comment on function public.penalty_amount(int, numeric, numeric) is
  'مقدار الجزاء من جدول العقد: مبلغٌ مقطوع × الوحدات، أو نسبةٌ من قيمة الخطبة أو الترجمة (ملاحظة ١٩٧)';

-- ---------------------------------------------------------------------
-- ٤) القيمةُ الإجمالية للعقد وسقفُ الغرامات منها
-- ---------------------------------------------------------------------
create or replace function public.penalty_cap()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_total numeric; v_pct numeric; v_cap numeric; v_sum numeric;
begin
  if not public.is_manager() then return null; end if;
  select coalesce(sum(total_value), 0) into v_total from public.contract_items;
  select coalesce(penalty_cap_pct, 20) into v_pct from public.platform_settings where id;
  v_cap := round(v_total * v_pct / 100.0, 2);
  select coalesce(sum(amount), 0) into v_sum
    from public.penalties where state <> 'waived';
  return jsonb_build_object(
    'contract_total', v_total, 'cap_pct', v_pct, 'cap_amount', v_cap,
    'imposed', v_sum, 'remaining', greatest(0, v_cap - v_sum),
    'used_pct', case when v_cap > 0 then round(v_sum * 100.0 / v_cap, 1) else 0 end,
    'near', v_cap > 0 and v_sum >= v_cap * 0.8,
    'over', v_cap > 0 and v_sum > v_cap);
end $$;
grant execute on function public.penalty_cap() to authenticated;

-- ---------------------------------------------------------------------
-- ٥) تسجيلُ الواقعة وتعديلُها وإسقاطُها
-- ---------------------------------------------------------------------
create or replace function public.save_penalty(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
        v_kind int := nullif(p ->> 'kind_code', '')::int;
        v_on date := nullif(p ->> 'happened_on', '')::date;
        v_units numeric := coalesce(nullif(p ->> 'units', '')::numeric, 1);
        v_base numeric := nullif(p ->> 'base_amount', '')::numeric;
        v_amt numeric := nullif(p ->> 'amount', '')::numeric;
        v_manual boolean := false;
        v_calc numeric;
begin
  if not public.is_manager() then
    raise exception 'الجزاءات لمدير المشروع' using errcode = '42501';
  end if;
  if v_kind is null or not exists (select 1 from public.penalty_kinds where code = v_kind) then
    raise exception 'اختر نوع المخالفة';
  end if;
  if v_on is null then raise exception 'اكتب تاريخ الواقعة'; end if;
  if v_on > current_date then raise exception 'تاريخ الواقعة لا يكون في المستقبل'; end if;
  if v_units <= 0 or v_units > 9999 then raise exception 'عدد الوحدات بين واحدٍ و٩٩٩٩'; end if;

  v_calc := public.penalty_amount(v_kind, v_units, v_base);
  if v_amt is null then
    v_amt := v_calc;
  else
    v_manual := (v_amt <> v_calc);
  end if;
  if v_amt < 0 then raise exception 'مقدار الجزاء لا يكون سالبًا'; end if;
  if v_manual and nullif(trim(coalesce(p ->> 'note', '')), '') is null then
    raise exception 'اكتب سبب تثبيت مقدارٍ غير المحتسَب';
  end if;

  if v_id is null then
    insert into public.penalties (kind_code, happened_on, material_id, lang_code,
                                  units, base_amount, amount, is_manual, note, created_by)
    values (v_kind, v_on, nullif(p ->> 'material_id', '')::uuid,
            nullif(p ->> 'lang_code', ''), v_units, v_base, v_amt, v_manual,
            nullif(trim(coalesce(p ->> 'note', '')), ''), auth.uid())
    returning id into v_id;
  else
    update public.penalties
       set kind_code = v_kind, happened_on = v_on,
           material_id = nullif(p ->> 'material_id', '')::uuid,
           lang_code = nullif(p ->> 'lang_code', ''),
           units = v_units, base_amount = v_base, amount = v_amt,
           is_manual = v_manual, note = nullif(trim(coalesce(p ->> 'note', '')), ''),
           updated_at = now()
     where id = v_id;
    if not found then raise exception 'الواقعة غير موجودة'; end if;
  end if;
  return v_id;
end $$;
grant execute on function public.save_penalty(jsonb) to authenticated;

create or replace function public.set_penalty_state(p_id uuid, p_state text,
                                                    p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then
    raise exception 'الجزاءات لمدير المشروع' using errcode = '42501';
  end if;
  if p_state not in ('draft', 'notified', 'settled', 'waived') then
    raise exception 'الحالة غير معروفة';
  end if;
  if p_state = 'waived' and nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'اكتب سبب الإسقاط';
  end if;
  update public.penalties
     set state = p_state,
         note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note),
         updated_at = now()
   where id = p_id;
  if not found then raise exception 'الواقعة غير موجودة'; end if;
end $$;
grant execute on function public.set_penalty_state(uuid, text, text) to authenticated;

create or replace function public.delete_penalty(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_state text;
begin
  if not public.is_manager() then
    raise exception 'الجزاءات لمدير المشروع' using errcode = '42501';
  end if;
  select state into v_state from public.penalties where id = p_id;
  if v_state is null then raise exception 'الواقعة غير موجودة'; end if;
  if v_state <> 'draft' then
    raise exception 'ما خرج من المسودّة لا يُحذف: أسقِطه بسببٍ مكتوب';
  end if;
  delete from public.penalties where id = p_id;
end $$;
grant execute on function public.delete_penalty(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ٦) كشفُ الجزاءات في مدة
-- ---------------------------------------------------------------------
create or replace function public.penalty_report(p_from date default null,
                                                 p_to date default null)
returns table (id uuid, kind_code int, kind_name text, description text,
               per_label text, happened_on date, title text, lang_name text,
               units numeric, base_amount numeric, amount numeric,
               is_manual boolean, state text, note text)
language sql stable security definer set search_path = public as $$
  select p.id, p.kind_code, k.name, k.description, k.per_label, p.happened_on,
         m.title, l.name_ar, p.units, p.base_amount, p.amount,
         p.is_manual, p.state, p.note
    from public.penalties p
    join public.penalty_kinds k on k.code = p.kind_code
    left join public.materials m on m.id = p.material_id
    left join public.languages l on l.code = p.lang_code
   where public.is_manager()
     and (p_from is null or p.happened_on >= p_from)
     and (p_to   is null or p.happened_on <= p_to)
   order by p.happened_on desc, k.sort
$$;
grant execute on function public.penalty_report(date, date) to authenticated;

-- =====================================================================
-- ثانيًا: مواعيدُ الترجمة التحريرية بعدد الصفحات
-- =====================================================================
alter table public.materials
  add column if not exists pages       int,
  add column if not exists urgency     text not null default 'normal',
  add column if not exists received_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'materials_urgency_check') then
    alter table public.materials add constraint materials_urgency_check
      check (urgency in ('normal', 'urgent', 'emergency'));
  end if;
end $$;

comment on column public.materials.pages is
  'عدد صفحات الأصل: منه تُعرف مدّة التسليم في جدول العقد (ملاحظة ١٩٧)';
comment on column public.materials.urgency is
  'نوع المهمة: اعتيادية أو عاجلة أو طارئة — وبها تختلف المدّة والجزاء';
comment on column public.materials.received_at is
  'وقت استلام المادة: منه تُحسب المهلة، فإن لم يُثبَت فوقتُ إدخالها';

update public.materials set received_at = created_at where received_at is null;

-- الصفحةُ نحو مئتين وخمسين كلمة، فيُقترح العددُ ولا يُفرض
create or replace function public.count_pages(p_words int) returns int
language sql immutable set search_path = public as $$
  select case when coalesce(p_words, 0) <= 0 then null
              else greatest(1, ceil(p_words / 250.0)::int) end;
$$;
grant execute on function public.count_pages(int) to anon, authenticated;

-- ---------------------------------------------------------------------
-- ٧) جدولُ المدد كما في العقد
-- ---------------------------------------------------------------------
create table if not exists public.text_deadlines (
  urgency      text not null check (urgency in ('normal', 'urgent', 'emergency')),
  pages_from   int  not null,
  pages_to     int,                           -- فارغٌ يعني «أكثر من»
  hours        numeric not null,
  label        text not null,
  description  text,
  needs_review boolean not null default false,
  primary key (urgency, pages_from)
);

comment on table public.text_deadlines is
  'الجدول الزمني للترجمة التحريرية بعدد الصفحات ونوع المهمة كما في العقد (ملاحظة ١٩٧)';
comment on column public.text_deadlines.needs_review is
  'سطرٌ في العقد يحتاج استيضاحًا من الهيئة، فتأخذ المنصة بأعلى المهلتين حتى يُبيَّن';

alter table public.text_deadlines enable row level security;
drop policy if exists "read text deadlines" on public.text_deadlines;
create policy "read text deadlines" on public.text_deadlines for select to authenticated
  using (true);

insert into public.text_deadlines
  (urgency, pages_from, pages_to, hours, label, description, needs_review)
values
  ('normal',    1, 10,   48, 'خلال يومين',   'مهام دورية غير مستعجلة',              false),
  ('normal',   11, 20,   96, 'خلال أربعة أيام', 'ذات طابع خاص',                     false),
  ('normal',   21, null, 168, 'خلال سبعة أيام', 'محتوى موسَّع: كتب ومطويات',         false),
  ('urgent',    1, 10,    8, 'خلال ثماني ساعات', 'ترجمة مطلوبة قبل مناسبة أو خطاب رسمي', false),
  ('urgent',   11, 20,   24, 'خلال أربعٍ وعشرين ساعة',
       'تخصيص فريق عملٍ مزدوج للترجمة دون تأخير مع إمكانية التجزئة',                 false),
  ('urgent',   21, null,  72, 'خلال اثنتين وسبعين ساعة', 'مشروط بالتنسيق المسبق مع المتعاقد', false),
  ('emergency', 1, 10,   24, 'خلال أربعٍ وعشرين ساعة',
       'خطابات عاجلة أو مواد إعلامية أو أمرٌ طارئ',                                  false),
  ('emergency', 11, 20,  24, 'خلال أربعٍ وعشرين ساعة',
       'العقد يذكر عشرين ساعة، وهي أقلُّ من مهلة الصفحات العشر الأُوَل — يُستوضح من الهيئة، وحتى يُبيَّن تُؤخذ أربعٌ وعشرون', true),
  ('emergency', 21, null, 24, 'خلال أربعٍ وعشرين ساعة',
       'العقد يذكر «من اثنتي عشرة إلى أربعٍ وعشرين ساعة» مدًى لا حدًّا — يُستوضح من الهيئة، وحتى يُبيَّن يُؤخذ أعلاه', true)
on conflict (urgency, pages_from) do update
  set pages_to = excluded.pages_to, hours = excluded.hours, label = excluded.label,
      description = excluded.description, needs_review = excluded.needs_review;

-- ---------------------------------------------------------------------
-- ٨) مهلةُ المادة: من استلامها إلى موعدها
-- ---------------------------------------------------------------------
create or replace function public.text_window(p_material uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m public.materials; d public.text_deadlines;
        v_pages int; v_due timestamptz; v_from timestamptz;
begin
  select * into m from public.materials where id = p_material and deleted_at is null;
  if not found then return null; end if;
  if m.material_type = 'خطب' then
    -- الخطبةُ لها نافذتُها من موعد الجمعة لا من عدد الصفحات
    return jsonb_build_object('is_sermon', true, 'window', public.sermon_window(m.sermon_date));
  end if;

  v_pages := coalesce(m.pages,
                      public.count_pages(coalesce(m.source_words,
                        public.count_words(public.plain_text(m.source_html)))));
  if v_pages is null then
    return jsonb_build_object('is_sermon', false, 'pages', null,
                              'urgency', m.urgency, 'unknown', true);
  end if;

  select * into d from public.text_deadlines
   where urgency = m.urgency
     and v_pages >= pages_from
     and (pages_to is null or v_pages <= pages_to)
   order by pages_from desc limit 1;
  if not found then
    return jsonb_build_object('is_sermon', false, 'pages', v_pages,
                              'urgency', m.urgency, 'unknown', true);
  end if;

  v_from := coalesce(m.received_at, m.created_at);
  v_due  := v_from + make_interval(mins => (d.hours * 60)::int);

  return jsonb_build_object(
    'is_sermon', false, 'pages', v_pages, 'urgency', m.urgency,
    'hours', d.hours, 'label', d.label, 'description', d.description,
    'needs_review', d.needs_review,
    'received_at', v_from, 'due_at', v_due,
    'minutes_left', floor(extract(epoch from (v_due - now())) / 60)::int,
    'overdue', now() > v_due,
    'late_hours', case when now() > v_due
                       then round(extract(epoch from (now() - v_due)) / 3600.0, 1)
                       else 0 end);
end $$;
grant execute on function public.text_window(uuid) to authenticated;

-- ومهلةُ المراجعة الشرعية: ثمانِ ساعاتٍ للخطب وأربعٌ وعشرون لما سواها
create or replace function public.sharia_window(p_material uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m public.materials; v_h int; v_from timestamptz; v_due timestamptz;
begin
  select * into m from public.materials where id = p_material and deleted_at is null;
  if not found then return null; end if;
  v_h := case when m.material_type = 'خطب' then 8 else 24 end;
  v_from := coalesce(m.received_at, m.created_at);
  v_due  := v_from + make_interval(hours => v_h);
  return jsonb_build_object(
    'hours', v_h, 'received_at', v_from, 'due_at', v_due,
    'minutes_left', floor(extract(epoch from (v_due - now())) / 60)::int,
    'overdue', now() > v_due,
    'note', case when m.material_type = 'خطب'
                 then 'العقد: خلال ثماني ساعات من استلام الخطب'
                 else 'العقد: أربعٌ وعشرون ساعة للمواد الأخرى' end);
end $$;
grant execute on function public.sharia_window(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ٩) نوعُ المهمة وصفحاتُها: يُثبتهما من يُدخل المادة
-- ---------------------------------------------------------------------
create or replace function public.set_material_text_plan(p_material uuid, p_urgency text,
                                                         p_pages int default null,
                                                         p_received timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'نوع المهمة ومدّتها للإدارة' using errcode = '42501';
  end if;
  if p_urgency not in ('normal', 'urgent', 'emergency') then
    raise exception 'نوع المهمة: اعتيادية أو عاجلة أو طارئة';
  end if;
  if p_pages is not null and (p_pages < 1 or p_pages > 5000) then
    raise exception 'عدد الصفحات بين واحدٍ و٥٠٠٠';
  end if;
  if p_received is not null and p_received > now() + interval '1 hour' then
    raise exception 'وقت الاستلام لا يكون في المستقبل';
  end if;

  update public.materials
     set urgency = p_urgency,
         pages = coalesce(p_pages, pages),
         received_at = coalesce(p_received, received_at, created_at)
   where id = p_material and deleted_at is null;
  if not found then raise exception 'المادة غير موجودة'; end if;
end $$;
grant execute on function public.set_material_text_plan(uuid, text, int, timestamptz)
  to authenticated;

-- ---------------------------------------------------------------------
-- ١٠) ما قارب موعدَه وما تجاوزه من النصوص المفتوحة
-- ---------------------------------------------------------------------
create or replace function public.texts_due()
returns table (material_id uuid, title text, material_type text, urgency text,
               pages int, hours numeric, label text, received_at timestamptz,
               due_at timestamptz, minutes_left int, overdue boolean,
               needs_review boolean, open_tracks int)
language sql stable security definer set search_path = public as $$
  select m.id, m.title, m.material_type, m.urgency,
         (w ->> 'pages')::int, (w ->> 'hours')::numeric, w ->> 'label',
         (w ->> 'received_at')::timestamptz, (w ->> 'due_at')::timestamptz,
         (w ->> 'minutes_left')::int, (w ->> 'overdue')::boolean,
         (w ->> 'needs_review')::boolean,
         (select count(*)::int from public.tracks t
           where t.material_id = m.id and t.deleted_at is null
             and t.status <> 'completed')
    from public.materials m
    cross join lateral public.text_window(m.id) w
   where m.deleted_at is null
     and m.material_type <> 'خطب'
     and public.is_admin()
     and (w ->> 'due_at') is not null
     and exists (select 1 from public.tracks t
                  where t.material_id = m.id and t.deleted_at is null
                    and t.status <> 'completed')
   order by (w ->> 'due_at')::timestamptz
$$;
grant execute on function public.texts_due() to authenticated;

-- ---------------------------------------------------------------------
-- ١١) «عن المبادرة»: مواعيدُ التسليم تُعرف من المادة لا من الذاكرة
--     — بلا ذكرٍ مالي ولا تسعيرة
-- ---------------------------------------------------------------------
do $$
declare v jsonb; v_s jsonb; v_id text; v_blocks jsonb; v_new jsonb := '[]'::jsonb;
begin
  select content into v from public.page_content where key = 'initiative';
  if v is null then return; end if;

  for v_s in select jsonb_array_elements(v -> 'sections') loop
    v_id := v_s ->> 0;
    v_blocks := v_s -> 2;

    if v_id = 'outputs' and not (v_blocks::text like '%مواعيدُ التسليم%') then
      v_blocks := v_blocks || jsonb_build_array(
        jsonb_build_array('h3', 'مواعيدُ التسليم تُعرف من المادة'),
        jsonb_build_array('p', 'لكل مادةٍ نوعُها: اعتيادية أو عاجلة أو طارئة، '
          || 'ولها عددُ صفحاتها. ومن هذين تعرف المنصة مهلةَ تسليمها، '
          || 'فتُحسب من وقت الاستلام لا من التقدير، ويُعرف ما قارب موعدَه '
          || 'وما تجاوزه قبل أن يُسأل عنه.'),
        jsonb_build_array('p', 'وللمراجعة الشرعية مهلتُها: ثمانِ ساعاتٍ للخطب، '
          || 'وأربعٌ وعشرون لما سواها. وما كان في المواعيد محلَّ احتمالٍ وُسم '
          || 'بأنه يحتاج استيضاحًا، وأُخذ بأوسع المهلتين حتى يُبيَّن — '
          || 'فلا تُبنى مطالبةٌ على فهمٍ لم يُراجَع.'));
    end if;

    v_new := v_new || jsonb_build_array(jsonb_build_array(v_s -> 0, v_s -> 1, v_blocks));
  end loop;

  update public.page_content
     set content = jsonb_set(v, '{sections}', v_new), updated_at = now()
   where key = 'initiative';
end $$;

notify pgrst, 'reload schema';
