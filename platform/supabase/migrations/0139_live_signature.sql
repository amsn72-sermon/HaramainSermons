-- =====================================================================
-- ٠١٣٩ — التوقيعُ يُرسَم ولا يُرفَع صورةً (ملاحظة ٤٩٠)
--
--   جاء كشفُ التواقيع ففيه من وقَّع توقيعًا حيًّا، ومن رفع صورةً
--   شخصيةً مكانَه، ومن رفع صورةً بيضاءَ لا يكاد يُرى فيها أثر. والتوقيعُ
--   إنما يُراد لأنه فعلُ صاحبه بيده، فإذا صار ملفًّا يُرفَع ذهب معناه.
--
--   فصار بابُ الرفع مغلقًا، والتوقيعُ رسمًا على الشاشة بالإصبع أو
--   الفأرة. ويُحفَظ مع كلِّ توقيعٍ وجهُه: أرُسم أم رُفع، فيُعرَف القديمُ
--   من الجديد، ويُطالَب من كان توقيعُه مرفوعًا برسمه حيًّا.
-- =====================================================================

alter table public.profile_private
  add column if not exists signature_kind text
    check (signature_kind is null or signature_kind in ('drawn', 'uploaded')),
  add column if not exists signature_redo_at timestamptz,
  add column if not exists signature_redo_by uuid references public.profiles (id);

comment on column public.profile_private.signature_kind is
  'وجهُ التوقيع: رُسم على الشاشة أم رُفع صورةً (ملاحظة ٤٩٠)';
comment on column public.profile_private.signature_redo_at is
  'وقتُ طلب الإدارة توقيعًا حيًّا بدلَ المرفوع (ملاحظة ٤٩٠)';

-- والتواقيعُ القائمةُ قبل اليوم لا يُعرَف وجهُها، فتُوسَم «مرفوعة»
--   احتياطًا: فمن رسمها يُعيد رسمَها في أوّل توقيعٍ بلا كلفة، ومن
--   رفعها يُكشَف
update public.profile_private
   set signature_kind = 'uploaded'
 where signature_path is not null and signature_kind is null;

-- ـــ ١) حفظُ التوقيع ومعه وجهُه
drop function if exists public.set_my_signature(text);
create or replace function public.set_my_signature(p_path text, p_kind text default 'drawn')
returns void language plpgsql security definer set search_path = public as $$
declare v_path text := nullif(btrim(coalesce(p_path, '')), '');
        v_kind text := case when p_kind = 'uploaded' then 'uploaded' else 'drawn' end;
begin
  if auth.uid() is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  -- ولا يكتب في مجلَّد غيره
  if v_path is not null and split_part(v_path, '/', 1) <> auth.uid()::text then
    raise exception 'لا يُحفَظ توقيعُ غيرك' using errcode = '42501';
  end if;
  insert into public.profile_private (id) values (auth.uid()) on conflict (id) do nothing;
  update public.profile_private
     set signature_path = v_path,
         signature_at = case when v_path is null then null else now() end,
         signature_kind = case when v_path is null then null else v_kind end,
         -- ومن رسمه حيًّا سقط عنه طلبُ الإعادة
         signature_redo_at = case when v_path is not null and v_kind = 'drawn'
                                  then null else signature_redo_at end
   where id = auth.uid();
end $$;
grant execute on function public.set_my_signature(text, text) to authenticated;

comment on function public.set_my_signature(text, text) is
  'حفظُ توقيع العضو ومعه وجهُه: رسمًا أو صورةً مرفوعة (ملاحظتا ١١٠ و٤٩٠)';

-- ـــ ٢) طلبُ الإدارة توقيعًا حيًّا: يُمحى القديمُ فيُطالَب برسمه
create or replace function public.require_live_signature(p_members uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  -- والمفتاحُ المفصَّلُ هو الحاكم كما في سائر إجراءات الفريق، لا الدورُ
  --   وحدَه: فمن أُغلق عنه تعديلُ الفريق لا يمحو تواقيعَهم
  if not public.is_admin_for('tm_edit') then
    raise exception 'طلبُ التوقيع الحيِّ لمن يملك تعديلَ الفريق' using errcode = '42501';
  end if;
  if p_members is null or array_length(p_members, 1) is null then return 0; end if;
  if array_length(p_members, 1) > 500 then
    raise exception 'الطلبُ دفعةً واحدةً لخمسمئةٍ على الأكثر';
  end if;
  update public.profile_private
     set signature_path = null, signature_at = null, signature_kind = null,
         signature_redo_at = now(), signature_redo_by = auth.uid()
   where id = any (p_members)
     and id in (select id from public.profiles where status = 'active');
  get diagnostics v_n = row_count;
  -- ويُخبَر كلٌّ منهم، فلا يُفاجَأ بطلبٍ لا يعرف سببَه
  -- ولا يُخبَر إلا من وقع عليه المحو
  perform public.enqueue_notification(pp.id, 'data_reminder',
    'يلزمك توقيعٌ حيّ',
    'التوقيعُ المحفوظُ لك صورةٌ مرفوعة، والمطلوبُ أن ترسم توقيعَك بيدك '
    || 'على الشاشة. يُطلَب منك عند أوّل توقيعٍ قادم.', null)
    from public.profile_private pp
   where pp.id = any (p_members) and pp.signature_redo_by = auth.uid()
     and pp.signature_redo_at > now() - interval '1 minute';
  perform public.log_admin('signature_redo', null, jsonb_build_object('n', v_n));
  return v_n;
end $$;
grant execute on function public.require_live_signature(uuid[]) to authenticated;

comment on function public.require_live_signature(uuid[]) is
  'طلبُ توقيعٍ حيٍّ بدلَ الصورة المرفوعة: يُمحى المحفوظُ ويُخبَر صاحبُه (ملاحظة ٤٩٠)';

-- ـــ ٣) وشاشةُ الفريق ترى وجهَ التوقيع لتكشف المرفوع
drop function if exists public.team_private();
create or replace function public.team_private()
returns table (
  id uuid, whatsapp text, residence text, applied_as text,
  photo_path text, photo_status text, photo_note text, photo_at timestamptz,
  iqama_status text, iqama_note text, iqama_at timestamptz,
  iqama_uploaded_at timestamptz, photo_uploaded_at timestamptz,
  data_status text, data_note text, data_at timestamptz,
  signature_path text, signature_at timestamptz,
  signature_kind text, signature_redo_at timestamptz,
  reminded_at timestamptz, remind_count int,
  -- ما لا يُعرَض إلا لمن يملك مفتاحَ الاطّلاع على الهوية
  national_id text, nationality text, iqama_path text,
  id_type text, id_expiry date
) language sql stable security definer set search_path = public as $$
  select pp.id, pp.whatsapp, pp.residence, pp.applied_as,
         pp.photo_path, pp.photo_status, pp.photo_note, pp.photo_at,
         pp.iqama_status, pp.iqama_note, pp.iqama_at,
         pp.iqama_uploaded_at, pp.photo_uploaded_at,
         pp.data_status, pp.data_note, pp.data_at,
         pp.signature_path, pp.signature_at,
         pp.signature_kind, pp.signature_redo_at,
         pp.reminded_at, pp.remind_count,
         case when public.is_admin_for('docs_id_view') then pp.national_id end,
         case when public.is_admin_for('docs_id_view') then pp.nationality end,
         case when public.is_admin_for('docs_id_view') then pp.iqama_path end,
         case when public.is_admin_for('docs_id_view') then pp.id_type end,
         case when public.is_admin_for('docs_id_view') then pp.id_expiry end
    from public.profile_private pp
   where public.is_admin() or pp.id = auth.uid()
$$;
grant execute on function public.team_private() to authenticated;

comment on function public.team_private() is
  'بياناتُ الفريق الخاصّة بقدر صلاحية السائل، ومعها وجهُ التوقيع (فحصٌ أمنيّ ٠١٣٣ وملاحظتا ٤٨٤ و٤٩٠)';

-- ـــ ٤) وكشفُ التواقيع للإدارة: من وقَّع ووجهُ توقيعه ومساره
create or replace function public.signature_sheet()
returns table (member_id uuid, full_name text, member_no int, role text, track text,
               signature_path text, signature_at timestamptz,
               signature_kind text, signature_redo_at timestamptz, acks int)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.member_no, p.role::text, coalesce(p.track, 'translation'),
         pp.signature_path, pp.signature_at, pp.signature_kind, pp.signature_redo_at,
         (select count(*)::int from public.circular_recipients r
           where r.member_id = p.id and r.acked_at is not null)
    from public.profiles p
    -- ضمٌّ خارجيٌّ: من لا صفَّ له في الخاصّة لا توقيعَ له، ويُعَدُّ
    left join public.profile_private pp on pp.id = p.id
   where p.status = 'active' and public.is_admin_for('tm_view')
   order by (pp.signature_path is null), pp.signature_kind, p.full_name
$$;
grant execute on function public.signature_sheet() to authenticated;

comment on function public.signature_sheet() is
  'كشفُ تواقيع الفريق: من وقَّع ووجهُ توقيعه، ليُكشَف المرفوعُ ويُطلَب حيًّا (ملاحظة ٤٩٠)';

notify pgrst, 'reload schema';
