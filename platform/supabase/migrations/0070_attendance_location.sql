-- =====================================================================
-- 0070 — الحضورُ بالموقع من المتصفح (ملاحظة ٢١٩)
--   يفتح العضو شاشةَ «حضوري» في جواله، فيأذن للمتصفح بموضعه، فتُرسل
--   إحداثيّاته. و**الحسابُ في قاعدة البيانات لا في الجهاز**: تُقاس
--   المسافةُ إلى موقعه المسنَد، فتُقبل أو تُردّ. ولا يُصدَّق موضعٌ
--   يرسله التطبيقُ ويُكتب كما هو.
--
--   والمواقعُ ثلاثةٌ ابتداءً، واسعةٌ حتى تستقرّ التجربة:
--     المسجد الحرام كاملًا، والمسجد النبوي كاملًا، ومبنى الترجمة
--     بجوار الحرم. ومن كان في مكة قِيس على الحرم المكي، ومن في المدينة
--     على النبوي — من نفسه، بلا إسنادٍ يدوي.
--   ثم يُضبط الموقعُ بالضبط على الخريطة متى شاءت الإدارةُ أو قائدُ
--   الفريق الميداني، فيُسنَد لكل عضوٍ موقعُه.
--
--   ويُسجَّل مع الحضور: المسافةُ ودقّةُ الإشارة. فالتزويرُ يبقى ممكنًا
--   بأدواتٍ متخصّصة، لكنه يضيق، ويبقى للقائد أن يراجع ما يستريب فيه.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) المواقع: نقطةٌ ونصفُ قطر
-- ---------------------------------------------------------------------
create table if not exists public.work_sites (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  city       text check (city is null or city in ('makkah', 'madinah')),
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  radius_m   integer not null default 300 check (radius_m between 20 and 5000),
  is_default boolean not null default false,
  is_active  boolean not null default true,
  note       text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists work_sites_city_idx on public.work_sites (city);
alter table public.work_sites enable row level security;
drop policy if exists "read work sites" on public.work_sites;
create policy "read work sites" on public.work_sites
  for select using (public.my_role() is not null);
grant select on public.work_sites to authenticated;

comment on table public.work_sites is
  'مواقعُ العمل: نقطةٌ ونصفُ قطر يُقاس عليهما الحضور (ملاحظة ٢١٩)';

-- النطاقاتُ الثلاثة الافتراضية — واسعةٌ حتى تستقرّ التجربة، ثم تُضبط
insert into public.work_sites (name, city, lat, lng, radius_m, is_default, note)
select * from (values
  ('المسجد الحرام كاملًا', 'makkah',  21.422487, 39.826206, 500, true,
   'من الكعبة المشرفة، ويشمل التوسعةَ والساحات'),
  ('المسجد النبوي كاملًا', 'madinah', 24.467227, 39.611111, 450, true,
   'من الروضة الشريفة، ويشمل الساحات'),
  ('مبنى الترجمة بجوار الحرم', 'makkah', 21.422487, 39.826206, 150, false,
   'يُضبط موضعُه بالوقوف فيه ثم «خذ موضعي الآن»')
) v(name, city, lat, lng, radius_m, is_default, note)
where not exists (select 1 from public.work_sites);

-- موقعُ العضو المسنَد: إن لم يُسنَد قِيس على نطاق مدينته
alter table public.profiles
  add column if not exists site_id uuid references public.work_sites (id) on delete set null;
comment on column public.profiles.site_id is
  'موقعُ العضو المسنَد؛ فإن خلا قِيس على نطاق مدينته (ملاحظة ٢١٩)';

-- ---------------------------------------------------------------------
-- ٢) المسافة بين نقطتين على سطح الأرض — بالمتر
-- ---------------------------------------------------------------------
create or replace function public.geo_distance_m(
  p_lat1 double precision, p_lng1 double precision,
  p_lat2 double precision, p_lng2 double precision)
returns double precision language sql immutable as $$
  select 6371000 * 2 * asin(sqrt(
      power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2))
      * power(sin(radians(p_lng2 - p_lng1) / 2), 2)))
$$;
grant execute on function public.geo_distance_m(double precision, double precision,
  double precision, double precision) to authenticated;

-- موقعُ عضوٍ بعينه: المسنَدُ له، وإلا افتراضيُّ مدينته
create or replace function public.site_for(p_member uuid)
returns public.work_sites language sql stable security definer set search_path = public as $$
  select s.* from public.work_sites s
   where s.is_active
     and (s.id = (select p.site_id from public.profiles p where p.id = p_member)
          or (s.is_default
              and s.city is not distinct from (select p.city from public.profiles p where p.id = p_member)))
   order by (s.id = (select p.site_id from public.profiles p where p.id = p_member)) desc
   limit 1
$$;
grant execute on function public.site_for(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ٣) سجلُّ الحضور بالموقع
-- ---------------------------------------------------------------------
alter table public.shifts
  add column if not exists in_lat    double precision,
  add column if not exists in_lng    double precision,
  add column if not exists in_acc_m  integer,
  add column if not exists in_dist_m integer,
  add column if not exists in_site   uuid references public.work_sites (id),
  add column if not exists out_lat   double precision,
  add column if not exists out_lng   double precision,
  add column if not exists out_acc_m integer,
  add column if not exists out_dist_m integer;

comment on column public.shifts.in_dist_m is
  'بُعدُ العضو عن موقعه حين سجّل حضوره، بالمتر (ملاحظة ٢١٩)';

-- حدُّ الدقّة المقبولة: ما ضعفت إشارتُه لا يُقبل
alter table public.platform_settings
  add column if not exists geo_max_accuracy_m integer not null default 120;

-- ---------------------------------------------------------------------
-- ٤) التسجيل: الحسابُ هنا لا في الجهاز
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
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
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

  v_dist := public.geo_distance_m(p_lat, p_lng, v_site.lat, v_site.lng);
  if v_dist > v_site.radius_m then
    raise exception 'أنت خارج نطاق «%»: تبعد عنه % مترًا، والنطاق % مترًا',
      v_site.name, round(v_dist)::int, v_site.radius_m;
  end if;

  -- مناوبةُ اليوم إن كانت مجدولة، وإلا سُجّلت مناوبةٌ لهذا اليوم
  select * into v_sh from public.shifts
   where member_id = v_uid and shift_date = v_today
   order by start_at limit 1;

  if v_sh.id is null then
    if p_out then raise exception 'لم تسجّل حضورك اليوم بعد'; end if;
    insert into public.shifts (member_id, shift_date, start_at, end_at, status,
                               check_in_at, in_lat, in_lng, in_acc_m, in_dist_m, in_site, created_by)
    values (v_uid, v_today, (now() at time zone 'Asia/Riyadh')::time,
            ((now() at time zone 'Asia/Riyadh') + interval '8 hours')::time, 'present',
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

  return jsonb_build_object(
    'ok', true, 'site', v_site.name, 'distance_m', round(v_dist)::int,
    'radius_m', v_site.radius_m, 'out', p_out,
    'at', coalesce(v_sh.check_out_at, v_sh.check_in_at));
end $$;
grant execute on function public.geo_check_in(double precision, double precision,
  double precision, boolean) to authenticated;

-- حالُ يومي: ليعرف العضو ما سجّله
create or replace function public.my_attendance_today()
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'site',        (select s.name from public.site_for(auth.uid()) s),
    'radius_m',    (select s.radius_m from public.site_for(auth.uid()) s),
    'lat',         (select s.lat from public.site_for(auth.uid()) s),
    'lng',         (select s.lng from public.site_for(auth.uid()) s),
    'check_in_at',  sh.check_in_at,
    'check_out_at', sh.check_out_at,
    'in_dist_m',    sh.in_dist_m)
    from (select * from public.shifts
           where member_id = auth.uid()
             and shift_date = (now() at time zone 'Asia/Riyadh')::date
           order by start_at limit 1) sh
   union all
  select jsonb_build_object(
    'site',     (select s.name from public.site_for(auth.uid()) s),
    'radius_m', (select s.radius_m from public.site_for(auth.uid()) s),
    'lat',      (select s.lat from public.site_for(auth.uid()) s),
    'lng',      (select s.lng from public.site_for(auth.uid()) s))
   where not exists (select 1 from public.shifts
                      where member_id = auth.uid()
                        and shift_date = (now() at time zone 'Asia/Riyadh')::date)
  limit 1
$$;
grant execute on function public.my_attendance_today() to authenticated;

-- ---------------------------------------------------------------------
-- ٥) ضبطُ المواقع: للإدارة ولقائد الفريق الميداني
-- ---------------------------------------------------------------------
create or replace function public.may_set_sites()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin_for('shifts') or public.is_field_lead()
$$;
grant execute on function public.may_set_sites() to authenticated;

create or replace function public.save_work_site(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
        v_name text := nullif(trim(coalesce(p ->> 'name', '')), '');
        v_rad int := coalesce((p ->> 'radius_m')::int, 300);
begin
  if not public.may_set_sites() then
    raise exception 'ضبطُ المواقع للإدارة ولقائد الفريق الميداني' using errcode = '42501';
  end if;
  if v_name is null then raise exception 'اكتب اسم الموقع'; end if;
  if v_rad < 20 or v_rad > 5000 then raise exception 'نصفُ القطر بين ٢٠ و٥٠٠٠ متر'; end if;

  if v_id is null then
    insert into public.work_sites (name, city, lat, lng, radius_m, note, created_by)
    values (v_name, nullif(trim(coalesce(p ->> 'city', '')), ''),
            (p ->> 'lat')::double precision, (p ->> 'lng')::double precision,
            v_rad, nullif(trim(coalesce(p ->> 'note', '')), ''), auth.uid())
    returning id into v_id;
  else
    update public.work_sites
       set name = v_name,
           city = nullif(trim(coalesce(p ->> 'city', '')), ''),
           lat = (p ->> 'lat')::double precision,
           lng = (p ->> 'lng')::double precision,
           radius_m = v_rad,
           note = nullif(trim(coalesce(p ->> 'note', '')), ''),
           is_active = coalesce((p ->> 'is_active')::boolean, is_active)
     where id = v_id;
    if not found then raise exception 'الموقع غير موجود'; end if;
  end if;
  return v_id;
end $$;
grant execute on function public.save_work_site(jsonb) to authenticated;

create or replace function public.set_member_site(p_member uuid, p_site uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin_for('team')
          or (public.is_field_lead() and public.in_my_lead_scope(p_member))) then
    raise exception 'إسنادُ الموقع للإدارة ولقائد الفريق في نطاقه' using errcode = '42501';
  end if;
  update public.profiles set site_id = p_site where id = p_member;
  if not found then raise exception 'العضو غير موجود'; end if;
end $$;
grant execute on function public.set_member_site(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
