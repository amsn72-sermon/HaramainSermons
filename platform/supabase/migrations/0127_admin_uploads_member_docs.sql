-- ---------------------------------------------------------------------
-- ٠١٢٧ — رفعُ الإدارة وثيقةَ عضوٍ عنه (ملاحظة ٤٤٨)
--
--   كان مستودعُ الوثائق الخاصة يأذن بالكتابة لصاحب المجلَّد وحدَه:
--     with check (bucket_id = 'private-docs'
--                 and (storage.foldername(name))[1] = auth.uid()::text)
--   فإذا رفع المنسقُ أو مديرُ المشروع هويةَ عضوٍ من ملفِّه كُتبت في
--   مجلَّد ذلك العضو لا في مجلَّده هو، فتردُّها السياسةُ ويظهر «هذا
--   خارجَ نطاقِ عملك الحالي». وكان في ٠٠٥١ إذنُ التعديل للإدارة ولم
--   يكن إذنُ الإنشاء، فاستُدرك هنا.
--
--   والقراءةُ باقيةٌ على حالها: لصاحبها وللإدارة، ولا تُفتَح لغيرهم.
-- ---------------------------------------------------------------------

drop policy if exists "admin uploads member docs" on storage.objects;
create policy "admin uploads member docs" on storage.objects for insert to authenticated
  with check (
    bucket_id in ('private-docs', 'bank-docs')
    and public.is_admin()
  );

-- وحذفُ القديم عند الاستبدال كذلك، فلا تتراكم نسخٌ لا تُقرأ
drop policy if exists "admin removes member docs" on storage.objects;
create policy "admin removes member docs" on storage.objects for delete to authenticated
  using (
    bucket_id in ('private-docs', 'bank-docs')
    and public.is_admin()
  );
