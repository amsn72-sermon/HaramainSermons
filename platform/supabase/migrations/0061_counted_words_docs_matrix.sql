-- =====================================================================
-- 0061 — الكلماتُ المحتسَبة، ومصفوفةُ تدقيق المستندات (ملاحظة ١٩٩)
--
--   أولًا: الكلمات. العقدُ لا يحتسب كلماتِ الترجمة، وإنما كلماتِ النص
--   العربي الأصل، وللنصوص دون الخطب — فالخطبةُ بالمقطوعية لكل لغة.
--   وكانت المنصة تعرض «الكلمات المترجَمة» وهي عددُ كلمات المخرَج، فلا
--   يُقاس عليها شيء ولا يُطالَب بها. فيُضاف إلى دليل الإنتاج عمودُ
--   كلمات الأصل، ويُضاف عدّادٌ للمحتسَب وحده.
--
--   ثانيًا: تدقيق المستندات. كان الكشفُ بطاقاتٍ لما رُفع وانتظر التدقيق،
--   فلا يُرى منه حالُ الفريق كلِّه في موضعٍ واحد. فتُبنى مصفوفةٌ: صفٌّ
--   لكل حساب، وعمودٌ لكل بيان، وحالُ كلِّ خانةٍ ثلاث: اكتمل، أو تحت
--   التدقيق، أو لم يُرفع. ومعها تذكيرٌ يُرسَل لمن لم تكتمل بياناتُه،
--   ويبقى أثرُه فيُعرف متى ذُكِّر آخر مرة.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) دليل الإنتاج: كلماتُ الأصل العربي بجانب كلمات المخرَج
-- ---------------------------------------------------------------------
drop view if exists public.production_rows;
create view public.production_rows with (security_invoker = true) as
select t.id                                   as track_id,
       m.id                                   as material_id,
       m.title,
       m.material_type,
       m.sermon_type,
       m.mosque,
       m.sermon_date,
       m.created_at                           as added_at,
       t.language_code,
       t.status,
       t.completed_at,
       t.published_at,
       -- كلماتُ الأصل العربي: هي وحدها ما يحتسب به العقد (ملاحظة ١٩٩)
       coalesce(m.source_words,
                public.count_words(public.plain_text(m.source_html)), 0)  as source_words,
       (m.material_type <> 'خطب')                                         as counts_by_word,
       -- وكلماتُ المخرَج تبقى للقياس الداخلي لا للاحتساب
       case when public.plain_text(t.translation_html) = '' then 0
            else array_length(regexp_split_to_array(public.plain_text(t.translation_html), '\s+'), 1) end as words,
       length(public.plain_text(t.translation_html))::int as chars,
       coalesce(
         (select sum(a.duration_seconds)::int from public.track_audios a
           where a.track_id = t.id and a.is_approved and a.duration_seconds is not null),
         (select a.duration_seconds from public.track_audios a
           where a.track_id = t.id and a.path = t.audio_path and a.duration_seconds is not null
           order by a.created_at desc limit 1),
         (select a.duration_seconds from public.track_audios a
           where a.track_id = t.id and a.duration_seconds is not null
           order by a.created_at desc limit 1),
         0)                                   as audio_seconds
from public.tracks t
join public.materials m on m.id = t.material_id
where t.deleted_at is null and m.deleted_at is null;

grant select on public.production_rows to authenticated;

comment on view public.production_rows
  is 'دليل الإنتاج: صفٌّ لكل لغة من كل مادة — كلماتُ الأصل المحتسَبة، وكلماتُ المخرَج للقياس، ومدةُ التسجيل (ملاحظتا ٩٠ و١٩٩)';

-- والمجاميعُ تُعيد كلماتِ الأصل للنصوص دون الخطب
drop function if exists public.production_totals();
create function public.production_totals()
returns table (materials int, tracks int, words bigint, source_words bigint,
               counted_words bigint, chars bigint, audio_seconds bigint, languages int)
language sql stable set search_path = public as $$
  select count(distinct material_id)::int,
         count(*)::int,
         coalesce(sum(words), 0)::bigint,
         coalesce(sum(source_words), 0)::bigint,
         -- المحتسَبُ يُقاس على المنجَز لا على ما له مخرَج، فيُؤخذ من الدليل كلِّه
         (select coalesce(sum(r.source_words), 0)::bigint
            from public.production_rows r
           where r.counts_by_word and r.status = 'completed'),
         coalesce(sum(chars), 0)::bigint,
         coalesce(sum(audio_seconds), 0)::bigint,
         count(distinct language_code)::int
  from public.production_rows
  where words > 0 or audio_seconds > 0
$$;
grant execute on function public.production_totals() to authenticated;

comment on function public.production_totals()
  is 'مجاميع دليل الإنتاج: والمحتسَبُ منها كلماتُ الأصل للنصوص المنجَزة دون الخطب (ملاحظة ١٩٩)';

-- ---------------------------------------------------------------------
-- ٢) تدقيق المستندات: متى ذُكِّر العضو آخرَ مرة
-- ---------------------------------------------------------------------
alter table public.profile_private
  add column if not exists reminded_at timestamptz,
  add column if not exists reminded_by uuid references public.profiles (id),
  add column if not exists remind_count int not null default 0;

comment on column public.profile_private.reminded_at is
  'آخر تذكيرٍ أُرسل إلى العضو باستكمال بياناته (ملاحظة ١٩٩)';

-- ---------------------------------------------------------------------
-- ٣) المصفوفة: صفٌّ لكل حساب، وحالُ كل بيانٍ فيه
--    'ok' اكتمل · 'review' تحت التدقيق · 'bad' أُعيد · 'none' لم يُرفع
-- ---------------------------------------------------------------------
create or replace function public.member_data_matrix()
returns table (member_id uuid, full_name text, email text, member_no text,
               role text, track text, city text, status text,
               photo text, iqama text, national_id text, whatsapp text,
               nationality text, residence text, languages text, city_state text,
               bank text, data_status text, data_note text,
               missing int, waiting int, complete boolean,
               reminded_at timestamptz, remind_count int)
language sql stable security definer set search_path = public as $$
  with base as (
    select p.id, p.full_name, p.email, p.member_no, p.role::text as role,
           coalesce(p.track, 'translation') as track, p.city, p.status::text as status,
           v.photo_path, v.photo_status::text as photo_status,
           v.iqama_path, v.iqama_status::text as iqama_status,
           v.national_id, v.whatsapp, v.nationality, v.residence,
           v.data_status, v.data_note, v.reminded_at, coalesce(v.remind_count, 0) as remind_count,
           (select count(*) from public.member_languages ml where ml.member_id = p.id) as lang_n,
           (b.member_id is not null) as has_bank, (b.verified_at is not null) as bank_ok
      from public.profiles p
      left join public.profile_private v on v.id = p.id
      left join public.bank_accounts b on b.member_id = p.id
     where public.is_admin() and p.status <> 'disabled'
  ), st as (
    select b.*,
      case when b.photo_path is null then 'none'
           when coalesce(b.photo_status, 'pending') = 'approved' then 'ok'
           when b.photo_status = 'rejected' then 'bad'
           else 'review' end as photo_s,
      case when b.iqama_path is null then 'none'
           when coalesce(b.iqama_status, 'pending') = 'approved' then 'ok'
           when b.iqama_status = 'rejected' then 'bad'
           else 'review' end as iqama_s,
      case when coalesce(trim(b.national_id), '') = '' then 'none' else 'ok' end as nid_s,
      case when coalesce(trim(b.whatsapp), '') = '' then 'none' else 'ok' end as wa_s,
      case when coalesce(trim(b.nationality), '') = '' then 'none' else 'ok' end as nat_s,
      case when coalesce(trim(b.residence), '') = '' then 'none' else 'ok' end as res_s,
      case when b.track not in ('translation', 'field') then 'na'
           when b.lang_n > 0 then 'ok' else 'none' end as lang_s,
      case when b.track <> 'field' then 'na'
           when b.city is not null then 'ok' else 'none' end as city_s,
      case when not b.has_bank then 'none'
           when b.bank_ok then 'ok' else 'review' end as bank_s
    from base b
  )
  select id, full_name, email, member_no, role, track, city, status,
         photo_s, iqama_s, nid_s, wa_s, nat_s, res_s, lang_s, city_s, bank_s,
         coalesce(data_status, 'none'), data_note,
         (select count(*) from unnest(array[photo_s, iqama_s, nid_s, wa_s, nat_s,
                                            res_s, lang_s, city_s]) x
           where x in ('none', 'bad'))::int,
         (select count(*) from unnest(array[photo_s, iqama_s, bank_s]) x
           where x = 'review')::int,
         not exists (select 1 from unnest(array[photo_s, iqama_s, nid_s, wa_s, nat_s,
                                                res_s, lang_s, city_s]) x
                      where x in ('none', 'bad', 'review')),
         reminded_at, remind_count
    from st
   order by (select count(*) from unnest(array[photo_s, iqama_s, nid_s, wa_s, nat_s,
                                               res_s, lang_s, city_s]) x
              where x in ('none', 'bad')) desc,
            full_name
$$;
grant execute on function public.member_data_matrix() to authenticated;

comment on function public.member_data_matrix()
  is 'مصفوفةُ بيانات الفريق: صفٌّ لكل حساب وحالُ كل بيانٍ فيه — اكتمل أو تحت التدقيق أو لم يُرفع (ملاحظة ١٩٩)';

-- ---------------------------------------------------------------------
-- ٤) التذكير: يُرسَل لمن لم تكتمل بياناتُه، ويبقى أثرُه
-- ---------------------------------------------------------------------
do $$
begin
  alter table public.notifications drop constraint if exists notifications_kind_check;
  alter table public.notifications add constraint notifications_kind_check
    check (kind in ('assigned', 'track_completed', 'returned', 'reminder', 'data_reminder'));
end $$;

create or replace function public.remind_profile_data(p_members uuid[] default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; v_n int := 0; v_id uuid; v_missing text[];
begin
  if not public.is_admin() then
    raise exception 'التذكير للإدارة' using errcode = '42501';
  end if;

  -- بلا تحديدٍ: كلُّ من نقص بيانُه
  if p_members is null or array_length(p_members, 1) is null then
    select array_agg(member_id) into v_ids
      from public.member_data_matrix() where missing > 0;
  else
    select array_agg(m.member_id) into v_ids
      from public.member_data_matrix() m
     where m.member_id = any (p_members) and m.missing > 0;
  end if;
  if v_ids is null then return 0; end if;

  foreach v_id in array v_ids loop
    v_missing := public.profile_missing(v_id);
    if coalesce(array_length(v_missing, 1), 0) = 0 then continue; end if;

    insert into public.notifications (member_id, kind, subject, body)
    values (v_id, 'data_reminder',
            'استكمال بياناتك',
            'بقي من بياناتك: ' || array_to_string(v_missing, '، ')
              || '. تُستكمل من شاشة «بياناتي»، ولا تُعتمد حتى تُدقَّق.');

    update public.profile_private
       set reminded_at = now(), reminded_by = auth.uid(),
           remind_count = coalesce(remind_count, 0) + 1
     where id = v_id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
grant execute on function public.remind_profile_data(uuid[]) to authenticated;

comment on function public.remind_profile_data(uuid[]) is
  'تذكيرُ من لم تكتمل بياناتُه، ويُحفظ وقتُ التذكير وعددُه فلا يضيع أثرُه (ملاحظة ١٩٩)';

notify pgrst, 'reload schema';
