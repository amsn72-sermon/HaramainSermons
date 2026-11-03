-- =====================================================================
-- ٠١٣٢ — رابطُ بثِّ الترجمة، ونقلُ التسجيل، وأصلُ خطبة عرفة
--   (الملاحظات ٤٧٨ و٤٧٥ و٤٧٦)
-- =====================================================================

-- ـــ ١) رابطُ بثِّ الترجمة على يوتيوب (ملاحظة ٤٧٨)
--
--   بعد الترجمة واعتماد المراحل تُبَثُّ الترجمةُ مباشرةً على يوتيوب،
--   فيُحفَظ رابطُ بثِّها في مسار اللغة — اختياريًّا، فليس كلُّ ترجمةٍ
--   تُبَثّ.
alter table public.tracks
  add column if not exists stream_video  text,
  add column if not exists stream_at     timestamptz,
  add column if not exists stream_by     uuid references public.profiles (id);

comment on column public.tracks.stream_video is
  'معرّفُ مقطع بثِّ الترجمة على يوتيوب — اختياريٌّ يُضاف بعد الترجمة (ملاحظة ٤٧٨)';

-- يُقبَل الرابطُ كما يُنسَخ من يوتيوب، ويُستخرَج منه المعرّف
--   ويُؤخَذ المعرّفُ من مواضعه المعروفة في روابط يوتيوب لا من أيِّ
--   إحدى عشرة محرفًا في الرابط، وإلّا قُرئ من رابط القناة
--   «youtube.com/@HaramainInfo/live» معرّفٌ وهميٌّ ووُصل به بثٌّ ميّت.
create or replace function public.video_id_of(p_url text)
returns text language sql immutable set search_path = public as $$
  select coalesce(m[1], m[2]) from (
    select regexp_match(btrim(coalesce(p_url, '')),
      '(?:v=|/live/|/shorts/|/embed/|youtu\.be/)([A-Za-z0-9_-]{11})(?:[?&/#]|$)'
      || '|^([A-Za-z0-9_-]{11})$') as m) x
$$;

comment on function public.video_id_of(text) is
  'استخراجُ معرّف مقطع يوتيوب من رابطٍ أو من المعرّف نفسِه (ملاحظة ٤٧٨)';

create or replace function public.set_track_stream(p_track uuid, p_url text)
returns text language plpgsql security definer set search_path = public as $$
declare v_t public.tracks; v_id text;
begin
  if not (public.is_admin() or public.is_lang_supervisor(p_track)) then
    raise exception 'رابطُ البثِّ للإدارة ولمشرف اللغة' using errcode = '42501';
  end if;
  select * into v_t from public.tracks where id = p_track;
  if not found then raise exception 'المسار غير موجود'; end if;
  if nullif(btrim(coalesce(p_url, '')), '') is null then
    update public.tracks set stream_video = null, stream_at = null, stream_by = null
     where id = p_track;
    perform public.log_event(p_track, 'stream_cleared', null, null, null);
    return null;
  end if;
  v_id := public.video_id_of(p_url);
  if v_id is null then
    raise exception 'الرابطُ لا يحمل معرّفَ مقطعٍ صحيحًا';
  end if;
  update public.tracks
     set stream_video = v_id, stream_at = now(), stream_by = auth.uid()
   where id = p_track;
  perform public.log_event(p_track, 'stream_set', null, null, v_id);
  return v_id;
end $$;
grant execute on function public.set_track_stream(uuid, text) to authenticated;

comment on function public.set_track_stream(uuid, text) is
  'حفظُ رابط بثِّ الترجمة أو مسحُه — للإدارة ولمشرف اللغة (ملاحظة ٤٧٨)';

-- ـــ ٢) نقلُ التسجيل الصوتي بين المراحل (ملاحظة ٤٧٥)
--
--   مرحلةُ التسجيل تُختار عند إنشاء المادة ولم يكن لها بعدَه سبيلٌ إلى
--   التغيير، فإذا تبيَّن أنَّ الأنسبَ غيرُها لم يكن إلا إعادةُ الإنشاء.
--   ويُشترَط ألّا يكون التسجيلُ قد رُفع، فالمرفوعُ لا يُنقَل.
create or replace function public.set_audio_stage(p_track uuid, p_stage text)
returns void language plpgsql security definer set search_path = public as $$
declare v_t public.tracks; v_ws public.workflow_stages;
begin
  if not (public.is_admin() or public.is_lang_supervisor(p_track)) then
    raise exception 'نقلُ التسجيل للإدارة ولمشرف اللغة' using errcode = '42501';
  end if;
  select * into v_t from public.tracks where id = p_track for update;
  if not found then raise exception 'المسار غير موجود'; end if;
  if v_t.audio_stage_key is null then
    raise exception 'هذه المادةُ لا تسجيلَ فيها';
  end if;
  if v_t.audio_path is not null
     or exists (select 1 from public.track_audios where track_id = p_track) then
    raise exception 'رُفع التسجيلُ فلا تُنقَل مرحلتُه';
  end if;
  if not exists (select 1 from public.track_stages
                  where track_id = p_track and stage_key = p_stage) then
    raise exception 'المرحلة غير موجودة في هذا المسار';
  end if;
  select * into v_ws from public.workflow_stages where key = p_stage;
  if v_ws.assignee_role <> 'translator' then
    raise exception 'التسجيلُ يكون على مرحلةٍ من مراحل المترجمين';
  end if;
  if v_t.audio_stage_key = p_stage then return; end if;
  update public.tracks set audio_stage_key = p_stage where id = p_track;
  perform public.log_event(p_track, 'audio_stage_moved', p_stage, null, v_ws.name_ar);
end $$;
grant execute on function public.set_audio_stage(uuid, text) to authenticated;

comment on function public.set_audio_stage(uuid, text) is
  'نقلُ مرحلة التسجيل الصوتي ما دام لم يُرفَع — للإدارة ولمشرف اللغة (ملاحظة ٤٧٥)';

-- ـــ ٣) الأصلُ العربيُّ لخطبة عرفة (ملاحظة ٤٧٦)
--
--   قائمةُ عرفة على يوتيوب لا تتضمَّن الخطبةَ العربيةَ الأصلية، فكانت
--   تُضاف في إعدادات الواجهة بسطرٍ لكلِّ عام — أي برفع ملفٍّ كلَّ سنة.
--   فصارت تُدار من المنصة، ويقرؤها الموقعُ العامُّ بلا حساب.
create table if not exists public.arafah_originals (
  year       int primary key check (year between 1400 and 1600),
  video_id   text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  note       text,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

comment on table public.arafah_originals is
  'الأصلُ العربيُّ لخطبة عرفة لكلِّ عامٍ هجريّ (ملاحظة ٤٧٦)';

alter table public.arafah_originals enable row level security;
-- ولا يُقرأ الجدولُ مباشرةً: فيه مَن عدَّل ومتى، والزائرُ إنما يحتاج
--   العامَ والمعرّف، وهما ما تُعيده الدالّةُ أدناه
drop policy if exists "read arafah originals" on public.arafah_originals;
create policy "read arafah originals" on public.arafah_originals for select
  using (public.is_admin());
grant select on public.arafah_originals to authenticated;

insert into public.arafah_originals (year, video_id, note)
values (1447, 'Ea664JHx2rY', 'نُقل من إعدادات الواجهة')
on conflict (year) do nothing;

create or replace function public.arafah_originals()
returns table (year int, video_id text)
language sql stable security definer set search_path = public as $$
  select a.year, a.video_id from public.arafah_originals a order by a.year desc
$$;
grant execute on function public.arafah_originals() to anon, authenticated;

create or replace function public.set_arafah_original(
  p_year int, p_url text, p_note text default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  if not public.is_admin() then
    raise exception 'أصلُ خطبة عرفة للمنسق ومدير المشروع' using errcode = '42501';
  end if;
  if p_year is null or p_year < 1400 or p_year > 1600 then
    raise exception 'سنةٌ هجريةٌ غير صحيحة';
  end if;
  if nullif(btrim(coalesce(p_url, '')), '') is null then
    delete from public.arafah_originals where year = p_year;
    return null;
  end if;
  v_id := public.video_id_of(p_url);
  if v_id is null then raise exception 'الرابطُ لا يحمل معرّفَ مقطعٍ صحيحًا'; end if;
  insert into public.arafah_originals (year, video_id, note, updated_by)
  values (p_year, v_id, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  on conflict (year) do update
    set video_id = excluded.video_id, note = excluded.note,
        updated_by = auth.uid(), updated_at = now();
  return v_id;
end $$;
grant execute on function public.set_arafah_original(int, text, text) to authenticated;

comment on function public.set_arafah_original(int, text, text) is
  'تعيينُ الأصل العربيِّ لخطبة عرفة في عامٍ هجريّ — للإدارة (ملاحظة ٤٧٦)';

-- ـــ ٤) ومشرفُ اللغة الموقوفُ عن العمل ليس مشرفًا
--   `is_lang_supervisor` كانت تنظر في الإسناد وحدَه بلا حالة الحساب،
--   بخلاف `is_admin()` و`my_role()`. فمن أُوقف حسابُه وبقي اسمُه مشرفًا
--   كان يملك ما يملكه المشرف.
create or replace function public.is_lang_supervisor(p_track uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tracks t
      join public.languages l on l.code = t.language_code
      join public.profiles p on p.id = l.supervisor_id
     where t.id = p_track and p.id = auth.uid() and p.status = 'active')
$$;
