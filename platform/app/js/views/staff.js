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

  const [team, counts, byGroup] = await Promise.all([
    teamRender(ctx, { parts: true, group, reloadPath: scr.path + (want === 'team' ? '' : `?tab=${want}`) }),
    db.rpc('pending_reviews').then(r => (Array.isArray(r) ? r[0] : r) || {}).catch(() => ({})),
    db.rpc('pending_reviews_by_group').then(r => (Array.isArray(r) ? r : [])).catch(() => [])
  ]);

  const ids = new Set(team.members.map(m => m.id));
  const panel = h('div.staff-panel');
  const TABS = [
    ['team', scr.tab, team.pendingCount],
    ['docs', 'تدقيق المستندات', 0],
    ['bank', 'الحسابات البنكية', 0]
  ];
  // لكل قائمة عدّادها: ما ينتظر تدقيقه فيها هي (ملاحظة ١٢٠)
  const mineCount = byGroup.find(r => r.grp === group);
  if (mineCount) {
    TABS[1][2] = Number(mineCount.photos || 0) + Number(mineCount.iqamas || 0);
    TABS[2][2] = Number(mineCount.banks || 0);
  } else if (group === 'translators') {
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
const GROUP_OF = m => (['manager', 'coordinator'].includes(m.role) ? 'admins'
  : (m.track === 'field' ? 'field' : 'translators'));
const GROUP_NAME = { admins: 'الحسابات الإدارية', translators: 'المترجمون المتخصصون', field: 'المرشدون المكانيون' };

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

  function draw() {
    const inScope = people.filter(m => scope.value === 'all' || GROUP_OF(m) === group);
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
