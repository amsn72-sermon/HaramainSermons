-- =====================================================================
-- 0017 — دليل الإنتاج: عدد الكلمات لكل عمل ودقائق التسجيلات (ملاحظة ٩٠)
--   قوائم بالخطب والدروس والكتب وغيرها، أمام كل عمل عدد كلماته،
--   ومجموع يظهر عدّادًا رقميًّا يتحدّث.
-- =====================================================================

-- مدة التسجيل بالثواني: يقيسها المتصفح عند الرفع، وتُستكمل للقديم عند التشغيل
alter table public.track_audios add column if not exists duration_seconds int;

comment on column public.track_audios.duration_seconds
  is 'مدة التسجيل بالثواني — لحساب الدقائق الصوتية (ملاحظة ٩٠)';

-- ---------------------------------------------------------------------
-- رفع التسجيل مع مدته
-- ---------------------------------------------------------------------
drop function if exists public.set_track_audio(uuid, text);

create or replace function public.set_track_audio(p_track uuid, p_path text, p_seconds int default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_s public.track_stages;
begin
  v_s := public.current_stage(p_track);
  if v_s.id is null or v_s.assignee_id is distinct from auth.uid() then
    raise exception 'رفع التسجيل متاح لمسؤول المرحلة الحالية فقط' using errcode = '42501';
  end if;
  if (select audio_stage_key from public.tracks where id = p_track) is null then
    raise exception 'هذه المادة لا تتطلب تسجيلًا صوتيًا';
  end if;
  if not public.audio_open_for(p_track) then
    raise exception 'التسجيل الصوتي مسند إلى مرحلة لاحقة';
  end if;

  insert into public.track_audios (track_id, path, uploaded_by, stage_key, duration_seconds)
  values (p_track, p_path, auth.uid(), v_s.stage_key,
          case when p_seconds is not null and p_seconds > 0 then p_seconds end);

  -- النسخة الأحدث هي المعروضة ما لم يعتمد المدير غيرها لاحقًا
  update public.tracks set audio_path = p_path where id = p_track;
  perform public.log_event(p_track, 'audio_uploaded', v_s.stage_key, null, null);
end $$;

grant execute on function public.set_track_audio(uuid, text, int) to authenticated;

-- استكمال مدة تسجيل قديم: يكتبها المتصفح أول مرة يُشغَّل فيها
create or replace function public.set_audio_duration(p_track uuid, p_path text, p_seconds int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_seconds is null or p_seconds <= 0 or p_seconds > 86400 then return; end if;
  if not (public.is_admin() or public.can_see_track(p_track)) then return; end if;
  update public.track_audios set duration_seconds = p_seconds
   where track_id = p_track and path = p_path and duration_seconds is null;
end $$;

grant execute on function public.set_audio_duration(uuid, text, int) to authenticated;

-- ---------------------------------------------------------------------
-- صف لكل عمل مترجَم: عنوانه وتاريخه ولغته وعدد كلماته
-- ---------------------------------------------------------------------
create or replace view public.production_rows with (security_invoker = true) as
select t.id                                   as track_id,
       m.id                                   as material_id,
       m.title,
       m.material_type,
       m.sermon_type,
       m.mosque,
       m.sermon_date,
       m.created_at                           as added_at,
       t.language_code,
       t.status,
       t.completed_at,
       t.published_at,
       -- الكلمات: ما بين الفراغات في النص المجرّد من الوسوم
       case when public.plain_text(t.translation_html) = '' then 0
            else array_length(regexp_split_to_array(public.plain_text(t.translation_html), '\s+'), 1) end as words,
       -- الحروف: تنفع للغات التي لا تفصل كلماتها بفراغ كالصينية
       length(public.plain_text(t.translation_html))::int as chars,
       (select coalesce(sum(a.duration_seconds), 0)::int from public.track_audios a
         where a.track_id = t.id and a.is_approved)       as audio_seconds
from public.tracks t
join public.materials m on m.id = t.material_id
where t.deleted_at is null and m.deleted_at is null;

grant select on public.production_rows to authenticated;

comment on view public.production_rows
  is 'دليل الإنتاج: صف لكل لغة من كل مادة بعدد كلماتها وحروفها ومدة تسجيلها (ملاحظة ٩٠)';

-- ---------------------------------------------------------------------
-- المجاميع للعدّاد — بحقوق المستدعي، فيرى كلٌّ ما يخصه
-- ---------------------------------------------------------------------
create or replace function public.production_totals()
returns table (materials int, tracks int, words bigint, chars bigint, audio_seconds bigint, languages int)
language sql stable set search_path = public as $$
  select count(distinct material_id)::int,
         count(*)::int,
         coalesce(sum(words), 0)::bigint,
         coalesce(sum(chars), 0)::bigint,
         coalesce(sum(audio_seconds), 0)::bigint,
         count(distinct language_code)::int
  from public.production_rows
  where words > 0 or audio_seconds > 0
$$;

grant execute on function public.production_totals() to authenticated;
