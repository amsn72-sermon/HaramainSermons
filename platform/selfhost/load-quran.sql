-- تحميلُ نصِّ المصحف بالرسم العثمانيِّ من ملفِّ تنزيل (ملاحظة ٥٠٠)
--   يُنتظَر ملفٌّ كلُّ سطرٍ فيه: سورة|آية|النص
--   وما لا يوافق هذه الصورةَ — كذيل الملفِّ وحقوقه — يُترَك
\set ON_ERROR_STOP on
begin;

create temp table q_raw (line text);
\copy q_raw from '/tmp/quran.txt' with (format text)

insert into public.quran_ayat (sura, aya, text_uthmani, text_plain)
select (m[1])::int, (m[2])::int, btrim(m[3]), ''
  from (select regexp_match(line, '^([0-9]{1,3})\|([0-9]{1,3})\|(.+)$') m
          from q_raw) s
 where m is not null
on conflict (sura, aya) do update
  set text_uthmani = excluded.text_uthmani;

-- وعددُ الآي في جدول السور يُصحَّح من الواقع
update public.quran_suras s
   set ayat = x.n
  from (select sura, count(*)::int n from public.quran_ayat group by sura) x
 where x.sura = s.sura and x.n <> s.ayat;

commit;

select public.quran_ready();
