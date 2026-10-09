-- =====================================================================
-- 0123 — كليشاتُ التصدير، وبطاقةٌ لها مدةٌ وظهورٌ، وتعطيلٌ بسببه
--        (ملاحظات ٤٠٢ و٤٠٣ و٤٠٩ و٤١٢)
--
--   كانت الخطبةُ لا تُصدَّر إلا على كليشة الهيئة. فتُفتَح كليشاتٌ
--   تُصمَّم وتُسمَّى، وتُجمَع مع قوالب المجمَّع في بابٍ واحد.
--
--   والبطاقةُ كانت تُعتمَد بلا مدةٍ ولا ظهورٍ مستقلّ، فصار لها أجلٌ
--   يُطبَع عليها، وإظهارٌ لصاحبها يُرفَع ويُوضَع.
--
--   والتعطيلُ كان يقع بلا سببٍ مكتوب، فصار يُقيَّد سببُه.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) الكليشات: ما تُصدَّر عليه الخطبةُ المفردة (ملاحظة ٤٠٩)
-- ---------------------------------------------------------------------
create table if not exists public.letterheads (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(btrim(name)) > 1),
  tpl        jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

comment on table public.letterheads is
  'كليشاتُ تصدير الخطبة المفردة: رأسٌ وذيلٌ وهوامشُ وخلفية (ملاحظة ٤٠٩)';

alter table public.letterheads enable row level security;
drop policy if exists "read letterheads" on public.letterheads;
create policy "read letterheads" on public.letterheads for select
  using (public.my_role() is not null);
grant select on public.letterheads to authenticated;

create or replace function public.letterhead_list()
returns table (id uuid, name text, is_default boolean, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select l.id, l.name, l.is_default, l.updated_at
    from public.letterheads l
   where public.my_role() is not null
   order by l.is_default desc, l.name
$$;
grant execute on function public.letterhead_list() to authenticated;

create or replace function public.letterhead_get(p_id uuid)
returns table (id uuid, name text, is_default boolean, tpl jsonb)
language sql stable security definer set search_path = public as $$
  select l.id, l.name, l.is_default, l.tpl
    from public.letterheads l
   where l.id = p_id and public.my_role() is not null
$$;
grant execute on function public.letterhead_get(uuid) to authenticated;

create or replace function public.save_letterhead(
  p_id uuid, p_name text, p_tpl jsonb, p_default boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (public.is_manager() or public.is_admin_for('arch_edit')) then
    raise exception 'تصميمُ الكليشات بإذن مدير المشروع' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then
    raise exception 'اكتبْ اسمَ الكليشة';
  end if;
  if p_id is null then
    insert into public.letterheads (name, tpl, is_default, updated_by)
    values (btrim(p_name), coalesce(p_tpl, '{}'::jsonb), coalesce(p_default, false), auth.uid())
    returning id into v_id;
  else
    update public.letterheads
       set name = btrim(p_name), tpl = coalesce(p_tpl, tpl),
           is_default = coalesce(p_default, is_default),
           updated_at = now(), updated_by = auth.uid()
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'لا كليشةَ بهذا المعرِّف'; end if;
  end if;
  if coalesce(p_default, false) then
    update public.letterheads set is_default = (id = v_id);
  end if;
  perform public.log_admin('letterhead_save', null,
    jsonb_build_object('id', v_id, 'name', btrim(p_name)));
  return v_id;
end $$;
grant execute on function public.save_letterhead(uuid, text, jsonb, boolean) to authenticated;

create or replace function public.delete_letterhead(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_manager() or public.is_admin_for('arch_edit')) then
    raise exception 'حذفُ الكليشات بإذن مدير المشروع' using errcode = '42501';
  end if;
  delete from public.letterheads where id = p_id;
  perform public.log_admin('letterhead_delete', null, jsonb_build_object('id', p_id));
end $$;
grant execute on function public.delete_letterhead(uuid) to authenticated;

-- وقوالبُ التصدير كلُّها في قائمةٍ واحدة: مجمَّعاتٌ وكليشات (ملاحظة ٤١٢)
create or replace function public.export_templates()
returns table (id uuid, name text, kind text, is_default boolean, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, 'book'::text, t.is_default, t.updated_at
    from public.book_templates t where public.my_role() is not null
  union all
  select l.id, l.name, 'letterhead'::text, l.is_default, l.updated_at
    from public.letterheads l where public.my_role() is not null
  order by 3, 4 desc, 2
$$;
grant execute on function public.export_templates() to authenticated;

comment on function public.export_templates() is
  'قوالبُ التصدير: مجمَّعاتُ العام وكليشاتُ الخطبة المفردة (ملاحظة ٤١٢)';

-- ---------------------------------------------------------------------
-- ٢) البطاقة: أجلٌ يُطبَع عليها، وظهورٌ لصاحبها (ملاحظة ٤٠٢)
-- ---------------------------------------------------------------------
alter table public.member_cards
  add column if not exists hidden boolean not null default false,
  add column if not exists hidden_at timestamptz,
  add column if not exists hidden_by uuid references public.profiles (id);

comment on column public.member_cards.hidden is
  'البطاقةُ معتمَدةٌ ولا تظهر لصاحبها حتى تُعاد (ملاحظة ٤٠٢)';

-- الإصدارُ بمدّة: ثلاثةُ أشهرٍ أو ستةٌ أو أجلٌ يُكتَب
create or replace function public.issue_member_cards_until(
  p_members uuid[], p_months int default null, p_until date default null
) returns int language plpgsql security definer set search_path = public as $$
declare v_until date; v_n int;
begin
  if not (public.is_manager() or public.is_admin_for('cards')) then
    raise exception 'اعتمادُ البطاقات بإذن' using errcode = '42501';
  end if;
  v_until := coalesce(p_until,
    case when p_months is not null and p_months > 0
         then (current_date + (p_months || ' month')::interval)::date end);
  insert into public.member_cards (member_id, issued_at, issued_by, valid_until, hidden)
  select m, now(), auth.uid(), v_until, false from unnest(p_members) m
  on conflict (member_id) do update
     set issued_at = now(), issued_by = auth.uid(),
         valid_until = excluded.valid_until, hidden = false;
  get diagnostics v_n = row_count;
  perform public.log_admin('cards_issue', null,
    jsonb_build_object('n', v_n, 'until', v_until));
  return v_n;
end $$;
grant execute on function public.issue_member_cards_until(uuid[], int, date) to authenticated;

create or replace function public.hide_member_card(p_member uuid, p_hidden boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_manager() or public.is_admin_for('cards')) then
    raise exception 'إظهارُ البطاقة وإخفاؤها بإذن' using errcode = '42501';
  end if;
  update public.member_cards
     set hidden = coalesce(p_hidden, false),
         hidden_at = case when coalesce(p_hidden, false) then now() end,
         hidden_by = case when coalesce(p_hidden, false) then auth.uid() end
   where member_id = p_member;
  if not found then raise exception 'لا بطاقةَ معتمَدةٌ لهذا العضو'; end if;
  perform public.log_admin('card_hide', p_member,
    jsonb_build_object('hidden', coalesce(p_hidden, false)));
  return coalesce(p_hidden, false);
end $$;
grant execute on function public.hide_member_card(uuid, boolean) to authenticated;

-- ومن تظهر له البطاقةُ اليومَ ومن لا تظهر، ولِمَ
create or replace function public.card_visibility()
returns table (member_id uuid, full_name text, track text, role text,
               issued_at timestamptz, valid_until date, hidden boolean,
               expired boolean, shows boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, coalesce(p.track, 'translation')::text, p.role::text,
         c.issued_at, c.valid_until, c.hidden,
         (c.valid_until is not null and c.valid_until < current_date),
         (not c.hidden
          and (c.valid_until is null or c.valid_until >= current_date))
    from public.member_cards c
    join public.profiles p on p.id = c.member_id
   where public.is_manager() or public.is_admin_for('cards')
   order by p.full_name
$$;
grant execute on function public.card_visibility() to authenticated;

-- ---------------------------------------------------------------------
-- ٣) التعطيلُ يُقيَّد سببُه (ملاحظة ٤٠٣)
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists disabled_reason text,
  add column if not exists disabled_at timestamptz;

comment on column public.profiles.disabled_reason is
  'سببُ تعطيل الحساب، يُكتَب عند التعطيل (ملاحظة ٤٠٣)';

create or replace function public.set_member_disabled(
  p_member uuid, p_off boolean, p_why text default null
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'تعطيلُ الحسابات بإذن' using errcode = '42501';
  end if;
  if coalesce(p_off, false) and length(btrim(coalesce(p_why, ''))) < 3 then
    raise exception 'اكتبْ سببَ التعطيل';
  end if;
  update public.profiles
     set status = (case when coalesce(p_off, false) then 'disabled' else 'active' end)::public.member_status,
         disabled_reason = case when coalesce(p_off, false) then btrim(p_why) end,
         disabled_at = case when coalesce(p_off, false) then now() end
   where id = p_member;
  if not found then raise exception 'لا عضوَ بهذا المعرِّف'; end if;
  perform public.log_admin(
    case when coalesce(p_off, false) then 'member_disable' else 'member_enable' end,
    p_member, jsonb_build_object('why', btrim(coalesce(p_why, ''))));
  return coalesce(p_off, false);
end $$;
grant execute on function public.set_member_disabled(uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- ٤) التصديرُ المجمَّع: عدَدُ الخطب والصفحاتِ قبل البناء (ملاحظة ٤١٣)
--
--   يُحسَب تقديرُ الصفحات من طول النصِّ: نحوُ ألفَين وأربعِمئة حرفٍ في
--   الصفحة على كليشة الهيئة، ولكلِّ نسخةٍ صفحةٌ على الأقلّ لأنها تبدأ
--   صفحةً جديدة.
-- ---------------------------------------------------------------------
create or replace function public.arch_export_count(
  p_year int, p_langs text[] default null, p_month int default null,
  p_mosque text default null, p_section uuid default null
) returns table (sermons int, versions int, pages int)
language sql stable security definer set search_path = public as $$
  with v as (
    select m.id as sermon_id, v.language_code,
           length(coalesce(v.body_html, '')) as n
      from public.arch_sermons m
      join public.arch_versions v on v.sermon_id = m.id
     where (public.is_manager() or public.is_admin_for('arch_export')
            or public.is_admin() or public.is_supervisor() or public.is_viewer())
       and m.h_year = p_year
       and (p_langs is null or v.language_code = any (p_langs))
       and (p_month is null
            or public.hijri_month(coalesce(m.sermon_date, m.friday_on)) = p_month)
       and (p_mosque is null or m.mosque = p_mosque)
       and (p_section is null or m.section_id = p_section)
  )
  select count(distinct v.sermon_id)::int,
         count(*)::int,
         coalesce(sum(greatest(1, ceil(v.n / 2400.0))), 0)::int
    from v
$$;
grant execute on function public.arch_export_count(int, text[], int, text, uuid) to authenticated;

comment on function public.arch_export_count(int, text[], int, text, uuid) is
  'عددُ الخطب والنسخ وتقديرُ الصفحات قبل التصدير (ملاحظة ٤١٣)';

-- وخطبُ العام بلغاتها معًا: يُبنى منها المخرَجُ المرتَّب بالجمعة
--   (العربيةُ ثمَّ لغاتُها المتفرِّعة) — ملاحظة ٤١٣
create or replace function public.arch_book_all(
  p_year int, p_langs text[] default null, p_month int default null,
  p_mosque text default null, p_section uuid default null
) returns table (seq int, week_no int, title text, khateeb text, mosque text,
                 sermon_type text, sermon_date date, hijri_text text,
                 body_html text, doc_no text, title_tr text, h_month int,
                 language_code text, is_source boolean)
language sql stable security definer set search_path = public as $$
  select m.seq, m.week_no, m.title, m.khateeb, m.mosque, m.sermon_type,
         m.sermon_date, m.hijri_text, v.body_html, v.doc_no, v.title_tr,
         public.hijri_month(coalesce(m.sermon_date, m.friday_on)),
         v.language_code, coalesce(v.is_source, v.language_code = 'ar')
    from public.arch_sermons m
    join public.arch_versions v on v.sermon_id = m.id
   where (public.is_manager() or public.is_admin_for('arch_export')
          or public.is_admin() or public.is_supervisor() or public.is_viewer())
     and m.h_year = p_year
     and (p_langs is null or v.language_code = any (p_langs))
     and (p_month is null
          or public.hijri_month(coalesce(m.sermon_date, m.friday_on)) = p_month)
     and (p_mosque is null or m.mosque = p_mosque)
     and (p_section is null or m.section_id = p_section)
   order by coalesce(m.sermon_date, date '9999-12-31'), m.seq, m.mosque,
            (v.language_code <> 'ar'), v.language_code
$$;
grant execute on function public.arch_book_all(int, text[], int, text, uuid) to authenticated;

comment on function public.arch_book_all(int, text[], int, text, uuid) is
  'خطبُ العام بكلِّ لغاتها مرتَّبةً بالجمعة ثمَّ العربيةِ فلغاتها (ملاحظة ٤١٣)';

notify pgrst, 'reload schema';
