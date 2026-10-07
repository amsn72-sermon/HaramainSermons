// شؤون الفريق: الانضمام والأعضاء، وتدقيق المستندات، والحسابات البنكية في شاشة واحدة (ملاحظة ٩٨)
// وتحت «الفريق» ثلاث قوائم مستقلة: الإداريون، والمترجمون المتخصصون،
// والمرشدون المكانيون (ملاحظتا ٩٩ و١٠١)
import { h, toast, busy, dialog, fmtDate, fmtDateTime, confirm } from '../ui.js';
import { db, storage } from '../sb.js';
import { state, isManager } from '../store.js';
import { render as teamRender } from './team.js';
import { adminList as bankAdmin } from './bank.js';

export const DOC_LABEL = { photo: 'الصورة الشخصية', iqama: 'صورة الهوية أو الإقامة' };
export const DOC_STATE = {
  none: ['لم تُرفع', 'bad'],
  pending: ['تحت المراجعة', 'warn'],
  approved: ['معتمَدة', 'ok'],
  rejected: ['أُعيدت للعضو', 'bad']
};

const SCREEN = {
  admins: {
    path: '/app/staff/admins', title: 'الحسابات الإدارية', tab: 'الإداريون',
    lead: 'مديرو المشروع والمنسقون: قبول الانضمام، وتدقيق المستندات، والحسابات البنكية، والبيانات وتصديرها.'
  },
  translators: {
    path: '/app/staff', title: 'المترجمون المتخصصون', tab: 'المترجمون',
    lead: 'فريق الترجمة التخصصية: قبول الانضمام، وتدقيق المستندات واعتمادها، والحسابات البنكية، والبيانات وتصديرها.'
  },
  field: {
    path: '/app/field', title: 'المرشدون المكانيون', tab: 'المرشدون',
    lead: 'فريق الإرشاد المكاني: تسجيل وتوثيق بيانات ومستندات وحسابات بنكية، بلا إسناد أعمال ترجمة. ومن تميّز منهم يُنقل إلى الترجمة التخصصية.'
  },
  // لا يُسجَّل فيها أحد: ينقل إليها المنسق أو مدير المشروع من يراه (ملاحظة ١٨٦)
  answers: {
    path: '/app/answers', title: 'المخصَّصون لإجابة السائلين', tab: 'إجابة السائلين',
    lead: 'من يُنقل إليهم نقلُ أسئلة الزوّار إلى أهل الفتوى ونقلُ جوابهم. '
      + 'ولا يُسجَّل في هذه القائمة أحد ابتداءً، بل ينقل إليها المنسق أو مدير المشروع من يراه.'
  }
};

export const admins = ctx => render(ctx, 'admins');
export const field = ctx => render(ctx, 'field');
export const answers = ctx => render(ctx, 'answers');

export async function render(ctx, group = 'translators') {
  const scr = SCREEN[group] || SCREEN.translators;
  const want = ctx.query?.get('tab') || (location.pathname === '/app/bank-accounts' ? 'bank' : 'team');

  const [team, counts, byGroup] = await Promise.all([
    teamRender(ctx, { parts: true, group, reloadPath: scr.path + (want === 'team' ? '' : `?tab=${want}`) }),
    db.rpc('pending_reviews').then(r => (Array.isArray(r) ? r[0] : r) || {}).catch(() => ({})),
    db.rpc('pending_reviews_by_group').then(r => (Array.isArray(r) ? r : [])).catch(() => [])
  ]);

  const ids = new Set(team.members.map(m => m.id));
  const panel = h('div.staff-panel');
  // ترتيبٌ واحدٌ في الشاشات الثلاث: الأعضاءُ ثم الهويةُ ثم البنوكُ ثم التدقيق
  // — فالتدقيقُ آخرُها لأنه الجامعُ لكلِّ الحالات (ملاحظة ٣١٨)
  const TABS = [
    ['team', scr.tab, team.pendingCount],
    ['ids',  'الهوية الشخصية', 0],
    ['bank', 'الحسابات البنكية', 0],
    ['docs', 'تدقيق المستندات', 0]
  ];
  const T = key => TABS.find(t => t[0] === key);
  // لكل قائمة عدّادها: ما ينتظر تدقيقه فيها هي (ملاحظة ١٢٠)
  const mineCount = byGroup.find(r => r.grp === group);
  if (mineCount) {
    // والبيانات المرفوعة للتدقيق تُعدّ مع المستندات (ملاحظة ١٧٩)
    T('docs')[2] = Number(mineCount.photos || 0) + Number(mineCount.iqamas || 0);
    T('team')[2] = Number(T('team')[2] || 0) + Number(mineCount.data || 0);
    T('bank')[2] = Number(mineCount.banks || 0);
  } else if (group === 'translators') {
    T('docs')[2] = Number(counts.photos || 0) + Number(counts.iqamas || 0);
    T('bank')[2] = Number(counts.banks || 0);
  }

  let current = TABS.some(t => t[0] === want) ? want : 'team';
  const btns = TABS.map(([key, label, n]) => {
    const b = h('button.btn.tab', { type: 'button', role: 'tab' },
      label, n > 0 ? h('span.nav-badge', String(n)) : null);
    b.onclick = () => show(key);
    return b;
  });

  async function show(key) {
    current = key;
    btns.forEach((b, i) => {
      const on = TABS[i][0] === key;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    history.replaceState(null, '', key === 'team' ? scr.path : `${scr.path}?tab=${key}`);
    panel.replaceChildren(h('p.muted.small', 'جارٍ التحميل…'));
    try {
      if (key === 'team') panel.replaceChildren(...[
        group === 'admins' ? registrationCard(ctx) : null,
        group === 'admins' ? securityCard(ctx) : null,
        team.joins, team.cityTabs, team.filters, team.table].filter(Boolean));
      else if (key === 'ids') panel.replaceChildren(await identitySection(group));
      else if (key === 'docs') panel.replaceChildren(await docsSection(ctx, team, scr, group));
      else panel.replaceChildren(await bankAdmin(ctx, { parts: true, only: ids, reloadPath: `${scr.path}?tab=bank` }));
    } catch (err) { panel.replaceChildren(h('p.small.bad', err.message)); }
  }

  await show(current);

  return h('div',
    h('div.page-head', team.tools,
      h('div.grow', h('div.eyebrow', 'الفريق'), h('h1', scr.title), h('p.muted', scr.lead))),
    h('div.tabs', { role: 'tablist' }, btns),
    panel);
}

// ---------------------------------------------------------------------
// حماية حسابات الإدارة: إلزام التحقق بخطوتين — بيد مدير المشروع (ملاحظة ١٠٣)
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// باب التسجيل: يُفتح مدةً معلومة ثم يُغلق بنفسه (ملاحظة ١٧٤)
// ---------------------------------------------------------------------
function registrationCard(ctx0) {
  const card = h('div.card.stack');
  const url = location.origin + '/register';

  const paint = async () => {
    let st = { open: true };
    try { st = (await db.rpc('registration_state')) || {}; st = Array.isArray(st) ? st[0] : st; }
    catch { /* تعذّر الفحص لا يحجب الشاشة */ }
    const open = st.open !== false;
    const until = st.closes_at ? new Date(st.closes_at) : null;
    const left = until ? Math.max(0, Math.round((until - Date.now()) / 60000)) : null;
    const leftText = left === null ? null
      : left >= 60 ? `${Math.floor(left / 60)} ساعة و${left % 60} دقيقة`
        : `${left} دقيقة`;

    const hours = h('select', { 'aria-label': 'مدة الفتح' },
      h('option', { value: '' }, 'حتى أُغلقه بنفسي'),
      [6, 12, 24, 48, 72, 168].map(n => h('option', { value: String(n), selected: n === 48 ? true : null },
        n < 24 ? `${n} ساعات` : n === 24 ? 'يومًا واحدًا' : n === 168 ? 'أسبوعًا' : `${n / 24} أيام`)));

    const set = (on, btn) => busy(btn, async () => {
      if (!isManager()) return toast('فتح التسجيل وإغلاقه لمدير المشروع.', 'bad');
      if (!on && !await confirm('إغلاق التسجيل',
        'يُغلق باب التسجيل، فلا يُنشأ حساب جديد حتى تفتحه — ولك أن تُنشئ الحسابات يدويًّا في كل حال. متابعة؟',
        'إغلاق التسجيل')) return;
      try {
        await db.rpc('set_registration', { p_open: on, p_hours: on && hours.value ? Number(hours.value) : null });
        toast(on ? 'فُتح باب التسجيل.' : 'أُغلق باب التسجيل.', 'ok');
        paint();
      } catch (err) { toast(err.message, 'bad'); }
    });

    const openBtn = h('button.btn.sm.primary', { type: 'button' }, open ? 'تمديد المدة' : 'فتح التسجيل');
    openBtn.onclick = e => set(true, e.currentTarget);
    const closeBtn = h('button.btn.sm.danger', { type: 'button' }, 'إغلاق التسجيل');
    closeBtn.onclick = e => set(false, e.currentTarget);
    const copy = h('button.btn.xs', { type: 'button' }, '⧉ نسخ رابط التسجيل');
    copy.onclick = () => navigator.clipboard.writeText(url)
      .then(() => toast('نُسخ رابط التسجيل.', 'ok')).catch(() => toast('انسخه من شريط العنوان.', 'bad'));

    card.replaceChildren(
      h('div.row.between', h('h3', 'باب التسجيل في المنصة'),
        h('span.badge', { class: open ? 'ok' : 'bad' }, open ? 'مفتوح' : 'مغلق')),
      h('p.small.muted', 'العدد معروف وقليل، فالأصل إغلاقه. افتحه مدةً معلومة حتى يُسجّل من دُعي، '
        + 'ثم يُغلق بنفسه — فلا يدخل غريبٌ لو انتشر الرابط. والمنع في قاعدة البيانات لا في الشاشة وحدها.'),
      open && leftText
        ? h('p.small', 'يُغلق تلقائيًّا بعد ', h('b', leftText), ' — في ', fmtDateTime(st.closes_at), '.')
        : open ? h('p.small.warn', 'مفتوح بلا مدة — يبقى حتى تغلقه بنفسك.') : null,
      isManager()
        ? h('div.row.wrap', h('label.field', 'مدة الفتح', hours), openBtn, open ? closeBtn : null)
        : h('p.small.muted', 'فتح التسجيل وإغلاقه بيد مدير المشروع.'),
      h('p.small.muted', 'رابط التسجيل: ', h('span', { dir: 'ltr' }, url), ' ', copy));
  };
  paint();
  return card;
}

function securityCard(ctx0) {
  const on = state.mfaRequired !== false;
  const btn = h('button.btn.sm', { type: 'button' }, on ? 'إلغاء الإلزام' : 'إلزام التحقق');
  const badge = h('span.badge', { class: on ? 'ok' : 'warn' }, on ? 'إلزامي' : 'اختياري');
  btn.onclick = () => busy(btn, async () => {
    if (!isManager()) return toast('تغيير إعدادات الحماية لمدير المشروع وحده.', 'bad');
    try {
      await db.rpc('set_mfa_required', { p_required: !on });
      state.mfaRequired = !on;
      toast(!on ? 'صار التحقق بخطوتين إلزاميًّا على حسابات الإدارة.' : 'رُفع الإلزام.', 'ok');
      ctx0 && ctx0.navigate(`${SCREEN.admins.path}`, { replace: true });
    } catch (err) { toast(err.message, 'bad'); }
  });
  return h('div.card.stack',
    h('div.row.between', h('h3', 'التحقق بخطوتين لحسابات الإدارة'), badge),
    h('p.small.muted', 'مدير المشروع والمنسقون لا يدخلون بكلمة المرور وحدها، بل برمز من تطبيق المصادقة على أجهزتهم (Google Authenticator أو Microsoft Authenticator). ومن لم يفعّله يُطالَب بتفعيله عند أول دخول.'),
    isManager() ? h('div.row', btn) : h('p.small.muted', 'تغيير هذا الإعداد بيد مدير المشروع.'));
}

// ---------------------------------------------------------------------
// تدقيق المستندات: الصورة الشخصية وصورة الهوية تُعتمد أو تُعاد بسبب مكتوب
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// تدقيق المستندات: كشف الفريق كله من الخادم، لا من القائمة المعروضة،
// فلا يفوت مستند رُفع (ملاحظتا ٩٨ و١٢٠)
// ---------------------------------------------------------------------
const GROUP_OF = m => (['manager', 'coordinator', 'supervisor'].includes(m.role) ? 'admins'
  : m.track === 'answers' ? 'answers' : (m.track === 'field' ? 'field' : 'translators'));
const GROUP_NAME = { admins: 'الحسابات الإدارية', translators: 'المترجمون المتخصصون', field: 'المرشدون المكانيون' };

// ---------------------------------------------------------------------
// الهوية الشخصية: البياناتُ والصورةُ مجتمعةً فتُطابَق، ثم قبولٌ أو إعادة
//   (ملاحظة ٣٠٧). ولا يُفتح إلا لمن مُنح مفتاحَ الاطّلاع، ومنحُه بيد
//   مدير المشروع — ومن لا يملكه لا يرى التبويبَ شيئًا (ملاحظة ٢٩٤).
// ---------------------------------------------------------------------
const ID_TYPE_LABEL = { national: 'هوية وطنية أو إقامة', passport: 'جواز سفر' };

async function identitySection(group = 'translators') {
  const box = h('div.stack');
  const summary = h('p.small.muted');
  const filter = h('select', { 'aria-label': 'التصفية' },
    h('option', { value: 'pending' }, 'ما ينتظر التدقيق'),
    h('option', { value: 'expiring' }, 'ما انتهى أو قارب'),
    h('option', { value: 'none' }, 'من لم يرفعْ هويته'),
    h('option', { value: 'all', selected: true }, 'الكل'));

  let rows = [], denied = false;
  const load = async () => {
    try { rows = await db.rpc('identity_sheet', { p_group: group }) || []; denied = false; }
    catch (e) { rows = []; denied = /42501|إذن|صلاحي/.test(e.message || ''); }
  };
  await load();

  // الخلوُّ غيرُ المنع: لكلٍّ عبارتُه (ملاحظة ٣١٧)
  if (!rows.length) {
    return h('div.card.stack',
      h('h3', 'الهوية الشخصية'),
      h('p.muted', denied
        ? 'هذا خارجَ نطاقِ عملك الحالي.'
        : 'لا أحدَ في هذه الفئة بعد.'));
  }

  // البتُّ في الهوية: قبولٌ أو إعادةٌ بسببٍ مكتوب
  const decide = async (r, decision) => {
    let note = null;
    if (decision === 'rejected') {
      const why = h('textarea', { rows: 2, 'aria-label': 'سبب الإعادة' });
      const res = await dialog({
        title: `إعادةُ هوية ${r.full_name}`,
        body: h('div.stack',
          h('p.small.muted', 'يُكتب السببُ فيصل صاحبَه، ويُطلب منه تجديدُها.'),
          h('label.field', 'السبب', why)),
        buttons: [
          { label: 'أعِدْها', kind: 'bad',
            validate: () => (why.value.trim().length >= 5 ? true : 'اكتب السبب'),
            value: () => why.value.trim() },
          { label: 'إلغاء', value: null }
        ]
      });
      if (!res) return;
      note = res;
    }
    try {
      await db.rpc('review_member_doc',
        { p_member: r.member_id, p_kind: 'iqama', p_decision: decision, p_note: note });
      if (decision === 'rejected') {
        await db.rpc('ask_renewal',
          { p_member: r.member_id, p_kind: 'iqama', p_reason: note }).catch(() => {});
      }
      toast(decision === 'approved' ? 'اعتُمدت الهوية.' : 'أُعيدت الهويةُ للعضو.', 'ok');
      await load(); draw();
    } catch (e) { toast(e.message, 'bad'); }
  };

  // تعديلُ ما قرأتَه في الصورة: الرقمُ والنوعُ والجنسيةُ والتاريخ
  const editData = async r => {
    const kind = h('select', { 'aria-label': 'نوع الهوية' },
      Object.entries(ID_TYPE_LABEL).map(([k, v]) =>
        h('option', { value: k, selected: (r.id_type || 'national') === k }, v)));
    const no = h('input', { dir: 'ltr', value: r.national_id || '', maxlength: 15,
      'aria-label': 'رقم الهوية' });
    const nat = h('input', { value: r.nationality || '', 'aria-label': 'الجنسية' });
    const exp = h('input', { type: 'date', value: r.id_expiry || '',
      'aria-label': 'تاريخ الانتهاء' });
    const res = await dialog({
      title: `بياناتُ هوية ${r.full_name}`,
      body: h('div.stack',
        h('p.small.muted', 'تُقرأ من الصورة وتُكتب هنا، فتُطابَق عند كلِّ مراجعة.'),
        h('div.grid-2',
          h('label.field', 'نوع الهوية', kind),
          h('label.field', 'رقم الهوية', no),
          h('label.field', 'الجنسية', nat),
          h('label.field', 'تاريخ الانتهاء', exp))),
      buttons: [{ label: 'حفظ', kind: 'primary',
        value: () => ({ kind: kind.value, no: no.value.trim(),
          nat: nat.value.trim(), exp: exp.value || null }) }, { label: 'إلغاء', value: null }]
    });
    if (!res) return;
    try {
      await db.rpc('set_identity', { p_member: r.member_id, p_id_type: res.kind,
        p_national_id: res.no || null, p_nationality: res.nat || null, p_expiry: res.exp });
      toast('حُفظت بياناتُ الهوية.', 'ok');
      await load(); draw();
    } catch (e) { toast(e.message, 'bad'); }
  };

  // طلبُ تجديدٍ من الإدارة بسببٍ مكتوب (ملاحظة ٣٠٨)
  const askRenew = async r => {
    const why = h('input', { value: 'قاربت هويتُك على الانتهاء',
      'aria-label': 'سبب الطلب' });
    const res = await dialog({
      title: `طلبُ تجديدٍ من ${r.full_name}`,
      body: h('div.stack',
        h('p.small.muted', 'يصل العضوَ إشعارٌ بالسبب، ويظهر له المطلوبُ في «بياناتي». '
          + 'والقديمُ معمولٌ به حتى يُعتمد الجديد.'),
        h('label.field', 'السبب', why)),
      buttons: [{ label: 'أرسِلْ', kind: 'primary',
        value: () => why.value.trim() || 'يُرجى تجديدُ الهوية' }, { label: 'إلغاء', value: null }]
    });
    if (!res) return;
    try {
      await db.rpc('ask_renewal', { p_member: r.member_id, p_kind: 'iqama', p_reason: res });
      toast('أُرسل طلبُ التجديد.', 'ok');
      await load(); draw();
    } catch (e) { toast(e.message, 'bad'); }
  };

  const expiryBadge = r => {
    if (r.id_expiry == null) return h('span.badge.warn', { title: 'لم يُسجَّل' }, 'بلا تاريخ');
    const d = Number(r.days_left);
    if (d < 0) return h('span.badge.bad', `انتهت قبل ${Math.abs(d)} يومًا`);
    if (d <= 90) return h('span.badge.warn', `يبقى ${d} يومًا`);
    return h('span.badge.ok', fmtDate(r.id_expiry));
  };

  const card = r => {
    const view = h('div.id-view');
    if (r.iqama_path) {
      const img = h('img.id-shot', { alt: `صورةُ هوية ${r.full_name}` });
      storage.signedUrl('private-docs', r.iqama_path, 600)
        .then(u => { img.src = u; })
        .catch(() => view.replaceChildren(h('span.small.muted', 'تعذّر عرضُ الصورة')));
      const open = h('button.btn.xs.ghost', { type: 'button' }, 'افتحْها كبيرة');
      open.onclick = () => busy(open, async () => {
        try { window.open(await storage.signedUrl('private-docs', r.iqama_path, 600), '_blank', 'noopener'); }
        catch (e) { toast(e.message, 'bad'); }
      });
      view.replaceChildren(img, open);
    } else {
      view.replaceChildren(h('div.id-shot.empty', h('span', 'لم تُرفع')));
    }

    // من لم يرفعْ هويتَه يظهر بحاله لا منتظرًا للتدقيق (ملاحظة ٣١٧)
    const st = r.iqama_path ? (r.iqama_status || 'pending') : 'none';
    const [label, tone] = DOC_STATE[st] || DOC_STATE.pending;

    return h('div.card.stack.id-card', { class: st === 'pending' ? 'waiting' : '' },
      h('div.id-grid',
        view,
        h('div.stack', { style: { gap: '4px' } },
          h('div.row.between.wrap',
            h('b', r.full_name),
            h('div.row', { style: { gap: '6px' } },
              h('span.badge', { class: tone }, label),
              r.renewal_open ? h('span.badge.warn', 'طلبُ تجديدٍ مفتوح') : null)),
          h('span.small.muted', { dir: 'ltr' }, r.email || ''),
          h('span.small.muted', GROUP_NAME[GROUP_OF(r)]
            + (r.member_no ? ` · ${r.member_no}` : '')),
          h('div.id-facts',
            h('span', h('small', 'النوع'), h('b', ID_TYPE_LABEL[r.id_type] || '—')),
            h('span', h('small', 'الرقم'), h('b', { dir: 'ltr' }, r.national_id || '—')),
            h('span', h('small', 'الجنسية'), h('b', r.nationality || '—')),
            h('span', h('small', 'الانتهاء'), expiryBadge(r))),
          r.iqama_note ? h('p.small.bad', { style: { margin: 0 } },
            'سببُ الإعادة: ', r.iqama_note) : null,
          r.renewal_reason ? h('p.small.muted', { style: { margin: 0 } },
            'سببُ التجديد: ', r.renewal_reason) : null,
          r.iqama_at ? h('span.small.muted', fmtDateTime(r.iqama_at)) : null,
          h('div.row.wrap', { style: { gap: '6px' } },
            h('button.btn.xs', { type: 'button', onclick: () => editData(r) }, 'بياناتُ الهوية'),
            st !== 'approved' && r.iqama_path
              ? h('button.btn.xs.primary', { type: 'button',
                  onclick: () => decide(r, 'approved') }, 'اعتماد') : null,
            st !== 'rejected' && r.iqama_path
              ? h('button.btn.xs.danger', { type: 'button',
                  onclick: () => decide(r, 'rejected') }, 'إعادةٌ للعضو') : null,
            !r.renewal_open
              ? h('button.btn.xs.ghost', { type: 'button',
                  onclick: () => askRenew(r) }, 'اطلبْ تجديدًا') : null))));
  };

  function draw() {
    const want = filter.value;
    const stOf = r => (r.iqama_path ? (r.iqama_status || 'pending') : 'none');
    const list = rows.filter(r => want === 'all'
      || (want === 'pending' && stOf(r) === 'pending')
      || (want === 'none' && stOf(r) === 'none')
      || (want === 'expiring' && r.id_expiry != null && Number(r.days_left) <= 90));
    const pending = rows.filter(r => stOf(r) === 'pending').length;
    const none = rows.filter(r => stOf(r) === 'none').length;
    const expiring = rows.filter(r => r.id_expiry != null && Number(r.days_left) <= 90).length;
    const noDate = rows.filter(r => r.id_expiry == null).length;
    summary.textContent = `${rows.length} عضوًا · لم يرفعْ: ${none} · ينتظر التدقيق: ${pending}`
      + ` · انتهت أو قاربت: ${expiring} · بلا تاريخ: ${noDate}`;
    box.replaceChildren(list.length ? h('div.id-wrap', list.map(card))
      : h('p.muted', 'لا هوياتٍ في هذه التصفية.'));
  }
  filter.onchange = draw;
  draw();

  return h('div.card.stack',
    h('div.row.between.wrap',
      h('h3', 'الهوية الشخصية'),
      h('label.field', 'التصفية', filter)),
    h('p.small.muted', 'تُطابَق بياناتُ الهوية بصورتها: النوعُ والرقمُ والجنسيةُ وتاريخُ الانتهاء. '
      + 'وما لا يُطابق يُعاد للعضو بسببٍ مكتوب، فيُطلب منه تجديدُها.'),
    summary,
    box);
}

async function docsSection(ctx, team, scr, group = 'translators') {
  let people = [];
  try {
    const rows = await db.rpc('member_docs');
    people = (Array.isArray(rows) ? rows : []).map(r => ({ ...r, id: r.member_id }));
  } catch {
    // خادم لم يُحدَّث بعد: يُرجع إلى قائمة الشاشة
    const priv = await db.select('profile_private', { select: '*' }).catch(() => []);
    const privOf = Object.fromEntries(priv.map(p => [p.id, p]));
    people = team.members.map(m => ({ ...m, member_id: m.id, ...(privOf[m.id] || {}) }));
  }
  people = people.filter(m => m.status !== 'disabled');

  const reload = () => ctx.navigate(`${scr.path}?tab=docs`, { replace: true });
  const pendingOf = m => ['photo', 'iqama'].some(k => m[`${k}_path`] && (m[`${k}_status`] || 'pending') === 'pending');

  const scope = h('select', { 'aria-label': 'نطاق العرض' },
    h('option', { value: 'group' }, GROUP_NAME[group] || 'هذه القائمة'),
    h('option', { value: 'all' }, 'كل الفريق'));
  const status = h('select', { 'aria-label': 'حالة المستند' },
    h('option', { value: 'matrix' }, 'كشف البيانات كاملًا'),
    h('option', { value: 'pending' }, 'ما ينتظر التدقيق'),
    h('option', { value: 'all' }, 'كل المستندات'),
    h('option', { value: 'approved' }, 'المعتمدة'),
    h('option', { value: 'rejected' }, 'المعادة للأعضاء'),
    h('option', { value: 'missing' }, 'من لم يرفع'));
  const box = h('div.stack');
  const summary = h('p.small.muted');

  async function decide(m, kind, decision) {
    let note = null;
    if (decision === 'rejected') {
      const reason = h('textarea', { rows: 3, placeholder: 'مثال: الصورة غير واضحة، أو الخلفية غير بيضاء، أو الزي غير مناسب' });
      const res = await dialog({
        title: `إعادة ${DOC_LABEL[kind]} إلى ${m.full_name}`,
        body: h('div.stack',
          h('p.small.muted', 'يظهر السبب للعضو في «بياناتي» ليرفع بديلًا مطابقًا للشروط.'),
          h('label.field', 'سبب الإعادة', reason)),
        buttons: [
          { label: 'إعادة للعضو', kind: 'danger', validate: () => {
            if (reason.value.trim().length < 5) { toast('اكتب سبب الإعادة.', 'bad'); return false; }
            return true;
          }, value: () => reason.value.trim() },
          { label: 'إلغاء', value: null }
        ]
      });
      if (!res) return;
      note = res;
    }
    try {
      await db.rpc('review_member_doc', { p_member: m.member_id || m.id, p_kind: kind, p_decision: decision, p_note: note });
      toast(decision === 'approved' ? 'اعتُمد المستند.' : 'أُعيد المستند للعضو.', 'ok');
      reload();
    } catch (err) { toast(err.message, 'bad'); }
  }

  function docCard(m, kind) {
    const path = m[`${kind}_path`];
    const st = m[`${kind}_status`] || 'pending';
    const note = m[`${kind}_note`];
    const at = m[`${kind}_at`];
    const [label, tone] = DOC_STATE[st] || DOC_STATE.pending;

    const view = h('div.doc-view');
    if (kind === 'photo') {
      const img = h('img.photo-4x6', { alt: `الصورة الشخصية لـ${m.full_name}` });
      storage.signedUrl('member-photos', path, 600).then(u => { img.src = u; })
        .catch(() => view.replaceChildren(h('span.small.muted', 'تعذّر عرض الصورة')));
      view.replaceChildren(img);
    } else {
      const open = h('button.btn.sm', { type: 'button' }, 'عرض صورة الهوية');
      open.onclick = () => busy(open, async () => {
        try { window.open(await storage.signedUrl('private-docs', path, 600), '_blank', 'noopener'); }
        catch (err) { toast(err.message, 'bad'); }
      });
      view.replaceChildren(open);
    }

    return h('div.doc-card', { class: st === 'pending' ? 'waiting' : '' },
      view,
      h('div.doc-body',
        h('b', m.full_name),
        h('div.small.muted', GROUP_NAME[GROUP_OF(m)] + (m.member_no ? ` · ${m.member_no}` : '')),
        h('div.small.muted', { dir: 'ltr' }, m.email || ''),
        h('div.small', DOC_LABEL[kind], ' — ', h('span.badge', { class: tone }, label)),
        note ? h('div.small.bad', 'سبب الإعادة: ', note) : null,
        at ? h('div.small.muted', fmtDateTime(at)) : null,
        h('div.row',
          st !== 'approved' && h('button.btn.sm.primary', { type: 'button', onclick: () => decide(m, kind, 'approved') }, 'اعتماد'),
          st !== 'rejected' && h('button.btn.sm.danger', { type: 'button', onclick: () => decide(m, kind, 'rejected') }, 'إعادة للعضو'))));
  }

  // ---------- كشفُ البيانات: صفٌّ لكل حساب، وحالُ كل بيانٍ خانة ----------
  // اكتمل ✓ · تحت التدقيق ◷ · لم يُرفع ✗ · أُعيد ⟲ · لا يلزمه —
  const MARK = {
    ok:     ['✓', 'ok',   'اكتمل واعتُمد'],
    review: ['◷', 'warn', 'تحت التدقيق'],
    none:   ['✗', 'bad',  'لم يُرفع'],
    bad:    ['⟲', 'bad',  'أُعيد للعضو ليُصحّحه'],
    na:     ['—', 'muted', 'لا يلزم هذا الحساب']
  };
  const COLS = [
    ['photo', 'الصورة'], ['iqama', 'الهوية'], ['national_id', 'رقم الهوية'],
    ['whatsapp', 'الجوال'], ['nationality', 'الجنسية'], ['residence', 'الإقامة'],
    ['languages', 'اللغات'], ['city_state', 'المدينة'], ['bank', 'الحساب البنكي']
  ];
  let matrix = null;

  const cell = (v, label) => {
    const [sign, tone, title] = MARK[v] || MARK.na;
    return h('td', { 'data-label': label, class: `mx-cell ${tone}`, title },
      h('span.mx-mark', { class: tone, 'aria-label': `${label}: ${title}` }, sign));
  };

  const remind = async (ids, btn) => busy(btn, async () => {
    try {
      const n = await db.rpc('remind_profile_data', { p_members: ids });
      toast(Number(n) > 0 ? `أُرسل التذكير إلى ${Number(n)}.` : 'لا أحد ينقصه بيان.', 'ok');
      matrix = null;
      draw();
    } catch (err) { toast(err.message, 'bad'); }
  });

  async function drawMatrix(inScope) {
    if (!matrix) {
      try { matrix = await db.rpc('member_data_matrix'); }
      catch (err) { box.replaceChildren(h('p.small.bad', err.message)); return; }
      matrix = Array.isArray(matrix) ? matrix : [];
    }
    const ids = new Set(inScope.map(m => m.member_id || m.id));
    const rows = matrix.filter(r => ids.has(r.member_id));
    const short = rows.filter(r => Number(r.missing) > 0);
    const wait = rows.filter(r => Number(r.waiting) > 0);
    const done = rows.filter(r => r.complete);

    summary.textContent = `في هذه القائمة: ${rows.length} حسابًا · اكتملت بياناتهم: `
      + `${done.length} · تحت التدقيق: ${wait.length} · ينقصهم بيان: ${short.length}`;

    const remindAll = h('button.btn.sm.primary', { type: 'button' },
      `تذكير من ينقصه بيان (${short.length})`);
    remindAll.onclick = () => remind(short.map(r => r.member_id), remindAll);
    if (!short.length) remindAll.disabled = true;

    box.replaceChildren(
      h('div.row.wrap.between',
        h('p.small.muted', { style: { margin: 0 } },
          'الخانة الخضراء ما اكتمل واعتُمد، والحمراء ما لم يُرفع أو أُعيد، '
          + 'والصفراء ما هو تحت التدقيق. ويبقى التذكير حتى تكتمل البيانات.'),
        remindAll),
      h('div.table-wrap', h('table.responsive.mx-table',
        h('thead', h('tr',
          h('th', 'الحساب'), h('th', 'الفريق'),
          COLS.map(([, label]) => h('th', { class: 'mx-head' }, label)),
          h('th', 'الناقص'), h('th', 'آخر تذكير'), h('th', ''))),
        h('tbody', rows.map(r => {
          const btn = h('button.btn.xs', { type: 'button', title: 'تذكير هذا العضو' }, 'تذكير');
          btn.onclick = () => remind([r.member_id], btn);
          if (!Number(r.missing)) btn.disabled = true;
          return h('tr', { class: r.complete ? 'mx-done' : (Number(r.missing) ? 'mx-short' : '') },
            h('td', { 'data-label': 'الحساب' }, h('b', r.full_name),
              h('span.sub', { dir: 'ltr' }, r.email || ''),
              r.data_note ? h('span.sub.bad', r.data_note) : null),
            h('td', { 'data-label': 'الفريق' },
              h('span.small', GROUP_NAME[GROUP_OF({ role: r.role, track: r.track })] || '—')),
            COLS.map(([k, label]) => cell(r[k], label)),
            h('td', { 'data-label': 'الناقص', dir: 'ltr' },
              r.complete
                ? h('span.badge.ok', 'مكتمل')
                : h('span.badge', { class: Number(r.missing) ? 'bad' : 'warn' },
                    Number(r.missing) ? String(r.missing) : 'تدقيق')),
            h('td', { 'data-label': 'آخر تذكير' },
              r.reminded_at
                ? h('span.small.muted', fmtDateTime(r.reminded_at),
                    Number(r.remind_count) > 1
                      ? h('span.sub', `${r.remind_count} مرات`) : null)
                : h('span.small.muted', '—')),
            h('td', btn));
        })))),
      short.length
        ? h('p.small.warn', 'ولا تُصدَر بطاقةُ عملٍ لمن لم تكتمل بياناتُه.')
        : h('p.small.ok', 'اكتملت بيانات هذه القائمة.'));
  }

  function draw() {
    const inScope = people.filter(m => scope.value === 'all' || GROUP_OF(m) === group);
    if (status.value === 'matrix') { drawMatrix(inScope); return; }
    const want = status.value;
    const items = [];
    if (want !== 'missing') {
      for (const m of inScope) {
        for (const kind of ['photo', 'iqama']) {
          if (!m[`${kind}_path`]) continue;
          const st = m[`${kind}_status`] || 'pending';
          if (want !== 'all' && st !== want) continue;
          items.push(docCard(m, kind));
        }
      }
    }
    const missing = inScope.filter(m => !m.photo_path || !m.iqama_path);
    const waiting = inScope.filter(pendingOf).length;

    summary.textContent = `في هذه القائمة: ${inScope.length} عضوًا · ينتظر التدقيق: ${waiting} · لم يكتمل رفعهم: ${missing.length}`;

    box.replaceChildren(
      want === 'missing'
        ? (missing.length
            ? h('div.table-wrap', h('table.responsive',
                h('thead', h('tr', ['العضو', 'الفريق', 'الصورة الشخصية', 'صورة الهوية'].map(t => h('th', t)))),
                h('tbody', missing.map(m => h('tr',
                  h('td', { 'data-label': 'العضو' }, h('b', m.full_name), h('div.small.muted', { dir: 'ltr' }, m.email || '')),
                  h('td', { 'data-label': 'الفريق' }, GROUP_NAME[GROUP_OF(m)]),
                  h('td', { 'data-label': 'الصورة' }, m.photo_path ? h('span.badge.ok', 'مرفوعة') : h('span.badge.bad', 'لم تُرفع')),
                  h('td', { 'data-label': 'الهوية' }, m.iqama_path ? h('span.badge.ok', 'مرفوعة') : h('span.badge.bad', 'لم تُرفع')))))))
            : h('p.muted', 'رفع الجميع مستنداتهم.'))
        : (items.length ? h('div.doc-grid', items)
            : h('p.muted', want === 'pending' ? 'لا مستندات بانتظار التدقيق في هذه القائمة.' : 'لا مستندات بهذه الحالة.')),
      want !== 'missing' && missing.length
        ? h('p.small.muted', `لم يكتمل رفع مستنداتهم: ${missing.slice(0, 12).map(m => m.full_name).join('، ')}${missing.length > 12 ? '…' : ''}`)
        : null);
  }
  scope.onchange = draw;
  status.onchange = draw;
  draw();

  return h('div.card.stack',
    h('div.row.between.wrap',
      h('h3', 'تدقيق المستندات'),
      h('div.row.wrap', h('label.field', 'الفريق', scope), h('label.field', 'الحالة', status))),
    h('p.small.muted', 'تُعتمد الصورة الشخصية وصورة الهوية قبل إصدار بطاقة العمل. وما لا يطابق الشروط يُعاد للعضو بسبب مكتوب.'),
    summary,
    box);
}
