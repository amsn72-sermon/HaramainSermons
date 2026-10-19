// ميثاق العمل: نصّه، ومن وقّع عليه ومتى، ومن لم يوقّع — لمدير المشروع والمنسق
// (ملاحظة ١٢٥؛ وهو ما كان يُسمّى «سياسة السرية»، والتوقيعات السابقة باقية بتواريخها)
import { h, toast, busy, fmtDate, fmtDateTime } from '../ui.js';
import { db } from '../sb.js';
import { isAdmin, isManager, roleLabel } from '../store.js';
import { POLICY_KEY, POLICY_VERSION, POLICY_TITLE } from '../policy.js';
import { policyText } from './policy.js';
import { proofFor, rosterDialog } from '../sigproof.js';
import { exportExcel, exportPdf, exportWord } from '../teamexport.js';

const GROUP_NAME = { admins: 'الحسابات الإدارية', translators: 'المترجمون المتخصصون',
  field: 'المرشدون المكانيون', answers: 'المخصَّصون لإجابة السائلين' };
const groupOf = m => (['manager', 'coordinator'].includes(m.role) ? 'admins'
  : m.track === 'answers' ? 'answers' : (m.track === 'field' ? 'field' : 'translators'));

export async function render(ctx) {
  if (!isAdmin()) { ctx.navigate('/app', { replace: true }); return h('div'); }

  const [members, signs] = await Promise.all([
    db.select('profiles', { select: 'id,full_name,email,member_no,role,track,status', order: 'full_name.asc' }),
    db.select('policy_acceptances', {
      select: 'member_id,policy_version,signed_name,accepted_at', policy_key: `eq.${POLICY_KEY}` }).catch(() => [])
  ]);

  const signOf = {};
  for (const r of signs) if (r.policy_version === POLICY_VERSION) signOf[r.member_id] = r;
  // ومن وقَّع على نسخةٍ سابقةٍ يُعرَف، فيُطالَب بالجارية ولا يُحسَب غيرَ موقِّعٍ
  //   أصلًا، ووثيقةُ إثباته تُطبَع بنصِّ نسخته هو (ملاحظتا ٤٢٦ و٤٢٧)
  const prevOf = {};
  for (const r of [...signs].sort((a, b) => String(a.accepted_at).localeCompare(String(b.accepted_at)))) {
    if (r.policy_version !== POLICY_VERSION) prevOf[r.member_id] = r;
  }

  const people = members.filter(m => m.status === 'active');
  const signed = people.filter(m => signOf[m.id]);
  const waiting = people.filter(m => !signOf[m.id]);

  // زرُّ وثيقة الإثبات: يُطبَع بنصِّ النسخة التي وقَّعها هو (ملاحظة ٤٢٧)
  const proofBtn = (m, sg) => {
    const b = h('button.btn.xs', { type: 'button',
      title: `وثيقةُ إثبات توقيع ${m.full_name} على النسخة ${sg.policy_version}` }, '🖨 وثيقةُ إثبات');
    b.onclick = () => busy(b, () => proofFor(m.id, sg.policy_version));
    return b;
  };

  const rowsOf = list => list.map(m => {
    const sg = signOf[m.id];
    const old = !sg ? prevOf[m.id] : null;
    const rec = sg || old;
    return h('tr',
      h('td', { 'data-label': 'العضو' }, h('b', m.full_name),
        h('div.small.muted', { dir: 'ltr' }, m.email || '')),
      h('td', { 'data-label': 'الفريق' }, GROUP_NAME[groupOf(m)], h('div.small.muted', roleLabel(m))),
      h('td', { 'data-label': 'الرقم' }, m.member_no || '—'),
      h('td', { 'data-label': 'الحال' }, sg
        ? h('span', h('span.badge.ok', 'وقّع'), h('div.small.muted', `باسم «${sg.signed_name}»`))
        : old
          ? h('span', h('span.badge.warn', `وقّع ${old.policy_version}`),
              h('div.small.muted', `ينتظر توقيع ${POLICY_VERSION}`))
          : h('span.badge.bad', 'لم يوقّع')),
      h('td', { 'data-label': 'التاريخ' }, rec ? fmtDateTime(rec.accepted_at) : '—'),
      h('td', { 'data-label': 'الإثبات' }, rec && isManager() ? proofBtn(m, rec) : '—'));
  });

  // صندوقُ التحقُّق: رمزٌ يُكتَب فيُقابَل بسجلّه
  function verifyBox() {
    const code = h('input', { dir: 'ltr', placeholder: 'SG-XXXXXXXXXX',
      'aria-label': 'رمز وثيقة الإثبات', maxlength: 20 });
    const out = h('div.small');
    const go = h('button.btn.sm.primary', { type: 'button' }, 'تحقَّقْ');
    go.onclick = () => busy(go, async () => {
      const v = code.value.trim().toUpperCase();
      if (v.length < 6) { out.replaceChildren(h('span.bad', 'اكتبِ الرمزَ كاملًا.')); return; }
      try {
        const rows = await db.rpc('policy_proof_by_code', { p_code: v });
        const r = (Array.isArray(rows) ? rows[0] : rows) || null;
        out.replaceChildren(r
          ? h('span.ok', `صحيح: ${r.full_name}`
              + (r.member_no ? ` (${r.member_no})` : '')
              + ` — وقَّع باسم «${r.signed_name}» على النسخة ${r.policy_version}`
              + ` في ${fmtDateTime(r.accepted_at)}`)
          : h('span.bad', 'لا سجلَّ بهذا الرمز.'));
      } catch (e) { out.replaceChildren(h('span.bad', e.message)); }
    });
    return h('div.stack', h('div.row.wrap', h('label.field', 'رمزُ الوثيقة', code), go), out);
  }

  const sheet = () => [
    ['العضو', 'الفريق', 'الرقم', 'الحال', 'الاسم الموقَّع به', 'تاريخ التوقيع'],
    ...people.map(m => {
      const sg = signOf[m.id];
      const old = !sg ? prevOf[m.id] : null;
      const rec = sg || old;
      return [m.full_name, GROUP_NAME[groupOf(m)], m.member_no || '',
        sg ? 'وقّع' : old ? `وقّع النسخة ${old.policy_version}` : 'لم يوقّع',
        rec ? rec.signed_name : '', rec ? fmtDateTime(rec.accepted_at) : ''];
    }),
    ['الإجمالي', `${people.length} عضوًا`, '', `وقّع ${signed.length} · لم يوقّع ${waiting.length}`, '', '']
  ];
  const title = `${POLICY_TITLE} — كشف التواقيع`;
  const note = `وقّع ${signed.length} من ${people.length} — النسخة ${POLICY_VERSION} — ${fmtDate(new Date())}`;

  // كشفٌ كاملٌ على كليشة الهيئة: الميثاقُ منسَّقًا ثم جدولُ من يُختار
  //   (ملاحظة ٤٢٩)
  const rosterBtn = h('button.btn.sm.primary', { type: 'button' }, '🖨 طباعةُ الكشف');
  rosterBtn.onclick = () => busy(rosterBtn, () => rosterDialog(people.map(m => {
    const sg = signOf[m.id];
    const old = !sg ? prevOf[m.id] : null;
    const rec = sg || old;
    return { id: m.id, full_name: m.full_name, member_no: m.member_no,
      group: GROUP_NAME[groupOf(m)], signed: !!rec,
      policy_version: rec ? rec.policy_version : '',
      accepted_at: rec ? rec.accepted_at : null };
  })));

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
      rosterBtn,
      h('button.btn.sm', { type: 'button', onclick: () => exportExcel(sheet(), title) }, 'تصدير Excel'),
      wordBtn,
      h('button.btn.sm', { type: 'button',
        onclick: () => { if (!exportPdf(sheet(), title, { note })) toast('اسمح بالنوافذ المنبثقة للتصدير', 'bad'); } },
        'تصدير PDF')),

    waiting.length ? h('div.card.stack',
      h('h3', `لم يوقّعوا بعد (${waiting.length})`),
      h('p.small.muted', 'العضو يُطالَب بالميثاق عند أول دخول، ولا يتابع عمله قبل توقيعه. '
        + `والنسخةُ الجاريةُ ${POLICY_VERSION}: من وقَّع نسخةً سابقةً يُطالَب بها من جديد، `
        + 'ويبقى توقيعُه الأولُ بنصِّه وتاريخه، فيُحتجُّ عليه به فيما كان قبلها.'),
      h('div.table-wrap', h('table.responsive',
        h('thead', h('tr', ['العضو', 'الفريق', 'الرقم', 'الحال', 'التاريخ', 'الإثبات'].map(t => h('th', t)))),
        h('tbody', rowsOf(waiting))))) : null,

    h('div.card.stack',
      h('h3', `وقّعوا (${signed.length})`),
      signed.length
        ? h('div.table-wrap', h('table.responsive',
            h('thead', h('tr', ['العضو', 'الفريق', 'الرقم', 'الحال', 'التاريخ', 'الإثبات'].map(t => h('th', t)))),
            h('tbody', rowsOf(signed))))
        : h('p.muted', 'لم يوقّع أحد بعد.')),

    // التحقُّقُ برمزِ الوثيقة المطبوعة (ملاحظة ٤٢٥)
    isManager() ? h('div.card.stack',
      h('h3', 'التحقُّقُ برمزِ الوثيقة'),
      h('p.small.muted', 'كلُّ وثيقةِ إثباتٍ تحمل رمزًا. اكتبِ الرمزَ هنا ليُعرَض سجلُّه، '
        + 'فتُقابَل الورقةُ التي في يدك بما في المنصة.'),
      verifyBox()) : null,

    h('details.cd-more', { style: { marginTop: '14px' } },
      h('summary', `نصّ ${POLICY_TITLE} — النسخة ${POLICY_VERSION}`),
      h('div.card.stack', policyText(),
        h('p.small.muted', 'عند تعديل النص جوهريًّا تُرفع النسخة، فيُطلب التوقيع من جديد ويبقى سجل التوقيع السابق.'))));
}
