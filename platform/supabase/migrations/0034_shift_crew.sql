-- =====================================================================
-- 0034 — وردية بفريق: مسؤول ومعه أعضاء (ملاحظة ١٢٧)
--   الوردية الواحدة قد يقوم بها عدة مرشدين، ورأسهم مسؤول قد يكون من
--   خارج فريق الإرشاد. فصار لكل وردية رقم مجموعة يجمع صفوف أعضائها،
--   وعلامة تميّز مسؤولها.
-- =====================================================================

alter table public.shifts add column if not exists crew_id uuid;
alter table public.shifts add column if not exists is_lead boolean not null default false;

create index if not exists shifts_crew_idx on public.shifts (crew_id);

comment on column public.shifts.crew_id is 'رقم يجمع صفوف الوردية الواحدة لأعضائها (ملاحظة ١٢٧)';
comment on column public.shifts.is_lead is 'مسؤول الوردية';

-- ---------------------------------------------------------------------
-- حفظ وردية بفريقها: صفٌّ لكل عضو، وأولهم مسؤولها
-- ---------------------------------------------------------------------
create or replace function public.save_shift_crew(
  p_lead uuid, p_members uuid[], p_date date, p_start time, p_end time,
  p_location text default null, p_note text default null, p_crew uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_crew uuid := coalesce(p_crew, gen_random_uuid());
        v_all uuid[]; v_m uuid;
begin
  if not public.is_admin() then raise exception 'جدولة الورديات للمنسق ومدير المشروع' using errcode = '42501'; end if;
  if p_end <= p_start then raise exception 'نهاية الوردية بعد بدايتها'; end if;
  if p_lead is null then raise exception 'اختر مسؤول الوردية'; end if;

  v_all := array(select distinct x from unnest(array_append(coalesce(p_members, '{}'::uuid[]), p_lead)) as x);

  if exists (select 1 from unnest(v_all) as x
              where not exists (select 1 from public.profiles p where p.id = x and p.status = 'active')) then
    raise exception 'في الاختيار عضو غير مفعّل';
  end if;

  -- تعديل وردية قائمة: تُمسح صفوفها التي لم يُسجَّل فيها حضور ثم تُبنى
  if p_crew is not null then
    delete from public.shifts where crew_id = p_crew and check_in_at is null;
  end if;

  foreach v_m in array v_all loop
    insert into public.shifts (member_id, shift_date, start_at, end_at, location, note,
                               created_by, crew_id, is_lead)
    values (v_m, p_date, p_start, p_end, nullif(trim(coalesce(p_location, '')), ''),
            nullif(trim(coalesce(p_note, '')), ''), auth.uid(), v_crew, (v_m = p_lead))
    on conflict (member_id, shift_date, start_at) do update
      set end_at = excluded.end_at, location = excluded.location, note = excluded.note,
          crew_id = excluded.crew_id, is_lead = excluded.is_lead;
  end loop;

  return v_crew;
end $$;

grant execute on function public.save_shift_crew(uuid, uuid[], date, time, time, text, text, uuid) to authenticated;

-- حذف الوردية كلها بأعضائها
create or replace function public.delete_shift_crew(p_crew uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.is_admin() then raise exception 'حذف الورديات للمنسق ومدير المشروع' using errcode = '42501'; end if;
  delete from public.shifts where crew_id = p_crew;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'الوردية غير موجودة'; end if;
  return v_n;
end $$;

grant execute on function public.delete_shift_crew(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- من يصلح للورديات: المرشدون أولًا ثم بقية الفريق (ملاحظة ١٢٧)
-- ---------------------------------------------------------------------
create or replace function public.shift_candidates()
returns table (member_id uuid, full_name text, member_no text, role text, track text, is_field boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.member_no, p.role, coalesce(p.track, 'translation'),
         (coalesce(p.track, 'translation') = 'field')
    from public.profiles p
   where public.is_admin() and p.status = 'active'
   order by (coalesce(p.track, 'translation') = 'field') desc, p.full_name
$$;

grant execute on function public.shift_candidates() to authenticated;

notify pgrst, 'reload schema';
