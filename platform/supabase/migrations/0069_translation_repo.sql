-- =====================================================================
-- 0069 — مستودعُ الترجمة: أعمالُ السنوات الماضية (ملاحظة ٢١٨)
--   للمشروع ثلاثُ سنواتٍ سابقة، وأرشيفُها متفرّقٌ على مساحاتِ تخزين.
--   فجُعل له مستودعٌ في المنصة على هيئة الأرشيف، يُرفع فيه ما مضى من
--   خطبٍ ودروسٍ وكتب، ويُبحَث فيه ويُصدَّر منه.
--
--   وأصلُه أنه **خارج حساب العقد**: لا يدخل في المستخلص ولا في التقرير
--   الشهري ولا في الأجور ولا في إحصاءات الإنتاج، ولا تُحسب له مراحلُ
--   ولا مواعيد. فهو ذاكرةُ المشروع لا دفترُ حسابه.
--
--   ويجري فيه ترقيمُ التوثيق المعتمد نفسُه، فيكون للعمل القديم رقمُه
--   كالعمل الجديد.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) دفعاتُ الاستيراد: لكل رفعةٍ رقمُها، فتُحذف كاملةً إن أخطأ فيها
-- ---------------------------------------------------------------------
create table if not exists public.repo_batches (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  note       text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
alter table public.repo_batches enable row level security;
drop policy if exists "read repo batches" on public.repo_batches;
create policy "read repo batches" on public.repo_batches
  for select using (public.my_role() is not null);
grant select on public.repo_batches to authenticated;

-- ---------------------------------------------------------------------
-- ٢) العمل: خطبةٌ أو درسٌ أو كتابٌ مضى
-- ---------------------------------------------------------------------
create table if not exists public.repo_works (
  id            uuid primary key default gen_random_uuid(),
  material_type text not null,
  sermon_type   text,
  mosque        text check (mosque is null or mosque in ('makkah', 'madinah')),
  work_date     date,
  khateeb_id    integer references public.khateebs (id),
  title         text not null,
  notes         text,
  batch_id      uuid references public.repo_batches (id) on delete set null,
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now()
);
create index if not exists repo_works_date_idx   on public.repo_works (work_date desc);
create index if not exists repo_works_type_idx   on public.repo_works (material_type);
create index if not exists repo_works_mosque_idx on public.repo_works (mosque);

alter table public.repo_works enable row level security;
drop policy if exists "read repo works" on public.repo_works;
create policy "read repo works" on public.repo_works
  for select using (public.my_role() is not null);
grant select on public.repo_works to authenticated;

comment on table public.repo_works is
  'مستودعُ الترجمة: أعمالُ السنوات الماضية، خارج حساب العقد (ملاحظة ٢١٨)';

-- ---------------------------------------------------------------------
-- ٣) نسخُ العمل: الأصلُ العربي وترجماتُه، لكلٍّ رقمُ توثيقه
-- ---------------------------------------------------------------------
create table if not exists public.repo_items (
  id            uuid primary key default gen_random_uuid(),
  work_id       uuid not null references public.repo_works (id) on delete cascade,
  language_code text not null,
  is_source     boolean not null default false,
  body_html     text,
  file_path     text,
  media_url     text,
  words         integer,
  doc_no        text,
  doc_h_year    int,
  doc_serial    int,
  created_at    timestamptz not null default now(),
  unique (work_id, language_code)
);
create index if not exists repo_items_work_idx on public.repo_items (work_id);
create unique index if not exists repo_items_doc_no_key
  on public.repo_items (doc_no) where doc_no is not null;

alter table public.repo_items enable row level security;
drop policy if exists "read repo items" on public.repo_items;
create policy "read repo items" on public.repo_items
  for select using (public.my_role() is not null);
grant select on public.repo_items to authenticated;

-- ---------------------------------------------------------------------
-- ٤) رقمُ التوثيق للعمل القديم: بالقاعدة المعتمدة نفسِها
-- ---------------------------------------------------------------------
create or replace function public.assign_repo_doc_no(p_item uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_i record; v_w record; v_year int; v_scope text; v_kind text; v_serial int; v_no text;
begin
  select * into v_i from public.repo_items where id = p_item;
  if v_i.id is null then raise exception 'النسخة غير موجودة'; end if;
  if v_i.doc_no is not null then return v_i.doc_no; end if;

  select * into v_w from public.repo_works where id = v_i.work_id;
  v_year  := public.hijri_year(coalesce(v_w.work_date, current_date));
  v_scope := public.doc_scope(v_w.mosque);
  v_kind  := public.doc_kind_code(v_w.material_type, v_w.sermon_type);

  insert into public.doc_serials (h_year, lang, scope, kind, last)
  values (v_year, upper(v_i.language_code), v_scope, v_kind, 1)
  on conflict (h_year, lang, scope, kind)
  do update set last = doc_serials.last + 1
  returning last into v_serial;

  v_no := public.doc_no_text(v_year, v_i.language_code, v_scope, v_kind, v_serial);
  update public.repo_items set doc_no = v_no, doc_h_year = v_year, doc_serial = v_serial
   where id = p_item;
  return v_no;
end $$;

-- ---------------------------------------------------------------------
-- ٥) الحفظ والحذف — لمن يملك صلاحية المواد
-- ---------------------------------------------------------------------
create or replace function public.save_repo_work(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
        v_title text := nullif(trim(coalesce(p ->> 'title', '')), '');
        v_type  text := nullif(trim(coalesce(p ->> 'material_type', '')), '');
        v_item  jsonb; v_item_id uuid; v_lang text;
begin
  if not public.is_admin_for('materials') then
    raise exception 'المستودع لمن يملك صلاحية المواد' using errcode = '42501';
  end if;
  if v_title is null then raise exception 'اكتب عنوان العمل'; end if;
  if v_type is null then raise exception 'اختر نوع العمل'; end if;

  if v_id is null then
    insert into public.repo_works (material_type, sermon_type, mosque, work_date,
                                   khateeb_id, title, notes, batch_id, created_by)
    values (v_type, nullif(trim(coalesce(p ->> 'sermon_type', '')), ''),
            nullif(trim(coalesce(p ->> 'mosque', '')), ''),
            nullif(p ->> 'work_date', '')::date,
            nullif(p ->> 'khateeb_id', '')::int,
            v_title, nullif(trim(coalesce(p ->> 'notes', '')), ''),
            nullif(p ->> 'batch_id', '')::uuid, auth.uid())
    returning id into v_id;
  else
    update public.repo_works
       set material_type = v_type,
           sermon_type = nullif(trim(coalesce(p ->> 'sermon_type', '')), ''),
           mosque = nullif(trim(coalesce(p ->> 'mosque', '')), ''),
           work_date = nullif(p ->> 'work_date', '')::date,
           khateeb_id = nullif(p ->> 'khateeb_id', '')::int,
           title = v_title,
           notes = nullif(trim(coalesce(p ->> 'notes', '')), '')
     where id = v_id;
    if not found then raise exception 'العمل غير موجود'; end if;
  end if;

  -- النسخ: الأصلُ العربي وترجماتُه
  for v_item in select * from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) loop
    v_lang := lower(nullif(trim(coalesce(v_item ->> 'language_code', '')), ''));
    if v_lang is null then continue; end if;
    insert into public.repo_items (work_id, language_code, is_source, body_html, file_path, media_url, words)
    values (v_id, v_lang, coalesce((v_item ->> 'is_source')::boolean, v_lang = 'ar'),
            nullif(v_item ->> 'body_html', ''), nullif(v_item ->> 'file_path', ''),
            nullif(v_item ->> 'media_url', ''),
            nullif(v_item ->> 'words', '')::int)
    on conflict (work_id, language_code) do update
      set is_source = excluded.is_source,
          body_html = coalesce(excluded.body_html, repo_items.body_html),
          file_path = coalesce(excluded.file_path, repo_items.file_path),
          media_url = coalesce(excluded.media_url, repo_items.media_url),
          words     = coalesce(excluded.words, repo_items.words)
    returning id into v_item_id;
    perform public.assign_repo_doc_no(v_item_id);
  end loop;

  return v_id;
end $$;
grant execute on function public.save_repo_work(jsonb) to authenticated;

create or replace function public.delete_repo_work(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin_for('materials') then
    raise exception 'حذفُ أعمال المستودع لمن يملك صلاحية المواد' using errcode = '42501';
  end if;
  delete from public.repo_works where id = p_id;
  if not found then raise exception 'العمل غير موجود'; end if;
end $$;
grant execute on function public.delete_repo_work(uuid) to authenticated;

create or replace function public.delete_repo_item(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin_for('materials') then
    raise exception 'حذفُ نسخ المستودع لمن يملك صلاحية المواد' using errcode = '42501';
  end if;
  delete from public.repo_items where id = p_id;
  if not found then raise exception 'النسخة غير موجودة'; end if;
end $$;
grant execute on function public.delete_repo_item(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ٦) كشفُ المستودع: صفٌّ لكل عمل بلغاته
-- ---------------------------------------------------------------------
drop view if exists public.repo_rows;
create view public.repo_rows with (security_invoker = true) as
  select w.id, w.material_type, w.sermon_type, w.mosque, w.work_date, w.title,
         w.notes, w.batch_id, w.created_at,
         k.name as khateeb_name,
         (select count(*) from public.repo_items i where i.work_id = w.id) as items,
         (select count(*) from public.repo_items i
           where i.work_id = w.id and not i.is_source) as translations,
         (select coalesce(sum(i.words), 0) from public.repo_items i
           where i.work_id = w.id and i.is_source) as source_words,
         (select string_agg(i.language_code, ',' order by i.language_code)
            from public.repo_items i where i.work_id = w.id) as languages
    from public.repo_works w
    left join public.khateebs k on k.id = w.khateeb_id;
grant select on public.repo_rows to authenticated;

comment on view public.repo_rows is
  'كشفُ مستودع الترجمة: العملُ ولغاتُه وعددُ ترجماته (ملاحظة ٢١٨)';

notify pgrst, 'reload schema';
