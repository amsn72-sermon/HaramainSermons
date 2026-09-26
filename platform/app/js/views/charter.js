// ميثاق العمل: نصّه، ومن وقّع عليه ومتى، ومن لم يوقّع — لمدير المشروع والمنسق
// (ملاحظة ١٢٥؛ وهو ما كان يُسمّى «سياسة السرية»، والتوقيعات السابقة باقية بتواريخها)
import { h, toast, busy, fmtDate, fmtDateTime } from '../ui.js';
import { db } from '../sb.js';
import { state, isAdmin, ROLE_LABEL } from '../store.js';
import { POLICY_KEY, POLICY_VERSION, POLICY_TITLE } from '../policy.js';
import { policyText } from './policy.js';
import { exportExcel, exportPdf, exportWord } from '../teamexport.js';

const GROUP_NAME = { admins: 'الحسابات الإدارية', translators: 'المترجمون المتخصصون', field: 'المرشدون المكانيون' };
const groupOf = m => (['manager', 'coordinator'].includes(m.role) ? 'admins'
  : (m.track === 'field' ? 'field' : 'translators'));

export async function render(ctx) {
  if (!isAdmin()) { ctx.navigate('/app', { replace: true }); return h('div'); }

  const [members, signs] = await Promise.all([
    db.select('profiles', { select: 'id,full_name,email,member_no,role,track,status', order: 'full_name.asc' }),
    db.select('policy_acceptances', {
      select: 'member_id,policy_version,signed_name,accepted_at', policy_key: `eq.${POLICY_KEY}` }).catch(() => [])
  ]);

  const signOf = {};
  for (const r of signs) if (r.policy_version === POLICY_VERSION) signOf[r.member_id] = r;

  const people = members.filter(m => m.status === 'active');
  const signed = people.filter(m => signOf[m.id]);
  const waiting = people.filter(m => !signOf[m.id]);

  const rowsOf = list => list.map(m => {
    const sg = signOf[m.id];
    return h('tr',
      h('td', { 'data-label': 'العضو' }, h('b', m.full_name),
        h('div.small.muted', { dir: 'ltr' }, m.email || '')),
      h('td', { 'data-label': 'الفريق' }, GROUP_NAME[groupOf(m)], h('div.small.muted', ROLE_LABEL[m.role])),
      h('td', { 'data-label': 'الرقم' }, m.member_no || '—'),
      h('td', { 'data-label': 'الحال' }, sg
        ? h('span', h('span.badge.ok', 'وقّع'), h('div.small.muted', `باسم «${sg.signed_name}»`))
        : h('span.badge.bad', 'لم يوقّع')),
      h('td', { 'data-label': 'التاريخ' }, sg ? fmtDateTime(sg.accepted_at) : '—'));
  });

  const sheet = () => [
    ['العضو', 'الفريق', 'الرقم', 'الحال', 'الاسم الموقَّع به', 'تاريخ التوقيع'],
    ...people.map(m => {
      const sg = signOf[m.id];
      return [m.full_name, GROUP_NAME[groupOf(m)], m.member_no || '',
        sg ? 'وقّع' : 'لم يوقّع', sg ? sg.signed_name : '', sg ? fmtDateTime(sg.accepted_at) : ''];
    }),
    ['الإجمالي', `${people.length} عضوًا`, '', `وقّع ${signed.length} · لم يوقّع ${waiting.length}`, '', '']
  ];
  const title = `${POLICY_TITLE} — كشف التواقيع`;
  const note = `وقّع ${signed.length} من ${people.length} — النسخة ${POLICY_VERSION} — ${fmtDate(new Date())}`;

  const wordBtn = h('button.btn.sm', { type: 'button' }, 'تصدير Word');
  wordBtn.onclick = () => busy(wordBtn, () => exportWord(sheet(), title, { note }).catch(e => toast(e.message, 'bad')));

  return h('div',
    h('div.page-head', h('div.grow',
      h('div.eyebrow', 'الفريق'), h('h1', POLICY_TITLE),
      h('p.muted', 'ميثاق يوقّعه كل عضو قبل مباشرة العمل، وفيه ما يلزمه تجاه المواد والمواعيد والسرية. وهنا نصّه ومن وقّعه.'))),

    h('div.pay-sum',
      h('div.pay-cell', h('span', 'أعضاء الفريق'), h('b', String(people.length))),
      h('div.pay-cell', h('span', 'وقّعوا'), h('b', String(signed.length))),
      h('div.pay-cell', { class: waiting.length ? 'warn' : '' },
        h('span', 'لم يوقّعوا'), h('b', String(waiting.length)))),

    h('div.row.wrap', { style: { margin: '12px 0' } },
      h('button.btn.sm', { type: 'button', onclick: () => exportExcel(sheet(), title) }, 'تصدير Excel'),
      wordBtn,
      h('button.btn.sm', { type: 'button',
        onclick: () => { if (!exportPdf(sheet(), title, { note })) toast('اسمح بالنوافذ المنبثقة للتصدير', 'bad'); } },
        'تصدير PDF')),

    waiting.length ? h('div.card.stack',
      h('h3', `لم يوقّعوا بعد (${waiting.length})`),
      h('p.small.muted', 'العضو يُطالَب بالميثاق عند أول دخول، ولا يتابع عمله قبل توقيعه.'),
      h('div.table-wrap', h('table.responsive',
        h('thead', h('tr', ['العضو', 'الفريق', 'الرقم', 'الحال', 'التاريخ'].map(t => h('th', t)))),
        h('tbody', rowsOf(waiting))))) : null,

    h('div.card.stack',
      h('h3', `وقّعوا (${signed.length})`),
      signed.length
        ? h('div.table-wrap', h('table.responsive',
            h('thead', h('tr', ['العضو', 'الفريق', 'الرقم', 'الحال', 'التاريخ'].map(t => h('th', t)))),
            h('tbody', rowsOf(signed))))
        : h('p.muted', 'لم يوقّع أحد بعد.')),

    h('details.cd-more', { style: { marginTop: '14px' } },
      h('summary', `نصّ ${POLICY_TITLE} — النسخة ${POLICY_VERSION}`),
      h('div.card.stack', policyText(),
        h('p.small.muted', 'عند تعديل النص جوهريًّا تُرفع النسخة، فيُطلب التوقيع من جديد ويبقى سجل التوقيع السابق.'))));
}
