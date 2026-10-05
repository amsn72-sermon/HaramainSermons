-- =====================================================================
-- 0089 — تسمياتُ الأدوار، وبطاقتا العمليات التشغيلية
--        (ملاحظتا ٢٧٢ و٢٦٥)
--
--   ٢٧٢) الاسمُ الظاهرُ لكلِّ دورٍ يكتبه مديرُ المشروع، فيتغيّر في
--        المنصة كلِّها دفعةً واحدة. والاسمُ وحدَه هو الذي يتغيّر لا
--        الصلاحيات: فالدورُ ثابتٌ بمفتاحه، وما يُكتب وجهُه للناس.
--        والتقاريرُ تُولَّد عند طلبها، فتخرج بالاسم القائم يومَ إخراجها.
--
--   ٢٦٥) وتُحذف من بطاقتي العمليات التشغيلية جملةُ «ولقبُه تشغيليٌّ على
--        حساب التنسيق…»، فهي تُشعرهما بأنهما منسّقان. والأمرُ في النظام
--        يبقى كما هو بلا إعلان.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) جدولُ التسميات: المفتاحُ ثابتٌ، والاسمُ والوصفُ يُكتبان
-- ---------------------------------------------------------------------
create table if not exists public.role_labels (
  key         text primary key,
  label       text not null,
  descr       text,
  base_label  text not null,       -- الاسمُ الأصليُّ يُعاد إليه بزرٍّ واحد
  sort        int  not null default 0
);

alter table public.role_labels enable row level security;
drop policy if exists "read role labels" on public.role_labels;
create policy "read role labels" on public.role_labels
  for select to anon, authenticated using (true);

comment on table public.role_labels is
  'الاسمُ الظاهرُ لكلِّ دورٍ — يكتبه مديرُ المشروع ولا تتغيّر به صلاحية (ملاحظة ٢٧٢)';

insert into public.role_labels (key, label, base_label, sort) values
  ('manager',     'مدير المشروع',                     'مدير المشروع',                     1),
  ('ops_manager', 'مدير العمليات التشغيلية',          'مدير العمليات التشغيلية',          2),
  ('ops_deputy',  'مساعد مدير العمليات التشغيلية',    'مساعد مدير العمليات التشغيلية',    3),
  ('coordinator', 'منسق',                             'منسق',                             4),
  ('supervisor',  'مدير المشروع من الهيئة',           'مدير المشروع من الهيئة',           5),
  ('viewer',      'متابع',                            'متابع',                            6),
  ('field_lead',  'قائد الفريق الميداني',             'قائد الفريق الميداني',             7),
  ('translator',  'مترجم',                            'مترجم',                            8)
on conflict (key) do nothing;

create or replace function public.set_role_label(
  p_key text, p_label text, p_descr text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  -- تغييرُ الأسماء في معنى تغييرِ الهيكل: لمدير المشروع وحدَه، ولا يُمنح
  if not public.is_manager() then
    raise exception 'تسمياتُ الأدوار بيد مدير المشروع' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_label, '')), '') is null then
    raise exception 'اكتب الاسم الظاهر للدور';
  end if;
  select label into v_old from public.role_labels where key = p_key;
  if not found then raise exception 'دورٌ غير معروف: %', p_key; end if;

  update public.role_labels
     set label = btrim(p_label),
         descr = nullif(btrim(coalesce(p_descr, '')), '')
   where key = p_key;

  perform public.log_admin('rename_role', null,
    jsonb_build_object('key', p_key, 'from', v_old, 'to', p_label));
end $$;
grant execute on function public.set_role_label(text, text, text) to authenticated;

create or replace function public.reset_role_label(p_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then
    raise exception 'تسمياتُ الأدوار بيد مدير المشروع' using errcode = '42501';
  end if;
  update public.role_labels set label = base_label, descr = null where key = p_key;
  if not found then raise exception 'دورٌ غير معروف: %', p_key; end if;
  perform public.log_admin('rename_role', null,
    jsonb_build_object('key', p_key, 'reset', true));
end $$;
grant execute on function public.reset_role_label(text) to authenticated;

-- ---------------------------------------------------------------------
-- ٢) بطاقتا العمليات التشغيلية في «عن المبادرة» (ملاحظة ٢٦٥)
-- ---------------------------------------------------------------------
do $do$
declare v jsonb; v_roles jsonb; i int; v_item jsonb; v_name text;
begin
  select content into v from public.page_content where key = 'initiative';
  if v is null then return; end if;
  v_roles := coalesce(v -> 'roles', '[]'::jsonb);

  for i in 0 .. jsonb_array_length(v_roles) - 1 loop
    v_item := v_roles -> i;
    v_name := v_item ->> 0;

    if v_name = 'مدير العمليات التشغيلية' then
      v_roles := jsonb_set(v_roles, array[i::text], jsonb_build_array(
        v_name,
        jsonb_build_array(
          'يتولّى تسييرَ العمل اليوميِّ في المبادرة: متابعةَ الإنجاز والمواعيد، '
          || 'وتنظيمَ الإسناد بين الفرق، وموازنةَ الأحمال على المترجمين والمراجعين '
          || 'بحسب اللغات والطاقات.',
          'ويرفع تقاريرَ سيرِ العمل إلى مدير المشروع، ويعالج ما يَعرِض من تعثّرٍ أو '
          || 'تأخّرٍ في وقته، ويكون حلقةَ الوصلِ بين الفريق والإدارة في مجرى العمل.'),
        coalesce(v_item ->> 2, 'bolt')));

    elsif v_name = 'مساعد مدير العمليات التشغيلية' then
      v_roles := jsonb_set(v_roles, array[i::text], jsonb_build_array(
        v_name,
        jsonb_build_array(
          'يعين مديرَ العمليات في المتابعة اليومية ويقوم مقامَه عند غيابه: يتابع '
          || 'المهامَّ المفتوحةَ وآجالَها، ويذكّر بما قارب موعدَه.',
          'ويجمع بيانات الإنجاز ويهيّئها للتقارير، ويشارك في تنظيم الورديات '
          || 'وجداول العمل.'),
        coalesce(v_item ->> 2, 'bolt')));
    end if;
  end loop;

  update public.page_content
     set content = jsonb_set(v, '{roles}', v_roles), updated_at = now()
   where key = 'initiative';
end $do$;

notify pgrst, 'reload schema';
