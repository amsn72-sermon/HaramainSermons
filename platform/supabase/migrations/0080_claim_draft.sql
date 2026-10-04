-- =====================================================================
-- 0080 — مسودّةُ المستخلص: كميةٌ فعليةٌ وكميةٌ محتسَبة (ملاحظة ٢٤٢)
--
--   المنصةُ تحسب ما أُنجز فعلًا، والمستخلَصُ الذي يُقدَّم إلى الهيئة قد
--   يخالفه: إعفاءٌ في بندٍ، أو تقديرٌ في ساعاتٍ أو خطب، فتعتمد الهيئةُ
--   ما قُدِّم وإن لم يبلغ المطلوبَ تمامًا. فجُعل العمودان معًا:
--     • الكميةُ الفعلية  — من المنصة، شاهدٌ لا يُمسّ
--     • الكميةُ المحتسَبة — تبدأ نسخةً منها، وتُعدَّل بسببها، وبها تُضرب القيمة
--   وتُضاف أعمدةٌ بأسمائها، وتُسمّى الأعمدةُ القائمةُ بما يوافق الهيئة.
--   وتُحفظ مسودّةُ كلِّ شهرٍ بحالها، فإذا فُتح شهرٌ ماضٍ رُئي ما قُدِّم
--   حينها لا ما يُحسب اليوم. وكلُّ تعديلٍ يُسجَّل: من ومتى والرقمان.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) مسودّةُ الشهر: أعمدتُها المضافةُ وأسماؤها المحرَّرة
-- ---------------------------------------------------------------------
create table if not exists public.claim_drafts (
  month      date primary key,
  columns    jsonb not null default '[]'::jsonb,   -- [{key,label,kind}]
  labels     jsonb not null default '{}'::jsonb,   -- {عمودٌ قائم: اسمٌ جديد}
  note       text,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
alter table public.claim_drafts enable row level security;
drop policy if exists "read claim drafts" on public.claim_drafts;
create policy "read claim drafts" on public.claim_drafts
  for select using (public.is_manager());
grant select on public.claim_drafts to authenticated;

comment on table public.claim_drafts is
  'مسودّةُ مستخلص الشهر: أعمدتُها وأسماؤها (ملاحظة ٢٤٢)';

-- ---------------------------------------------------------------------
-- ٢) صفوفُها: ما عُدِّل من الكميات وما مُلئ من الأعمدة المضافة
-- ---------------------------------------------------------------------
create table if not exists public.claim_rows (
  month        date not null,
  item_code    int  not null,
  qty_claim    numeric,          -- فارغٌ يعني: الفعليُّ كما هو
  reason       text,
  extras       jsonb not null default '{}'::jsonb,
  updated_by   uuid references public.profiles (id),
  updated_at   timestamptz not null default now(),
  primary key (month, item_code)
);
alter table public.claim_rows enable row level security;
drop policy if exists "read claim rows" on public.claim_rows;
create policy "read claim rows" on public.claim_rows
  for select using (public.is_manager());
grant select on public.claim_rows to authenticated;

-- ---------------------------------------------------------------------
-- ٣) سجلُّ التعديل — فالمستخلَصُ وثيقةٌ تُقدَّم، وأثرُها يُحفظ
-- ---------------------------------------------------------------------
create table if not exists public.claim_log (
  id         uuid primary key default gen_random_uuid(),
  month      date not null,
  item_code  int  not null,
  qty_actual numeric,
  qty_before numeric,
  qty_after  numeric,
  reason     text,
  changed_by uuid references public.profiles (id),
  changed_at timestamptz not null default now()
);
create index if not exists claim_log_month_idx on public.claim_log (month, changed_at desc);
alter table public.claim_log enable row level security;
drop policy if exists "read claim log" on public.claim_log;
create policy "read claim log" on public.claim_log
  for select using (public.is_manager());
grant select on public.claim_log to authenticated;

-- ---------------------------------------------------------------------
-- ٤) الكشفُ المدمَج: الفعليُّ والمحتسَبُ معًا
-- ---------------------------------------------------------------------
create or replace function public.claim_sheet(p_month date)
returns table (code int, name text, unit text, unit_price numeric,
               qty_actual numeric, qty_claim numeric, qty_initiative numeric,
               amount numeric, reason text, extras jsonb, edited boolean)
language sql stable security definer set search_path = public as $$
  select c.code, c.name, c.unit, c.unit_price,
         c.qty_done                                   as qty_actual,
         coalesce(r.qty_claim, c.qty_done)            as qty_claim,
         c.qty_initiative,
         round(coalesce(c.unit_price, 0) * coalesce(r.qty_claim, c.qty_done), 2) as amount,
         r.reason,
         coalesce(r.extras, '{}'::jsonb)              as extras,
         (r.qty_claim is not null and r.qty_claim is distinct from c.qty_done) as edited
    from public.claim_month(p_month) c
    left join public.claim_rows r
           on r.month = date_trunc('month', p_month)::date and r.item_code = c.code
   where public.is_manager()
   order by c.code
$$;
grant execute on function public.claim_sheet(date) to authenticated;

comment on function public.claim_sheet(date) is
  'مستخلَصُ الشهر: الكميةُ الفعليةُ من المنصة والمحتسَبةُ المقدَّمة (ملاحظة ٢٤٢)';

-- ---------------------------------------------------------------------
-- ٥) تحرير الصف — لمدير المشروع وحدَه، ويُسجَّل
-- ---------------------------------------------------------------------
create or replace function public.save_claim_row(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_month date := date_trunc('month', nullif(p ->> 'month', '')::date)::date;
        v_code int := nullif(p ->> 'item_code', '')::int;
        v_qty numeric := nullif(p ->> 'qty_claim', '')::numeric;
        v_actual numeric; v_before numeric;
begin
  if not public.is_manager() then
    raise exception 'تحريرُ المستخلص لمدير المشروع' using errcode = '42501';
  end if;
  if v_month is null or v_code is null then raise exception 'حدّد الشهر والبند'; end if;
  if v_qty is not null and v_qty < 0 then raise exception 'الكميةُ لا تكون سالبة'; end if;

  select c.qty_done into v_actual from public.claim_month(v_month) c where c.code = v_code;
  if v_actual is null then raise exception 'بندٌ غير معروف'; end if;
  select r.qty_claim into v_before from public.claim_rows r
   where r.month = v_month and r.item_code = v_code;

  insert into public.claim_rows (month, item_code, qty_claim, reason, extras, updated_by)
  values (v_month, v_code, v_qty,
          nullif(trim(coalesce(p ->> 'reason', '')), ''),
          coalesce(p -> 'extras', '{}'::jsonb), auth.uid())
  on conflict (month, item_code) do update
     set qty_claim = excluded.qty_claim,
         reason    = excluded.reason,
         extras    = case when p ? 'extras' then excluded.extras else claim_rows.extras end,
         updated_by = auth.uid(), updated_at = now();

  -- لا يُسجَّل إلا ما غيّر الرقمَ فعلًا
  if coalesce(v_qty, v_actual) is distinct from coalesce(v_before, v_actual) then
    insert into public.claim_log (month, item_code, qty_actual, qty_before, qty_after,
                                  reason, changed_by)
    values (v_month, v_code, v_actual, coalesce(v_before, v_actual),
            coalesce(v_qty, v_actual),
            nullif(trim(coalesce(p ->> 'reason', '')), ''), auth.uid());
  end if;
end $$;
grant execute on function public.save_claim_row(jsonb) to authenticated;

-- الردُّ إلى الفعلي
create or replace function public.reset_claim_row(p_month date, p_code int)
returns void language plpgsql security definer set search_path = public as $$
declare v_month date := date_trunc('month', p_month)::date;
begin
  if not public.is_manager() then
    raise exception 'تحريرُ المستخلص لمدير المشروع' using errcode = '42501';
  end if;
  update public.claim_rows
     set qty_claim = null, reason = null, updated_by = auth.uid(), updated_at = now()
   where month = v_month and item_code = p_code;
end $$;
grant execute on function public.reset_claim_row(date, int) to authenticated;

-- ---------------------------------------------------------------------
-- ٦) الأعمدةُ المضافةُ وأسماءُ الأعمدة
-- ---------------------------------------------------------------------
create or replace function public.save_claim_columns(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_month date := date_trunc('month', nullif(p ->> 'month', '')::date)::date;
begin
  if not public.is_manager() then
    raise exception 'أعمدةُ المستخلص لمدير المشروع' using errcode = '42501';
  end if;
  if v_month is null then raise exception 'حدّد الشهر'; end if;
  if jsonb_array_length(coalesce(p -> 'columns', '[]'::jsonb)) > 12 then
    raise exception 'الأعمدةُ المضافةُ اثنا عشر على الأكثر';
  end if;

  insert into public.claim_drafts (month, columns, labels, note, updated_by)
  values (v_month, coalesce(p -> 'columns', '[]'::jsonb),
          coalesce(p -> 'labels', '{}'::jsonb),
          nullif(trim(coalesce(p ->> 'note', '')), ''), auth.uid())
  on conflict (month) do update
     set columns = case when p ? 'columns' then excluded.columns else claim_drafts.columns end,
         labels  = case when p ? 'labels'  then excluded.labels  else claim_drafts.labels end,
         note    = case when p ? 'note'    then excluded.note    else claim_drafts.note end,
         updated_by = auth.uid(), updated_at = now();
end $$;
grant execute on function public.save_claim_columns(jsonb) to authenticated;

create or replace function public.claim_draft(p_month date)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_manager() then
    coalesce((select jsonb_build_object('columns', d.columns, 'labels', d.labels,
                                        'note', d.note, 'updated_at', d.updated_at)
                from public.claim_drafts d
               where d.month = date_trunc('month', p_month)::date),
             jsonb_build_object('columns', '[]'::jsonb, 'labels', '{}'::jsonb))
  end
$$;
grant execute on function public.claim_draft(date) to authenticated;

notify pgrst, 'reload schema';
