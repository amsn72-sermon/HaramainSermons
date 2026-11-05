// ميثاق العمل: نصّه، ومن وقّع عليه ومتى، ومن لم يوقّع — لمدير المشروع والمنسق
// (ملاحظة ١٢٥؛ وهو ما كان يُسمّى «سياسة السرية»، والتوقيعات السابقة باقية بتواريخها)
//
//   وللمشروع ميثاقان (ملاحظة ٤٨١): «ميثاق العمل» وقَّعه المترجمون
//   المتخصصون والحساباتُ الإدارية، و«ميثاقُ العمل الميداني» لأهل
//   الساحات والأبواب — الإرشادِ المكانيِّ وإجابةِ السائلين. فهذه
//   الشاشةُ تعرضهما معًا، كلَّ ميثاقٍ بأهله وتواقيعهم، ولا يُخلَط أحدُهما
//   بالآخر. ومن وقَّع ميثاقَ المترجمين لا يُطالَب بغيره.
import { h, fill, toast, busy, fmtDate, fmtDateTime } from '../ui.js';
import { db } from '../sb.js';
import { isAdmin, isManager, roleLabel } from '../store.js';
import { POLICY_KEY, POLICY_VERSION, FIELD_KEY, FIELD_VERSION,
         charterDoc, isFieldMember } from '../policy.js';
import { policyText } from './policy.js';
import { proofFor, rosterDialog, rosterRows } from '../sigproof.js';
import { exportExcel, exportPdf, exportWord } from '../teamexport.js';

const GROUP_NAME = { admins: 'الحسابات الإدارية', translators: 'المترجمون المتخصصون',
  field: 'المرشدون المكانيون', answers: 'المخصَّصون لإجابة السائلين' };
const groupOf = m => (['manager', 'coordinator'].includes(m.role) ? 'admins'
  : m.track === 'answers' ? 'answers' : (m.track === 'field' ? 'field' : 'translators'));

const CITY_AR = { makkah: 'مكة المكرمة', madinah: 'المدينة المنورة' };

// الميثاقان: مفتاحُ كلٍّ ونسختُه الجاريةُ وأهلُه
const CHARTERS = [
  { key: POLICY_KEY, version: POLICY_VERSION,
    who: 'المترجمون المتخصصون والحسابات الإدارية' },
  { key: FIELD_KEY, version: FIELD_VERSION,
    who: 'المرشدون المكانيون وفريقُ إجابة السائلين' }
];

export async function render(ctx) {
  if (!isAdmin()) { ctx.navigate('/app', { replace: true }); return h('div'); }

  const [members, signs] = await Promise.all([
    db.select('profiles', {
      select: 'id,full_name,email,member_no,role,track,city,status', order: 'full_name.asc' }),
    db.select('policy_acceptances', {
      select: 'member_id,policy_key,policy_version,signed_name,accepted_at',
      policy_key: `in.(${POLICY_KEY},${FIELD_KEY})` }).catch(() => [])
  ]);

  const wrap = h('div.stack');
  const tabs = h('div.row.wrap', { style: { margin: '2px 0 10px' } });

  // ـــ لوحةُ ميثاقٍ واحد: أهلُه وتواقيعُهم ونصُّه
  const panel = ch => {
    const doc = charterDoc(ch.key, ch.version);
    const mine = signs.filter(r => (r.policy_key || POLICY_KEY) === ch.key);

    const signOf = {};
    for (const r of mine) if (r.policy_version === ch.version) signOf[r.member_id] = r;
    // ومن وقَّع على نسخةٍ سابقةٍ يُعرَف، فيُطالَب بالجارية ولا يُحسَب غيرَ موقِّعٍ
    //   أصلًا، ووثيقةُ إثباته تُطبَع بنصِّ نسخته هو (ملاحظتا ٤٢٦ و٤٢٧)
    const prevOf = {};
    for (const r of [...mine].sort((a, b) =>
        String(a.accepted_at).localeCompare(String(b.accepted_at)))) {
      if (r.policy_version !== ch.version) prevOf[r.member_id] = r;
    }

    // أهلُ هذا الميثاق، ومعهم من وقَّعه ثم نُقل إلى فريقٍ آخر: توقيعُه
    //   قائمٌ ووثيقةُ إثباته تُطبَع من هنا، فلا يُحجَب بنقله (ملاحظة ٤٨١)
    const mineOf = {};
    for (const r of mine) mineOf[r.member_id] = true;
    const belongs = m => isFieldMember(m) === (ch.key === FIELD_KEY);
    const people = members.filter(m => m.status === 'active'
      && (belongs(m) || mineOf[m.id]));
    const signed = people.filter(m => signOf[m.id]);
    const waiting = people.filter(m => !signOf[m.id] && belongs(m));

    // زرُّ وثيقة الإثبات: يُطبَع بنصِّ النسخة التي وقَّعها هو (ملاحظة ٤٢٧)
    const proofBtn = (m, sg) => {
      const b = h('button.btn.xs', { type: 'button',
        title: `وثيقةُ إثبات توقيع ${m.full_name} على النسخة ${sg.policy_version}` },
        '🖨 وثيقةُ إثبات');
      b.onclick = () => busy(b, () => proofFor(m.id, sg.policy_version, ch.key));
      return b;
    };

    const rowsOf = list => list.map(m => {
      const sg = signOf[m.id];
      const old = !sg ? prevOf[m.id] : null;
      const rec = sg || old;
      return h('tr',
        h('td', { 'data-label': 'العضو' }, h('b', m.full_name),
          h('div.small.muted', { dir: 'ltr' }, m.email || '')),
        h('td', { 'data-label': 'الفريق' }, GROUP_NAME[groupOf(m)],
          h('div.small.muted', [roleLabel(m), CITY_AR[m.city]].filter(Boolean).join(' · ')),
          belongs(m) ? null
            : h('div.small.warn', 'وقَّع هذا الميثاقَ ثم نُقل إلى فريقٍ آخر، '
                + 'وميثاقُه اليومَ غيرُه')),
        h('td', { 'data-label': 'الرقم' }, m.member_no || '—'),
        h('td', { 'data-label': 'الحال' }, sg
          ? h('span', h('span.badge.ok', 'وقّع'), h('div.small.muted', `باسم «${sg.signed_name}»`))
          : old
            ? h('span', h('span.badge.warn', `وقّع ${old.policy_version}`),
                h('div.small.muted', `ينتظر توقيع ${ch.version}`))
            : h('span.badge.bad', 'لم يوقّع')),
        h('td', { 'data-label': 'التاريخ' }, rec ? fmtDateTime(rec.accepted_at) : '—'),
        h('td', { 'data-label': 'الإثبات' }, rec && isManager() ? proofBtn(m, rec) : '—'));
    });

    const sheet = () => [
      ['العضو', 'الفريق', 'المدينة', 'الرقم', 'الحال', 'الاسم الموقَّع به', 'تاريخ التوقيع'],
      ...people.map(m => {
        const sg = signOf[m.id];
        const old = !sg ? prevOf[m.id] : null;
        const rec = sg || old;
        return [m.full_name, GROUP_NAME[groupOf(m)], CITY_AR[m.city] || '', m.member_no || '',
          sg ? 'وقّع' : old ? `وقّع النسخة ${old.policy_version}` : 'لم يوقّع',
          rec ? rec.signed_name : '', rec ? fmtDateTime(rec.accepted_at) : ''];
      }),
      ['الإجمالي', `${people.length} عضوًا`, '', '',
        `وقّع ${signed.length} · لم يوقّع ${waiting.length}`, '', '']
    ];
    const title = `${doc.title} — كشف التواقيع`;
    const note = `وقّع ${signed.length} من ${people.length} — النسخة ${ch.version}`
      + ` — ${fmtDate(new Date())}`;

    // كشفٌ كاملٌ على كليشة الهيئة: الميثاقُ منسَّقًا ثم جدولُ من يُختار،
    //   ويُرشَّح بالفريق والمدينة ويُبوَّب بهما (ملاحظتا ٤٢٩ و٤٨٠)
    const rosterBtn = h('button.btn.sm.primary', { type: 'button' }, '🖨 طباعةُ الكشف');
    rosterBtn.onclick = () => busy(rosterBtn, async () => {
      // الكشفُ من القاعدة: فيه الهويةُ ورمزُ الوثيقة (ملاحظتا ٤٣٢ و٤٣٣)
      const rows = await rosterRows({ key: ch.key });
      if (!rows.length) { toast('لا أعضاءَ في الكشف.', 'warn'); return; }
      await rosterDialog(rows, { key: ch.key, version: ch.version });
    });

    const wordBtn = h('button.btn.sm', { type: 'button' }, 'تصدير Word');
    wordBtn.onclick = () => busy(wordBtn,
      () => exportWord(sheet(), title, { note }).catch(e => toast(e.message, 'bad')));

    const table = list => h('div.table-wrap', h('table.responsive',
      h('thead', h('tr', ['العضو', 'الفريق', 'الرقم', 'الحال', 'التاريخ', 'الإثبات']
        .map(t => h('th', t)))),
      h('tbody', rowsOf(list))));

    return h('div.stack',
      h('p.muted', `أهلُ هذا الميثاق: ${ch.who}.`),

      h('div.pay-sum',
        h('div.pay-cell', h('span', 'أهلُ الميثاق'),
          h('b', String(people.filter(belongs).length))),
        h('div.pay-cell', h('span', 'وقّعوا'), h('b', String(signed.length))),
        h('div.pay-cell', { class: waiting.length ? 'warn' : '' },
          h('span', 'لم يوقّعوا'), h('b', String(waiting.length)))),

      h('div.row.wrap', { style: { margin: '12px 0' } },
        rosterBtn,
        h('button.btn.sm', { type: 'button', onclick: () => exportExcel(sheet(), title) },
          'تصدير Excel'),
        wordBtn,
        h('button.btn.sm', { type: 'button',
          onclick: () => { if (!exportPdf(sheet(), title, { note })) toast('اسمح بالنوافذ المنبثقة للتصدير', 'bad'); } },
          'تصدير PDF')),

      people.length ? null : h('p.muted', 'لا أعضاءَ في هذا الميثاق بعد.'),

      waiting.length ? h('div.card.stack',
        h('h3', `لم يوقّعوا بعد (${waiting.length})`),
        h('p.small.muted', 'العضو يُطالَب بالميثاق عند أول دخول، ولا يتابع عمله قبل توقيعه. '
          + `والنسخةُ الجاريةُ ${ch.version}: من وقَّع نسخةً سابقةً يُطالَب بها من جديد، `
          + 'ويبقى توقيعُه الأولُ بنصِّه وتاريخه، فيُحتجُّ عليه به فيما كان قبلها.'),
        table(waiting)) : null,

      h('div.card.stack',
        h('h3', `وقّعوا (${signed.length})`),
        signed.length ? table(signed) : h('p.muted', 'لم يوقّع أحد بعد.')),

      h('details.cd-more', { style: { marginTop: '14px' } },
        h('summary', `نصّ ${doc.title} — النسخة ${ch.version}`),
        h('div.card.stack', policyText(ch.version, ch.key),
          h('p.small.muted', 'عند تعديل النص جوهريًّا تُرفع النسخة، فيُطلب التوقيع من جديد '
            + 'ويبقى سجل التوقيع السابق.'))));
  };

  // ـــ صندوقُ التحقُّق: رمزٌ يُكتَب فيُقابَل بسجلّه — لا يختصُّ بميثاق
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

  let cur = CHARTERS[0];
  const head = h('h1');
  const paint = () => {
    fill(tabs, CHARTERS.map(c => {
      const b = h('button.btn.sm', { type: 'button',
        class: c.key === cur.key ? 'primary' : '' }, charterDoc(c.key, c.version).title);
      b.onclick = () => { cur = c; paint(); };
      return b;
    }));
    head.textContent = charterDoc(cur.key, cur.version).title;
    fill(wrap, panel(cur));
  };
  paint();

  return h('div',
    h('div.page-head', h('div.grow',
      h('div.eyebrow', 'الفريق'), head,
      h('p.muted', 'ميثاق يوقّعه كل عضو قبل مباشرة العمل. وللمشروع ميثاقان: '
        + 'ميثاقُ العمل لمن يعمل على المواد، وميثاقُ العمل الميداني لمن يعمل '
        + 'في الساحات وعند الأبواب. وهنا نصُّ كلٍّ ومن وقَّعه.'))),
    tabs,
    wrap,

    // التحقُّقُ برمزِ الوثيقة المطبوعة (ملاحظة ٤٢٥)
    isManager() ? h('div.card.stack',
      h('h3', 'التحقُّقُ برمزِ الوثيقة'),
      h('p.small.muted', 'كلُّ وثيقةِ إثباتٍ تحمل رمزًا. اكتبِ الرمزَ هنا ليُعرَض سجلُّه، '
        + 'فتُقابَل الورقةُ التي في يدك بما في المنصة.'),
      verifyBox()) : null);
}
