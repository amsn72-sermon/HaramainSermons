-- =====================================================================
-- 0090 — الحضورُ يُقاس بالوردية المقرَّرة لا بوقت البصمة (ملاحظة ٢٦٤)
--
--   كان التسجيلُ يولّد الورديةَ من لحظة البصمة: فمن حُدّدت له وردةٌ من
--   السابعة إلى الثالثة ثم بصم الحاديةَ عشرة، ظهرت وردتُه «١١:٠٠ –
--   ١٩:٠٠»، فسقط التأخيرُ كلُّه ومُنح ثماني ساعاتٍ كاملةً متى حضر.
--
--   فالوردةُ هي المرجع: إن كانت ٠٧:٠٠–١٥:٠٠ فهي كذلك في البطاقة وفي
--   الحساب، ولو بصم الحاديةَ عشرة. والتأخيرُ يُحتسب، والمتبقّي إلى
--   نهاية الوردة لا ثماني ساعاتٍ من البصمة، والانصرافُ قبلها يُحتسب.
--
--   والأصلُ أن يلتزم بالوقت والمكان المحدَّدَين له. والدوامُ المرن
--   خيارٌ يُفعَّل لمن يُراد له وحدَه: يُطلب منه إتمامُ الساعات لا
--   الالتزامُ بالساعة المعيّنة.
-- =====================================================================

alter table public.shifts
  add column if not exists early_minutes  int not null default 0,
  add column if not exists worked_minutes int,
  add column if not exists unscheduled    boolean not null default false;

comment on column public.shifts.early_minutes is
  'دقائقُ الانصراف قبل نهاية الوردة المقرَّرة (ملاحظة ٢٦٤ هـ)';
comment on column public.shifts.worked_minutes is
  'ما احتُسب له من عملٍ داخل حدود الوردة (ملاحظة ٢٦٤ د)';
comment on column public.shifts.unscheduled is
  'بصمةٌ بلا وردةٍ مجدولة — لا يُقاس عليها تأخيرٌ ولا متبقٍّ';

-- الدوامُ المرن: لمن يُفعَّل له وحدَه، والأصلُ المنع (ملاحظة ٢٦٤ ز)
alter table public.profiles
  add column if not exists flex_hours boolean not null default false;

comment on column public.profiles.flex_hours is
  'دوامٌ مرن: يُطلب إتمامُ الساعات لا الالتزامُ بالساعة المعيّنة (ملاحظة ٢٦٤ ز)';

create or replace function public.set_flex_hours(p_member uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_manager() or public.has_perm('sh_flex')) then
    raise exception 'الدوامُ المرن يُفعَّل بإذن مدير المشروع' using errcode = '42501';
  end if;
  if not public.may_act_on(p_member) then
    raise exception 'لا تُغيّر دوامَ نظيرك' using errcode = '42501';
  end if;
  update public.profiles set flex_hours = coalesce(p_on, false) where id = p_member;
  if not found then raise exception 'العضو غير موجود'; end if;
  perform public.log_admin('flex', p_member, jsonb_build_object('on', p_on));
end $$;
grant execute on function public.set_flex_hours(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- حسابُ الوردية: التأخيرُ والانصرافُ المبكرُ وما احتُسب من عمل
--
--   كلُّه مقيسٌ على start_at و end_at المقرَّرتين. وإن امتدّت الوردةُ
--   إلى ما بعد منتصف الليل (نهايةٌ أصغرُ من بداية) حُسب لها يومٌ تالٍ.
-- ---------------------------------------------------------------------
create or replace function public.shift_recalc(p_shift uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s        public.shifts;
  v_flex   boolean;
  v_start  timestamptz;
  v_end    timestamptz;
  v_in     timestamptz;
  v_out    timestamptz;
  v_late   int := 0;
  v_early  int := 0;
  v_worked int;
begin
  select * into s from public.shifts where id = p_shift;
  if not found then return; end if;

  if s.unscheduled then
    update public.shifts
       set late_minutes = 0, early_minutes = 0,
           worked_minutes = case when s.check_in_at is not null and s.check_out_at is not null
                                 then greatest(0, (extract(epoch from (s.check_out_at - s.check_in_at)) / 60)::int)
                                 else null end
     where id = p_shift;
    return;
  end if;

  select coalesce(flex_hours, false) into v_flex from public.profiles where id = s.member_id;

  v_start := (s.shift_date + s.start_at) at time zone 'Asia/Riyadh';
  v_end   := ((case when s.end_at <= s.start_at then s.shift_date + 1 else s.shift_date end)
              + s.end_at) at time zone 'Asia/Riyadh';
  v_in    := s.check_in_at;
  v_out   := s.check_out_at;

  if v_in is not null and not v_flex then
    v_late := greatest(0, (extract(epoch from (v_in - v_start)) / 60)::int);
  end if;

  if v_in is not null and v_out is not null then
    -- ما احتُسب: ما وقع داخل حدود الوردة لا خارجها
    v_worked := greatest(0, (extract(epoch from (
                  least(v_out, v_end) - greatest(v_in, v_start))) / 60)::int);
    if not v_flex then
      v_early := greatest(0, (extract(epoch from (v_end - v_out)) / 60)::int);
    end if;
    -- وفي الدوام المرن: العبرةُ بإتمام النصاب، فإن نقص عُدَّ نقصًا لا تأخيرًا
    if v_flex then
      v_worked := greatest(0, (extract(epoch from (v_out - v_in)) / 60)::int);
      v_early  := greatest(0, (extract(epoch from (v_end - v_start)) / 60)::int - v_worked);
    end if;
  end if;

  update public.shifts
     set late_minutes   = v_late,
         early_minutes  = v_early,
         worked_minutes = v_worked
   where id = p_shift;
end $$;
grant execute on function public.shift_recalc(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- التسجيل: الوردةُ المقرَّرةُ تبقى على حالها
-- ---------------------------------------------------------------------
create or replace function public.geo_check_in(
  p_lat double precision, p_lng double precision, p_acc double precision, p_out boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_site public.work_sites;
  v_dist double precision;
  v_max  int;
  v_sh   public.shifts;
  v_now  timestamp := now() at time zone 'Asia/Riyadh';
  v_today date := v_now::date;
begin
  if v_uid is null then raise exception 'لا جلسة' using errcode = '42501'; end if;
  if p_lat is null or p_lng is null then raise exception 'لم يصل موضعُك من المتصفح'; end if;

  select * into v_site from public.site_for(v_uid);
  if v_site.id is null then
    raise exception 'لا موقعَ محدَّدٌ لك — راجع قائد فريقك ليحدّد موقعك';
  end if;

  select coalesce(geo_max_accuracy_m, 120) into v_max from public.platform_settings limit 1;
  if p_acc is not null and p_acc > v_max then
    raise exception 'إشارةُ الموقع ضعيفة (± % مترًا) — اخرج إلى مكانٍ مكشوفٍ وأعد المحاولة',
      round(p_acc)::int;
  end if;

  -- ولا تُقبل البصمةُ إلا من موقعه المحدَّد (ملاحظة ٢٦٤ و)
  v_dist := public.geo_distance_m(p_lat, p_lng, v_site.lat, v_site.lng);
  if v_dist > v_site.radius_m then
    raise exception 'أنت خارج نطاق «%»: تبعد عنه % مترًا، والنطاق % مترًا',
      v_site.name, round(v_dist)::int, v_site.radius_m;
  end if;

  -- وردةُ اليوم: أقربُ المجدولات إلى هذه الساعة، لا أوّلُها
  select * into v_sh from public.shifts
   where member_id = v_uid and shift_date = v_today
   order by (case when p_out and check_in_at is not null then 0 else 1 end),
            abs(extract(epoch from (v_now::time - start_at)))
   limit 1;

  if v_sh.id is null then
    -- لا تُولَّد وردةٌ من وقت البصمة: تُسجَّل بصمةٌ خارج الجدول (ملاحظة ٢٦٤ أ)
    if p_out then raise exception 'لم تسجّل حضورك اليوم بعد'; end if;
    insert into public.shifts (member_id, shift_date, start_at, end_at, status, unscheduled,
                               check_in_at, in_lat, in_lng, in_acc_m, in_dist_m, in_site, created_by)
    values (v_uid, v_today, v_now::time, v_now::time, 'present', true,
            now(), p_lat, p_lng, round(coalesce(p_acc, 0))::int, round(v_dist)::int, v_site.id, v_uid)
    returning * into v_sh;
  elsif p_out then
    update public.shifts
       set check_out_at = now(), out_lat = p_lat, out_lng = p_lng,
           out_acc_m = round(coalesce(p_acc, 0))::int, out_dist_m = round(v_dist)::int
     where id = v_sh.id returning * into v_sh;
  else
    if v_sh.check_in_at is not null then raise exception 'سجّلتَ حضورك اليوم'; end if;
    update public.shifts
       set status = 'present', check_in_at = now(), in_lat = p_lat, in_lng = p_lng,
           in_acc_m = round(coalesce(p_acc, 0))::int, in_dist_m = round(v_dist)::int,
           in_site = v_site.id
     where id = v_sh.id returning * into v_sh;
  end if;

  perform public.shift_recalc(v_sh.id);
  select * into v_sh from public.shifts where id = v_sh.id;

  return jsonb_build_object(
    'ok', true, 'site', v_site.name, 'distance_m', round(v_dist)::int,
    'radius_m', v_site.radius_m, 'out', p_out,
    'scheduled', not v_sh.unscheduled,
    'shift_start', v_sh.start_at, 'shift_end', v_sh.end_at,
    'late_minutes', v_sh.late_minutes, 'early_minutes', v_sh.early_minutes,
    'at', coalesce(v_sh.check_out_at, v_sh.check_in_at));
end $$;
grant execute on function public.geo_check_in(double precision, double precision,
  double precision, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- وكلُّ تعديلٍ على الوردية يُعيد الحساب، فلا يبقى رقمٌ قديمٌ على خطئه
-- ---------------------------------------------------------------------
create or replace function public.shift_recalc_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.shift_recalc(new.id);
  return null;
end $$;

drop trigger if exists shifts_recalc on public.shifts;
create trigger shifts_recalc after insert or update of
  start_at, end_at, check_in_at, check_out_at, unscheduled
  on public.shifts for each row execute function public.shift_recalc_trg();

-- وإعادةُ احتسابِ ما سُجّل على الحساب الخاطئ (ملاحظة ٢٦٤ ح)
do $do$
declare r record;
begin
  -- ما وُلّد من وقت البصمة يُعلَّم أنه خارج الجدول، فلا يُقاس عليه تأخير
  update public.shifts s
     set unscheduled = true
   where s.created_by = s.member_id
     and s.check_in_at is not null
     and abs(extract(epoch from ((s.check_in_at at time zone 'Asia/Riyadh')::time - s.start_at))) < 120;
  for r in select id from public.shifts where check_in_at is not null loop
    perform public.shift_recalc(r.id);
  end loop;
end $do$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- حالُ اليوم يُري العضوَ وردتَه المقرَّرةَ وتأخيرَه وما بقي من وقتها
-- لا ثماني ساعاتٍ من بصمته (ملاحظة ٢٦٤ ج)
-- ---------------------------------------------------------------------
create or replace function public.my_attendance_today()
returns jsonb language sql security definer set search_path = public as $$
  with site as (select * from public.site_for(auth.uid())),
       sh as (
         select * from public.shifts
          where member_id = auth.uid()
            and shift_date = (now() at time zone 'Asia/Riyadh')::date
          order by abs(extract(epoch from ((now() at time zone 'Asia/Riyadh')::time - start_at)))
          limit 1)
  select jsonb_build_object(
    'site',         (select name from site),
    'radius_m',     (select radius_m from site),
    'lat',          (select lat from site),
    'lng',          (select lng from site),
    'flex',         coalesce((select flex_hours from public.profiles where id = auth.uid()), false),
    'scheduled',    (select not unscheduled from sh),
    'shift_start',  (select start_at from sh),
    'shift_end',    (select end_at from sh),
    'check_in_at',  (select check_in_at from sh),
    'check_out_at', (select check_out_at from sh),
    'late_minutes', (select late_minutes from sh),
    'early_minutes',(select early_minutes from sh),
    'worked_minutes', (select worked_minutes from sh),
    'left_minutes', (select case when unscheduled then null else greatest(0,
        (extract(epoch from (
           ((case when end_at <= start_at then shift_date + 1 else shift_date end) + end_at)
             at time zone 'Asia/Riyadh') - now()) / 60)::int) end from sh),
    'in_dist_m',    (select in_dist_m from sh))
$$;
grant execute on function public.my_attendance_today() to authenticated;

notify pgrst, 'reload schema';
