-- =====================================================================
-- 0076 — مرصدُ المصطلحات، والدليلُ بمعانيه وشواهده (ملاحظتا ٢٣٤ و٢٣٥)
--
--   كان للمصطلح شرحٌ واحد، وهذا موضعُ الخلل: المصطلحُ يتغيّر معناه بتغيّر
--   الجملة، فلا يُفسَّر بلا سياقه. فصار له معانٍ، لكلِّ معنًى عنوانُه
--   وشرحُه وترجمتُه في كلِّ لغةٍ على حدة وشواهدُه من أعمالٍ بعينها.
--
--   والمرصدُ يَرصد المتكرِّر في أصول الأرشيف العربية فيعرضه مرشَّحًا:
--   يُضاف إلى الدليل، أو يُتجاهَل فلا يعود، أو يُلحَق بمصطلحٍ قائم.
--   ولا يقترح معنًى من نفسه — تقسيمُ المعاني للإنسان لا للآلة.
--
--   ويُحتسب لكلِّ عضوٍ ما أضاف وما اعتُمد له وأثرُ مصطلحه (ملاحظة ٢٣٥)،
--   سجلَّ مشاركةٍ معدودًا لا تقييمًا — فالتقييمُ من مشرفي الهيئة.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) أقسامٌ أوسع، وحالُ الردِّ بسببه
-- ---------------------------------------------------------------------
alter table public.glossary_terms drop constraint if exists glossary_terms_category_check;
alter table public.glossary_terms add constraint glossary_terms_category_check
  check (category in ('عقدي', 'فقهي', 'دعوي', 'توجيهات', 'مناسك', 'أعلام', 'قرآني', 'عام'));

alter table public.glossary_terms drop constraint if exists glossary_terms_status_check;
alter table public.glossary_terms add constraint glossary_terms_status_check
  check (status in ('مقترح', 'معتمد', 'مردود'));

alter table public.glossary_terms
  add column if not exists reject_reason text,
  add column if not exists reviewed_at   timestamptz,
  add column if not exists reviewed_by   uuid references public.profiles (id);

-- ---------------------------------------------------------------------
-- ٢) المعاني — وهي لبُّ الأمر
-- ---------------------------------------------------------------------
create table if not exists public.glossary_senses (
  id          uuid primary key default gen_random_uuid(),
  term_id     uuid not null references public.glossary_terms (id) on delete cascade,
  label       text not null,
  explanation text,
  sort        int not null default 0,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now()
);
create index if not exists glossary_senses_term_idx on public.glossary_senses (term_id);

alter table public.glossary_senses enable row level security;
drop policy if exists "read senses" on public.glossary_senses;
create policy "read senses" on public.glossary_senses
  for select using (public.my_role() is not null);
grant select on public.glossary_senses to authenticated;

comment on table public.glossary_senses is
  'معاني المصطلح: لكلِّ معنًى ترجمتُه وشواهدُه — فلا يُترجَم مصطلحٌ بلا سياقه (ملاحظة ٢٣٤)';

create table if not exists public.glossary_sense_translations (
  sense_id      uuid not null references public.glossary_senses (id) on delete cascade,
  language_code text not null references public.languages (code) on update cascade,
  term_tr       text not null,
  note          text,
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  primary key (sense_id, language_code)
);
alter table public.glossary_sense_translations enable row level security;
drop policy if exists "read sense tr" on public.glossary_sense_translations;
create policy "read sense tr" on public.glossary_sense_translations
  for select using (public.my_role() is not null);
grant select on public.glossary_sense_translations to authenticated;

-- الشواهد: جملٌ من أعمالٍ بعينها يُستدلُّ بها على المعنى
create table if not exists public.glossary_examples (
  id          uuid primary key default gen_random_uuid(),
  sense_id    uuid not null references public.glossary_senses (id) on delete cascade,
  quote       text not null,
  material_id uuid references public.materials (id) on delete set null,
  work_id     uuid references public.repo_works (id) on delete set null,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now()
);
create index if not exists glossary_examples_sense_idx on public.glossary_examples (sense_id);
alter table public.glossary_examples enable row level security;
drop policy if exists "read examples" on public.glossary_examples;
create policy "read examples" on public.glossary_examples
  for select using (public.my_role() is not null);
grant select on public.glossary_examples to authenticated;

-- ---------------------------------------------------------------------
-- ٣) تسويةُ الحرف العربي — تُوحَّد الهمزاتُ والتاءُ والياءُ وتُجرَّد الحركات
-- ---------------------------------------------------------------------
create or replace function public.ar_norm(p_text text)
returns text language sql immutable as $$
  select btrim(regexp_replace(
           translate(
             regexp_replace(coalesce(p_text, ''), '[ً-ْـٰ]', '', 'g'),
             'أإآٱةىؤئ', 'اااا' || 'هيوي'),
           '[^ء-ي ]', ' ', 'g'))
$$;

comment on function public.ar_norm(text) is
  'تسويةُ الحرف ليجتمع المصطلحُ على صورةٍ واحدة (ملاحظة ٢٣٤)';

-- كلماتٌ شائعةٌ لا تُرصد
create table if not exists public.ar_stopwords (word text primary key);
insert into public.ar_stopwords (word) values
 ('من'),('الى'),('على'),('عن'),('في'),('ان'),('انه'),('انها'),('الذي'),('التي'),('الذين'),
 ('هذا'),('هذه'),('ذلك'),('تلك'),('هو'),('هي'),('هم'),('هن'),('نحن'),('انا'),('انت'),
 ('كان'),('كانت'),('يكون'),('تكون'),('قد'),('لقد'),('ثم'),('او'),('ام'),('بل'),('لا'),
 ('ما'),('لم'),('لن'),('قال'),('قالت'),('يقول'),('وقال'),('كل'),('بعض'),('غير'),('بين'),
 ('عند'),('عندما'),('حتى'),('اذا'),('اذ'),('لكن'),('كما'),('مع'),('بعد'),('قبل'),('هنا'),
 ('هناك'),('ايضا'),('كذلك'),('حيث'),('فان'),('وان'),('فاذا'),('وقد'),('فقد'),('وهو'),
 ('وهي'),('له'),('لها'),('لهم'),('به'),('بها'),('بهم'),('فيه'),('فيها'),('منه'),('منها'),
 ('عليه'),('عليها'),('عليهم'),('اليه'),('اليها'),('الا'),('اي'),('اية'),('نعم'),('كيف'),
 ('متى'),('اين'),('لماذا'),('سوف'),('سا'),('يا'),('ايها'),('جدا'),('فقط'),('اكثر'),
 ('اقل'),('اول'),('اخر'),('اخرى'),('جميع'),('كلها'),('كله'),('شيء'),('امر'),('ذا'),('ذو')
on conflict (word) do nothing;
alter table public.ar_stopwords enable row level security;
drop policy if exists "read stopwords" on public.ar_stopwords;
create policy "read stopwords" on public.ar_stopwords
  for select using (public.my_role() is not null);
grant select on public.ar_stopwords to authenticated;

-- ---------------------------------------------------------------------
-- ٤) المرشَّحون
-- ---------------------------------------------------------------------
create table if not exists public.term_candidates (
  norm       text primary key,
  raw        text not null,
  hits       int not null default 0,
  works      int not null default 0,
  words      int not null default 1,
  state      text not null default 'new' check (state in ('new', 'ignored', 'added')),
  term_id    uuid references public.glossary_terms (id) on delete set null,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);
create index if not exists term_candidates_state_idx on public.term_candidates (state, works desc, hits desc);

alter table public.term_candidates enable row level security;
drop policy if exists "read candidates" on public.term_candidates;
create policy "read candidates" on public.term_candidates
  for select using (public.my_role() is not null);
grant select on public.term_candidates to authenticated;

comment on table public.term_candidates is
  'مرشَّحو مرصد المصطلحات من أصول الأرشيف العربية (ملاحظة ٢٣٤)';

-- ---------------------------------------------------------------------
-- ٥) الرصد: كلماتٌ وتراكيبُ من أصول الأرشيف
--    يُرتَّب بمقياسين: كم تكرّر، وفي كم عمل — فلا تتصدّر كلمةٌ تكرّرت
--    خمسين مرةً في خطبةٍ واحدة.
-- ---------------------------------------------------------------------
create or replace function public.scan_terms(p_min_works int default 2,
                                             p_max int default 400)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_found int := 0; v_new int := 0;
begin
  if not public.is_admin() then
    raise exception 'الرصدُ للإدارة' using errcode = '42501';
  end if;

  with src as (
    select m.id as mid,
           public.ar_norm(regexp_replace(coalesce(m.source_html, ''), '<[^>]*>', ' ', 'g')) as txt
      from public.materials m
     where nullif(trim(coalesce(m.source_html, '')), '') is not null
  ),
  toks as (
    select mid, w, row_number() over (partition by mid) as i
      from src, lateral regexp_split_to_table(src.txt, '\s+') w
     where length(w) >= 3
  ),
  grams as (
    select mid, w as g, 1 as n from toks
    union all
    select mid, w || ' ' || lead(w) over (partition by mid order by i), 2
      from toks
    union all
    select mid, w || ' ' || lead(w) over (partition by mid order by i)
                 || ' ' || lead(w, 2) over (partition by mid order by i), 3
      from toks
  ),
  kept as (
    select g.mid, g.g, g.n from grams g
     where g.g is not null
       and not exists (select 1 from public.ar_stopwords s where s.word = split_part(g.g, ' ', 1))
       and not exists (select 1 from public.ar_stopwords s where s.word = split_part(g.g, ' ', g.n))
  ),
  agg as (
    select g as norm, max(n) as n, count(*)::int as hits,
           count(distinct mid)::int as works
      from kept
     group by g
    having count(distinct mid) >= greatest(1, p_min_works)
     order by count(distinct mid) desc, count(*) desc
     limit greatest(10, p_max)
  )
  insert into public.term_candidates (norm, raw, hits, works, words, last_seen)
  select a.norm, a.norm, a.hits, a.works, a.n, now()
    from agg a
   where not exists (select 1 from public.glossary_terms t
                      where public.ar_norm(t.term_ar) = a.norm)
  on conflict (norm) do update
     set hits = excluded.hits, works = excluded.works, last_seen = now()
   where public.term_candidates.state = 'new';

  get diagnostics v_new = row_count;
  select count(*)::int into v_found from public.term_candidates where state = 'new';
  return jsonb_build_object('scanned', v_new, 'pending', v_found);
end $$;
grant execute on function public.scan_terms(int, int) to authenticated;

-- تجاهلُ مرشَّحٍ فلا يعود يظهر
create or replace function public.ignore_candidate(p_norm text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'المرصدُ للإدارة' using errcode = '42501';
  end if;
  update public.term_candidates set state = 'ignored' where norm = p_norm;
end $$;
grant execute on function public.ignore_candidate(text) to authenticated;

-- ---------------------------------------------------------------------
-- ٦) الاقتراحُ والاعتماد
--    المترجمُ يقترح فيُسجَّل «مقترحًا»، ومدير المشروع والمنسقون يعتمدون
-- ---------------------------------------------------------------------
create or replace function public.propose_glossary_term(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_term text := btrim(coalesce(p ->> 'term_ar', ''));
        v_cat text := coalesce(nullif(trim(coalesce(p ->> 'category', '')), ''), 'عام');
        v_admin boolean := public.is_admin();
begin
  if public.my_role() is null or public.is_supervisor() then
    raise exception 'الدليلُ المصطلحي للفريق' using errcode = '42501';
  end if;
  if v_term = '' then raise exception 'اكتب المصطلح العربي'; end if;

  select id into v_id from public.glossary_terms where term_ar = v_term;
  if v_id is not null then
    if v_admin then
      update public.glossary_terms
         set category = v_cat,
             explanation = coalesce(nullif(trim(coalesce(p ->> 'explanation', '')), ''), explanation)
       where id = v_id;
    end if;
    return v_id;
  end if;

  insert into public.glossary_terms (term_ar, category, explanation, status, created_by,
                                     approved_by, approved_at)
  values (v_term, v_cat, coalesce(nullif(trim(coalesce(p ->> 'explanation', '')), ''), ''),
          case when v_admin then 'معتمد' else 'مقترح' end, auth.uid(),
          case when v_admin then auth.uid() end,
          case when v_admin then now() end)
  returning id into v_id;

  -- إن جاء من المرصد عُلّم مرشَّحُه فلا يعود
  update public.term_candidates
     set state = 'added', term_id = v_id
   where norm = public.ar_norm(v_term);

  return v_id;
end $$;
grant execute on function public.propose_glossary_term(jsonb) to authenticated;

create or replace function public.review_glossary_term(p_id uuid, p_approve boolean,
                                                       p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin_for('glossary') then
    raise exception 'اعتمادُ المصطلحات لمن له صلاحيةُ الدليل' using errcode = '42501';
  end if;
  update public.glossary_terms
     set status = case when p_approve then 'معتمد' else 'مردود' end,
         reject_reason = case when p_approve then null else nullif(trim(coalesce(p_reason, '')), '') end,
         approved_by = case when p_approve then auth.uid() else approved_by end,
         approved_at = case when p_approve then now() else approved_at end,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
  if not found then raise exception 'المصطلح غير موجود'; end if;
end $$;
grant execute on function public.review_glossary_term(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- ٧) المعاني وترجماتُها وشواهدُها
-- ---------------------------------------------------------------------
create or replace function public.save_glossary_sense(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
        v_term uuid := nullif(p ->> 'term_id', '')::uuid;
        v_label text := nullif(trim(coalesce(p ->> 'label', '')), '');
        v_row jsonb;
begin
  if public.my_role() is null or public.is_supervisor() then
    raise exception 'الدليلُ المصطلحي للفريق' using errcode = '42501';
  end if;
  if v_label is null then raise exception 'اكتب عنوان المعنى'; end if;

  if v_id is null then
    if v_term is null then raise exception 'حدّد المصطلح'; end if;
    insert into public.glossary_senses (term_id, label, explanation, sort, created_by)
    values (v_term, v_label, nullif(trim(coalesce(p ->> 'explanation', '')), ''),
            coalesce((p ->> 'sort')::int, 0), auth.uid())
    returning id into v_id;
  else
    update public.glossary_senses
       set label = v_label,
           explanation = nullif(trim(coalesce(p ->> 'explanation', '')), ''),
           sort = coalesce((p ->> 'sort')::int, sort)
     where id = v_id;
    if not found then raise exception 'المعنى غير موجود'; end if;
  end if;

  if p ? 'translations' then
    for v_row in select * from jsonb_array_elements(coalesce(p -> 'translations', '[]'::jsonb)) loop
      if nullif(trim(coalesce(v_row ->> 'term_tr', '')), '') is null then
        delete from public.glossary_sense_translations
         where sense_id = v_id and language_code = v_row ->> 'language_code';
      else
        insert into public.glossary_sense_translations (sense_id, language_code, term_tr, note, created_by)
        values (v_id, v_row ->> 'language_code', btrim(v_row ->> 'term_tr'),
                nullif(trim(coalesce(v_row ->> 'note', '')), ''), auth.uid())
        on conflict (sense_id, language_code) do update
           set term_tr = excluded.term_tr, note = excluded.note;
      end if;
    end loop;
  end if;

  if p ? 'examples' then
    for v_row in select * from jsonb_array_elements(coalesce(p -> 'examples', '[]'::jsonb)) loop
      if nullif(trim(coalesce(v_row ->> 'quote', '')), '') is not null then
        insert into public.glossary_examples (sense_id, quote, material_id, created_by)
        values (v_id, btrim(v_row ->> 'quote'), nullif(v_row ->> 'material_id', '')::uuid, auth.uid());
      end if;
    end loop;
  end if;

  return v_id;
end $$;
grant execute on function public.save_glossary_sense(jsonb) to authenticated;

create or replace function public.delete_glossary_sense(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin_for('glossary') then
    raise exception 'حذفُ المعاني لمن له صلاحيةُ الدليل' using errcode = '42501';
  end if;
  delete from public.glossary_senses where id = p_id;
end $$;
grant execute on function public.delete_glossary_sense(uuid) to authenticated;

-- شواهدُ المعنى من الأرشيف: تُقترح على من يحرّر المعنى
create or replace function public.sense_quotes(p_term text, p_limit int default 5)
returns table (material_id uuid, title text, quote text)
language sql stable security definer set search_path = public as $$
  select m.id, m.title,
         left(btrim(regexp_replace(
           substring(regexp_replace(coalesce(m.source_html, ''), '<[^>]*>', ' ', 'g')
                     from greatest(1, position(p_term in regexp_replace(coalesce(m.source_html, ''), '<[^>]*>', ' ', 'g')) - 90)
                     for 240), '\s+', ' ', 'g')), 240)
    from public.materials m
   where public.my_role() is not null
     and p_term is not null and p_term <> ''
     and regexp_replace(coalesce(m.source_html, ''), '<[^>]*>', ' ', 'g') like '%' || p_term || '%'
   order by m.sermon_date desc nulls last
   limit greatest(1, p_limit)
$$;
grant execute on function public.sense_quotes(text, int) to authenticated;

-- ---------------------------------------------------------------------
-- ٨) بطاقاتُ اللغات، وصفوفُ البطاقة
-- ---------------------------------------------------------------------
create or replace function public.glossary_cards()
returns table (code text, name_ar text, native_name text, dir text, is_core boolean,
               done int, missing int)
language sql stable security definer set search_path = public as $$
  select l.code, l.name_ar, l.native_name, l.dir, l.is_core,
         (select count(distinct s.term_id)::int
            from public.glossary_sense_translations tr
            join public.glossary_senses s on s.id = tr.sense_id
            join public.glossary_terms t on t.id = s.term_id
           where tr.language_code = l.code and t.status = 'معتمد'),
         (select count(*)::int from public.glossary_terms t
           where t.status = 'معتمد'
             and not exists (
               select 1 from public.glossary_senses s
                 join public.glossary_sense_translations tr on tr.sense_id = s.id
                where s.term_id = t.id and tr.language_code = l.code))
    from public.languages l
   where public.my_role() is not null
   order by l.is_core desc, l.sort
$$;
grant execute on function public.glossary_cards() to authenticated;

create or replace function public.glossary_rows(p_lang text, p_category text default null,
                                                p_q text default null)
returns table (term_id uuid, term_ar text, category text, status text,
               sense_id uuid, sense_label text, explanation text,
               term_tr text, note text, example text)
language sql stable security definer set search_path = public as $$
  select t.id, t.term_ar, t.category, t.status,
         s.id, s.label, coalesce(s.explanation, t.explanation),
         tr.term_tr, tr.note,
         (select e.quote from public.glossary_examples e where e.sense_id = s.id
           order by e.created_at limit 1)
    from public.glossary_terms t
    left join public.glossary_senses s on s.term_id = t.id
    left join public.glossary_sense_translations tr
           on tr.sense_id = s.id and tr.language_code = p_lang
   where public.my_role() is not null
     and (t.status = 'معتمد' or t.created_by = auth.uid() or public.is_admin())
     and (p_category is null or t.category = p_category)
     and (p_q is null or p_q = ''
          or public.ar_norm(t.term_ar) like '%' || public.ar_norm(p_q) || '%'
          or coalesce(tr.term_tr, '') ilike '%' || p_q || '%')
   order by t.category, t.term_ar, s.sort, s.label
$$;
grant execute on function public.glossary_rows(text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- ٩) سجلُّ مشاركة العضو (ملاحظة ٢٣٥)
--    عدٌّ ووقائعُ لا تقييم — والتقييمُ من مشرفي الهيئة نسجّله ولا نولّده
-- ---------------------------------------------------------------------
create or replace function public.glossary_contrib(p_member uuid default null)
returns table (member_id uuid, full_name text, proposed int, approved int,
               rejected int, senses int, translations int, examples int,
               impact int, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name,
         (select count(*)::int from public.glossary_terms t where t.created_by = p.id),
         (select count(*)::int from public.glossary_terms t where t.created_by = p.id and t.status = 'معتمد'),
         (select count(*)::int from public.glossary_terms t where t.created_by = p.id and t.status = 'مردود'),
         (select count(*)::int from public.glossary_senses s where s.created_by = p.id),
         (select count(*)::int from public.glossary_sense_translations tr where tr.created_by = p.id),
         (select count(*)::int from public.glossary_examples e where e.created_by = p.id),
         (select coalesce(sum(c.works), 0)::int
            from public.term_candidates c
            join public.glossary_terms t on t.id = c.term_id
           where t.created_by = p.id and t.status = 'معتمد'),
         greatest(
           (select max(t.created_at) from public.glossary_terms t where t.created_by = p.id),
           (select max(s.created_at) from public.glossary_senses s where s.created_by = p.id),
           (select max(tr.created_at) from public.glossary_sense_translations tr where tr.created_by = p.id))
    from public.profiles p
   where p.status <> 'disabled'
     and (p_member is null or p.id = p_member)
     and (public.is_admin() or p.id = auth.uid())
   order by 4 desc, p.full_name
$$;
grant execute on function public.glossary_contrib(uuid) to authenticated;

notify pgrst, 'reload schema';
