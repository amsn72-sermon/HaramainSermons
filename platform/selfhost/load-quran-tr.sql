-- تحميلُ ترجمةٍ معتمَدةٍ للآيات (ملاحظة ٥٠٢)
--   يُنتظَر ملفٌّ كلُّ سطرٍ فيه: سورة|آية|النص — كصيغة نصِّ المصحف
--   ويُستدعى بمتغيِّراته:
--     psql -v lang=en -v title='...' -v translator='...' -v source='...' -f هذا الملف
\set ON_ERROR_STOP on
begin;

create temp table tr_raw (line text);
\copy tr_raw from '/tmp/tr.txt' with (format text)

-- اللغةُ الواحدةُ ترجمةٌ واحدة: ما كان لها قبلُ يُرفَع ويحلُّ الجديدُ محلَّه
delete from public.quran_tr where lang = :'lang';

insert into public.quran_tr (lang, sura, aya, text)
select :'lang', (m[1])::int, (m[2])::int, btrim(m[3])
  from (select regexp_match(line, '^([0-9]{1,3})\|([0-9]{1,3})\|(.+)$') m
          from tr_raw) s
 where m is not null
on conflict (lang, sura, aya) do update set text = excluded.text;

insert into public.quran_tr_editions (lang, title, translator, source, loaded_at, ayat)
values (:'lang', :'title', nullif(:'translator', ''), nullif(:'source', ''), now(), 0)
on conflict (lang) do update
  set title = excluded.title, translator = excluded.translator,
      source = excluded.source, loaded_at = now();

select public.quran_tr_count();

commit;

select lang, title, translator, ayat from public.quran_tr_editions order by lang;
