-- =====================================================================
-- ٠١٤١ — باركودٌ واحدٌ في رأس الكشف يفتح الكشفَ نفسَه (ملاحظة ٤٩٨)
--
--   في كلِّ صفٍّ من الكشف باركودُ صاحبه، يفتح وثيقةَ إثبات توقيعه
--   وحدَه. وبقي السؤال عن الورقة كلِّها: ما هذا الميثاقُ؟ ولمن هو؟
--   ومن وقَّع ومن لم يوقِّع يومَ طُبعت؟ فصار في رأس الكشف باركودٌ
--   واحدٌ يفتح صورةَ الكشف كما طُبع: نصُّ الميثاق، ونطاقُه، وأسماءُ
--   أهله وحالُ كلِّ واحدٍ منهم.
--
--   وهذا كشفٌ داخليٌّ فيه أرقامُ الهويات، فلا يُفتَح لمن مسحه من
--   الناس: لا يراه إلّا إداريٌّ في المنصة يملك مفتاحَ «كشوف التواقيع»،
--   ويُسجَّل كلُّ فتحٍ بصاحبه ووقته وعنوانه. وباركوداتُ الصفوف تبقى
--   على حالها، كلٌّ يفتح وثيقةَ صاحبه.
-- =====================================================================

-- ـــ ١) مفتاحُ الصلاحية الجديد
insert into public.perm_keys (key, label, sort, default_open)
values ('roster_view', 'كشوفُ التواقيع المطبوعة وفتحُها بالباركود',
        coalesce((select max(sort) + 1 from public.perm_keys), 1), false)
on conflict (key) do update set label = excluded.label;

-- ـــ ٢) صورةُ الكشف كما طُبع
create table if not exists public.roster_snapshots (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  policy_key   text not null,
  policy_version text not null,
  band         text,                 -- البابُ: إداريون، متخصصون، مكانيون…
  city         text,
  title        text,
  note         text,
  doc_text     text,                 -- نصُّ الميثاق بنسخته كما وُقِّع عليه
  rows         jsonb not null default '[]'::jsonb,
  n_rows       int not null default 0,
  n_signed     int not null default 0,
  created_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now()
);
create index if not exists roster_snapshots_at on public.roster_snapshots (created_at desc);

alter table public.roster_snapshots enable row level security;
-- ولا يُقرأ من العملاء مباشرةً: البابُ دالّةٌ تُسجِّل من فتح
drop policy if exists "no direct read roster" on public.roster_snapshots;

comment on table public.roster_snapshots is
  'صورةُ كشف التواقيع كما طُبع، يفتحها باركودُ الرأس (ملاحظة ٤٩٨)';

-- ـــ ٣) سجلُّ من فتح الكشف
create table if not exists public.roster_hits (
  roster_id  uuid not null references public.roster_snapshots (id) on delete cascade,
  member_id  uuid references public.profiles (id),
  at         timestamptz not null default now(),
  ip         inet,
  ok         boolean not null default true
);
create index if not exists roster_hits_at on public.roster_hits (roster_id, at desc);
alter table public.roster_hits enable row level security;
drop policy if exists "no direct read roster hits" on public.roster_hits;

comment on table public.roster_hits is
  'كلُّ فتحٍ لكشفٍ بباركود الرأس: من فتحه ومتى ومن أيِّ عنوان (ملاحظة ٤٩٨)';

-- ـــ ٤) حفظُ الصورة عند الطباعة، ورمزُها يُطبَع في الرأس
create or replace function public.make_roster(
  p_key text, p_version text, p_band text, p_city text,
  p_title text, p_note text, p_doc text, p_rows jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text; v_n int; v_s int; v_id uuid;
begin
  -- من يطبع الكشفَ هو من يراه: مفتاحُ كشوف التواقيع
  if not public.is_admin_for('roster_view') then
    raise exception 'كشفُ التواقيع لمن يملك مفتاحَه' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'الكشفُ بلا صفوف';
  end if;
  v_n := jsonb_array_length(p_rows);
  if v_n > 2000 then raise exception 'الكشفُ ألفا صفٍّ على الأكثر'; end if;
  select count(*) into v_s from jsonb_array_elements(p_rows) e
   where coalesce((e ->> 'signed')::boolean, false);

  -- رمزٌ عشريٌّ ستَّ عشريٌّ لا يُخمَّن، ويُعاد توليدُه عند التصادم
  for i in 1 .. 5 loop
    v_code := 'RS-' || upper(substr(encode(sha256(convert_to(
                auth.uid()::text || coalesce(p_key, '') || coalesce(p_version, '')
                || clock_timestamp()::text || i::text, 'UTF8')), 'hex'), 1, 10));
    exit when not exists (select 1 from public.roster_snapshots s where s.code = v_code);
    v_code := null;
  end loop;
  if v_code is null then raise exception 'تعذَّر توليدُ رمزٍ للكشف'; end if;

  insert into public.roster_snapshots
    (code, policy_key, policy_version, band, city, title, note, doc_text,
     rows, n_rows, n_signed, created_by)
  values (v_code, coalesce(nullif(btrim(p_key), ''), 'policy'),
          coalesce(nullif(btrim(p_version), ''), '1.0'),
          nullif(btrim(coalesce(p_band, '')), ''), nullif(btrim(coalesce(p_city, '')), ''),
          nullif(btrim(coalesce(p_title, '')), ''), nullif(btrim(coalesce(p_note, '')), ''),
          nullif(btrim(coalesce(p_doc, '')), ''), p_rows, v_n, v_s, auth.uid())
  returning id into v_id;

  perform public.log_admin('roster_make', null,
    jsonb_build_object('code', v_code, 'key', p_key, 'version', p_version, 'n', v_n));
  return v_code;
end $$;
grant execute on function public.make_roster(text, text, text, text, text, text, text, jsonb)
  to authenticated;

comment on function public.make_roster(text, text, text, text, text, text, text, jsonb) is
  'حفظُ صورة كشف التواقيع عند طباعته، وردُّ رمزِ باركود رأسه (ملاحظة ٤٩٨)';

-- ـــ ٥) فتحُ الكشف بالرمز: لإداريٍّ يملك المفتاح، ويُسجَّل فتحُه
create or replace function public.roster_proof(p_code text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v public.roster_snapshots; v_ok boolean;
begin
  if auth.uid() is null then
    raise exception 'يلزم الدخولُ إلى المنصة' using errcode = '42501';
  end if;
  v_ok := public.is_admin_for('roster_view');

  select * into v from public.roster_snapshots
   where code = upper(btrim(coalesce(p_code, '')))
     and length(btrim(coalesce(p_code, ''))) >= 8;

  -- ويُسجَّل الفتحُ قبل الردّ: المأذونُ والممنوعُ سواءٌ في التسجيل،
  --   فيُعرَف من حاول كما يُعرَف من رأى
  if v.id is not null then
    insert into public.roster_hits (roster_id, member_id, ip, ok)
    values (v.id, auth.uid(), public.request_ip(), v_ok);
  end if;

  -- والمنعُ يُردُّ ردًّا لا يُرمى خطأً: الخطأُ يُبطِل المعاملةَ فيذهب
  --   معها تسجيلُ المحاولة، ومقصودُنا أن تبقى محفوظةً على صاحبها
  if not v_ok then
    return jsonb_build_object('found', false, 'denied', true);
  end if;
  if v.id is null then return jsonb_build_object('found', false); end if;

  return jsonb_build_object(
    'found',      true,
    'code',       v.code,
    'title',      v.title,
    'note',       v.note,
    'band',       v.band,
    'city',       v.city,
    'policy_key', v.policy_key,
    'version',    v.policy_version,
    'doc_text',   v.doc_text,
    'n_rows',     v.n_rows,
    'n_signed',   v.n_signed,
    'created_at', v.created_at,
    'created_by', (select p.full_name from public.profiles p where p.id = v.created_by),
    'rows',       v.rows);
end $$;
grant execute on function public.roster_proof(text) to authenticated;

comment on function public.roster_proof(text) is
  'فتحُ كشف التواقيع برمز باركود رأسه، لإداريٍّ يملك مفتاحَه، ويُسجَّل فتحُه (ملاحظة ٤٩٨)';

-- ـــ ٦) ومن فتح الكشفَ يُعرَف: سجلُّ الفتح لمن يملك المفتاح
create or replace function public.roster_log(p_code text)
returns table (at timestamptz, member text, ok boolean, ip inet)
language sql stable security definer set search_path = public as $$
  select hh.at, p.full_name, hh.ok, hh.ip
    from public.roster_hits hh
    join public.roster_snapshots s on s.id = hh.roster_id
    left join public.profiles p on p.id = hh.member_id
   where s.code = upper(btrim(coalesce(p_code, '')))
     and public.is_admin_for('roster_view')
   order by hh.at desc
   limit 200
$$;
grant execute on function public.roster_log(text) to authenticated;

comment on function public.roster_log(text) is
  'سجلُّ من فتح كشفًا بباركود رأسه (ملاحظة ٤٩٨)';

notify pgrst, 'reload schema';
