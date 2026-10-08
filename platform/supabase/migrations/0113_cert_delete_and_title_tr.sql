-- =====================================================================
-- 0113 — حذفُ الشهادة الملغاة، وعنوانُ النسخة بلغتها (ملاحظتا ٣٤٤ و٣٤١)
--
--   ١) الإلغاءُ يُبقي الشهادةَ في السجلِّ معلَنَ الإلغاء — وهذا أصلٌ
--      صحيحٌ في الشهادة التي صدرت وخرجت إلى صاحبها. لكنّ ما أُلغي ولم
--      يخرج، أو أُنشئ خطأً، يبقى معروضًا لا سبيلَ إلى إزالته. فأُتيح
--      حذفُه لمدير المشروع وحدَه، مع تسجيل أثرِه في سجلِّ الإدارة،
--      ولا يُحذف إلا الملغى أو المسوّدة — والصادرةُ القائمةُ لا تُمَسّ.
--
--   ٢) وبطاقةُ بيانات الخطبة صارت صفَّين: عربيًّا وبلغة الخطبة. فعنوانُ
--      الخطبة بلغتها يحتاج موضعًا يُكتَب فيه، فأُضيف إلى النسخة.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) حذفُ شهادةٍ ملغاةٍ أو مسوّدة
-- ---------------------------------------------------------------------
create or replace function public.delete_certificate(p_cert uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if not public.is_manager() then
    raise exception 'حذفُ الشهادات بيد مدير المشروع' using errcode = '42501';
  end if;
  select * into c from public.certificates where id = p_cert;
  if not found then raise exception 'الشهادة غير موجودة'; end if;
  if c.status = 'issued' then
    raise exception 'الشهادةُ الصادرةُ لا تُحذف — تُلغى أوّلًا فيبقى أثرُ رقمها';
  end if;
  perform public.log_admin('cert_delete', c.member_id,
    jsonb_build_object('cert', p_cert, 'serial', c.serial_no,
                       'title', c.title, 'status', c.status));
  delete from public.certificates where id = p_cert;
end $$;
grant execute on function public.delete_certificate(uuid) to authenticated;

comment on function public.delete_certificate(uuid) is
  'حذفُ شهادةٍ ملغاةٍ أو مسوّدة — بيد مدير المشروع، وأثرُه مكتوب (ملاحظة ٣٤٤)';

-- والكشفُ يُرجع سنةَ الشهادة ليُقسَّم بها العرض (ملاحظة ٣٤٠)
drop function if exists public.certificates_list(text);
create or replace function public.certificates_list(p_status text default null)
returns table (id uuid, kind text, member_id uuid, member_name text, title text,
               hours numeric, start_on date, end_on date, source text,
               status text, serial_no text, verify_key text,
               h_year int, created_at timestamptz, issued_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.kind, c.member_id, p.full_name, c.title, c.hours, c.start_on, c.end_on,
         c.source, c.status, c.serial_no, c.verify_key,
         public.hijri_year(coalesce(c.issued_at, c.created_at)::date),
         c.created_at, c.issued_at
    from public.certificates c
    join public.profiles p on p.id = c.member_id
   where (public.is_admin() or public.is_supervisor() or public.is_viewer())
     and (p_status is null or p_status = '' or c.status = p_status)
   order by c.created_at desc
$$;
grant execute on function public.certificates_list(text) to authenticated;

-- ---------------------------------------------------------------------
-- ٢) عنوانُ الخطبة بلغة نسختها
-- ---------------------------------------------------------------------
alter table public.arch_versions add column if not exists title_tr text;

comment on column public.arch_versions.title_tr is
  'عنوانُ الخطبة كما كتبه المترجم بلغته — يُطبع في الصفِّ الثاني من البطاقة (ملاحظة ٣٤١)';

-- ويُحفَظ مع النسخة
do $do$
declare v_src text; v_old text;
begin
  v_src := pg_get_functiondef('public.save_arch_sermon(jsonb)'::regprocedure);
  if position('title_tr' in v_src) > 0 then return; end if;

  v_old := '      (sermon_id, language_code, is_source, body_html, file_path, audio_path, words, uploaded_by)';
  if position(v_old in v_src) = 0 then
    raise exception 'save_arch_sermon: لم يُوجد موضعُ الترقيع (الأعمدة)';
  end if;
  v_src := replace(v_src, v_old,
    '      (sermon_id, language_code, is_source, body_html, file_path, audio_path, words,'
    || ' title_tr, uploaded_by)');

  v_old := '            nullif(v_item ->> ''words'', '''')::int, auth.uid())';
  if position(v_old in v_src) = 0 then
    raise exception 'save_arch_sermon: لم يُوجد موضعُ الترقيع (القيم)';
  end if;
  v_src := replace(v_src, v_old,
    '            nullif(v_item ->> ''words'', '''')::int,'
    || ' nullif(btrim(v_item ->> ''title_tr''), ''''), auth.uid())');

  v_old := '          words      = coalesce(excluded.words, public.arch_versions.words),';
  if position(v_old in v_src) = 0 then
    raise exception 'save_arch_sermon: لم يُوجد موضعُ الترقيع (التحديث)';
  end if;
  v_src := replace(v_src, v_old,
    '          words      = coalesce(excluded.words, public.arch_versions.words),'
    || E'\n          title_tr   = coalesce(excluded.title_tr, public.arch_versions.title_tr),');

  execute v_src;
end $do$;

-- وتنقيحُ نسخةٍ قائمةٍ لا يحتاج ذكرَ القسم: قسمُها معلومٌ من الخطبة
--   (ملاحظة ٣٣٨ — التنقيحُ على الكليشة يرسل النصَّ وحدَه)
do $do$
declare v_src text; v_old text;
begin
  v_src := pg_get_functiondef('public.save_arch_sermon(jsonb)'::regprocedure);
  if position('قسمُ الخطبة القائمة' in v_src) > 0 then return; end if;
  v_old := '  if v_sec is null then raise exception ''لم يُحدَّد القسم''; end if;';
  if position(v_old in v_src) = 0 then
    raise exception 'save_arch_sermon: لم يُوجد موضعُ الترقيع (القسم)';
  end if;
  execute replace(v_src, v_old,
    '  -- قسمُ الخطبة القائمة يُستغنى به عن ذكره في الطلب (ملاحظة ٣٣٨)' || E'\n'
    || '  if v_sec is null and v_id is not null then' || E'\n'
    || '    select section_id into v_sec from public.arch_sermons where id = v_id;' || E'\n'
    || '  end if;' || E'\n'
    || '  if v_sec is null then raise exception ''لم يُحدَّد القسم''; end if;');
end $do$;

-- ويُقرأ مع نصِّها
drop function if exists public.arch_version_text(uuid, text);
create or replace function public.arch_version_text(p_sermon uuid, p_lang text)
returns table (body_html text, file_path text, audio_path text, doc_no text, title_tr text)
language sql stable security definer set search_path = public as $$
  select v.body_html, v.file_path, v.audio_path, v.doc_no, v.title_tr
    from public.arch_versions v
   where v.sermon_id = p_sermon and v.language_code = p_lang
     and public.my_role() is not null
$$;
grant execute on function public.arch_version_text(uuid, text) to authenticated;

-- ونسخُ الخطبة تُظهر أنّ لها عنوانًا مترجَمًا
drop function if exists public.arch_sermon(uuid);
create or replace function public.arch_sermon(p_id uuid)
returns table (id uuid, title text, khateeb text, mosque text, sermon_type text,
               sermon_date date, hijri_text text, week_no int, seq int, h_year int,
               notes text, doc_no text, versions jsonb)
language sql stable security definer set search_path = public as $$
  select m.id, m.title, m.khateeb, m.mosque, m.sermon_type, m.sermon_date,
         m.hijri_text, m.week_no, m.seq, m.h_year, m.notes, m.doc_no,
         coalesce((select jsonb_agg(to_jsonb(x) order by x.is_source desc, x.language_code)
                     from (select v.language_code, v.is_source, v.doc_no, v.title_tr,
                                  (v.file_path is not null)  as has_file,
                                  (v.audio_path is not null) as has_audio,
                                  (nullif(btrim(coalesce(v.body_html, '')), '') is not null) as has_text,
                                  v.words, v.uploaded_at
                             from public.arch_versions v where v.sermon_id = m.id) x), '[]'::jsonb)
    from public.arch_sermons m
   where m.id = p_id and public.my_role() is not null
$$;
grant execute on function public.arch_sermon(uuid) to authenticated;

notify pgrst, 'reload schema';
