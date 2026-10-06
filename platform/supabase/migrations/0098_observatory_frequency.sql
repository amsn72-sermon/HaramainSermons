-- =====================================================================
-- 0098 — المرصد: الأعلى تكرارًا أولًا، ولا يُقترح ما في الدليل
--        (ملاحظات ٢٩٨ و٢٩٩ و٣٠٠)
--
--   كان المرصدُ يُرتِّب بعدد الأعمال، والمقصودُ الأعلى تكرارًا فالأعلى:
--   فاللفظُ الذي ورد مئةَ مرةٍ أحقُّ بالنظر من لفظٍ ورد في عملين.
--
--   ويقترح المرصدُ ألفاظًا هي في الدليل أصلًا، لأنّ المطابقةَ كانت
--   بالنصِّ المجرَّدِ وحدَه: «الاعتكاف» في الدليل و«اعتكاف» مرشَّحٌ
--   جديد. فتصير المطابقةُ بالجذر، ويُنقَّى المرصدُ ممّا دخل الدليلَ
--   بعد رصده.
--
--   والبداءةُ من مدير المشروع: يمسح، فيُنقَّى له، فيختار، فيُولِّد
--   المصطلحاتَ من المرشَّحين، ثم يوجّهها إلى المترجمين.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) تنقيةُ المرصد: ما صار في الدليل لا يُعرَض مرشَّحًا (ملاحظة ٢٩٨)
-- ---------------------------------------------------------------------
create or replace function public.purge_candidates()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.is_admin() then
    raise exception 'المرصدُ للإدارة' using errcode = '42501';
  end if;
  update public.term_candidates c
     set state = 'added',
         term_id = coalesce(c.term_id, (select t.id from public.glossary_terms t
                                         where public.ar_bare(t.term_ar) = public.ar_bare(c.norm)
                                         limit 1))
   where c.state = 'new'
     and exists (select 1 from public.glossary_terms t
                  where public.ar_bare(t.term_ar) = public.ar_bare(c.norm));
  get diagnostics v_n = row_count;
  return v_n;
end $$;
grant execute on function public.purge_candidates() to authenticated;

comment on function public.purge_candidates() is
  'تنقيةُ المرشَّحين ممّا دخل الدليل — بالجذر لا بالنصّ (ملاحظة ٢٩٨)';

-- ---------------------------------------------------------------------
-- ٢) الرصدُ: الأعلى تكرارًا أولًا، والمطابقةُ بالجذر، ثم تنقية
-- ---------------------------------------------------------------------
create or replace function public.scan_terms(p_min_works int default 2,
                                             p_max int default 400)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_found int := 0; v_new int := 0; v_purged int := 0;
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
     -- الأعلى تكرارًا فالأعلى (ملاحظة ٣٠٠)
     order by count(*) desc, count(distinct mid) desc
     limit greatest(10, p_max)
  )
  insert into public.term_candidates (norm, raw, hits, works, words, last_seen)
  select a.norm, a.norm, a.hits, a.works, a.n, now()
    from agg a
   -- ولا يُقترح ما في الدليل، والمطابقةُ بالجذر (ملاحظة ٢٩٨)
   where not exists (select 1 from public.glossary_terms t
                      where public.ar_bare(t.term_ar) = public.ar_bare(a.norm))
  on conflict (norm) do update
     set hits = excluded.hits, works = excluded.works, last_seen = now()
   where public.term_candidates.state = 'new';

  get diagnostics v_new = row_count;
  v_purged := public.purge_candidates();
  select count(*)::int into v_found from public.term_candidates where state = 'new';
  return jsonb_build_object('scanned', v_new, 'pending', v_found, 'purged', v_purged);
end $$;
grant execute on function public.scan_terms(int, int) to authenticated;

-- ---------------------------------------------------------------------
-- ٣) توليدُ المصطلحات من المرشَّحين: مدير المشروع يختار فتُولَّد
--    معتمدةً عربيةً تنتظر ترجمتَها، ثم يوجّهها (ملاحظة ٣٠٠)
-- ---------------------------------------------------------------------
create or replace function public.promote_candidates(
  p_norms text[], p_category text default 'عام'
) returns table (term_id uuid, term_ar text)
language plpgsql security definer set search_path = public as $$
declare w text; v_term text; v_id uuid;
        v_cat text := coalesce(nullif(btrim(p_category), ''), 'عام');
begin
  if not (public.is_manager() or public.has_perm('gl_request')) then
    raise exception 'توليدُ المصطلحات من المرصد بإذن مدير المشروع' using errcode = '42501';
  end if;
  if v_cat not in ('عقدي','فقهي','دعوي','توجيهات','مناسك','أعلام','قرآني','عام') then
    v_cat := 'عام';
  end if;

  foreach w in array coalesce(p_norms, array[]::text[]) loop
    select c.raw into v_term from public.term_candidates c where c.norm = w;
    v_term := nullif(btrim(coalesce(v_term, w)), '');
    continue when v_term is null;

    select t.id into v_id from public.glossary_terms t
     where public.ar_bare(t.term_ar) = public.ar_bare(v_term) limit 1;

    if v_id is null then
      insert into public.glossary_terms
        (term_ar, category, status, created_by, approved_by, approved_at)
      values (v_term, v_cat, 'معتمد', auth.uid(), auth.uid(), now())
      returning id into v_id;
    end if;

    update public.term_candidates set state = 'added', term_id = v_id where norm = w;

    term_id := v_id; term_ar := v_term;
    return next;
  end loop;
end $$;
grant execute on function public.promote_candidates(text[], text) to authenticated;

comment on function public.promote_candidates(text[], text) is
  'توليدُ مصطلحاتٍ من مرشَّحي المرصد، معتمدةً تنتظر الترجمة (ملاحظة ٣٠٠)';

notify pgrst, 'reload schema';
