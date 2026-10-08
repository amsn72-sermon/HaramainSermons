-- =====================================================================
-- 0118 — أرشيفُ الخطب: أشهرُ العام، وصفٌّ لكلِّ لغة، وتعديلُ القسم
--        (ملاحظات ٣٥٨ و٣٦٤ ومن ٣٦٥ إلى ٣٧١)
--
--   كان العامُ ينزل دفعةً واحدة: إحدى وخمسون جمعةً في قائمةٍ واحدة،
--   ولغاتُ الخطبة وسومًا مرصوفةً تحت صفِّها. فصار العامُ اثنتي عشرة
--   بطاقةً على أشهره، وصار لكلِّ لغةٍ صفُّها بأيقوناتها ورمزِ توثيقها.
--
--   والصفوفُ الخاليةُ تُرسَم في الواجهة ولا تُخزَّن هنا: لا يُكتب في
--   الجدول إلا ما رُفع فعلًا، فيبقى الإحصاءُ صادقًا ولا يعدُّ الترقيمُ
--   فراغًا. وإنما يُحفَظ هنا أمران: لغاتُ العام المتوقَّعة، وما استُثني
--   من لغاتٍ في خطبةٍ بعينها.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) لغاتُ العام المتوقَّعة، وما يُستثنى منها في خطبة
-- ---------------------------------------------------------------------
alter table public.arch_years   add column if not exists langs text[];
alter table public.arch_sermons add column if not exists skip_langs text[] not null default '{}';

comment on column public.arch_years.langs is
  'لغاتُ العام المتوقَّعة: يُرسَم لكلٍّ منها صفٌّ ولو لم تُرفَع (ملاحظة ٣٦٨)';
comment on column public.arch_sermons.skip_langs is
  'لغاتٌ حُذف صفُّها من هذه الخطبة — تُستردُّ متى شئت (ملاحظة ٣٧٠)';

-- اللغاتُ المعمولُ بها في عامٍ: المحفوظةُ إن حُفظت، وإلا الرئيسةُ الفاعلة
create or replace function public.arch_year_langs(p_year int)
returns table (code text, name_ar text, dir text, sort int, stored boolean)
language sql stable security definer set search_path = public as $$
  with y as (select (select a.langs from public.arch_years a where a.h_year = p_year) as langs)
  select l.code, l.name_ar, l.dir, l.sort, y.langs is not null
    from public.languages l cross join y
   where public.my_role() is not null
     and (
       case when y.langs is not null
            then l.code = any (y.langs)
            else l.code = 'ar' or (l.is_core and l.is_active)
       end)
   order by case when l.code = 'ar' then 0 else 1 end, l.sort, l.code
$$;
grant execute on function public.arch_year_langs(int) to authenticated;

comment on function public.arch_year_langs(int) is
  'لغاتُ العام التي يُرسَم لكلٍّ منها صفٌّ في كلِّ خطبة (ملاحظتا ٣٦٨ و٣٧٠)';

create or replace function public.set_arch_year_langs(p_year int, p_langs text[])
returns int language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_manager() or public.is_admin_for('arch_upload')) then
    raise exception 'تحديدُ لغات العام بإذن مدير المشروع' using errcode = '42501';
  end if;
  if p_langs is not null and array_length(p_langs, 1) is null then
    raise exception 'لا بدَّ من لغةٍ واحدةٍ على الأقل';
  end if;
  update public.arch_years
     set langs = case when p_langs is null then null
                      else (select array_agg(distinct x) from unnest(p_langs) x
                             where exists (select 1 from public.languages l where l.code = x)) end
   where h_year = p_year;
  return coalesce(array_length(p_langs, 1), 0);
end $$;
grant execute on function public.set_arch_year_langs(int, text[]) to authenticated;

-- حذفُ صفِّ لغةٍ من خطبةٍ أو ردُّه — الصفُّ لا النصّ
create or replace function public.skip_arch_lang(p_id uuid, p_lang text, p_on boolean)
returns text[] language plpgsql security definer set search_path = public as $$
declare v_out text[];
begin
  if not (public.is_manager() or public.is_admin_for('arch_edit')) then
    raise exception 'تعديلُ صفوف اللغات بإذن مدير المشروع' using errcode = '42501';
  end if;
  if p_on and exists (select 1 from public.arch_versions v
                       where v.sermon_id = p_id and v.language_code = p_lang
                         and (v.body_html is not null or v.file_path is not null)) then
    raise exception 'في هذا الصفِّ نسخةٌ محفوظة — احذفِ النسخةَ أوّلًا';
  end if;
  update public.arch_sermons
     set skip_langs = case when p_on
            then (select array_agg(distinct x) from unnest(skip_langs || p_lang) x)
            else (select coalesce(array_agg(x), '{}') from unnest(skip_langs) x where x <> p_lang) end
   where id = p_id
   returning skip_langs into v_out;
  return coalesce(v_out, '{}');
end $$;
grant execute on function public.skip_arch_lang(uuid, text, boolean) to authenticated;

-- حذفُ نسخةٍ بلغتها وحدَها دون سائر الخطبة
create or replace function public.delete_arch_version(p_sermon uuid, p_lang text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (public.is_manager() or public.is_admin_for('arch_edit')) then
    raise exception 'حذفُ النسخ بإذن مدير المشروع' using errcode = '42501';
  end if;
  delete from public.arch_versions where sermon_id = p_sermon and language_code = p_lang;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.delete_arch_version(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- ٢) تعديلُ القسم وحذفُه (ملاحظتا ٣٥٨ و٣٦٤)
-- ---------------------------------------------------------------------
create or replace function public.rename_arch_section(p_id uuid, p_name text, p_icon text default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_manager() or public.is_admin_for('arch_upload')) then
    raise exception 'تعديلُ الأقسام بإذن مدير المشروع' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then
    raise exception 'اكتبِ اسمَ القسم';
  end if;
  update public.arch_sections
     set name = btrim(p_name),
         icon = coalesce(nullif(btrim(p_icon), ''), icon)
   where id = p_id;
  return p_id;
end $$;
grant execute on function public.rename_arch_section(uuid, text, text) to authenticated;

create or replace function public.delete_arch_section(p_id uuid, p_force boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare n int; v_year int;
begin
  if not (public.is_manager() or public.is_admin_for('arch_upload')) then
    raise exception 'حذفُ الأقسام بإذن مدير المشروع' using errcode = '42501';
  end if;
  select h_year into v_year from public.arch_sections where id = p_id;
  if v_year is null then raise exception 'لم يُوجد القسم'; end if;
  if (select count(*) from public.arch_sections where h_year = v_year) <= 1 then
    raise exception 'لا يُحذف آخرُ قسمٍ في العام';
  end if;
  select count(*)::int into n from public.arch_sermons where section_id = p_id;
  if n > 0 and not p_force then
    raise exception 'في القسم % خطبة — انقلْها أو أكِّدِ الحذفَ بما فيه', n;
  end if;
  delete from public.arch_sections where id = p_id;
  return n;
end $$;
grant execute on function public.delete_arch_section(uuid, boolean) to authenticated;

-- ونقلُ خطبِ قسمٍ إلى آخر، فيكون الحذفُ بلا فقد
create or replace function public.move_arch_sermons(p_from uuid, p_to uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (public.is_manager() or public.is_admin_for('arch_edit')) then
    raise exception 'نقلُ الخطب بإذن مدير المشروع' using errcode = '42501';
  end if;
  if (select h_year from public.arch_sections where id = p_from)
     is distinct from (select h_year from public.arch_sections where id = p_to) then
    raise exception 'النقلُ بين قسمَي عامٍ واحد';
  end if;
  update public.arch_sermons set section_id = p_to where section_id = p_from;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.move_arch_sermons(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ٣) أشهرُ العام: اثنتا عشرة بطاقةً بإحصائها (ملاحظة ٣٦٩)
--
--   والجمعةُ تتبع الشهرَ الذي يقع فيه تاريخُها الهجريُّ لا الميلادي،
--   وترقيمُ الأسابيع يبقى متّصلًا على العام فلا يُستأنَف في كلِّ شهر.
-- ---------------------------------------------------------------------
create or replace function public.arch_month_tiles(p_year int, p_section uuid default null)
returns table (h_month int, fridays int, covered int, sermons int,
               versions int, gaps int, first_friday date)
language sql stable security definer set search_path = public as $$
  with b as (select * from public.hijri_year_bounds(p_year)),
  f as (
    select d::date as friday_on, public.hijri_month(d::date) as h_month
      from b, generate_series(public.first_friday_of_year(p_year), b.ends_on, interval '7 day') d
  ),
  s as (
    select m.friday_on, m.mosque, m.id
      from public.arch_sermons m
     where m.h_year = p_year
       and (p_section is null or m.section_id = p_section)
       and m.friday_on is not null
  ),
  g as (
    select f.h_month, f.friday_on,
           (select count(distinct x.mosque)::int from s x
             where x.friday_on = f.friday_on and x.mosque is not null) as n_mosques,
           (select count(*)::int from s x where x.friday_on = f.friday_on) as n_sermons,
           (select count(*)::int from public.arch_versions v
             where v.sermon_id in (select x.id from s x where x.friday_on = f.friday_on)) as n_versions
      from f
  )
  select g.h_month,
         count(*)::int,
         count(*) filter (where g.n_mosques >= 2)::int,
         coalesce(sum(g.n_sermons), 0)::int,
         coalesce(sum(g.n_versions), 0)::int,
         count(*) filter (where g.n_mosques < 2)::int,
         min(g.friday_on)
    from g
   where public.my_role() is not null
   group by g.h_month
   order by min(g.friday_on)
$$;
grant execute on function public.arch_month_tiles(int, uuid) to authenticated;

comment on function public.arch_month_tiles(int, uuid) is
  'بطاقاتُ أشهر العام الهجرية بإحصاء جُمَعِها (ملاحظة ٣٦٩)';

-- ---------------------------------------------------------------------
-- ٤) الأسابيع: يُحمَل معها شهرُها ونسخُ كلِّ خطبةٍ بلغاتها
--
--   كانت الواجهةُ تسأل عن نسخِ كلِّ خطبةٍ بطلبٍ مستقلّ، فإذا كان في
--   الشهر عشرُ خطبٍ كان عشرةَ طلبات. فصارت تأتي معها في طلبٍ واحد.
-- ---------------------------------------------------------------------
drop function if exists public.arch_weeks(int, uuid);
create or replace function public.arch_weeks(p_year int, p_section uuid default null)
returns table (week_no int, friday_on date, h_month int,
               makkah jsonb, madinah jsonb, others jsonb, langs int)
language sql stable security definer set search_path = public as $$
  with b as (select * from public.hijri_year_bounds(p_year)),
  fridays as (
    select row_number() over (order by d)::int as week_no, d::date as friday_on,
           public.hijri_month(d::date) as h_month
      from b, generate_series(public.first_friday_of_year(p_year), b.ends_on, interval '7 day') d
  ),
  s as (
    select m.*,
           (select count(*) from public.arch_versions v where v.sermon_id = m.id) as n_langs,
           (select jsonb_agg(jsonb_build_object(
                      'language_code', v.language_code,
                      'doc_no',        v.doc_no,
                      'has_text',      v.body_html is not null,
                      'has_file',      v.file_path is not null,
                      'has_audio',     v.audio_path is not null,
                      'words',         v.words)
                    order by case when v.language_code = 'ar' then 0 else 1 end, v.language_code)
              from public.arch_versions v where v.sermon_id = m.id) as versions
      from public.arch_sermons m
     where m.h_year = p_year
       and (p_section is null or m.section_id = p_section)
  )
  select f.week_no, f.friday_on, f.h_month,
         (select to_jsonb(x) from (
            select s.id, s.title, s.khateeb, s.seq, s.sermon_date, s.hijri_text,
                   s.sermon_type, s.doc_no, s.n_langs, s.versions, s.skip_langs
              from s where s.friday_on = f.friday_on and s.mosque = 'makkah' limit 1) x),
         (select to_jsonb(x) from (
            select s.id, s.title, s.khateeb, s.seq, s.sermon_date, s.hijri_text,
                   s.sermon_type, s.doc_no, s.n_langs, s.versions, s.skip_langs
              from s where s.friday_on = f.friday_on and s.mosque = 'madinah' limit 1) x),
         (select jsonb_agg(to_jsonb(x) order by x.sermon_date, x.seq) from (
            select s.id, s.title, s.khateeb, s.seq, s.sermon_date, s.hijri_text,
                   s.sermon_type, s.doc_no, s.n_langs, s.versions, s.skip_langs
              from s where s.friday_on = f.friday_on and s.mosque is null) x),
         (select coalesce(sum(s.n_langs), 0)::int from s where s.friday_on = f.friday_on)
    from fridays f
   where public.my_role() is not null
   order by f.week_no
$$;
grant execute on function public.arch_weeks(int, uuid) to authenticated;

comment on function public.arch_weeks(int, uuid) is
  'أسابيعُ العام بشهرها، وخطبتا الحرمين بنسخهما بلغاتها (ملاحظات ٣٠٣ و٣٤٥ و٣٦٥ و٣٦٩)';

-- ---------------------------------------------------------------------
-- ٥) التصديرُ الجماعيُّ بحدوده: مدّةٌ ولغةٌ ومسجد (ملاحظة ٣٧١)
-- ---------------------------------------------------------------------
drop function if exists public.arch_book(int, text, text, uuid);
create or replace function public.arch_book(
  p_year int, p_lang text, p_mosque text default null, p_section uuid default null,
  p_from date default null, p_to date default null
) returns table (seq int, week_no int, title text, khateeb text, mosque text,
                 sermon_type text, sermon_date date, hijri_text text,
                 body_html text, doc_no text, title_tr text)
language sql stable security definer set search_path = public as $$
  select m.seq, m.week_no, m.title, m.khateeb, m.mosque, m.sermon_type,
         m.sermon_date, m.hijri_text, v.body_html, v.doc_no, v.title_tr
    from public.arch_sermons m
    join public.arch_versions v on v.sermon_id = m.id and v.language_code = p_lang
   where (public.is_manager() or public.is_admin_for('arch_export')
          or public.is_admin() or public.is_supervisor() or public.is_viewer())
     and m.h_year = p_year
     and (p_mosque is null or m.mosque = p_mosque)
     and (p_section is null or m.section_id = p_section)
     and (p_from is null or coalesce(m.sermon_date, m.friday_on) >= p_from)
     and (p_to   is null or coalesce(m.sermon_date, m.friday_on) <= p_to)
   order by coalesce(m.sermon_date, date '9999-12-31'), m.seq
$$;
grant execute on function public.arch_book(int, text, text, uuid, date, date) to authenticated;

comment on function public.arch_book(int, text, text, uuid, date, date) is
  'خطبُ عامٍ بلغةٍ مرتَّبةً زمنيًّا بين حدَّين — يُبنى منها المجمَّع والتصديرُ '
  'الجماعي (ملاحظتا ٣٠٩ و٣٧١)';

notify pgrst, 'reload schema';
