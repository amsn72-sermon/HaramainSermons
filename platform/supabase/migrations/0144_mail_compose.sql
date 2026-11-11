-- =====================================================================
-- ٠١٤٤ — بريدٌ بهويّة المشروع، ومُنشئُ رسائلَ باختيار المخاطَبين
--        (ملاحظة ٥٠١)
--
--   كانت الرسائلُ تخرج نصًّا مجرَّدًا من بريدِ خدمةٍ عامّ، فتقع في بريد
--   غير المرغوب عند بعضهم، ولا يُعرَف صاحبُها من أوّل نظرة. فصارت
--   تخرج بهويّة المشروع: ترويسةٌ وذيلٌ ولونٌ وشعارٌ نصيٌّ، مبنيّةٌ
--   بجداولَ لا بأنماطٍ حديثةٍ ليقرأها Outlook كما يقرأها غيرُه، ومعها
--   نسخةٌ نصيّةٌ مجرَّدةٌ لمن لا يقبل HTML.
--
--   ويُضاف إلى الطابور بابٌ يكتب فيه المسؤولُ رسالةً ويختار المخاطَبين:
--   الفريقَ كلَّه، أو فريقًا بعينه، أو مدينةً، أو من نقصت بياناتُه، أو
--   من لم يوقِّع الميثاق. ويُعايِن الرسالةَ قبل إرسالها.
-- =====================================================================

-- ـــ ١) الرسالةُ تحمل نسختَها المنسَّقةَ إن كانت
alter table public.notifications
  add column if not exists body_html text;

comment on column public.notifications.body_html is
  'نسخةُ الرسالة المنسَّقةُ بـHTML، والنصُّ المجرَّدُ في body بديلًا عنها (ملاحظة ٥٠١)';

-- والبابُ الجديدُ نوعٌ في الطابور: تعميمٌ أو تذكيرٌ يُكتَب بيد مسؤول
-- ويُحفَظ ما سبق من الأنواع ويُزاد عليه، فلا يسقط نوعٌ استُجدَّ قبلَه
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('assigned', 'track_completed', 'returned', 'reminder',
                  'data_reminder', 'bank_doc', 'bank_fix', 'cancelled',
                  'source_changed', 'circular', 'mail'));

-- ـــ ٢) طابورُ الإرسال يُسلِّم النسختين: المنسَّقةَ والمجرَّدة
drop function if exists public.pending_notifications(int);
create or replace function public.pending_notifications(p_limit int default 50)
returns table (id bigint, email text, full_name text, subject text, body text,
               body_html text)
language plpgsql security definer set search_path = public as $$
begin
  perform public.enqueue_due_reminders(24);
  return query
    select n.id, p.email, p.full_name,
           replace(replace(n.subject, E'\n', ' '), E'\r', ' '),
           replace(replace(n.body, E'\r', ''), E'\n', '\n'),
           replace(replace(coalesce(n.body_html, ''), E'\r', ''), E'\n', ' ')
      from public.notifications n join public.profiles p on p.id = n.member_id
     where n.status = 'pending' and n.attempts < 5
     order by n.created_at
     limit greatest(coalesce(p_limit, 50), 1);
end $$;
revoke all on function public.pending_notifications(int) from public, anon, authenticated;

comment on function public.pending_notifications(int) is
  'طابورُ البريد: الموضوعُ والنصُّ المجرَّدُ ونسختُه المنسَّقة (ملاحظتا ٨٣ و٥٠١)';

-- ـــ ٣) المخاطَبون: من يقع عليه الاختيار، يُعَدُّ قبل الإرسال ويُعايَن
--
--   p_audience: all | translators | field | answers | admins
--               | nodata | unsigned | city
create or replace function public.mail_audience(p_audience text, p_city text default null)
returns table (id uuid, full_name text, email text, track text, city text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email, coalesce(p.track, 'translation'), p.city
    from public.profiles p
    left join public.profile_private pp on pp.id = p.id
   where public.is_admin_for('circulars')
     and p.status = 'active' and coalesce(p.email, '') <> ''
     and case coalesce(p_audience, 'all')
           when 'all'         then true
           when 'translators' then coalesce(p.track, 'translation') = 'translation'
           when 'field'       then coalesce(p.track, '') = 'field'
           when 'answers'     then coalesce(p.track, '') = 'answers'
           when 'admins'      then p.role in ('manager', 'coordinator', 'supervisor', 'viewer')
           when 'city'        then coalesce(p.city, '') = coalesce(nullif(btrim(p_city), ''), '')
           -- من نقصت بياناتُه: لا هويةَ أو لا صورةَ أو لا توقيع
           when 'nodata'      then pp.id is null or pp.national_id is null
                                   or pp.photo_path is null or pp.signature_path is null
           -- من لم يوقِّع ميثاقَه بأيِّ نسخة
           when 'unsigned'    then not exists (
                                     select 1 from public.policy_acceptances a
                                      where a.member_id = p.id)
           else true
         end
   order by p.full_name
$$;
grant execute on function public.mail_audience(text, text) to authenticated;

comment on function public.mail_audience(text, text) is
  'المخاطَبون برسالةٍ بحسب الاختيار، يُعَدُّون قبل الإرسال (ملاحظة ٥٠١)';

-- ـــ ٤) الإرسال: يُضاف إلى الطابور صفٌّ لكلِّ مخاطَب، ويُسجَّل
create or replace function public.send_mail(
  p_subject text, p_body text, p_html text,
  p_audience text default 'all', p_city text default null,
  p_members uuid[] default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int; v_sub text := btrim(coalesce(p_subject, '')); v_body text := btrim(coalesce(p_body, ''));
begin
  if not public.is_admin_for('circulars') then
    raise exception 'إرسالُ البريد لمن يملك مفتاحَ المراسلات' using errcode = '42501';
  end if;
  if v_sub = '' or v_body = '' then raise exception 'الموضوعُ والنصُّ لا يُتركان'; end if;
  if length(v_sub) > 200 then raise exception 'الموضوعُ مئتا حرفٍ على الأكثر'; end if;
  if length(v_body) > 20000 then raise exception 'النصُّ طويلٌ جدًّا'; end if;

  insert into public.notifications (member_id, kind, subject, body, body_html)
  select a.id, 'mail', v_sub, v_body, nullif(btrim(coalesce(p_html, '')), '')
    from public.mail_audience(p_audience, p_city) a
   where p_members is null or a.id = any (p_members);
  get diagnostics v_n = row_count;

  perform public.log_admin('mail_send', null,
    jsonb_build_object('n', v_n, 'audience', p_audience, 'subject', v_sub));
  return v_n;
end $$;
grant execute on function public.send_mail(text, text, text, text, text, uuid[]) to authenticated;

comment on function public.send_mail(text, text, text, text, text, uuid[]) is
  'إضافةُ رسالةٍ إلى طابور البريد لمن وقع عليه الاختيار (ملاحظة ٥٠١)';

-- ـــ ٥) آخرُ ما أُرسل: ليُعرَف ما وصل وما تعثَّر
create or replace function public.mail_log(p_limit int default 50)
returns table (subject text, n bigint, sent bigint, failed bigint, at timestamptz)
language sql stable security definer set search_path = public as $$
  select n.subject, count(*),
         count(*) filter (where n.status = 'sent'),
         count(*) filter (where n.status = 'failed'),
         max(n.created_at)
    from public.notifications n
   where n.kind = 'mail' and public.is_admin_for('circulars')
   group by n.subject
   order by max(n.created_at) desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;
grant execute on function public.mail_log(int) to authenticated;

comment on function public.mail_log(int) is
  'سجلُّ ما أُرسل من رسائل البريد وحالُ كلِّ دفعة (ملاحظة ٥٠١)';

notify pgrst, 'reload schema';
