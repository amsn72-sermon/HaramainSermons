-- =====================================================================
-- 0031 — تفصيل أعمال العضو المنجزة ببياناتها (ملاحظة ١٢١)
--   عند مراجعة إنجاز الفريق يُفتح اسم العضو، فتُعرض أعماله عملًا عملًا:
--   نوعه وعنوانه ولغته وتاريخ اكتماله وعدد كلماته وصفحاته ودقائق تسجيله
--   والمبلغ المستحق عليه لمن أجره بالمقطوع.
-- =====================================================================

-- ملاحظة: إن كان ترحيل ٠٠٣٣ (أساس الاحتساب) مطبَّقًا قبل هذا — وذلك يقع
-- إذا رُفع تحديث لاحق قبل سابقه — فهذه النسخة أقدم، فتُتخطّى ولا تُفسد
-- ما هو أحدث منها.
do $guard$
begin
  if to_regprocedure('public.rate_basis_for(uuid,text)') is not null then
    raise notice 'تُخطّي تفصيل الأعمال: نسخة أحدث مطبَّقة (0033)';
    return;
  end if;

  execute $f$
create or replace function public.member_work_list(p_member uuid, p_from date, p_to date)
returns table (
  track_id uuid, material_id uuid, title text, material_type text, sermon_type text,
  language_code text, work_kind text, completed_at timestamptz,
  words int, chars int, pages int, audio_seconds int, stages text, rate numeric, amount numeric
)
language sql stable security definer set search_path = public as $$
  select t.id, m.id, m.title, m.material_type, m.sermon_type,
         t.language_code,
         public.work_kind(m.material_type, m.deliverable) as work_kind,
         t.completed_at,
         r.words, r.chars,
         case when r.words > 0 then greatest(1, ceil(r.words / 250.0))::int else 0 end as pages,
         r.audio_seconds,
         (select string_agg(distinct coalesce(w.name_ar, s2.stage_key), ' · ')
            from public.track_stages s2
            left join public.workflow_stages w on w.key = s2.stage_key
           where s2.track_id = t.id and s2.assignee_id = p_member and s2.status = 'done'),
         public.rate_for(p_member, public.work_kind(m.material_type, m.deliverable)),
         public.rate_for(p_member, public.work_kind(m.material_type, m.deliverable))
    from public.tracks t
    join public.materials m on m.id = t.material_id
    left join public.production_rows r on r.track_id = t.id
   where (public.is_admin() or p_member = auth.uid())
     and t.status = 'completed' and t.deleted_at is null
     and t.completed_at >= p_from::timestamptz
     and t.completed_at < (p_to + 1)::timestamptz
     and exists (select 1 from public.track_stages s
                  where s.track_id = t.id and s.assignee_id = p_member and s.status = 'done')
   order by t.completed_at desc
$$;

  $f$;

  execute 'grant execute on function public.member_work_list(uuid, date, date) to authenticated';
end $guard$;

comment on function public.member_work_list(uuid, date, date)
  is 'أعمال العضو المكتملة في مدة، ببياناتها ومستحقّها (ملاحظة ١٢١)';
