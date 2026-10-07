-- =====================================================================
-- 0106 — قوالبُ الشهادات وأصولُ التصميم، وترقيمُ الخطب وإحصاءُ الأعوام
--        (ملاحظات ٣١٧ و٣٢٢–٣٢٥ و٣٢٧ و٣٢٩)
--
--   أربعةُ أبوابٍ في ترحيلٍ واحد، يجمعها أنها كلُّها بياناتٌ تحت
--   الشاشات التي تُعاد في هذا التحديث:
--
--   ١) أصولُ التصميم: الشعاراتُ والخلفياتُ والتواقيعُ تصير أصولًا
--      محفوظةً في المنصة، فنزعُ شعارٍ من قالبٍ لا يُتلفه (٣٢٥)،
--      والخلفيةُ تُرفَع ملفَّ PDF فتُرسَم بكامل دقّتها (٣٢٢).
--   ٢) قوالبُ الشهادات: مسمّاةٌ متعدّدةٌ يُملأ فيها كلُّ ثابت، فلا
--      يبقى في المنح إلا اسمُ صاحبها (٣٢٤)، ومعها المنحُ الجماعي.
--   ٣) ترقيمُ الخطب: يُعدَّل بيد صاحبه، ويُعاد ترقيمُ العام بالتاريخ
--      للعام كلِّه أو لكلِّ حرمٍ على حِدة (٣٢٧).
--   ٤) إحصاءُ العام: الجُمَعُ المغطّاةُ والناقصةُ والخطباء، تُقرأ من
--      بطاقة العام قبل الدخول إليه (٣٢٩). وجُمَعُ العام تُحسَب من
--      التقويم لا من ملفٍّ يُرفَع — فتواريخُ الجُمَع معلومةٌ بنفسها.
--   وكشفُ الهوية يعرض كلَّ أعضاء الفئة لا من رفع وحدَه (٣١٧).
-- =====================================================================

-- =====================================================================
-- ١) أصولُ التصميم: شعارٌ وخلفيةٌ وتوقيع (ملاحظتا ٣٢٢ و٣٢٥)
-- =====================================================================
insert into storage.buckets (id, name, public) values ('design', 'design', false)
on conflict (id) do nothing;

drop policy if exists "staff read design assets" on storage.objects;
create policy "staff read design assets" on storage.objects for select
  using (bucket_id = 'design' and public.my_role() is not null);

drop policy if exists "admin writes design assets" on storage.objects;
create policy "admin writes design assets" on storage.objects for insert
  with check (bucket_id = 'design' and public.is_admin());

create table if not exists public.design_assets (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('logo', 'background', 'signature')),
  name       text not null,
  file_path  text,                       -- في حاوية design
  url        text,                       -- أو مسارٌ ثابتٌ في الموقع (الافتراضية)
  mime       text,
  pages      int,                        -- للخلفية من PDF: عددُ صفحاتها
  is_builtin boolean not null default false,   -- افتراضيٌّ لا يُحذف
  sort       int not null default 100,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  unique (kind, name)
);

comment on table public.design_assets is
  'أصولُ التصميم: شعاراتٌ وخلفياتٌ وتواقيع — تُضاف إلى القوالب وتُنزَع منها بلا إتلاف (ملاحظتا ٣٢٢ و٣٢٥)';

alter table public.design_assets enable row level security;
drop policy if exists "read design assets" on public.design_assets;
create policy "read design assets" on public.design_assets for select
  using (public.my_role() is not null);
grant select on public.design_assets to authenticated;

-- الشعاراتُ الثلاثةُ الافتراضية: لا تُحذف ولا تضيع بنزعها من قالب
insert into public.design_assets (kind, name, url, mime, is_builtin, sort) values
  ('logo', 'الهيئة العامة للعناية بشؤون المسجد الحرام والمسجد النبوي',
   '/assets/alharamain-logo-dark.png', 'image/png', true, 10),
  ('logo', 'جامعة أم القرى', '/assets/uqu-logo.png', 'image/png', true, 20),
  ('logo', 'شعار المشروع', '/assets/logo.png', 'image/png', true, 30)
on conflict (kind, name) do nothing;

create or replace function public.design_assets_list(p_kind text default null)
returns table (id uuid, kind text, name text, file_path text, url text,
               mime text, pages int, is_builtin boolean)
language sql stable security definer set search_path = public as $$
  select a.id, a.kind, a.name, a.file_path, a.url, a.mime, a.pages, a.is_builtin
    from public.design_assets a
   where public.my_role() is not null
     and (p_kind is null or a.kind = p_kind)
   order by a.is_builtin desc, a.sort, a.name
$$;
grant execute on function public.design_assets_list(text) to authenticated;

create or replace function public.add_design_asset(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_kind text := nullif(btrim(p ->> 'kind'), '');
begin
  if not (public.is_manager() or public.is_admin_for('cert_design')) then
    raise exception 'أصولُ التصميم بإذن مدير المشروع' using errcode = '42501';
  end if;
  if v_kind not in ('logo', 'background', 'signature') then
    raise exception 'نوعُ أصلٍ غيرُ معروف';
  end if;
  if nullif(btrim(p ->> 'name'), '') is null then
    raise exception 'سَمِّ الأصلَ كي يُعرف';
  end if;
  insert into public.design_assets (kind, name, file_path, url, mime, pages, created_by)
  values (v_kind, btrim(p ->> 'name'), nullif(btrim(p ->> 'file_path'), ''),
          nullif(btrim(p ->> 'url'), ''), nullif(btrim(p ->> 'mime'), ''),
          nullif(p ->> 'pages', '')::int, auth.uid())
  on conflict (kind, name) do update
    set file_path = coalesce(excluded.file_path, public.design_assets.file_path),
        url       = coalesce(excluded.url, public.design_assets.url),
        mime      = coalesce(excluded.mime, public.design_assets.mime),
        pages     = coalesce(excluded.pages, public.design_assets.pages)
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.add_design_asset(jsonb) to authenticated;

-- الحذفُ من المكتبة لمدير المشروع، والافتراضيُّ لا يُحذف أصلًا
create or replace function public.delete_design_asset(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then
    raise exception 'حذفُ أصول التصميم لمدير المشروع' using errcode = '42501';
  end if;
  if exists (select 1 from public.design_assets where id = p_id and is_builtin) then
    raise exception 'الأصلُ الافتراضيُّ لا يُحذف';
  end if;
  delete from public.design_assets where id = p_id;
end $$;
grant execute on function public.delete_design_asset(uuid) to authenticated;

-- =====================================================================
-- ٢) قوالبُ الشهادات: مسمّاةٌ متعدّدةٌ مملوءة (ملاحظة ٣٢٤)
-- =====================================================================
create table if not exists public.cert_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(btrim(name)) > 1),
  kind       text not null default 'course' check (kind in ('course', 'experience')),
  tpl        jsonb not null default '{}'::jsonb,   -- التصميمُ والنصوصُ الثابتة
  fixed      jsonb not null default '{}'::jsonb,   -- بياناتُ الشهادة الثابتة
  is_active  boolean not null default true,
  sort       int not null default 100,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

comment on table public.cert_templates is
  'قوالبُ الشهادات: يُملأ في القالب كلُّ ثابتٍ ولا يبقى في المنح إلا الاسم (ملاحظة ٣٢٤)';

alter table public.cert_templates enable row level security;
drop policy if exists "read cert templates" on public.cert_templates;
create policy "read cert templates" on public.cert_templates for select
  using (public.my_role() is not null);
grant select on public.cert_templates to authenticated;

alter table public.certificates
  add column if not exists template_id uuid references public.cert_templates (id);

create or replace function public.cert_templates_list(p_active boolean default null)
returns table (id uuid, name text, kind text, tpl jsonb, fixed jsonb,
               is_active boolean, issued int, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.kind, t.tpl, t.fixed, t.is_active,
         (select count(*)::int from public.certificates c where c.template_id = t.id),
         t.updated_at
    from public.cert_templates t
   where public.my_role() is not null
     and (p_active is null or t.is_active = p_active)
   order by t.sort, t.name
$$;
grant execute on function public.cert_templates_list(boolean) to authenticated;

create or replace function public.save_cert_template(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
  if not (public.is_manager() or public.is_admin_for('cert_design')) then
    raise exception 'قوالبُ الشهادات بإذن مدير المشروع' using errcode = '42501';
  end if;
  if nullif(btrim(p ->> 'name'), '') is null then
    raise exception 'سَمِّ القالبَ كي يُعرف';
  end if;

  if v_id is null then
    insert into public.cert_templates (name, kind, tpl, fixed, is_active, updated_by)
    values (btrim(p ->> 'name'),
            coalesce(nullif(p ->> 'kind', ''), 'course'),
            coalesce(p -> 'tpl', '{}'::jsonb), coalesce(p -> 'fixed', '{}'::jsonb),
            coalesce((p ->> 'is_active')::boolean, true), auth.uid())
    on conflict (name) do update
      set kind = excluded.kind, tpl = excluded.tpl, fixed = excluded.fixed,
          is_active = excluded.is_active, updated_at = now(), updated_by = auth.uid()
    returning id into v_id;
  else
    update public.cert_templates
       set name = btrim(p ->> 'name'),
           kind = coalesce(nullif(p ->> 'kind', ''), kind),
           tpl  = coalesce(p -> 'tpl', tpl),
           fixed = coalesce(p -> 'fixed', fixed),
           is_active = coalesce((p ->> 'is_active')::boolean, is_active),
           updated_at = now(), updated_by = auth.uid()
     where id = v_id;
  end if;
  return v_id;
end $$;
grant execute on function public.save_cert_template(jsonb) to authenticated;

create or replace function public.delete_cert_template(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then
    raise exception 'حذفُ القوالب لمدير المشروع' using errcode = '42501';
  end if;
  if exists (select 1 from public.certificates where template_id = p_id) then
    -- ما صدر عنه شهادةٌ لا يُحذف، بل يُعطَّل فلا يُمنَح به بعدُ
    update public.cert_templates set is_active = false where id = p_id;
    return;
  end if;
  delete from public.cert_templates where id = p_id;
end $$;
grant execute on function public.delete_cert_template(uuid) to authenticated;

-- المنحُ بالقالب: اسمٌ (أو أسماء) وحسب (ملاحظة ٣٢٤)
create or replace function public.grant_certificates(
  p_template uuid, p_members uuid[], p_issue boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.cert_templates%rowtype;
        v_m uuid; v_id uuid; v_made int := 0; v_skip int := 0; v_ids uuid[] := '{}';
begin
  if not (public.is_manager() or public.is_admin_for('cert_draft')) then
    raise exception 'منحُ الشهادات بإذن مدير المشروع' using errcode = '42501';
  end if;
  select * into t from public.cert_templates where id = p_template;
  if t.id is null then raise exception 'قالبٌ غيرُ موجود'; end if;
  if not t.is_active then raise exception 'القالبُ معطَّل'; end if;

  foreach v_m in array coalesce(p_members, '{}') loop
    if not exists (select 1 from public.profiles where id = v_m) then
      v_skip := v_skip + 1; continue;
    end if;
    insert into public.certificates
      (kind, member_id, title, subject, hours, start_on, end_on, place, provider,
       source, role_text, body, design, signer_name, signer_role, signature,
       template_id, created_by)
    values (t.kind, v_m,
            coalesce(nullif(btrim(t.fixed ->> 'title'), ''), t.name),
            nullif(btrim(t.fixed ->> 'subject'), ''),
            nullif(t.fixed ->> 'hours', '')::numeric,
            nullif(t.fixed ->> 'start_on', '')::date,
            nullif(t.fixed ->> 'end_on', '')::date,
            nullif(btrim(t.fixed ->> 'place'), ''),
            nullif(btrim(t.fixed ->> 'provider'), ''),
            coalesce(nullif(t.fixed ->> 'source', ''), 'platform'),
            nullif(btrim(t.fixed ->> 'role_text'), ''),
            nullif(btrim(t.fixed ->> 'body'), ''),
            t.tpl,
            nullif(btrim(t.fixed ->> 'signer_name'), ''),
            nullif(btrim(t.fixed ->> 'signer_role'), ''),
            coalesce(nullif(t.fixed ->> 'signature', ''), 'blank'),
            t.id, auth.uid())
    returning id into v_id;
    v_ids := v_ids || v_id;
    v_made := v_made + 1;
  end loop;

  if coalesce(p_issue, false) then
    foreach v_m in array v_ids loop
      perform public.issue_certificate(v_m);
    end loop;
  end if;

  return jsonb_build_object('created', v_made, 'skipped', v_skip,
                            'issued', case when p_issue then v_made else 0 end,
                            'ids', to_jsonb(v_ids));
end $$;
grant execute on function public.grant_certificates(uuid, uuid[], boolean) to authenticated;

comment on function public.grant_certificates(uuid, uuid[], boolean) is
  'منحُ شهادةٍ بالقالب لعضوٍ أو لجماعةٍ دفعةً واحدة (ملاحظة ٣٢٤)';

-- حقولُ صاحب الشهادة التي يملؤها القالب: الاسمُ ورقمُ الهوية وما إليهما
-- (ملاحظة ٣٢٤) — تُقرأ لمن له الشهاداتُ وحدَه، ولا تُفشى لغيره
create or replace function public.cert_fields(p_cert uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_manager() or public.is_admin_for('cert_draft')
                or public.is_admin_for('cert_issue') or c.member_id = auth.uid()
         then jsonb_build_object(
           'full_name',   p.full_name,
           'member_no',   p.member_no,
           'national_id', pp.national_id,
           'id_type',     pp.id_type,
           'nationality', pp.nationality,
           'role',        coalesce((select rl.label from public.role_labels rl
                                      where rl.key = p.role::text), p.role::text),
           'langs',       coalesce((select string_agg(l.name_ar, '، ' order by l.sort)
                                      from public.member_languages ml
                                      join public.languages l on l.code = ml.language_code
                                     where ml.member_id = p.id), ''),
           'serial_no',   c.serial_no,
           'issued_on',   c.issued_at::date,
           'title',       c.title)
         else '{}'::jsonb end
    from public.certificates c
    join public.profiles p on p.id = c.member_id
    left join public.profile_private pp on pp.id = p.id
   where c.id = p_cert
$$;
grant execute on function public.cert_fields(uuid) to authenticated;

-- =====================================================================
-- ٣) ترقيمُ الخطب: يُعدَّل، ويُعاد ترقيمُ العام (ملاحظة ٣٢٧)
-- =====================================================================
create or replace function public.set_arch_seq(p_id uuid, p_seq int)
returns void language plpgsql security definer set search_path = public as $$
declare v_year int;
begin
  if not (public.is_manager() or public.is_admin_for('arch_edit')) then
    raise exception 'ترقيمُ الخطب بإذن مدير المشروع' using errcode = '42501';
  end if;
  select h_year into v_year from public.arch_sermons where id = p_id;
  if v_year is null then raise exception 'خطبةٌ غيرُ موجودة'; end if;
  if p_seq is not null and exists (
       select 1 from public.arch_sermons
        where h_year = v_year and seq = p_seq and id <> p_id) then
    raise exception 'الرقمُ % مستعمَلٌ في هذا العام', p_seq;
  end if;
  update public.arch_sermons set seq = p_seq where id = p_id;
end $$;
grant execute on function public.set_arch_seq(uuid, int) to authenticated;

-- إعادةُ الترقيم بالتاريخ: للعام كلِّه، أو لكلِّ حرمٍ على حِدة
create or replace function public.renumber_arch_year(
  p_year int, p_per_mosque boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not (public.is_manager() or public.is_admin_for('arch_edit')) then
    raise exception 'ترقيمُ الخطب بإذن مدير المشروع' using errcode = '42501';
  end if;

  -- تُرفَع الأرقامُ عاليًا أولًا كي لا تصطدم بقيدِ التفرّد في أثناء النقل
  update public.arch_sermons set seq = seq + 100000
   where h_year = p_year and seq is not null;

  with ord as (
    select id, row_number() over (
             partition by case when p_per_mosque then mosque else null end
             order by coalesce(sermon_date, date '9999-12-31'), created_at)::int as n
      from public.arch_sermons where h_year = p_year)
  update public.arch_sermons s set seq = o.n from ord o where o.id = s.id;

  get diagnostics v_n = row_count;
  return v_n;
end $$;
grant execute on function public.renumber_arch_year(int, boolean) to authenticated;

comment on function public.renumber_arch_year(int, boolean) is
  'إعادةُ ترقيم خطب العام بتاريخها — للعام كلِّه أو لكلِّ حرم (ملاحظة ٣٢٧)';

-- والحفظُ يقبل رقمًا صريحًا إن أُعطي
do $do$
declare v_src text; v_new text;
begin
  v_src := pg_get_functiondef('public.save_arch_sermon(jsonb)'::regprocedure);
  if position('p ->> ''seq''' in v_src) > 0 then return; end if;

  v_new := replace(v_src,
    'select coalesce(max(seq), 0) + 1 into v_seq from public.arch_sermons where h_year = v_year;',
    'v_seq := nullif(p ->> ''seq'', '''')::int;
    if v_seq is null or exists (select 1 from public.arch_sermons
                                 where h_year = v_year and seq = v_seq) then
      select coalesce(max(seq), 0) + 1 into v_seq from public.arch_sermons where h_year = v_year;
    end if;');

  -- وفي التعديل يُقبل الرقمُ الجديد ما لم يكن مستعمَلًا
  v_new := replace(v_new,
    'notes = nullif(btrim(p ->> ''notes''), '''')
     where id = v_id;',
    'notes = nullif(btrim(p ->> ''notes''), ''''),
           seq = case when nullif(p ->> ''seq'', '''') is null then seq
                      when exists (select 1 from public.arch_sermons x
                                    where x.h_year = v_year and x.seq = (p ->> ''seq'')::int
                                      and x.id <> v_id) then seq
                      else (p ->> ''seq'')::int end
     where id = v_id;');
  execute v_new;
end $do$;

-- =====================================================================
-- ٤) إحصاءُ العام: الجُمَعُ المغطّاةُ والناقصة (ملاحظة ٣٢٩)
--    وتواريخُ الجُمَع تُحسَب من التقويم، لا من ملفٍّ يُرفَع
-- =====================================================================
create or replace function public.arch_year_fridays(p_year int)
returns int language sql stable set search_path = public as $$
  select count(*)::int
    from public.hijri_year_bounds(p_year) b,
         generate_series(public.first_friday_of_year(p_year), b.ends_on, interval '7 day') d
$$;
grant execute on function public.arch_year_fridays(int) to authenticated;

-- تغيَّرت أعمدةُ المرتجَع، فتُسقَط أولًا
drop function if exists public.arch_year_tiles();
create or replace function public.arch_year_tiles()
returns table (h_year int, sermons int, versions int, langs int, sections int,
               fridays int, covered int, gaps int, khateebs int, pct int)
language sql stable security definer set search_path = public as $$
  with y as (
    select v.h_year, public.arch_year_fridays(v.h_year) as fridays
      from public.arch_years v
  ),
  s as (
    select m.h_year,
           count(*)::int as sermons,
           count(distinct m.friday_on) filter (where m.sermon_type = 'خطبة جمعة')::int as covered,
           count(distinct m.khateeb) filter (where m.khateeb is not null)::int as khateebs,
           -- الجمعةُ تامّةٌ إذا حضر فيها الحرمان كلاهما
           count(*) filter (where m.mosque is not null)::int as placed
      from public.arch_sermons m group by m.h_year
  ),
  v as (
    select m.h_year, count(*)::int as versions,
           count(distinct x.language_code)::int as langs
      from public.arch_versions x join public.arch_sermons m on m.id = x.sermon_id
     group by m.h_year
  ),
  c as (select h_year, count(*)::int as sections from public.arch_sections group by h_year)
  select y.h_year,
         coalesce(s.sermons, 0), coalesce(v.versions, 0), coalesce(v.langs, 0),
         coalesce(c.sections, 0), y.fridays,
         coalesce(s.covered, 0),
         greatest(0, y.fridays - coalesce(s.covered, 0)),
         coalesce(s.khateebs, 0),
         case when y.fridays > 0
              then least(100, round(coalesce(s.covered, 0) * 100.0 / y.fridays)::int)
              else 0 end
    from y
    left join s on s.h_year = y.h_year
    left join v on v.h_year = y.h_year
    left join c on c.h_year = y.h_year
   where public.my_role() is not null
   order by y.h_year
$$;
grant execute on function public.arch_year_tiles() to authenticated;

comment on function public.arch_year_tiles() is
  'بطاقاتُ الأعوام: خطبُها ونسخُها ولغاتُها، وجُمَعُها المغطّاةُ والناقصة (ملاحظة ٣٢٩)';

-- وما نقص من جُمَع العام مفصَّلًا: جمعةٌ جمعةً وحرمًا حرمًا
create or replace function public.arch_year_gaps(p_year int)
returns table (week_no int, friday_on date, makkah boolean, madinah boolean)
language sql stable security definer set search_path = public as $$
  with b as (select * from public.hijri_year_bounds(p_year)),
  fridays as (
    select row_number() over (order by d)::int as week_no, d::date as friday_on
      from b, generate_series(public.first_friday_of_year(p_year), b.ends_on, interval '7 day') d
  )
  select f.week_no, f.friday_on,
         exists (select 1 from public.arch_sermons m
                  where m.h_year = p_year and m.friday_on = f.friday_on and m.mosque = 'makkah'),
         exists (select 1 from public.arch_sermons m
                  where m.h_year = p_year and m.friday_on = f.friday_on and m.mosque = 'madinah')
    from fridays f
   where public.my_role() is not null
   order by f.week_no
$$;
grant execute on function public.arch_year_gaps(int) to authenticated;

-- =====================================================================
-- ٥) كشفُ الهوية يعرض كلَّ أعضاء الفئة (ملاحظة ٣١٧)
--    من لم يرفعْ يظهر بحالة «لم تُرفع»، كما في تدقيق المستندات
-- =====================================================================
create or replace function public.identity_sheet(p_group text default 'all')
returns table (
  member_id uuid, full_name text, email text, role public.app_role, track text,
  member_no int, status public.member_status,
  id_type text, national_id text, nationality text, id_expiry date,
  iqama_path text, iqama_status public.doc_status, iqama_note text, iqama_at timestamptz,
  days_left int, renewal_open boolean, renewal_reason text
) language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email, p.role, p.track, p.member_no, p.status,
         pp.id_type, pp.national_id, pp.nationality, pp.id_expiry,
         pp.iqama_path, pp.iqama_status, pp.iqama_note, pp.iqama_at,
         case when pp.id_expiry is null then null
              else (pp.id_expiry - current_date)::int end,
         exists (select 1 from public.doc_renewals r
                  where r.member_id = p.id and r.kind = 'iqama' and r.state = 'open'),
         (select r.reason from public.doc_renewals r
           where r.member_id = p.id and r.kind = 'iqama' and r.state = 'open' limit 1)
    from public.profiles p
    left join public.profile_private pp on pp.id = p.id
   where public.is_admin_for('docs_id_view')
     and (p_group is null or p_group = 'all'
          or (p_group = 'admins'      and p.role in ('manager', 'coordinator', 'supervisor', 'viewer'))
          or (p_group = 'translators' and p.role = 'translator' and coalesce(p.track, '') <> 'field')
          or (p_group = 'field'       and coalesce(p.track, '') = 'field'))
   order by (pp.iqama_status is null) desc,
            (pp.iqama_status = 'pending') desc,
            coalesce(pp.id_expiry, date '9999-12-31'), p.full_name
$$;
grant execute on function public.identity_sheet(text) to authenticated;

comment on function public.identity_sheet(text) is
  'كشفُ الهويات: كلُّ أعضاء الفئة، ومن لم يرفعْ يظهر بلا هوية (ملاحظتا ٣٠٧ و٣١٧)';

notify pgrst, 'reload schema';

-- =====================================================================
-- ٦) الرفعُ الجماعي: العنوانُ يُورَث من جمعتِه (ملاحظة ٣١٦)
--    ملفُّ اللغة الصينية — وغيرُه — لا يحمل عناوينَ الخطب، فإذا وافق
--    تاريخُه ومسجدُه خطبةً قائمةً وَرِثَ عنوانَها ولم يُرَدَّ لخلوِّه منه.
--    ولا تُنشأ خطبةٌ بلا عنوان: والمردودُ يُبيَّن سببُه في المرتجَع.
-- =====================================================================
do $do$
declare v_src text; v_new text; v_old text; v_fix text;
begin
  v_src := pg_get_functiondef('public.import_arch_sermons(jsonb)'::regprocedure);
  if position('v_why text' in v_src) > 0 then return; end if;

  v_new := replace(v_src,
    'v_rows jsonb := ''[]''::jsonb; v_act text; v_langs text[];',
    'v_rows jsonb := ''[]''::jsonb; v_act text; v_langs text[]; v_why text;');

  v_old := '    -- بندٌ بلا عنوانٍ ولا تاريخٍ لا يُكتب: يُترك لصاحبه يُصحّحه
    if v_title is null or v_date is null then
      v_skip := v_skip + 1;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        ''i'', v_i, ''action'', ''skipped'', ''why'', ''العنوانُ أو التاريخُ ناقص''));
      continue;
    end if;

    v_id := public.arch_match_sermon(v_sec, v_date, v_mos, v_type);';

  v_fix := '    v_id := case when v_date is null then null
              else public.arch_match_sermon(v_sec, v_date, v_mos, v_type) end;

    -- التاريخُ لازم، والعنوانُ يُورَث من جمعتِه إن وُجدت
    v_why := case when v_date is null then ''بلا تاريخ''
                  when v_title is null and v_id is null
                       then ''بلا عنوانٍ ولا جمعةٍ قائمةٍ يُورَث منها''
                  else null end;
    if v_why is not null then
      v_skip := v_skip + 1;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        ''i'', v_i, ''action'', ''skipped'', ''why'', v_why,
        ''title'', coalesce(v_title, ''''), ''date'', v_date));
      continue;
    end if;';

  if position(v_old in v_new) = 0 then
    raise exception 'import_arch_sermons: لم يُوجد موضعُ الترقيع';
  end if;
  v_new := replace(v_new, v_old, v_fix);

  -- والضمُّ لا يُفسد عنوانًا قائمًا بعنوانٍ فارغ
  v_new := replace(v_new,
    'set title       = case when v_over then v_title else coalesce(nullif(btrim(s.title), ''''), v_title) end,',
    'set title       = case when v_over and v_title is not null then v_title
                            else coalesce(nullif(btrim(s.title), ''''), v_title, s.title) end,');

  execute v_new;
end $do$;

notify pgrst, 'reload schema';
