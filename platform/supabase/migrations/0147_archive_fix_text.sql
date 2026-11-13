-- =====================================================================
-- ٠١٤٧ — تنسيقُ نسخةٍ مؤرشفةٍ على الكليشة (ملاحظة ٦ من دفعة ٥٠٢)
--
--   المسارُ إذا اكتمل أُغلق بابُ تعديله: `save_translation` لمسؤول
--   المرحلة الجارية وحدَه، ولا مرحلةَ بعد الاكتمال. وهذا هو الأصل،
--   فالخطبةُ الموثَّقةُ برقمها لا يعبث بها أحد.
--
--   ولكن يبقى ما يُحتاج إليه: تنسيقٌ اختلَّ، أو فقرةٌ التصقت، أو مقاسُ
--   خطٍّ شذَّ — إصلاحُ صورةٍ لا تبديلُ معنًى. فيُفتَح لهذا بابٌ ضيِّق:
--   مفتاحٌ مستقلٌّ يُمنَح لمن تختاره الإدارةُ، وكلُّ حفظٍ يُبقي النصَّ
--   السابقَ كما كان في سجلٍّ يُرجَع إليه، ويُكتَب من عدَّل ومتى.
-- =====================================================================

-- ـــ ١) مفتاحُ الصلاحية
insert into public.perm_keys (key, label, sort, default_open)
values ('arch_fix', 'تنسيقُ النسخ المؤرشفة على الكليشة',
        coalesce((select max(sort) + 1 from public.perm_keys), 1), false)
on conflict (key) do update set label = excluded.label;

-- ـــ ٢) سجلُّ النصوص: ما كان قبل كلِّ إصلاح
create table if not exists public.track_text_history (
  id         bigint generated always as identity primary key,
  track_id   uuid not null references public.tracks (id) on delete cascade,
  html       text,
  at         timestamptz not null default now(),
  by_whom    uuid references public.profiles (id),
  reason     text
);
create index if not exists track_text_history_track
  on public.track_text_history (track_id, at desc);
alter table public.track_text_history enable row level security;
drop policy if exists "read text history" on public.track_text_history;
create policy "read text history" on public.track_text_history for select
  to authenticated using (public.is_admin());

comment on table public.track_text_history is
  'صورةُ نصِّ الترجمة قبل كلِّ إصلاحٍ على الكليشة (ملاحظة ٥٠٢)';

-- ـــ ٣) النصُّ للإصلاح: يُقرأ بمفتاحه لا بمرحلةٍ جارية
create or replace function public.fix_text(p_track uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.is_admin_for('arch_fix') then null else
    jsonb_build_object(
      'id', t.id, 'language_code', t.language_code, 'doc_no', t.doc_no,
      'title', m.title, 'mosque', m.mosque, 'material_type', m.material_type,
      'sermon_type', m.sermon_type, 'sermon_date', m.sermon_date,
      'khateeb', k.name, 'is_published', t.is_published,
      'html', t.translation_html)
  end
    from public.tracks t
    join public.materials m on m.id = t.material_id
    left join public.khateebs k on k.id = m.khateeb_id
   where t.id = p_track and t.deleted_at is null
$$;
grant execute on function public.fix_text(uuid) to authenticated;

comment on function public.fix_text(uuid) is
  'نصُّ نسخةٍ مؤرشفةٍ لمن يملك مفتاحَ التنسيق (ملاحظة ٥٠٢)';

-- ـــ ٤) الحفظ: النصُّ السابقُ يُحفَظ ثمَّ يُكتَب الجديد، ويُسجَّل الفعل
create or replace function public.fix_translation(
  p_track uuid, p_html text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_old text; v_n bigint;
begin
  if not public.is_admin_for('arch_fix') then
    raise exception 'تنسيقُ النسخ المؤرشفة لمن يملك مفتاحَه' using errcode = '42501';
  end if;
  select translation_html into v_old from public.tracks
   where id = p_track and deleted_at is null;
  if not found then raise exception 'لا نسخةَ بهذا الرقم'; end if;
  if coalesce(v_old, '') = coalesce(p_html, '') then return; end if;

  insert into public.track_text_history (track_id, html, by_whom, reason)
  values (p_track, v_old, auth.uid(), nullif(btrim(coalesce(p_reason, '')), ''));

  -- ولا يُترَك السجلُّ ينمو بلا حدّ: يُبقى على آخر عشرين صورةً لكلِّ نسخة
  delete from public.track_text_history h
   where h.track_id = p_track
     and h.id not in (select id from public.track_text_history
                       where track_id = p_track order by at desc limit 20);

  update public.tracks set translation_html = p_html where id = p_track;
  perform public.log_event(p_track, 'edited', null, null,
    'تنسيقٌ على الكليشة بعد الأرشفة');
  perform public.log_admin('arch_fix', null,
    jsonb_build_object('track', p_track, 'reason', p_reason));
end $$;
grant execute on function public.fix_translation(uuid, text, text) to authenticated;

comment on function public.fix_translation(uuid, text, text) is
  'حفظُ تنسيقِ نسخةٍ مؤرشفة، ويبقى نصُّها السابقُ في سجلِّها (ملاحظة ٥٠٢)';

-- ـــ ٥) وسجلُّ الإصلاح يُقرَأ، ويُرَدُّ النصُّ إلى صورةٍ منه
create or replace function public.fix_history(p_track uuid)
returns table (id bigint, at timestamptz, by_whom text, reason text, chars int)
language sql stable security definer set search_path = public as $$
  select h.id, h.at, p.full_name, h.reason, length(coalesce(h.html, ''))
    from public.track_text_history h
    left join public.profiles p on p.id = h.by_whom
   where h.track_id = p_track and public.is_admin_for('arch_fix')
   order by h.at desc
$$;
grant execute on function public.fix_history(uuid) to authenticated;

create or replace function public.fix_restore(p_history bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare v public.track_text_history;
begin
  if not public.is_admin_for('arch_fix') then
    raise exception 'الردُّ إلى صورةٍ سابقةٍ لمن يملك مفتاحَ التنسيق' using errcode = '42501';
  end if;
  select * into v from public.track_text_history where id = p_history;
  if v.id is null then return false; end if;
  perform public.fix_translation(v.track_id, v.html, 'ردٌّ إلى صورةٍ سابقة');
  return true;
end $$;
grant execute on function public.fix_restore(bigint) to authenticated;

notify pgrst, 'reload schema';
