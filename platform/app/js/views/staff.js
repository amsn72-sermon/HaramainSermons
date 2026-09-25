// شؤون الفريق: الانضمام والأعضاء، وتدقيق المستندات، والحسابات البنكية في شاشة واحدة (ملاحظة ٩٨)
// وتحت «الفريق» ثلاث قوائم مستقلة: الإداريون، والمترجمون المتخصصون،
// والمرشدون المكانيون (ملاحظتا ٩٩ و١٠١)
import { h, toast, busy, dialog, fmtDateTime } from '../ui.js';
import { db, storage } from '../sb.js';
import { state, isManager } from '../store.js';
import { render as teamRender } from './team.js';
import { adminList as bankAdmin } from './bank.js';

export const DOC_LABEL = { photo: 'الصورة الشخصية', iqama: 'صورة الهوية أو الإقامة' };
export const DOC_STATE = {
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
  }
};

export const admins = ctx => render(ctx, 'admins');
export const field = ctx => render(ctx, 'field');

export async function render(ctx, group = 'translators') {
  const scr = SCREEN[group] || SCREEN.translators;
  const want = ctx.query?.get('tab') || (location.pathname === '/app/bank-accounts' ? 'bank' : 'team');

  const [team, counts] = await Promise.all([
    teamRender(ctx, { parts: true, group, reloadPath: scr.path + (want === 'team' ? '' : `?tab=${want}`) }),
    db.rpc('pending_reviews').then(r => (Array.isArray(r) ? r[0] : r) || {}).catch(() => ({}))
  ]);

  const ids = new Set(team.members.map(m => m.id));
  const panel = h('div.staff-panel');
  const TABS = [
    ['team', scr.tab, team.pendingCount],
    ['docs', 'تدقيق المستندات', 0],
    ['bank', 'الحسابات البنكية', 0]
  ];
  // العدّادات العامة تُعرض على شاشة المترجمين فقط حتى لا تختلط أرقام القوائم
  if (group === 'translators') {
    TABS[1][2] = Number(counts.photos || 0) + Number(counts.iqamas || 0);
    TABS[2][2] = Number(counts.banks || 0);
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
        group === 'admins' ? securityCard(ctx) : null, team.joins, team.filters, team.table].filter(Boolean));
      else if (key === 'docs') panel.replaceChildren(await docsSection(ctx, team, scr));
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
async function docsSection(ctx, team, scr) {
  const priv = await db.select('profile_private', { select: '*' });
  const privOf = Object.fromEntries(priv.map(p => [p.id, p]));
  const people = team.members.filter(m => m.status !== 'pending');
  const reload = () => ctx.navigate(`${scr.path}?tab=docs`, { replace: true });

  const onlyPending = h('input', { type: 'checkbox', checked: true });
  const box = h('div.stack');

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
      await db.rpc('review_member_doc', { p_member: m.id, p_kind: kind, p_decision: decision, p_note: note });
      toast(decision === 'approved' ? 'اعتُمد المستند.' : 'أُعيد المستند للعضو.', 'ok');
      reload();
    } catch (err) { toast(err.message, 'bad'); }
  }

  function docCard(m, kind) {
    const p = privOf[m.id] || {};
    const path = kind === 'photo' ? p.photo_path : p.iqama_path;
    const status = (kind === 'photo' ? p.photo_status : p.iqama_status) || 'pending';
    const note = kind === 'photo' ? p.photo_note : p.iqama_note;
    const at = kind === 'photo' ? p.photo_at : p.iqama_at;
    const [label, tone] = DOC_STATE[status] || DOC_STATE.pending;

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

    return h('div.doc-card',
      view,
      h('div.doc-body',
        h('b', m.full_name), h('div.small.muted', { dir: 'ltr' }, m.email),
        h('div.small', DOC_LABEL[kind], ' — ', h('span.badge', { class: tone }, label)),
        note ? h('div.small.bad', 'سبب الإعادة: ', note) : null,
        at ? h('div.small.muted', fmtDateTime(at)) : null,
        h('div.row',
          status !== 'approved' && h('button.btn.sm.primary', { type: 'button', onclick: () => decide(m, kind, 'approved') }, 'اعتماد'),
          status !== 'rejected' && h('button.btn.sm.danger', { type: 'button', onclick: () => decide(m, kind, 'rejected') }, 'إعادة للعضو'))));
  }

  function draw() {
    const items = [];
    for (const m of people) {
      const p = privOf[m.id] || {};
      for (const kind of ['photo', 'iqama']) {
        const path = kind === 'photo' ? p.photo_path : p.iqama_path;
        if (!path) continue;
        const status = (kind === 'photo' ? p.photo_status : p.iqama_status) || 'pending';
        if (onlyPending.checked && status !== 'pending') continue;
        items.push(docCard(m, kind));
      }
    }
    const missing = people.filter(m => !(privOf[m.id] || {}).photo_path);
    box.replaceChildren(
      items.length ? h('div.doc-grid', items)
        : h('p.muted', onlyPending.checked ? 'لا مستندات بانتظار التدقيق.' : 'لم يرفع أحد مستندًا بعد.'),
      missing.length ? h('p.small.muted', `لم يرفع صورته الشخصية بعد: ${missing.map(m => m.full_name).join('، ')}`) : null);
  }
  onlyPending.onchange = draw;
  draw();

  return h('div.card.stack',
    h('div.row.between', h('h3', 'تدقيق المستندات'),
      h('label.check', onlyPending, h('span', 'ما ينتظر التدقيق فقط'))),
    h('p.small.muted', 'تُعتمد الصورة الشخصية وصورة الهوية قبل إصدار بطاقة العمل. وما لا يطابق الشروط يُعاد للعضو بسبب مكتوب.'),
    box);
}
