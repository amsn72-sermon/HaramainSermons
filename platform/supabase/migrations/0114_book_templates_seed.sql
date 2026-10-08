-- =====================================================================
-- 0114 — قوالبُ مجمَّع الخطب السنوي: بابٌ قائمٌ بنفسه (ملاحظتا ٣٣٩ و٣٥٠)
--
--   كان القالبُ يُصمَّم من داخل نافذة الإصدار: حقولٌ بلا معاينة، لا
--   يُرى أثرُها إلا بعد البناء. وهو خلافُ ما استقرَّ عليه مصمِّمُ
--   الشهادات — لوحةٌ تُرى وأدواتٌ تحتها.
--
--   فصار للقوالب بابُها في صفحة الأعوام، يخصُّ الأعوامَ كلَّها، وفيه
--   الغلافُ وصفحةُ عنوان الخطبة والكليشةُ الداخليةُ والترقيمُ والحليةُ
--   في الذيل — كلُّ بابٍ يُعايَن ويُعدَّل.
--
--   وتُنشَأ ثلاثةُ قوالبَ مقترحةٍ يُبنى عليها، وكلُّها يُغيَّر ويُزاد.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) قراءةُ قالبٍ بعينه، وحذفُه
-- ---------------------------------------------------------------------
create or replace function public.book_template_get(p_id uuid)
returns table (id uuid, name text, h_year int, is_default boolean, tpl jsonb)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.h_year, t.is_default, t.tpl
    from public.book_templates t
   where t.id = p_id and public.my_role() is not null
$$;
grant execute on function public.book_template_get(uuid) to authenticated;

create or replace function public.delete_book_template(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if not (public.is_manager() or public.is_admin_for('arch_export')) then
    raise exception 'قوالبُ المجمَّع بإذن مدير المشروع' using errcode = '42501';
  end if;
  select * into v from public.book_templates where id = p_id;
  if not found then raise exception 'القالب غير موجود'; end if;
  if (select count(*) from public.book_templates) <= 1 then
    raise exception 'لا يُحذف آخرُ قالبٍ — أنشِئْ غيرَه أوّلًا';
  end if;
  delete from public.book_templates where id = p_id;
  if v.is_default then
    update public.book_templates set is_default = true
     where id = (select id from public.book_templates order by updated_at desc limit 1);
  end if;
end $$;
grant execute on function public.delete_book_template(uuid) to authenticated;

-- والكشفُ يُرجع القالبَ نفسَه ليُعايَن في البطاقة
drop function if exists public.book_templates_list();
create or replace function public.book_templates_list()
returns table (id uuid, name text, h_year int, is_default boolean,
               tpl jsonb, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.h_year, t.is_default, t.tpl, t.updated_at
    from public.book_templates t
   where public.my_role() is not null
   order by t.is_default desc, t.h_year nulls first, t.name
$$;
grant execute on function public.book_templates_list() to authenticated;

-- وحفظُ قالبٍ باسمه مع تغيير اسمه، فالاسمُ وحدَه كان مفتاحَه
create or replace function public.save_book_template_by_id(
  p_id uuid, p_name text, p_tpl jsonb, p_year int default null,
  p_default boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (public.is_manager() or public.is_admin_for('arch_export')) then
    raise exception 'قوالبُ المجمَّع بإذن مدير المشروع' using errcode = '42501';
  end if;
  if p_tpl is null or jsonb_typeof(p_tpl) <> 'object' then
    raise exception 'قالبٌ غيرُ مقروء';
  end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then
    raise exception 'اكتبْ اسمَ القالب';
  end if;

  if p_id is null then
    insert into public.book_templates (name, h_year, tpl, is_default, updated_by)
    values (btrim(p_name), p_year, p_tpl, coalesce(p_default, false), auth.uid())
    returning id into v_id;
  else
    update public.book_templates
       set name = btrim(p_name), h_year = p_year, tpl = p_tpl,
           is_default = coalesce(p_default, false),
           updated_at = now(), updated_by = auth.uid()
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'القالب غير موجود'; end if;
  end if;

  if coalesce(p_default, false) then
    update public.book_templates set is_default = false where id <> v_id;
  end if;
  return v_id;
end $$;
grant execute on function public.save_book_template_by_id(uuid, text, jsonb, int, boolean)
  to authenticated;

-- ---------------------------------------------------------------------
-- ٢) ثلاثةُ قوالبَ مقترحةٍ يُبنى عليها — تُنشَأ مرةً ولا تُعاد
-- ---------------------------------------------------------------------
do $do$
declare v_marks jsonb := jsonb_build_array(
  jsonb_build_object('src', '/assets/alharamain-logo-dark.png', 'x', 6,  'y', 6, 'h', 16),
  jsonb_build_object('src', '/assets/presidency.png',           'x', 24, 'y', 6, 'h', 16),
  jsonb_build_object('src', '/assets/uqu-logo.png',             'x', 74, 'y', 6, 'h', 16));
begin
  if exists (select 1 from public.book_templates) then return; end if;

  insert into public.book_templates (name, h_year, tpl, is_default) values
  ('العاجيُّ الأخضر', null, jsonb_build_object(
      'size', 'book',
      'cover', jsonb_build_object('paper', '#f5efe4', 'ink', '#174a38', 'gold', '#b9975b',
        'pattern', true, 'bg', null, 'fade', 22, 'marks', v_marks,
        'bannerW', 30, 'bannerTop', 26, 'titleY', 52, 'foot', true),
      'divider', jsonb_build_object('paper', '#f5efe4', 'ink', '#174a38',
        'banner', true, 'bannerW', 34, 'ghost', false, 'stamp', true, 'midY', 62),
      'inner', jsonb_build_object('paper', '#ffffff', 'ink', '#1d2b3a', 'gold', '#b9975b',
        'head', true, 'foot', true, 'band', true, 'pageno', 'circle', 'ornament', false),
      'intro', ''), true),

  ('الأخضرُ الداكن', null, jsonb_build_object(
      'size', 'book',
      'cover', jsonb_build_object('paper', '#143b2d', 'ink', '#f3e7cd', 'gold', '#cdab6d',
        'pattern', true, 'bg', null, 'fade', 18, 'marks', v_marks,
        'bannerW', 26, 'bannerTop', 30, 'titleY', 54, 'foot', true),
      'divider', jsonb_build_object('paper', '#eee7d8', 'ink', '#143b2d',
        'banner', true, 'bannerW', 30, 'ghost', false, 'stamp', true, 'midY', 60),
      'inner', jsonb_build_object('paper', '#fffdf8', 'ink', '#1b2a22', 'gold', '#cdab6d',
        'head', true, 'foot', true, 'band', true, 'pageno', 'ornament', 'ornament', true),
      'intro', ''), false),

  ('الأبيضُ الذهبي', null, jsonb_build_object(
      'size', 'book',
      'cover', jsonb_build_object('paper', '#ffffff', 'ink', '#2b2b2b', 'gold', '#bf9b57',
        'pattern', false, 'bg', null, 'fade', 30, 'marks', v_marks,
        'bannerW', 0, 'bannerTop', 0, 'titleY', 44, 'foot', true),
      'divider', jsonb_build_object('paper', '#ffffff', 'ink', '#2b2b2b',
        'banner', false, 'bannerW', 0, 'ghost', false, 'stamp', true, 'midY', 50),
      'inner', jsonb_build_object('paper', '#ffffff', 'ink', '#222222', 'gold', '#bf9b57',
        'head', true, 'foot', true, 'band', false, 'pageno', 'plain', 'ornament', true),
      'intro', ''), false);
end $do$;

notify pgrst, 'reload schema';
