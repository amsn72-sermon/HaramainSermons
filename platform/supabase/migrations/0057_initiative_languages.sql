-- =====================================================================
-- 0057 — لغاتُ المبادرة: يخدمها المتعاقد بلا مقابل (ملاحظة ١٩٤)
--   العقد يطلب إحدى عشرة لغةً بالخطبة الأسبوعية، ويزيد المتعاقد من عنده
--   لغتين لا يأخذ عليهما شيئًا. فتُحسب أعمالُهما في المنصة كاملةً — في
--   دليل الإنتاج والأرشيف والإسناد والتقييم — وتُستثنى من كميات المستخلص،
--   وتُعرض في بنود العقد سطرًا مستقلًّا: «مبادرةُ المتعاقد — بلا مقابل»،
--   فيُبرَز ما تطوّع به ولا يُحتسب عليه مال.
-- =====================================================================

alter table public.languages
  add column if not exists is_initiative boolean not null default false,
  add column if not exists initiative_note text;

comment on column public.languages.is_initiative is
  'لغةٌ يخدمها المتعاقد مبادرةً منه بلا مقابل: تُحسب في المنصة وتُستثنى من المستخلص (ملاحظة ١٩٤)';

-- الإسبانية والبرتغالية: زيادةٌ من المتعاقد على ما طلبه العقد
update public.languages
   set is_initiative = true,
       initiative_note = 'مبادرةٌ من المتعاقد: خدمةٌ أسبوعية كاملة بلا مقابل'
 where code in ('es', 'pt');

-- ولمدير المشروع أن يضمّ لغةً إلى المبادرة أو يُخرجها منها
create or replace function public.set_language_initiative(p_code text, p_on boolean,
                                                          p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then
    raise exception 'لغات المبادرة لمدير المشروع' using errcode = '42501';
  end if;
  update public.languages
     set is_initiative = coalesce(p_on, false),
         initiative_note = case when coalesce(p_on, false)
                                then coalesce(nullif(trim(coalesce(p_note, '')), ''),
                                              'مبادرةٌ من المتعاقد: بلا مقابل')
                                else null end
   where code = p_code;
  if not found then raise exception 'اللغة غير موجودة'; end if;
end $$;
grant execute on function public.set_language_initiative(text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- الصفّ يحمل وصفَ لغته، فيُعرف المحتسَب من المتطوَّع به
-- ---------------------------------------------------------------------
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
                  and s.status = 'done')                                as has_sharia,
       coalesce(l.is_initiative, false)                                  as lang_initiative
  from public.tracks t
  join public.materials m on m.id = t.material_id
  left join public.languages l on l.code = t.language_code
 where t.deleted_at is null and m.deleted_at is null;

comment on view public.contract_rows
  is 'كل عمل بما يُحتسب به في بنود العقد، والكلمات من الأصل العربي، ولغةُ المبادرة مُعلَمة (ملاحظات ١٤٨ و١٨٨ و١٩٤)';
grant select on public.contract_rows to authenticated;

-- ---------------------------------------------------------------------
-- المنجَز في مدة: المحتسَب وحده في الكميات، والمبادرة في عمودها
-- ---------------------------------------------------------------------
drop function if exists public.contract_progress(date, date);
create function public.contract_progress(p_from date default null, p_to date default null)
returns table (code int, name text, unit text, unit_price numeric, qty_contracted numeric,
               qty_done numeric, qty_initiative numeric, total_value numeric, note text)
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
         -- المحتسَب: ما خلا لغات المبادرة
         case c.measure
           when 'sermon'               then (select count(*) from done where is_sermon and not lang_initiative)
           when 'sermon_audio'         then (select count(*) from done where is_sermon and has_audio and not lang_initiative)
           when 'sermon_sharia'        then (select count(*) from done where is_sermon and has_sharia and not lang_initiative)
           when 'interpretation_hours' then (select h from hours)
           when 'words'                then (select coalesce(sum(source_words), 0) from done where not is_sermon and not lang_initiative)
           when 'words_review'         then (select coalesce(sum(source_words), 0) from done where not is_sermon and not lang_initiative)
           else 0 end::numeric as qty_done,
         -- والمتطوَّع به: يُعرض ولا يُحتسب
         case c.measure
           when 'sermon'               then (select count(*) from done where is_sermon and lang_initiative)
           when 'sermon_audio'         then (select count(*) from done where is_sermon and has_audio and lang_initiative)
           when 'sermon_sharia'        then (select count(*) from done where is_sermon and has_sharia and lang_initiative)
           when 'interpretation_hours' then 0
           when 'words'                then (select coalesce(sum(source_words), 0) from done where not is_sermon and lang_initiative)
           when 'words_review'         then (select coalesce(sum(source_words), 0) from done where not is_sermon and lang_initiative)
           else 0 end::numeric as qty_initiative,
         c.total_value, c.note
    from public.contract_items c
   where public.is_manager()          -- بنود العقد لمدير المشروع وحده (ملاحظة ١٥٥)
   order by c.code
$$;
grant execute on function public.contract_progress(date, date) to authenticated;

-- مسودّة المستخلص: المحتسَب وحده يُسعَّر، والمبادرة تُعرض بجانبه
drop function if exists public.claim_month(date);
create function public.claim_month(p_month date)
returns table (code int, name text, unit text, unit_price numeric,
               qty_done numeric, qty_initiative numeric, amount numeric)
language sql stable security definer set search_path = public as $$
  select p.code, p.name, p.unit, p.unit_price, p.qty_done, p.qty_initiative,
         round(coalesce(p.unit_price, 0) * p.qty_done, 2)
    from public.contract_progress(date_trunc('month', p_month)::date,
                                  (date_trunc('month', p_month) + interval '1 month - 1 day')::date) p
$$;
grant execute on function public.claim_month(date) to authenticated;

-- ---------------------------------------------------------------------
-- بيانُ المبادرة: لغةً لغةً بما أُنجز فيها — لإبرازها لا لتسعيرها
-- ---------------------------------------------------------------------
create or replace function public.initiative_languages(p_from date default null,
                                                       p_to date default null)
returns table (code text, name_ar text, note text, sermons int, texts int,
               words bigint, tracks int, since date)
language sql stable security definer set search_path = public as $$
  select l.code, l.name_ar, l.initiative_note,
         count(*) filter (where d.is_sermon)::int,
         count(*) filter (where not d.is_sermon)::int,
         coalesce(sum(case when not d.is_sermon then d.source_words else 0 end), 0)::bigint,
         count(d.track_id)::int,
         min(coalesce(d.completed_at::date, d.sermon_date))
    from public.languages l
    left join (
      select * from public.contract_rows
       where status = 'completed'
         and (p_from is null or coalesce(completed_at::date, sermon_date) >= p_from)
         and (p_to   is null or coalesce(completed_at::date, sermon_date) <= p_to)
    ) d on d.language_code = l.code
   where l.is_initiative and public.is_manager()
   group by l.code, l.name_ar, l.initiative_note, l.sort
   order by l.sort
$$;
grant execute on function public.initiative_languages(date, date) to authenticated;

-- ومجموعُها في رقمٍ واحد، يُعرض في دليل الإنتاج لكل من يراه
create or replace function public.initiative_totals()
returns table (langs int, tracks int, sermons int, words bigint)
language sql stable security definer set search_path = public as $$
  select (select count(*)::int from public.languages where is_initiative and is_active),
         count(*)::int,
         count(*) filter (where is_sermon)::int,
         coalesce(sum(case when not is_sermon then source_words else 0 end), 0)::bigint
    from public.contract_rows
   where status = 'completed' and lang_initiative
$$;
grant execute on function public.initiative_totals() to authenticated;

-- ---------------------------------------------------------------------
-- «عن المبادرة»: لغتان زيادةً على ما طُلب، بلا مقابل — بيانٌ لا تسعيرة
-- ---------------------------------------------------------------------
do $$
declare v jsonb; v_s jsonb; v_id text; v_blocks jsonb; v_new jsonb := '[]'::jsonb;
begin
  select content into v from public.page_content where key = 'initiative';
  if v is null then return; end if;

  for v_s in select jsonb_array_elements(v -> 'sections') loop
    v_id := v_s ->> 0;
    v_blocks := v_s -> 2;

    if v_id = 'scope' and not (v_blocks::text like '%زيادةً على المطلوب%') then
      v_blocks := v_blocks || jsonb_build_array(
        jsonb_build_array('h3', 'لغتان زيادةً على المطلوب'),
        jsonb_build_array('p', 'المطلوب في نطاق العمل إحدى عشرة لغةً بالخطبة الأسبوعية. '
          || 'وقد زاد فريق المشروع من عنده لغتين يخدمهما خدمةً كاملة ولا يأخذ عليهما شيئًا: '
          || 'الإسبانية والبرتغالية. تُترجم خطبهما وتُراجع وتُؤدّى صوتيًّا كغيرهما، '
          || 'وتُحسب أعمالُهما في دليل الإنتاج والأرشيف، '
          || 'وتُستثنى من الكميات المحتسَبة فتُعرض سطرًا مستقلًّا بيانًا لها.'),
        jsonb_build_array('p', 'والمنصة تعرف اللغة المزيدة بوسمها، فلا يُخلط المتطوَّع به '
          || 'بالمطلوب في أي كشفٍ أو تقرير.'));
    end if;

    v_new := v_new || jsonb_build_array(jsonb_build_array(v_s -> 0, v_s -> 1, v_blocks));
  end loop;

  update public.page_content
     set content = jsonb_set(v, '{sections}', v_new), updated_at = now()
   where key = 'initiative';
end $$;

notify pgrst, 'reload schema';
