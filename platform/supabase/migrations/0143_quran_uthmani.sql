-- =====================================================================
-- ٠١٤٣ — إدراجُ الآيات بالرسم العثمانيِّ من مصدرٍ واحدٍ لا من الذاكرة
--        (ملاحظة ٥٠٠)
--
--   المترجمُ يكتب الآيةَ من حفظه أو ينسخها من موقعٍ في الشبكة، فيقع
--   في الرسم ما يقع، ويختلف الشكلُ من خطبةٍ إلى خطبة. والآيةُ لا يُتسامح
--   فيها كما يُتسامح في غيرها.
--
--   فصار النصُّ القرآنيُّ في جدولٍ عندنا — في خادم الرياض، لا يُستدعى
--   من شبكةٍ خارجية — يُدرَج منه إدراجًا مغلقًا: المترجمُ يختار السورةَ
--   والآيةَ فتُكتَب كما هي، ولا يُحرَّر نصُّها في المحرر. ثمَّ يُراجَع
--   المحفوظُ في الخادم: كلُّ آيةٍ موسومةٍ تُقابَل بأصلها، فإن خولفت رُدَّت.
--   ويُكشَف ما كُتب بالأيدي: نصٌّ يطابق آيةً ولم يُوسَم، فيُنبَّه عليه.
--
--   والحديثُ ليس كذلك: يُكتَب في المتن كسائر الكلام، ولا منتقِيَ له.
--   وللمترجم أن يترجم المعنى دون إدراج الآية، فالإدراجُ إتاحةٌ لا إلزام.
-- =====================================================================

-- ـــ ١) المصحفُ: سورةٌ وآيةٌ ونصُّها بالرسم العثماني
create table if not exists public.quran_ayat (
  sura      int  not null check (sura between 1 and 114),
  aya       int  not null check (aya between 1 and 286),
  text_uthmani text not null,
  text_plain   text not null,        -- بلا شكلٍ ولا تطويل، للبحث والمقابلة
  primary key (sura, aya)
);

create table if not exists public.quran_suras (
  sura int primary key check (sura between 1 and 114),
  name_ar text not null,
  ayat int not null
);

alter table public.quran_ayat  enable row level security;
alter table public.quran_suras enable row level security;
drop policy if exists "read ayat" on public.quran_ayat;
create policy "read ayat" on public.quran_ayat for select to authenticated using (true);
drop policy if exists "read suras" on public.quran_suras;
create policy "read suras" on public.quran_suras for select to authenticated using (true);

comment on table public.quran_ayat is
  'نصُّ القرآن بالرسم العثمانيِّ، مصدرُ الإدراج والمقابلة (ملاحظة ٥٠٠)';

-- ـــ ٢) التجريدُ: يُسقَط الشكلُ والتطويلُ وتُوحَّد الألفُ والياءُ والهمزة
--   ليُقابَل المكتوبُ بالمحفوظ وإن اختلف ضبطُه
create or replace function public.ar_plain(p text)
returns text language sql immutable set search_path = public as $fn$
  select nullif(btrim(regexp_replace(
    regexp_replace(
      translate(
        -- الحركاتُ والسكونُ والتنوينُ وعلاماتُ الوقف والتطويلُ وعلاماتُ الاتجاه
        regexp_replace(coalesce(p, ''),
          E'[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640\u200C-\u200F]',
          '', 'g'),
        E'\u0623\u0625\u0622\u0649\u0626\u0624\u0629\u0671',
        E'\u0627\u0627\u0627\u064A\u064A\u0648\u0647\u0627'),
      E'[^\u0621-\u064A ]+', ' ', 'g'),
    ' +', ' ', 'g')), '')
$fn$;
grant execute on function public.ar_plain(text) to authenticated;

comment on function public.ar_plain(text) is
  'تجريدُ النصِّ العربيِّ من الشكل والتطويل لتُقابَل به الآيات (ملاحظة ٥٠٠)';

-- والنصُّ المجرَّدُ يُملأ تلقائيًّا عند التحميل، فلا يُنسى
create or replace function public.quran_plain_fill()
returns trigger language plpgsql set search_path = public as $$
begin
  new.text_plain := coalesce(public.ar_plain(new.text_uthmani), '');
  return new;
end $$;
drop trigger if exists quran_plain_fill on public.quran_ayat;
create trigger quran_plain_fill before insert or update of text_uthmani
  on public.quran_ayat for each row execute function public.quran_plain_fill();


-- ـــ ٣) هل حُمِّل المصحفُ بعد؟ الشاشةُ تسأل قبل أن تعرض زرَّ الإدراج
create or replace function public.quran_ready()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ayat',  (select count(*) from public.quran_ayat),
    'suras', (select count(*) from public.quran_suras),
    'ready', (select count(*) from public.quran_ayat) >= 6236)
$$;
grant execute on function public.quran_ready() to authenticated;

-- ـــ ٤) الانتقاءُ: بالمرجع أو بالبحث في النصّ
create or replace function public.quran_pick(
  p_sura int default null, p_from int default null, p_to int default null,
  p_q text default null, p_limit int default 20)
returns table (sura int, aya int, sura_name text, text_uthmani text)
language sql stable security definer set search_path = public as $$
  select a.sura, a.aya, s.name_ar, a.text_uthmani
    from public.quran_ayat a
    left join public.quran_suras s on s.sura = a.sura
   where auth.uid() is not null
     and (p_sura is null or a.sura = p_sura)
     and (p_from is null or a.aya >= p_from)
     and (p_to   is null or a.aya <= p_to)
     and (nullif(btrim(coalesce(p_q, '')), '') is null
          or a.text_plain like '%' || public.ar_plain(p_q) || '%')
   order by a.sura, a.aya
   limit least(greatest(coalesce(p_limit, 20), 1), 300)
$$;
grant execute on function public.quran_pick(int, int, int, text, int) to authenticated;

comment on function public.quran_pick(int, int, int, text, int) is
  'انتقاءُ الآيات للإدراج: بالمرجع أو بالبحث في النصّ (ملاحظة ٥٠٠)';

-- ـــ ٥) المراجعةُ في الخادم: الموسومُ يُقابَل بأصله، والمكتوبُ بالأيدي يُكشَف
--
--   p_spans مصفوفةُ كائناتٍ: { ref: "2:255-257", text: "النصُّ كما في المحرر" }
--   وp_body نصُّ الخطبة كلِّه مجرَّدًا من الوسوم، يُلتمَس فيه ما يطابق آيةً
-- p_min أقلُّ طولٍ يُلتمَس به التطابق: ثلاثون حرفًا في العمل، فما دونها
--   تشترك فيه عباراتٌ كثيرةٌ ليست قرآنًا. ويُخفَّض في الاختبار وحدَه
create or replace function public.check_ayat(p_spans jsonb, p_body text default null,
                                             p_min int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  e jsonb; v_ref text; v_s int; v_a1 int; v_a2 int;
  v_src text; v_got text; v_bad jsonb := '[]'::jsonb; v_typed jsonb := '[]'::jsonb;
  v_plain text; r record;
begin
  if auth.uid() is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if (select count(*) from public.quran_ayat) = 0 then
    return jsonb_build_object('ready', false, 'bad', v_bad, 'typed', v_typed);
  end if;

  -- أ) الموسومُ يُقابَل بأصله
  if p_spans is not null and jsonb_typeof(p_spans) = 'array' then
    for e in select * from jsonb_array_elements(p_spans) loop
      v_ref := coalesce(e ->> 'ref', '');
      if v_ref !~ '^\d{1,3}:\d{1,3}(-\d{1,3})?$' then
        v_bad := v_bad || jsonb_build_object('ref', v_ref, 'why', 'مرجعٌ غيرُ صحيح');
        continue;
      end if;
      v_s  := split_part(v_ref, ':', 1)::int;
      v_a1 := split_part(split_part(v_ref, ':', 2), '-', 1)::int;
      v_a2 := coalesce(nullif(split_part(split_part(v_ref, ':', 2), '-', 2), '')::int, v_a1);
      select string_agg(public.ar_plain(a.text_uthmani), ' ' order by a.aya)
        into v_src from public.quran_ayat a
       where a.sura = v_s and a.aya between v_a1 and v_a2;
      if v_src is null then
        v_bad := v_bad || jsonb_build_object('ref', v_ref, 'why', 'لا آيةَ بهذا المرجع');
        continue;
      end if;
      v_got := public.ar_plain(coalesce(e ->> 'text', ''));
      -- وتُطرَح أقواسُ التزيين وأرقامُ الآي من المقابلة
      if coalesce(v_got, '') <> v_src then
        v_bad := v_bad || jsonb_build_object('ref', v_ref, 'why', 'النصُّ خولف عن أصله');
      end if;
    end loop;
  end if;

  -- ب) المكتوبُ بالأيدي: نصٌّ يطابق آيةً ولم يُوسَم
  v_plain := public.ar_plain(coalesce(p_body, ''));
  if v_plain is not null and length(v_plain) >= greatest(coalesce(p_min, 30), 8) then
    for r in
      select a.sura, a.aya, s.name_ar, a.text_uthmani
        from public.quran_ayat a
        left join public.quran_suras s on s.sura = a.sura
       where length(a.text_plain) >= greatest(coalesce(p_min, 30), 8)
         and position(a.text_plain in v_plain) > 0
       order by length(a.text_plain) desc
       limit 10
    loop
      v_typed := v_typed || jsonb_build_object(
        'ref', r.sura || ':' || r.aya, 'sura', r.name_ar, 'aya', r.aya,
        'text', r.text_uthmani);
    end loop;
  end if;

  return jsonb_build_object('ready', true, 'bad', v_bad, 'typed', v_typed);
end $$;
grant execute on function public.check_ayat(jsonb, text, int) to authenticated;

comment on function public.check_ayat(jsonb, text, int) is
  'مقابلةُ الآيات الموسومة بأصولها، وكشفُ ما كُتب منها بالأيدي (ملاحظة ٥٠٠)';

notify pgrst, 'reload schema';
