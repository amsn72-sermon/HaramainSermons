-- =====================================================================
-- 0037 — ثلاثة ضوابط من العقد ومن ملاحظات التجربة:
--   ١) لا تمرّ مادة ناقصة البيانات الرئيسة أو بلا أصل      (ملاحظة ١٤٢)
--   ٢) التسجيل الصوتي بصيغة WAV أو MP3 كما اشترط العقد     (ملاحظة ١٤٣)
--   ٣) نمط تسمية الملفات موحَّد يضبطه مدير المشروع         (ملاحظة ١٤٤)
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) اكتمال بيانات المادة — الحارس في قاعدة البيانات لا في الشاشة وحدها
-- ---------------------------------------------------------------------
create or replace function public.check_material_complete()
returns trigger language plpgsql set search_path = public as $$
declare v_txt text;
begin
  if nullif(trim(coalesce(new.material_type, '')), '') is null then
    raise exception 'نوع المادة مطلوب';
  end if;
  if nullif(trim(coalesce(new.title, '')), '') is null then
    raise exception 'عنوان المادة مطلوب';
  end if;
  if new.sermon_date is null then
    raise exception 'تاريخ المادة مطلوب';
  end if;

  if new.material_type = 'خطب' then
    if nullif(trim(coalesce(new.sermon_type, '')), '') is null then
      raise exception 'نوع الخطبة مطلوب (جمعة، عرفة، عيد…)';
    end if;
    if new.khateeb_id is null then
      raise exception 'اسم الخطيب مطلوب';
    end if;
    if new.mosque not in ('makkah', 'madinah') then
      raise exception 'حدّد جهة الخطبة: المسجد الحرام أو المسجد النبوي';
    end if;
  elsif nullif(trim(coalesce(new.author, '')), '') is null then
    raise exception 'المؤلف أو الجهة المصدرة مطلوب لغير الخطب';
  end if;

  -- الأصل: نصٌّ مكتوب أو ملف PDF، ولا تُقبل مادة بلا أصل
  v_txt := nullif(trim(regexp_replace(coalesce(new.source_html, ''), '<[^>]*>', ' ', 'g')), '');
  if v_txt is null and new.source_pdf_path is null then
    raise exception 'أدخل النص العربي أو أرفق ملف الأصل (PDF)';
  end if;
  return new;
end $$;

drop trigger if exists on_material_complete on public.materials;
create trigger on_material_complete
  before insert on public.materials
  for each row execute function public.check_material_complete();

comment on function public.check_material_complete()
  is 'لا تُقبل مادة ناقصة البيانات الرئيسة أو بلا أصل (ملاحظة ١٤٢)';

-- ---------------------------------------------------------------------
-- ٢) صيغة التسجيل الصوتي: WAV أو MP3 (العقد — مواصفات الملفات الصوتية)
--    الجودة لا تُحجب آليًّا؛ تُعرض للمنسق فيقبل أو يُعيد.
-- ---------------------------------------------------------------------
create or replace function public.check_audio_format()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.path !~* '\.(wav|mp3)$' then
    raise exception 'الصيغ المعتمدة للتسجيل: WAV أو MP3 فقط (شرط العقد)';
  end if;
  return new;
end $$;

drop trigger if exists on_track_audio_format on public.track_audios;
create trigger on_track_audio_format
  before insert on public.track_audios
  for each row execute function public.check_audio_format();

-- ---------------------------------------------------------------------
-- ٣) نمط تسمية الملفات — عنصرٌ من مواصفات التسليم في العقد
-- ---------------------------------------------------------------------
alter table public.platform_settings
  add column if not exists file_name_pattern text
  not null default '{doc_no} - {kind} - {mosque} - {hijri} - {lang} - {title}';

comment on column public.platform_settings.file_name_pattern
  is 'نمط تسمية الملفات المسلَّمة: {doc_no} {kind} {sub} {mosque} {hijri} {date} {lang} {title} {khateeb} (ملاحظة ١٤٤)';

create or replace function public.set_file_name_pattern(p_pattern text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then
    raise exception 'ضبط نمط التسمية لمدير المشروع' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_pattern, '')), '') is null then
    raise exception 'اكتب نمط التسمية';
  end if;
  if p_pattern !~ '\{(doc_no|title|lang)\}' then
    raise exception 'لا بد أن يتضمن النمط {doc_no} أو {title} أو {lang} ليتميز كل ملف';
  end if;
  update public.platform_settings
     set file_name_pattern = trim(p_pattern), updated_by = auth.uid(), updated_at = now()
   where id;
end $$;

grant execute on function public.set_file_name_pattern(text) to authenticated;

notify pgrst, 'reload schema';
