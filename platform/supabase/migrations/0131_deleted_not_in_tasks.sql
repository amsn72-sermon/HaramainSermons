-- =====================================================================
-- ٠١٣١ — المحذوفُ لا يبقى عند المترجمين (ملاحظة ٤٧٤)
--
--   أرسل صاحبُ المشروع خطبةً ثم تبيَّن خطأٌ في الإسناد فحذفها، فاختفت
--   من لوحة المتابعة وبقيت عند المترجمين. والسببُ أنَّ الحذف عندنا
--   «حذفٌ إلى الأرشيف»: يُوسَم العملُ بـ deleted_at ويبقى ليُستردّ.
--   وشاشتا المتابعة والأرشيف تحترمان الوسم، وأمّا سجلُّ المترجم
--   (my_history) فلا ينظر فيه أصلًا، فتظهر له المهمةُ كأنها قائمة.
--
--   ولا يُلمَس وسمُ الصفوف في RLS: الأرشيفُ يحتاج المحذوفَ ليعرضه
--   لمدير المشروع مع زرِّ الاسترجاع.
-- =====================================================================

-- ـــ ١) سجلُّ المترجم يُسقِط الموسومَ بالحذف، مادةً ومسارًا
do $do$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'my_history';
  if v_src is null then
    raise exception 'my_history غير موجودة';
  end if;
  if position('t.deleted_at is null' in v_src) > 0 then return; end if;
  v_new := replace(v_src, 'where s.assignee_id = auth.uid()',
    'where s.assignee_id = auth.uid() and t.deleted_at is null and m.deleted_at is null');
  if v_new = v_src then
    raise exception 'لم يُعثَر على شرط my_history';
  end if;
  execute v_new;
end $do$;

comment on function public.my_history() is
  'سجلُّ مهامِّ العضو — ولا يُعرَض فيه ما حُذف إلى الأرشيف (ملاحظة ٤٧٤)';

-- ـــ ٢) وعند الحذف يُخبَر أهلُ العمل، فلا تختفي المهمةُ بلا بيان
--
--   ومعه تُوقَف رسائلُ هذا المسار التي لم تُرسَل بعدُ في طابور البريد،
--   فلا يُدعى أحدٌ إلى عملٍ ملغًى، وتبقى شاهدةً لا تُمحى.
do $do$
declare v_def text;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public' and t.relname = 'notifications'
     and c.conname = 'notifications_kind_check';
  if v_def is null then
    -- لا نخمّن الأنواعَ القائمةَ فنُسقِط منها ما لا نعلم
    raise exception 'notifications_kind_check غير موجود';
  end if;
  if position('''cancelled''' in v_def) > 0 then return; end if;
  alter table public.notifications drop constraint notifications_kind_check;
  execute 'alter table public.notifications add constraint notifications_kind_check '
    || replace(v_def, 'ARRAY[', 'ARRAY[''cancelled''::text, ');
end $do$;

create or replace function public.notify_track_cancelled(p_track uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_title text; v_lang text; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select m.title, l.name_ar into v_title, v_lang
    from public.tracks t
    join public.materials m on m.id = t.material_id
    left join public.languages l on l.code = t.language_code
   where t.id = p_track;
  if v_title is null then return; end if;
  -- من كان عليه عملٌ لم يُنجَز في هذا المسار
  for r in select distinct s.assignee_id as who
             from public.track_stages s
            where s.track_id = p_track and s.assignee_id is not null
              and s.status <> 'done'
  loop
    perform public.enqueue_notification(r.who, 'cancelled',
      'أُلغي إسنادٌ إليك',
      'أُلغي إسنادُ «' || v_title || '»' || coalesce(' — ' || v_lang, '')
        || coalesce('. السبب: ' || v_reason, '') || ' فلم تعد المهمةُ مطلوبةً منك.',
      null);
  end loop;
  -- ورسائلُ هذا المسار التي لم تُرسَل بعدُ تُوقَف فلا يُدعى أحدٌ إلى
  --   عملٍ ملغًى — وتبقى في الطابور شاهدةً لا تُمحى
  update public.notifications
     set status = 'failed', last_error = 'أُلغي الإسناد فلم تُرسَل'
   where track_id = p_track and status = 'pending';
end $$;
revoke execute on function public.notify_track_cancelled(uuid, text) from public, anon, authenticated;

comment on function public.notify_track_cancelled(uuid, text) is
  'إخبارُ أهل العمل بإلغاء الإسناد وإيقافُ رسائله المعلَّقة — أداةٌ داخلية (ملاحظة ٤٧٤)';

-- ويُستدعى من حذف الأرشيف ومن إلغاء المسار، كلٌّ في موضعه
do $do$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_archive_deleted';
  if v_src is null or position('notify_track_cancelled' in v_src) > 0 then return; end if;
  v_new := replace(v_src,
    'update public.materials set deleted_at = v_when, deleted_by = v_who where id = p_material;',
    E'update public.materials set deleted_at = v_when, deleted_by = v_who where id = p_material;\n'
    || E'    if p_deleted then\n'
    || E'      perform public.notify_track_cancelled(id, v_reason)\n'
    || E'        from public.tracks where material_id = p_material and status <> ''completed'';\n'
    || E'    end if;');
  v_new := replace(v_new,
    'update public.tracks set deleted_at = v_when, deleted_by = v_who where id = p_track;',
    E'if p_deleted then perform public.notify_track_cancelled(p_track, v_reason); end if;\n'
    || E'    update public.tracks set deleted_at = v_when, deleted_by = v_who where id = p_track;');
  if v_new <> v_src then execute v_new; end if;
end $do$;

do $do$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cancel_track';
  if v_src is null or position('notify_track_cancelled' in v_src) > 0 then return; end if;
  v_new := replace(v_src, 'delete from public.tracks where id = p_track;',
    E'perform public.notify_track_cancelled(p_track, null);\n'
    || E'  delete from public.tracks where id = p_track;');
  if v_new <> v_src then execute v_new; end if;
end $do$;
