-- =====================================================================
-- 0032 — دقائق التسجيل في دليل الإنتاج تُحتسب ولو لم يُعتمد التسجيل بعد
--   (ملاحظة ١٢٢): كان الدليل يعدّ التسجيلات المعتمدة وحدها، فإذا رُفع
--   التسجيل ولم يمرّ على اعتماد المرحلة ظهرت الدقائق صفرًا. والعمل
--   المسلَّم هو التسجيل المعتمد إن وُجد، وإلا فالمعتمَد في المسار نفسه.
-- =====================================================================

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
       case when public.plain_text(t.translation_html) = '' then 0
            else array_length(regexp_split_to_array(public.plain_text(t.translation_html), '\s+'), 1) end as words,
       length(public.plain_text(t.translation_html))::int as chars,
       coalesce(
         -- التسجيلات المعتمدة
         (select sum(a.duration_seconds)::int from public.track_audios a
           where a.track_id = t.id and a.is_approved and a.duration_seconds is not null),
         -- وإلا التسجيل المعروض في المسار
         (select a.duration_seconds from public.track_audios a
           where a.track_id = t.id and a.path = t.audio_path and a.duration_seconds is not null
           order by a.created_at desc limit 1),
         -- وإلا آخر تسجيل رُفع وقيست مدته
         (select a.duration_seconds from public.track_audios a
           where a.track_id = t.id and a.duration_seconds is not null
           order by a.created_at desc limit 1),
         0)                                   as audio_seconds
from public.tracks t
join public.materials m on m.id = t.material_id
where t.deleted_at is null and m.deleted_at is null;

grant select on public.production_rows to authenticated;

comment on view public.production_rows
  is 'دليل الإنتاج: صف لكل لغة من كل مادة بكلماتها وحروفها ودقائق تسجيلها، معتمدًا كان أو مرفوعًا (ملاحظتا ٩٠ و١٢٢)';

-- تسجيل بلا مدة محفوظة: تُقاس في المتصفح عند أول تشغيل. وهذه الدالة
-- تُصلح ما فات بكتابة المدة لأي تسجيل يراه المستدعي (ملاحظة ١٢٢)
create or replace function public.set_audio_duration(p_track uuid, p_path text, p_seconds int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_seconds is null or p_seconds <= 0 or p_seconds > 86400 then return; end if;
  if not (public.is_admin() or public.can_see_track(p_track)) then return; end if;
  update public.track_audios set duration_seconds = p_seconds
   where track_id = p_track and (p_path is null or path = p_path) and duration_seconds is null;
end $$;

grant execute on function public.set_audio_duration(uuid, text, int) to authenticated;
