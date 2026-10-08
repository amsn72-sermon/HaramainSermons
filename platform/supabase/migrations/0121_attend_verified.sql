-- =====================================================================
-- 0121 — الحضورُ: غيابٌ يُكتب، وتأخيرٌ يُقاس، وحضورٌ مُتحقَّقٌ منه
--        (ملاحظات ٣٧٤ و٣٧٥ و٣٧٦)
--
--   كانت الوردةُ تبقى «مجدولة» إلى الأبد إن لم يبصم صاحبُها، فلا يُعرَف
--   الغائبُ إلا بالنظر. وكان الانصرافُ يُقبَل بضغطةٍ متى شاء: يغادر
--   والمتصفِّحُ مغلق، فإذا جاء وقتُ الانصراف فتحه فسُجِّل له.
--
--   وههنا حدٌّ تقنيٌّ لا يُتجاوَز: صفحةُ الوِب لا تقرأ الموقعَ والمتصفِّحُ
--   مغلق. فقُلبت القاعدةُ: لا نحاول اصطيادَه بعد الغياب، بل لا نحتسب
--   إلا الوقتَ المُتحقَّقَ منه — نبضٌ دوريٌّ يحمل الموقعَ ما دامت الصفحةُ
--   مفتوحة، والفجوةُ بين نبضتين وقتٌ غيرُ مُتحقَّقٍ منه يُطرَح ويُبيَّن.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) الإعدادات: مهلةُ تسامحٍ ومدّةُ النبض
-- ---------------------------------------------------------------------
alter table public.platform_settings
  add column if not exists late_grace_min     int not null default 5,
  add column if not exists geo_ping_min       int not null default 5,
  add column if not exists geo_gap_tolerance  int not null default 12;

comment on column public.platform_settings.late_grace_min is
  'مهلةُ تسامحٍ لا يُحتسَب التأخيرُ دونها، بالدقائق (ملاحظة ٣٧٤)';
comment on column public.platform_settings.geo_ping_min is
  'كلَّ كم دقيقةٍ يُرسَل نبضُ الموقع ما دامت الصفحةُ مفتوحة (ملاحظة ٣٧٥)';
comment on column public.platform_settings.geo_gap_tolerance is
  'ما فوقه من فجوةٍ بين نبضتين يُعَدُّ وقتًا غيرَ مُتحقَّقٍ منه (ملاحظة ٣٧٥)';

-- ---------------------------------------------------------------------
-- ٢) حالُ الوردة: ما يُتحقَّق منه وما لا
-- ---------------------------------------------------------------------
alter table public.shifts
  add column if not exists verified_minutes int,
  add column if not exists gap_minutes      int,
  add column if not exists out_unverified   boolean not null default false,
  add column if not exists out_outside      boolean not null default false,
  add column if not exists last_ping_at     timestamptz,
  add column if not exists challenge_at     timestamptz,
  add column if not exists challenge_ok_at  timestamptz,
  add column if not exists flags            text[];

comment on column public.shifts.verified_minutes is
  'الدقائقُ الموصولةُ بنبضِ موقعٍ — وما سواها لا يُحتسَب (ملاحظة ٣٧٥)';
comment on column public.shifts.gap_minutes is
  'ما بين النبضات من وقتٍ غيرِ مُتحقَّقٍ منه (ملاحظة ٣٧٥)';
comment on column public.shifts.out_unverified is
  'انصرافٌ سُجِّل ولا نبضَ قبله بوقتٍ قريب — يُرفَع للمشرف (ملاحظة ٣٧٥)';
comment on column public.shifts.out_outside is
  'انصرافٌ سُجِّل من خارج نطاق الموقع (ملاحظة ٣٧٦)';

-- ونبضُ الموقع سجلٌّ قائم: منه تُبنى الفتراتُ الموصولة
create table if not exists public.shift_pings (
  id        bigserial primary key,
  shift_id  uuid not null references public.shifts (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  at        timestamptz not null default now(),
  lat       double precision,
  lng       double precision,
  acc_m     int,
  dist_m    int,
  inside    boolean not null default true,
  kind      text not null default 'ping'
              check (kind in ('ping', 'in', 'out', 'challenge'))
);
create index if not exists shift_pings_shift on public.shift_pings (shift_id, at);

comment on table public.shift_pings is
  'نبضُ الموقع ما دامت صفحةُ الحضور مفتوحة — تُبنى منه الفتراتُ '
  'المُتحقَّقُ منها (ملاحظة ٣٧٥)';

alter table public.shift_pings enable row level security;
drop policy if exists "read my pings" on public.shift_pings;
create policy "read my pings" on public.shift_pings for select
  using (member_id = auth.uid() or public.is_admin() or public.is_admin_for('sh_view'));

-- ---------------------------------------------------------------------
-- ٣) احتسابُ المُتحقَّق منه: الفجوةُ تُطرَح ولا تُحتسَب
-- ---------------------------------------------------------------------
create or replace function public.shift_presence(p_shift uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.shifts; v_tol int; v_prev timestamptz; v_ver int := 0; v_gap int := 0;
        r record; v_end timestamptz;
begin
  select * into s from public.shifts where id = p_shift;
  if not found or s.check_in_at is null then return; end if;
  select coalesce(geo_gap_tolerance, 12) into v_tol from public.platform_settings limit 1;

  v_prev := s.check_in_at;
  v_end := coalesce(s.check_out_at, s.last_ping_at, s.check_in_at);

  for r in select at from public.shift_pings
            where shift_id = p_shift and at >= s.check_in_at and at <= v_end
            order by at loop
    declare d int := greatest(0, (extract(epoch from (r.at - v_prev)) / 60)::int);
    begin
      if d <= v_tol then v_ver := v_ver + d; else v_gap := v_gap + d; end if;
      v_prev := r.at;
    end;
  end loop;

  -- وما بعد آخر نبضةٍ إلى الانصراف: يُقبَل إن كان قريبًا، وإلا فجوة
  declare d2 int := greatest(0, (extract(epoch from (v_end - v_prev)) / 60)::int);
  begin
    if d2 <= v_tol then v_ver := v_ver + d2; else v_gap := v_gap + d2; end if;
  end;

  update public.shifts
     set verified_minutes = v_ver, gap_minutes = v_gap
   where id = p_shift;
end $$;
grant execute on function public.shift_presence(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ٤) النبضُ نفسُه: يُرسَل من الصفحة المفتوحة
-- ---------------------------------------------------------------------
create or replace function public.geo_ping(p_lat double precision, p_lng double precision,
                                           p_acc double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_site public.work_sites; v_dist double precision;
        v_sh public.shifts; v_today date := (now() at time zone 'Asia/Riyadh')::date;
        v_ask boolean := false; v_every int;
begin
  if v_uid is null then raise exception 'لا جلسة' using errcode = '42501'; end if;
  if p_lat is null or p_lng is null then raise exception 'لم يصل موضعُك من المتصفح'; end if;

  select * into v_sh from public.shifts
   where member_id = v_uid and shift_date = v_today
     and check_in_at is not null and check_out_at is null
   order by check_in_at desc limit 1;
  if v_sh.id is null then
    return jsonb_build_object('ok', false, 'why', 'no_open_shift');
  end if;

  select * into v_site from public.site_for(v_uid);
  v_dist := case when v_site.id is null then null
                 else public.geo_distance_m(p_lat, p_lng, v_site.lat, v_site.lng) end;

  insert into public.shift_pings (shift_id, member_id, lat, lng, acc_m, dist_m, inside, kind)
  values (v_sh.id, v_uid, p_lat, p_lng, round(coalesce(p_acc, 0))::int,
          round(coalesce(v_dist, 0))::int,
          coalesce(v_dist <= coalesce(v_site.radius_m, 300), true), 'ping');

  update public.shifts set last_ping_at = now() where id = v_sh.id;

  -- مناداةٌ عشوائيةٌ مرةً في الوردة: يُطلَب الردُّ عليها في وقتٍ وجيز
  select coalesce(geo_ping_min, 5) into v_every from public.platform_settings limit 1;
  if v_sh.challenge_at is null and random() < 0.06 then
    update public.shifts set challenge_at = now() where id = v_sh.id;
    v_ask := true;
  elsif v_sh.challenge_at is not null and v_sh.challenge_ok_at is null
        and now() - v_sh.challenge_at < interval '10 minutes' then
    v_ask := true;
  end if;

  perform public.shift_presence(v_sh.id);
  select * into v_sh from public.shifts where id = v_sh.id;

  return jsonb_build_object('ok', true, 'shift', v_sh.id,
    'distance_m', round(coalesce(v_dist, 0))::int,
    'radius_m', coalesce(v_site.radius_m, 0),
    'inside', coalesce(v_dist <= coalesce(v_site.radius_m, 300), true),
    'verified_minutes', v_sh.verified_minutes, 'gap_minutes', v_sh.gap_minutes,
    'every_min', v_every, 'challenge', v_ask);
end $$;
grant execute on function public.geo_ping(double precision, double precision, double precision)
  to authenticated;

comment on function public.geo_ping(double precision, double precision, double precision) is
  'نبضُ موقعٍ من صفحةٍ مفتوحة: يبني الفتراتَ المُتحقَّقَ منها (ملاحظة ٣٧٥)';

-- والردُّ على المناداة
create or replace function public.answer_challenge()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid;
        v_today date := (now() at time zone 'Asia/Riyadh')::date;
begin
  if v_uid is null then raise exception 'لا جلسة' using errcode = '42501'; end if;
  update public.shifts set challenge_ok_at = now()
   where member_id = v_uid and shift_date = v_today
     and check_in_at is not null and check_out_at is null
     and challenge_at is not null and challenge_ok_at is null
   returning id into v_id;
  return jsonb_build_object('ok', v_id is not null);
end $$;
grant execute on function public.answer_challenge() to authenticated;

-- ---------------------------------------------------------------------
-- ٥) الغيابُ يُكتب عند انقضاء الوردة، والتأخيرُ بمهلته (ملاحظة ٣٧٤)
-- ---------------------------------------------------------------------
create or replace function public.sweep_absent_shifts(p_date date default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  -- لا إذنَ خاصّ: الكنسُ حسابيٌّ لا يكشف شيئًا ولا يُنشئ شيئًا
  update public.shifts s
     set status = 'absent'
   where s.check_in_at is null
     and not s.unscheduled
     and s.status in ('scheduled', 'present')
     and (p_date is null or s.shift_date = p_date)
     and ((case when s.end_at <= s.start_at then s.shift_date + 1 else s.shift_date end)
          + s.end_at) at time zone 'Asia/Riyadh' < now();
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.sweep_absent_shifts(date) to authenticated;

comment on function public.sweep_absent_shifts(date) is
  'الوردةُ التي انقضت فترتُها ولم يُسجَّل فيها حضورٌ تُكتب غيابًا (ملاحظة ٣٧٤)';

-- ومهلةُ التسامح تُطرَح من التأخير
do $do$
declare src text;
begin
  select pg_get_functiondef(oid) into src from pg_proc where proname = 'shift_recalc';
  if src is null or position('late_grace_min' in src) > 0 then return; end if;

  src := replace(src,
    '  select coalesce(flex_hours, false) into v_flex from public.profiles where id = s.member_id;',
    '  select coalesce(flex_hours, false) into v_flex from public.profiles where id = s.member_id;'
    || E'\n  -- مهلةُ تسامحٍ لا يُحتسَب التأخيرُ دونها (ملاحظة ٣٧٤)'
    || E'\n  select coalesce(late_grace_min, 5) into v_grace from public.platform_settings limit 1;');
  src := replace(src,
    '  v_worked int;',
    '  v_worked int;' || E'\n  v_grace  int := 0;');
  src := replace(src,
    '    v_late := greatest(0, (extract(epoch from (v_in - v_start)) / 60)::int);',
    '    v_late := greatest(0, (extract(epoch from (v_in - v_start)) / 60)::int);'
    || E'\n    if v_late <= coalesce(v_grace, 0) then v_late := 0; end if;');
  execute src;
end $do$;

-- ---------------------------------------------------------------------
-- ٦) الانصرافُ: موقعٌ طازجٌ لازمٌ، والفجوةُ تُوسَم (ملاحظتا ٣٧٥ و٣٧٦)
-- ---------------------------------------------------------------------
do $do$
declare src text;
begin
  select pg_get_functiondef(oid) into src from pg_proc where proname = 'geo_check_in';
  if src is null or position('out_unverified' in src) > 0 then return; end if;

  -- ١) الانصرافُ من خارج النطاق يُسجَّل موسومًا لا يُرَدُّ، فالعبرةُ
  --    بالبيان لا بالمنع — وأمّا الحضورُ فيبقى مردودًا كما كان
  src := replace(src,
    '  v_dist := public.geo_distance_m(p_lat, p_lng, v_site.lat, v_site.lng);
  if v_dist > v_site.radius_m then',
    '  v_dist := public.geo_distance_m(p_lat, p_lng, v_site.lat, v_site.lng);
  if v_dist > v_site.radius_m and not p_out then');

  -- ٢) ويُوسَم بُعدُه عند الانصراف، ويُقاس بُعدُ آخرِ نبضةٍ عنه
  src := replace(src,
    '    update public.shifts
       set check_out_at = now(), out_lat = p_lat, out_lng = p_lng,
           out_acc_m = round(coalesce(p_acc, 0))::int, out_dist_m = round(v_dist)::int
     where id = v_sh.id returning * into v_sh;',
    '    update public.shifts
       set check_out_at = now(), out_lat = p_lat, out_lng = p_lng,
           out_acc_m = round(coalesce(p_acc, 0))::int, out_dist_m = round(v_dist)::int,
           out_outside = (v_dist > v_site.radius_m),
           out_unverified = (last_ping_at is null
             or now() - last_ping_at > make_interval(mins =>
                  greatest(5, (select coalesce(geo_gap_tolerance, 12)
                                 from public.platform_settings limit 1))))
     where id = v_sh.id returning * into v_sh;
    insert into public.shift_pings (shift_id, member_id, lat, lng, acc_m, dist_m, inside, kind)
    values (v_sh.id, v_uid, p_lat, p_lng, round(coalesce(p_acc, 0))::int,
            round(v_dist)::int, v_dist <= v_site.radius_m, ''out'');');

  -- ٣) والحضورُ يُقيَّد نبضةً أولى، فتُبنى منها الفترةُ الموصولة
  src := replace(src,
    '  perform public.shift_recalc(v_sh.id);',
    '  if not p_out then
    insert into public.shift_pings (shift_id, member_id, lat, lng, acc_m, dist_m, inside, kind)
    values (v_sh.id, v_uid, p_lat, p_lng, round(coalesce(p_acc, 0))::int,
            round(v_dist)::int, v_dist <= v_site.radius_m, ''in'');
    update public.shifts set last_ping_at = now() where id = v_sh.id;
  end if;
  perform public.shift_recalc(v_sh.id);
  perform public.shift_presence(v_sh.id);');

  -- ٤) وما يُرجَع إلى الصفحة يحمل البيانَ كلَّه
  src := replace(src,
    '    ''at'', coalesce(v_sh.check_out_at, v_sh.check_in_at));',
    '    ''at'', coalesce(v_sh.check_out_at, v_sh.check_in_at),
    ''verified_minutes'', v_sh.verified_minutes, ''gap_minutes'', v_sh.gap_minutes,
    ''out_unverified'', v_sh.out_unverified, ''out_outside'', v_sh.out_outside);');

  execute src;
end $do$;

-- ---------------------------------------------------------------------
-- ٧) وما يُعرَض للعضو ولمشرفه
-- ---------------------------------------------------------------------
-- و«حضوري» تبقى كما هي، وما استُجدَّ يُسأل عنه بدالةٍ خاصّةٍ إلى جانبها
create or replace function public.my_shift_presence()
returns table (shift_id uuid, shift_date date, start_at time, end_at time,
               check_in_at timestamptz, check_out_at timestamptz,
               late_minutes int, early_minutes int, worked_minutes int,
               verified_minutes int, gap_minutes int,
               out_unverified boolean, out_outside boolean,
               last_ping_at timestamptz, challenge_at timestamptz,
               challenge_ok_at timestamptz, pings int, status text,
               every_min int, grace_min int)
language sql stable security definer set search_path = public as $$
  select s.id, s.shift_date, s.start_at, s.end_at, s.check_in_at, s.check_out_at,
         s.late_minutes, s.early_minutes, s.worked_minutes,
         s.verified_minutes, s.gap_minutes, s.out_unverified, s.out_outside,
         s.last_ping_at, s.challenge_at, s.challenge_ok_at,
         (select count(*)::int from public.shift_pings p where p.shift_id = s.id),
         s.status,
         (select coalesce(geo_ping_min, 5) from public.platform_settings limit 1),
         (select coalesce(late_grace_min, 5) from public.platform_settings limit 1)
    from public.shifts s
   where s.member_id = auth.uid()
     and s.shift_date = (now() at time zone 'Asia/Riyadh')::date
   order by s.start_at desc
   limit 1
$$;
grant execute on function public.my_shift_presence() to authenticated;

comment on function public.my_shift_presence() is
  'وردةُ اليوم بما تُحقِّق منها وما لم يُتحقَّق (ملاحظتا ٣٧٤ و٣٧٥)';

notify pgrst, 'reload schema';
