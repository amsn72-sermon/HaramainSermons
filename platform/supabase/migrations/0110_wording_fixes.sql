-- =====================================================================
-- 0110 — تصحيحُ عباراتٍ تخالف ما استقرَّ عليه الأمر
--
--   ١) صفحةُ «عن المبادرة» عامّةٌ تُقرأ خارج المنصة، وقد نُصَّ على ألا
--      يُذكر فيها شيءٌ ماديٌّ ولا تسعيرة، فالأمرُ داخليٌّ. وفيها اليوم
--      جملتان ماليّتان: «ولا يأخذ عليهما شيئًا» و«تُستثنى من الكميات
--      المحتسَبة». فيُبقى المعنى — لغتان زيادةً على المطلوب تُخدَمان
--      خدمةً كاملة وتُعرضان سطرًا مستقلًّا — ويُحذف ما سواه.
--
--   ٢) وصفُ عمود الدور كُتب فيه «(اطّلاع فقط)»، وقد نُصَّ على ألا
--      تُكتب، وأن يُقال «للمتابعة» (كما في 0088).
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) صفحةُ المبادرة: بيانٌ بلا ذكر مال
-- ---------------------------------------------------------------------
do $do$
declare v jsonb; v_s jsonb; v_blocks jsonb; v_b jsonb; v_nb jsonb;
        v_new jsonb := '[]'::jsonb; v_txt text; v_hit boolean := false;
        v_fix text :=
          'المطلوب في نطاق العمل إحدى عشرة لغةً بالخطبة الأسبوعية. '
       || 'وقد زاد فريق المشروع من عنده لغتين يخدمهما خدمةً كاملة: '
       || 'الإسبانية والبرتغالية. تُترجم خطبهما وتُراجع وتُؤدّى صوتيًّا كغيرهما، '
       || 'وتُحسب أعمالُهما في دليل الإنتاج والأرشيف، وتُعرضان سطرًا مستقلًّا '
       || 'بيانًا لهما.';
begin
  select content into v from public.page_content where key = 'initiative';
  if v is null then return; end if;

  for v_s in select jsonb_array_elements(v -> 'sections') loop
    v_blocks := coalesce(v_s -> 2, '[]'::jsonb);
    v_nb := '[]'::jsonb;
    for v_b in select jsonb_array_elements(v_blocks) loop
      v_txt := v_b ->> 1;
      if v_txt is not null and position('ولا يأخذ عليهما شيئًا' in v_txt) > 0 then
        v_nb := v_nb || jsonb_build_array(jsonb_build_array(v_b ->> 0, v_fix));
        v_hit := true;
      else
        v_nb := v_nb || jsonb_build_array(v_b);
      end if;
    end loop;
    v_new := v_new || jsonb_build_array(jsonb_build_array(v_s -> 0, v_s -> 1, v_nb));
  end loop;

  if v_hit then
    update public.page_content
       set content = jsonb_set(v, '{sections}', v_new), updated_at = now()
     where key = 'initiative';
  end if;
end $do$;

-- ---------------------------------------------------------------------
-- ٢) «اطّلاع فقط» تُبدَّل بـ«للمتابعة»
-- ---------------------------------------------------------------------
comment on column public.profiles.role is
  'دور العضو: مدير المشروع · منسق · مترجم · مشرف الهيئة (للمتابعة) · '
  'مدير المشروع من الهيئة (للمتابعة)';

notify pgrst, 'reload schema';
