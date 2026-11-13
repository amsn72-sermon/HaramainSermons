-- =====================================================================
-- ٠١٤٨ — ترجمةُ الآية المعتمَدةُ تُدرَج بنصِّها (ملاحظات ٢ و٣ و٤ من دفعة ٥٠٢)
--
--   أُدرِجت الآيةُ بالرسم العثمانيِّ من مصدرها، فبقي أن تُدرَج ترجمتُها
--   كذلك: لا يترجمها المترجمُ من عنده ولا تُصاغ هنا، بل تُؤخَذ الترجمةُ
--   المعتمَدةُ بنصِّها كما أُخذ النصُّ القرآني. ومصحفُ المدينة يعتمد
--   لكلِّ لغةٍ ترجمةً واحدةً لا غير، فلا انتقاءَ ولا اجتهاد.
--
--   وتُحمَّل الترجماتُ في خادم الرياض كما حُمِّل المصحف، كلُّ لغةٍ في
--   دفعةٍ، ويُسجَّل لكلِّ لغةٍ اسمُ ترجمتها ومصدرُها لتُعرَف الحجّة.
--   وما لا ترجمةَ محمَّلةَ له من لغات المشروع لا يُدرَج فيه شيء،
--   ويترجم المترجمُ معناها بنفسه — فالبابُ إتاحةٌ لا إلزام.
-- =====================================================================

-- ـــ ١) الترجماتُ المعتمَدة: لغةٌ وسورةٌ وآيةٌ ونصّ
create table if not exists public.quran_tr (
  lang text not null,
  sura int  not null check (sura between 1 and 114),
  aya  int  not null check (aya between 1 and 286),
  text text not null,
  primary key (lang, sura, aya)
);

-- وبيانُ كلِّ لغةٍ: اسمُ الترجمة المعتمَدة ومصدرُها ووقتُ تحميلها
create table if not exists public.quran_tr_editions (
  lang       text primary key,
  title      text not null,
  translator text,
  source     text,
  loaded_at  timestamptz not null default now(),
  ayat       int not null default 0
);

alter table public.quran_tr enable row level security;
alter table public.quran_tr_editions enable row level security;
drop policy if exists "read quran tr" on public.quran_tr;
create policy "read quran tr" on public.quran_tr for select to authenticated using (true);
drop policy if exists "read quran tr editions" on public.quran_tr_editions;
create policy "read quran tr editions" on public.quran_tr_editions for select
  to authenticated using (true);

comment on table public.quran_tr is
  'ترجماتُ الآيات المعتمَدةُ بنصِّها، لكلِّ لغةٍ واحدة (ملاحظة ٥٠٢)';
comment on table public.quran_tr_editions is
  'الترجمةُ المعتمَدةُ لكلِّ لغة: اسمُها ومترجمُها ومصدرُها (ملاحظة ٥٠٢)';

-- ـــ ٢) ما حُمِّل من اللغات، لتعرف الشاشةُ أين تُدرِج وأين تسكت
create or replace function public.quran_tr_ready()
returns table (lang text, title text, translator text, ayat int, loaded_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.lang, e.title, e.translator, e.ayat, e.loaded_at
    from public.quran_tr_editions e
   where auth.uid() is not null
   order by e.lang
$$;
grant execute on function public.quran_tr_ready() to authenticated;

-- ـــ ٣) الانتقاءُ مع ترجمته: الآيةُ بالعثمانيِّ وترجمتُها المعتمَدةُ معها
drop function if exists public.quran_pick(int, int, int, text, int);
create or replace function public.quran_pick(
  p_sura int default null, p_from int default null, p_to int default null,
  p_q text default null, p_limit int default 20, p_lang text default null)
returns table (sura int, aya int, sura_name text, text_uthmani text, tr text)
language sql stable security definer set search_path = public as $$
  select a.sura, a.aya, s.name_ar, a.text_uthmani, t.text
    from public.quran_ayat a
    left join public.quran_suras s on s.sura = a.sura
    left join public.quran_tr t
           on t.sura = a.sura and t.aya = a.aya
          and t.lang = nullif(btrim(coalesce(p_lang, '')), '')
   where auth.uid() is not null
     and (p_sura is null or a.sura = p_sura)
     and (p_from is null or a.aya >= p_from)
     and (p_to   is null or a.aya <= p_to)
     and (nullif(btrim(coalesce(p_q, '')), '') is null
          or a.text_plain like '%' || public.ar_plain(p_q) || '%')
   order by a.sura, a.aya
   limit least(greatest(coalesce(p_limit, 20), 1), 300)
$$;
grant execute on function public.quran_pick(int, int, int, text, int, text) to authenticated;

comment on function public.quran_pick(int, int, int, text, int, text) is
  'انتقاءُ الآيات للإدراج ومعها ترجمتُها المعتمَدةُ بلغة المسار (ملاحظتا ٥٠٠ و٥٠٢)';

-- ـــ ٤) وعددُ الآي في بيان اللغة يُصحَّح من الواقع بعد كلِّ تحميل
create or replace function public.quran_tr_count()
returns void language sql security definer set search_path = public as $$
  update public.quran_tr_editions e
     set ayat = coalesce((select count(*) from public.quran_tr t where t.lang = e.lang), 0)
$$;
revoke execute on function public.quran_tr_count() from public, anon, authenticated;

notify pgrst, 'reload schema';
