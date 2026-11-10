-- =====================================================================
-- ٠١٣٨ — باركودُ الخطبة يفتح الخطبةَ نفسَها (ملاحظة ٤٩١)
--
--   كان مسحُ رقم التوثيق يُظهر وصفَ العمل وتاريخَ اعتماده لا غير، وهو
--   أصلُه (ملاحظة ١٣٤): إثباتٌ لا نشر. فصار معه النصُّ نفسُه للمنشورة
--   وحدَها، تُعرَض على كليشة الهيئة كما تُطبَع، فمن مسح الباركودَ قرأ
--   الخطبةَ من موضعها الموثَّق لا من نقلٍ عنها.
--
--   وغيرُ المنشورة تبقى كما كانت: وصفُها دون نصِّها، ويُقال إنها لم
--   تُنشر بعد. فالنشرُ قرارٌ لا يُتجاوَز بباركودٍ في ورقة.
-- =====================================================================

drop function if exists public.verify_doc(text);
create or replace function public.verify_doc(p_no text)
returns table (
  doc_no text, kind_label text, scope_label text, language text,
  language_code text, title text, khateeb text,
  mosque text, material_type text, sermon_type text,
  work_date date, documented_on date, is_published boolean,
  body_html text
) language sql stable security definer set search_path = public as $$
  select t.doc_no,
         coalesce(dt.label, m.material_type),
         case m.mosque when 'makkah' then 'المسجد الحرام' when 'madinah' then 'المسجد النبوي' else 'مادة عامة' end,
         l.name_ar,
         t.language_code,
         case when t.is_published then m.title else null end,
         case when t.is_published then k.name else null end,
         m.mosque, m.material_type, m.sermon_type,
         m.sermon_date,
         t.doc_no_at::date,
         t.is_published,
         -- النصُّ للمنشورة وحدَها
         case when t.is_published then t.translation_html else null end
    from public.tracks t
    join public.materials m on m.id = t.material_id
    left join public.languages l on l.code = t.language_code
    left join public.khateebs k on k.id = m.khateeb_id
    left join public.doc_type_codes dt
           on dt.material_type = m.material_type
          and coalesce(dt.sermon_type, '') = coalesce(m.sermon_type, '')
   where upper(replace(t.doc_no, ' ', '')) = upper(replace(trim(coalesce(p_no, '')), ' ', ''))
     and t.status = 'completed' and t.deleted_at is null and m.deleted_at is null
   limit 1
$$;
grant execute on function public.verify_doc(text) to anon, authenticated;

comment on function public.verify_doc(text) is
  'التحقّقُ من رقم التوثيق، ومعه نصُّ الخطبة إن كانت منشورةً (ملاحظتا ١٣٤ و٤٩١)';

notify pgrst, 'reload schema';
