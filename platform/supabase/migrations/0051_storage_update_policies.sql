-- =====================================================================
-- 0051 — إصلاح رفع المرفقات: سياسة «تعديل» لكل حاوية (ملاحظة ١٨٠)
--   خدمة التخزين تُنشئ صفّ الملف ثم تُحدّثه ببياناته بعد كتابته. فحاويةٌ
--   بلا سياسة update يُردّ رفعها وإن كان حجم الملف صغيرًا — وهذا سبب
--   تعذّر إرفاق PDF بالتعاميم، بينما نجحت الصورة لأن حاويتها لها سياسة
--   تعديل منذ البداية.
--   فتُسوّى الحاويات كلها على نمطٍ واحد: من يرفع يُعدّل، ومن يُدير يحذف.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) المراسلات: مرفق التعميم — رفعًا وتعديلًا وحذفًا للإدارة
-- ---------------------------------------------------------------------
drop policy if exists "admin updates circulars" on storage.objects;
create policy "admin updates circulars" on storage.objects for update to authenticated
  using (bucket_id = 'circulars' and public.is_admin())
  with check (bucket_id = 'circulars' and public.is_admin());

drop policy if exists "admin deletes circulars" on storage.objects;
create policy "admin deletes circulars" on storage.objects for delete to authenticated
  using (bucket_id = 'circulars' and public.is_admin());

-- ---------------------------------------------------------------------
-- ٢) أصول المواد: يرفعها المنسق ومدير المشروع
-- ---------------------------------------------------------------------
drop policy if exists "admin updates sources" on storage.objects;
create policy "admin updates sources" on storage.objects for update to authenticated
  using (bucket_id = 'sources' and public.is_admin())
  with check (bucket_id = 'sources' and public.is_admin());

drop policy if exists "admin deletes sources" on storage.objects;
create policy "admin deletes sources" on storage.objects for delete to authenticated
  using (bucket_id = 'sources' and public.is_admin());

-- ---------------------------------------------------------------------
-- ٣) التسجيلات الصوتية: صاحب المرحلة القائمة
-- ---------------------------------------------------------------------
drop policy if exists "assignee updates audio" on storage.objects;
create policy "assignee updates audio" on storage.objects for update to authenticated
  using (
    bucket_id = 'audio' and exists (
      select 1 from public.track_stages s join public.tracks t on t.current_stage_id = s.id
       where t.id::text = (storage.foldername(name))[1] and s.assignee_id = auth.uid()))
  with check (
    bucket_id = 'audio' and exists (
      select 1 from public.track_stages s join public.tracks t on t.current_stage_id = s.id
       where t.id::text = (storage.foldername(name))[1] and s.assignee_id = auth.uid()));

-- ---------------------------------------------------------------------
-- ٤) وثائق العضو الخاصة: ملفُّه وحده، والإدارة تدقّق
-- ---------------------------------------------------------------------
drop policy if exists "update own private docs" on storage.objects;
create policy "update own private docs" on storage.objects for update to authenticated
  using (
    bucket_id = 'private-docs'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()))
  with check (
    bucket_id = 'private-docs'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ---------------------------------------------------------------------
-- ٥) الحسابات المصرفية: وثيقة العضو
-- ---------------------------------------------------------------------
drop policy if exists "own bank doc update" on storage.objects;
create policy "own bank doc update" on storage.objects for update to authenticated
  using (
    bucket_id = 'bank-docs'
    and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text))
  with check (
    bucket_id = 'bank-docs'
    and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text));

-- ---------------------------------------------------------------------
-- ٦) هوية الهيئة: شعارٌ وكليشة — للإدارة
-- ---------------------------------------------------------------------
drop policy if exists "brand update" on storage.objects;
create policy "brand update" on storage.objects for update to authenticated
  using (bucket_id = 'brand' and public.is_admin())
  with check (bucket_id = 'brand' and public.is_admin());

-- ---------------------------------------------------------------------
-- ٧) وحدٌّ معلنٌ لحجم مرفق التعميم، فيُردّ الكبير برسالةٍ لا بصمت
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'storage' and table_name = 'buckets'
                and column_name = 'file_size_limit') then
    execute $q$update storage.buckets
                  set file_size_limit = 26214400   -- ٢٥ ميغابايت، والشاشة تقف عند ٢٠
                where id = 'circulars' and coalesce(file_size_limit, 0) < 26214400$q$;
  end if;
end $$;

notify pgrst, 'reload schema';
