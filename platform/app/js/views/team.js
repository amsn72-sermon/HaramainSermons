// فريق العمل: طلبات التسجيل، التفعيل، الأدوار، واللغات
import { h, toast, busy, dialog, emptyState, fmtDate } from '../ui.js';
import { db, storage } from '../sb.js';
import { state, isManager, ROLE_LABEL, STATUS_LABEL, langName } from '../store.js';

export async function render(ctx) {
  const [members, priv] = await Promise.all([
    db.select('profiles', { select: '*,member_languages(language_code)', order: 'created_at.desc' }),
    db.select('profile_private', { select: '*' })
  ]);
  const privOf = Object.fromEntries(priv.map(p => [p.id, p]));
  const langsOf = m => (m.member_languages || []).map(x => x.language_code);
  const reload = () => ctx.navigate('/app/team', { replace: true });

  const filterLang = h('select', { 'aria-label': 'تصفية حسب اللغة' }, h('option', { value: '' }, 'جميع اللغات'),
    state.languages.map(l => h('option', { value: l.code }, l.name_ar)));
  const filterStatus = h('select', { 'aria-label': 'تصفية حسب الحالة' }, h('option', { value: '' }, 'كل الحالات'),
    Object.entries(STATUS_LABEL).map(([k, v]) => h('option', { value: k }, v)));
  const q = h('input', { type: 'search', placeholder: 'الاسم أو البريد', 'aria-label': 'بحث' });
  const table = h('div');

  const canManage = m => isManager() || m.role === 'translator';

  async function edit(m) {
    const role = h('select', { disabled: !isManager() || m.id === state.profile.id },
      Object.entries(ROLE_LABEL).map(([k, v]) => h('option', { value: k, selected: m.role === k }, v)));
    const chosen = new Set(langsOf(m));
    const pills = h('div.lang-pills', state.languages.map(l => h('button', { type: 'button', 'aria-pressed': String(chosen.has(l.code)),
      onclick: e => { chosen.has(l.code) ? chosen.delete(l.code) : chosen.add(l.code); e.currentTarget.setAttribute('aria-pressed', String(chosen.has(l.code))); } }, l.name_ar)));
    const p = privOf[m.id] || {};
    const iqama = h('div');
    if (p.iqama_path) storage.signedUrl('private-docs', p.iqama_path, 600)
      .then(url => iqama.replaceChildren(h('a.btn.sm', { href: url, target: '_blank', rel: 'noopener' }, 'عرض صورة الإقامة (رابط مؤقت ١٠ دقائق)')))
      .catch(() => iqama.replaceChildren(h('span.small.muted', 'تعذّر فتح الصورة')));

    const result = await dialog({
      title: `${m.full_name} — ${ROLE_LABEL[m.role]}`,
      body: h('div.stack',
        h('div.grid-2',
          h('div', h('div.small.muted', 'البريد'), h('div', { dir: 'ltr' }, m.email)),
          h('div', h('div.small.muted', 'واتس آب'), h('div', { dir: 'ltr' }, p.whatsapp || '—')),
          h('div', h('div.small.muted', 'الجنسية'), h('div', p.nationality || '—')),
          h('div', h('div.small.muted', 'الهوية / الإقامة'), h('div', { dir: 'ltr' }, p.national_id || '—')),
          h('div', h('div.small.muted', 'مكان الإقامة'), h('div', p.residence || '—')),
          h('div', h('div.small.muted', 'تاريخ التسجيل'), h('div', fmtDate(m.created_at)))),
        iqama,
        h('label.field', 'الدور', role, !isManager() && h('small', 'تغيير الأدوار الإدارية بيد مدير المشروع')),
        h('fieldset', h('legend', 'اللغات المؤهل فيها'), pills)),
      buttons: [
        { label: 'حفظ', kind: 'primary', value: () => ({ role: role.value, languages: [...chosen] }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!result) return;
    try {
      await db.rpc('admin_update_member', { p_member: m.id, p_status: null, p_role: result.role === m.role ? null : result.role, p_languages: result.languages });
      toast('حُفظت بيانات العضو.', 'ok'); reload();
    } catch (err) { toast(err.message, 'bad'); }
  }

  async function setStatus(btn, m, status) {
    await busy(btn, async () => {
      try {
        await db.rpc('admin_update_member', { p_member: m.id, p_status: status, p_role: null, p_languages: null });
        toast(status === 'active' ? `فُعّل حساب ${m.full_name}.` : `عُطّل حساب ${m.full_name}.`, 'ok'); reload();
      } catch (err) { toast(err.message, 'bad'); }
    });
  }

  function draw() {
    const list = members.filter(m => m.status !== 'pending')
      .filter(m => !filterLang.value || langsOf(m).includes(filterLang.value))
      .filter(m => !filterStatus.value || m.status === filterStatus.value)
      .filter(m => !q.value.trim() || m.full_name.includes(q.value.trim()) || m.email.includes(q.value.trim()));
    table.replaceChildren(list.length ? h('div.table-wrap', h('table.responsive',
      h('thead', h('tr', ['الاسم', 'الدور', 'اللغات', 'الحالة', ''].map(t => h('th', t)))),
      h('tbody', list.map(m => h('tr',
        h('td', { 'data-label': 'الاسم' }, h('b', m.full_name), h('span.sub', { dir: 'ltr' }, m.email)),
        h('td', { 'data-label': 'الدور' }, ROLE_LABEL[m.role]),
        h('td', { 'data-label': 'اللغات' }, langsOf(m).map(langName).join('، ') || '—'),
        h('td', { 'data-label': 'الحالة' }, h('span.badge', { class: m.status === 'active' ? 'ok' : 'bad' }, STATUS_LABEL[m.status])),
        h('td', canManage(m) && m.id !== state.profile.id && h('div.row',
          h('button.btn.sm', { type: 'button', onclick: () => edit(m) }, 'الملف والتعديل'),
          m.status === 'active'
            ? h('button.btn.sm.danger', { type: 'button', onclick: e => setStatus(e.currentTarget, m, 'disabled') }, 'تعطيل')
            : h('button.btn.sm', { type: 'button', onclick: e => setStatus(e.currentTarget, m, 'active') }, 'تفعيل'))))))))
      : emptyState('لا أعضاء مطابقون', 'غيّر عوامل التصفية.'));
  }
  [filterLang, filterStatus, q].forEach(el => el.addEventListener('input', draw));
  draw();

  const pending = members.filter(m => m.status === 'pending');
  return h('div',
    h('div.page-head', h('div.grow', h('div.eyebrow', 'الإدارة'), h('h1', 'فريق العمل'),
      h('p.muted', 'ينضم الأعضاء عبر صفحة التسجيل، ثم يفعّلهم المنسق. التعطيل يحفظ سجل العضو بدل حذفه، ولا يُعطَّل من لديه مهمة قائمة.'))),
    h('div.card', h('h3', `طلبات التسجيل (${pending.length})`),
      pending.length ? h('div.stack', pending.map(m => h('div.row', { style: { borderBottom: '1px solid var(--border)', paddingBottom: '10px' } },
        h('div', { style: { flex: 1, minWidth: '200px' } }, h('b', m.full_name), h('div.small.muted', { dir: 'ltr' }, m.email),
          h('div.small', 'اللغات: ', langsOf(m).map(langName).join('، ') || '—')),
        h('button.btn.sm', { type: 'button', onclick: () => edit(m) }, 'مراجعة الملف'),
        h('button.btn.sm.primary', { type: 'button', onclick: e => setStatus(e.currentTarget, m, 'active') }, 'تفعيل'),
        h('button.btn.sm.danger', { type: 'button', onclick: e => setStatus(e.currentTarget, m, 'disabled') }, 'رفض'))))
        : h('p.muted', 'لا توجد طلبات جديدة.'),
      h('p.small.muted', 'رابط التسجيل لمشاركته مع المترجمين: ', h('span', { dir: 'ltr' }, location.origin + '/register'))),
    h('div.grid', { style: { margin: '16px 0' } }, h('label.field', 'بحث', q), h('label.field', 'اللغة', filterLang), h('label.field', 'الحالة', filterStatus)),
    table);
}
