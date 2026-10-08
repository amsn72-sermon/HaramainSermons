-- =====================================================================
-- 0117 — تحديثُ صفحتَي «عن المبادرة» و«عن المنصة» بما استجدَّ (ملاحظة ٣٥١)
--
--   استجدَّ في المنصة بابٌ كاملٌ لم تذكره الصفحتان: أرشيفُ الخطب
--   السنويُّ ومجمَّعُه. وقد نُصَّ على أن يكون الذكرُ مختصرًا، وألا
--   يُذكَر فيه شيءٌ ماديٌّ ولا تسعيرة — فالمبادرةُ شأنٌ داخليّ.
--
--   فيُضاف قسمٌ واحدٌ في «عن المبادرة» بعد قسم الأرشيف، وسطرٌ موجزٌ في
--   «عن المنصة» وبطاقةٌ في خدماتها. ولا يُمَسُّ ما سواه.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) «عن المبادرة»: قسمٌ موجزٌ لأرشيف الخطب السنويِّ ومجمَّعه
-- ---------------------------------------------------------------------
do $do$
declare v jsonb; v_s jsonb; v_new jsonb := '[]'::jsonb; v_has boolean := false;
        v_sec jsonb := jsonb_build_array('sermonarch', 'أرشيف الخطب السنوي ومجمَّعه',
          jsonb_build_array(
            jsonb_build_array('p',
              'إلى جانب أرشيف أعمال الترجمة، للخطب أرشيفُها السنويُّ على تقويم الحرمين: '
              || 'العامُ الهجريُّ أيقونةٌ فيها إحصاؤه، وفي العام أسابيعُ جُمَعِه، وفي كل '
              || 'جمعةٍ صفَّان — المسجد الحرام والمسجد النبوي — وتحت كل خطبةٍ نسخُها '
              || 'بلغاتها. والجمعةُ الخاليةُ تبقى صفًّا موسومًا، فيُبصَر الناقصُ بالنظر '
              || 'لا بالبحث.'),
            jsonb_build_array('p',
              'ويُرفَع مجمَّعُ عامٍ كاملٍ في ملفٍّ واحد، فتشقّه المنصة خطبًا بترويساتها '
              || '— تاريخها ومسجدها وخطيبها وعنوانها — ويُعرَض جدولُ مراجعةٍ يُصحَّح فيه '
              || 'ما التبس قبل الاعتماد. وأعمالُ العام المنجَزةُ في أرشيف الترجمة تُرحَّل '
              || 'إليه عند انقضائه، كلُّ خطبةٍ إلى جمعتها ونصُّ كل لغةٍ نسخةً لها.'),
            jsonb_build_array('p',
              'ومن الأرشيف يُصدَر مجمَّعُ الخطب السنويُّ كتابًا مُخرَجًا: غلافٌ ببياناته، '
              || 'ثم بسملةٌ وصفحةُ حقوقٍ وفهرسٌ بأرقام الصفحات، ثم صفحةُ عنوانٍ لكل خطبةٍ '
              || 'ومتنُها بكليشةٍ داخليةٍ وترقيمٍ متسلسل. وللمجمَّع قوالبُ تصميمٍ تُعايَن '
              || 'وتُعدَّل — غلافُها وصفحاتُ عناوينها وكليشتُها وترقيمُها — ولكلِّ عامٍ أن '
              || 'يأخذ قالبَه.'),
            jsonb_build_array('p',
              'ولكل خطبةٍ ولكل نسخةٍ منها رقمُ توثيقٍ وباركودُ تحقُّقٍ كما في أرشيف '
              || 'الترجمة، يُطبَعان في صدر صفحتها الأولى، فيُرجَع بهما إلى أصلها.')));
begin
  select content into v from public.page_content where key = 'initiative';
  if v is null then return; end if;

  for v_s in select jsonb_array_elements(v -> 'sections') loop
    if (v_s ->> 0) = 'sermonarch' then v_has := true; end if;
  end loop;
  if v_has then return; end if;

  for v_s in select jsonb_array_elements(v -> 'sections') loop
    v_new := v_new || jsonb_build_array(v_s);
    if (v_s ->> 0) = 'archive' then
      v_new := v_new || jsonb_build_array(v_sec);
    end if;
  end loop;

  -- فإن لم يُوجد قسمُ الأرشيف وُضع قبل الخاتمة
  if not (v_new::text like '%sermonarch%') then
    v_new := (v -> 'sections') || jsonb_build_array(v_sec);
  end if;

  update public.page_content
     set content = jsonb_set(v, '{sections}', v_new), updated_at = now()
   where key = 'initiative';
end $do$;

-- وبطاقةٌ في «مخرجات المنصة» — بيانٌ لا تسعيرة
do $do$
declare v jsonb; v_s jsonb; v_b jsonb; v_nb jsonb; v_new jsonb := '[]'::jsonb;
        v_card jsonb := jsonb_build_array(
          'مجمَّع الخطب السنوي',
          'كتابٌ سنويٌّ يُصدَر من أرشيف الخطب بلغةٍ مختارة: غلافٌ وفهرسٌ وصفحةُ عنوانٍ '
          || 'لكل خطبةٍ ومتنُها، بقالبٍ يُصمَّم ويُعايَن قبل أن يخرج.',
          'book');
begin
  select content into v from public.page_content where key = 'initiative';
  if v is null or v::text like '%مجمَّع الخطب السنوي%كتابٌ سنويٌّ%' then return; end if;

  for v_s in select jsonb_array_elements(v -> 'sections') loop
    if (v_s ->> 0) <> 'outputs' then
      v_new := v_new || jsonb_build_array(v_s);
      continue;
    end if;
    v_nb := '[]'::jsonb;
    for v_b in select jsonb_array_elements(coalesce(v_s -> 2, '[]'::jsonb)) loop
      if (v_b ->> 0) = 'cards' and not ((v_b -> 1)::text like '%مجمَّع الخطب السنوي%') then
        v_nb := v_nb || jsonb_build_array(
          jsonb_build_array('cards', (v_b -> 1) || jsonb_build_array(v_card)));
      else
        v_nb := v_nb || jsonb_build_array(v_b);
      end if;
    end loop;
    v_new := v_new || jsonb_build_array(jsonb_build_array(v_s -> 0, v_s -> 1, v_nb));
  end loop;

  update public.page_content
     set content = jsonb_set(v, '{sections}', v_new), updated_at = now()
   where key = 'initiative';
end $do$;

-- ---------------------------------------------------------------------
-- ٢) «عن المنصة»: سطرٌ موجزٌ وبطاقةٌ في خدماتها
-- ---------------------------------------------------------------------
do $do$
declare v jsonb; v_s jsonb; v_b jsonb; v_nb jsonb; v_new jsonb := '[]'::jsonb;
        v_p jsonb := jsonb_build_array('p',
          'وللخطب أرشيفٌ سنويٌّ على تقويم الحرمين: العامُ أسابيعُ جُمَعِه، وفي كل جمعةٍ '
          || 'خطبتا الحرمين بلغاتهما. ومنه يُصدَر مجمَّعُ الخطب السنويُّ كتابًا مُخرَجًا '
          || 'بقالبٍ يُصمَّم ويُعايَن.');
begin
  select content into v from public.page_content where key = 'about';
  if v is null or v::text like '%أرشيفٌ سنويٌّ على تقويم الحرمين%' then return; end if;

  for v_s in select jsonb_array_elements(coalesce(v -> 'sections', '[]'::jsonb)) loop
    if (v_s ->> 0) <> 'brief' then
      v_new := v_new || jsonb_build_array(v_s);
      continue;
    end if;
    v_nb := coalesce(v_s -> 2, '[]'::jsonb) || jsonb_build_array(v_p);
    v_new := v_new || jsonb_build_array(jsonb_build_array(v_s -> 0, v_s -> 1, v_nb));
  end loop;

  if jsonb_array_length(v_new) > 0 then
    update public.page_content
       set content = jsonb_set(v, '{sections}', v_new), updated_at = now()
     where key = 'about';
  end if;

  -- وبطاقةٌ في «ما تقدّمه المنصة»
  select content into v from public.page_content where key = 'about';
  v_new := '[]'::jsonb;
  for v_s in select jsonb_array_elements(coalesce(v -> 'sections', '[]'::jsonb)) loop
    if (v_s ->> 0) <> 'services' then
      v_new := v_new || jsonb_build_array(v_s);
      continue;
    end if;
    v_nb := '[]'::jsonb;
    for v_b in select jsonb_array_elements(coalesce(v_s -> 2, '[]'::jsonb)) loop
      if (v_b ->> 0) = 'cards' and not ((v_b -> 1)::text like '%أرشيف الخطب السنوي%') then
        v_nb := v_nb || jsonb_build_array(jsonb_build_array('cards',
          (v_b -> 1) || jsonb_build_array(jsonb_build_array(
            'أرشيف الخطب السنوي',
            'خطبُ الحرمين بأعوامها الهجرية وأسابيع جُمَعِها ولغاتها، ومنه يُصدَر '
            || 'المجمَّع السنويُّ بترقيمه وتوثيقه.',
            'archive'))));
      else
        v_nb := v_nb || jsonb_build_array(v_b);
      end if;
    end loop;
    v_new := v_new || jsonb_build_array(jsonb_build_array(v_s -> 0, v_s -> 1, v_nb));
  end loop;
  if jsonb_array_length(v_new) > 0 then
    update public.page_content
       set content = jsonb_set(v, '{sections}', v_new), updated_at = now()
     where key = 'about';
  end if;
end $do$;

notify pgrst, 'reload schema';
