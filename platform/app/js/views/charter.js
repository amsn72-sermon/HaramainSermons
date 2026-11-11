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
         charterDoc, isFieldMember, isAdminAccount } from '../policy.js';
import { policyText } from './policy.js';
import { proofFor, rosterDialog, rosterRows } from '../sigproof.js';
import { exportExcel, exportPdf, exportWord } from '../teamexport.js';

const GROUP_NAME = { admins: 'الحسابات الإدارية', translators: 'المترجمون المتخصصون',
  field: 'المرشدون المكانيون', answers: 'المخصَّصون لإجابة السائلين' };
const groupOf = m => (isAdminAccount(m) ? 'admins'
  : m.track === 'answers' ? 'answers' : (m.track === 'field' ? 'field' : 'translators'));

const CITY_AR = { makkah: 'مكة المكرمة', madinah: 'المدينة المنورة' };

// ثلاثةُ أبواب: ميثاقان لا غير، غير أنَّ ميثاق العمل يُعرَض على بابين
//   — الإداريون وحدَهم والمترجمون وحدَهم — فلا يختلط فريقٌ بفريقٍ في
//   الجداول ولا في الأعداد ولا في الكشف المطبوع (ملاحظة ٤٨٢).
//   والنصُّ واحدٌ في البابين لأنَّ الميثاق واحد.
const CHARTERS = [
  { id: 'admins', tab: 'الإداريون', key: POLICY_KEY, version: POLICY_VERSION,
    who: 'مديرُ المشروع والمنسقون ومديرُ المشروع من الهيئة والمتابعون',
    pick: m => isAdminAccount(m) },
  { id: 'translators', tab: 'المترجمون المتخصصون', key: POLICY_KEY, version: POLICY_VERSION,
    who: 'المترجمون المتخصصون',
    pick: m => !isAdminAccount(m) },
  { id: 'field', tab: 'المكانيون وإجابة السائلين', key: FIELD_KEY, version: FIELD_VERSION,
    who: 'المرشدون المكانيون وفريقُ إجابة السائلين',
    pick: () => true }
];

export async function render(ctx) {
  if (!isAdmin()) { ctx.navigate('/app', { replace: true }); return h('div'); }

  const [members, signs] = await Promise.all([
    db.select('profiles', {
      select: 'id,full_name,email,member_no,role,track,city,status,job_title,admin_title',
      order: 'full_name.asc' }),
    db.select('policy_acceptances', {
      select: 'member_id,policy_key,policy_version,signed_name,accepted_at',
      policy_key: `in.(${POLICY_KEY},${FIELD_KEY})` }).catch(() => [])
  ]);

  const wrap = h('div.stack');
  const tabs = h('div.row.wrap', { style: { margin: '2px 0 10px' } });

  // ـــ مرشِّحُ المدينة داخلَ كلِّ باب (ملاحظة ٤٨٣): مكةُ وحدَها أو
  //   المدينةُ وحدَها أو كلتاهما. ويسري على الجداول والأعداد والتصدير
  //   والكشف المطبوع جميعًا، فما تراه هو ما يُطبَع.
  const NO_CITY = '\u0000none';
  let cityPick = '';
  const inCity = m => (!cityPick
    || (cityPick === NO_CITY ? !m.city : (m.city || '') === cityPick));

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

    // أهلُ هذا الميثاق وحدَهم: هم جداولُه وأعدادُه وكشفُ طباعته، فلا
    //   يُخلَط فريقٌ بفريق (ملاحظة ٤٨١)
    const mineOf = {};
    for (const r of mine) mineOf[r.member_id] = true;
    const belongs = m => isFieldMember(m) === (ch.key === FIELD_KEY);
    // ومدنُ هذا الباب من أهله قبل الترشيح، فلا تختفي المدينةُ باختيارها.
    //   وإن كان الاختيارُ على مدينةٍ لا وجودَ لها في هذا الباب رُدَّ إلى
    //   «المدينتان معًا»، وإلّا بدا البابُ خاليًا والسببُ خافٍ.
    const pool = members.filter(m => m.status === 'active' && ch.pick(m) && belongs(m));
    const cityOpts = [...new Set(pool.map(m => m.city || ''))];
    const hasCity = cityOpts.filter(Boolean).length > 0;
    if (cityPick && !cityOpts.includes(cityPick === NO_CITY ? '' : cityPick)) cityPick = '';

    const people = members.filter(m => m.status === 'active' && belongs(m) && ch.pick(m)
      && inCity(m));
    // ومن وقَّع هذا الميثاقَ ثم نُقل إلى فريقٍ آخر: لا يُحسَب هنا ولا
    //   يُطالَب به، ويبقى توقيعُه قائمًا ووثيقتُه تُطبَع من بابه أدناه
    const moved = members.filter(m => m.status === 'active'
      && !belongs(m) && mineOf[m.id] && ch.pick(m) && inCity(m));
    const signed = people.filter(m => signOf[m.id]);
    const waiting = people.filter(m => !signOf[m.id]);

    // ـــ كشفٌ واحدٌ متَّصل: من وقَّع النسخةَ الجاريةَ أوّلًا بالاسم، ثمَّ
    //   من وقَّع نسخةً سابقةً، ثمَّ من لم يوقِّع — في الشاشة والطباعة
    //   سواءً، فلا يبحث القارئُ عن الاسم في كشفين (ملاحظة ٤٩٧)
    const rank = m => (signOf[m.id] ? 0 : prevOf[m.id] ? 1 : 2);
    const byName = (a, b) => rank(a) - rank(b)
      || String(a.full_name || '').localeCompare(String(b.full_name || ''), 'ar');
    const roster = [...people].sort(byName);

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
          h('div.small.muted', [roleLabel(m), CITY_AR[m.city]].filter(Boolean).join(' · '))),
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
      ...roster.map(m => {
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
    const cityNote = cityPick === '' ? ''
      : cityPick === NO_CITY ? ' — بلا مدينةٍ مسجَّلة' : ` — ${CITY_AR[cityPick]}`;
    const title = `${doc.title} — ${ch.tab}${cityNote} — كشف التواقيع`;
    const note = `وقّع ${signed.length} من ${people.length} — النسخة ${ch.version}`
      + `${cityNote} — ${fmtDate(new Date())}`;

    // كشفٌ كاملٌ على كليشة الهيئة: الميثاقُ منسَّقًا ثم جدولُ من يُختار،
    //   ويُرشَّح بالفريق والمدينة ويُبوَّب بهما (ملاحظتا ٤٢٩ و٤٨٠)
    const rosterBtn = h('button.btn.sm.primary', { type: 'button' }, '🖨 طباعةُ الكشف');
    rosterBtn.onclick = () => busy(rosterBtn, async () => {
      // الكشفُ من القاعدة: فيه الهويةُ ورمزُ الوثيقة (ملاحظتا ٤٣٢ و٤٣٣)
      const rows = await rosterRows({ key: ch.key, version: ch.version,
        pick: r => ch.pick(r) && inCity(r) });
      if (!rows.length) { toast('لا أعضاءَ في الكشف.', 'warn'); return; }
      await rosterDialog(rows, { key: ch.key, version: ch.version, band: ch.tab });
    });

    const wordBtn = h('button.btn.sm', { type: 'button' }, 'تصدير Word');
    wordBtn.onclick = () => busy(wordBtn,
      () => exportWord(sheet(), title, { note }).catch(e => toast(e.message, 'bad')));

    const table = list => h('div.table-wrap', h('table.responsive',
      h('thead', h('tr', ['العضو', 'الفريق', 'الرقم', 'الحال', 'التاريخ', 'الإثبات']
        .map(t => h('th', t)))),
      h('tbody', rowsOf(list))));

    const cityBox = !hasCity ? null : (() => {
      const sel = h('select',
        h('option', { value: '', selected: cityPick === '' }, 'المدينتان معًا'),
        ['makkah', 'madinah'].filter(c => cityOpts.includes(c)).map(c =>
          h('option', { value: c, selected: cityPick === c }, CITY_AR[c])),
        cityOpts.includes('')
          ? h('option', { value: NO_CITY, selected: cityPick === NO_CITY },
              'بلا مدينةٍ مسجَّلة')
          : null);
      sel.onchange = () => { cityPick = sel.value; paint(); };
      return h('div.row.wrap', h('label.field.tight', 'المدينة', sel));
    })();

    return h('div.stack',
      h('p.muted', `${doc.title} — النسخة ${ch.version}. وهذا الباب لـ: ${ch.who}.`),
      cityBox,

      h('div.pay-sum',
        h('div.pay-cell', h('span', 'أهلُ هذا الباب'), h('b', String(people.length))),
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

      roster.length ? h('div.card.stack',
        h('h3', `كشفُ الميثاق (${roster.length})`),
        h('p.small.muted', 'الموقِّعون بأسمائهم أوّلًا، ثمَّ من وقَّع نسخةً سابقة، '
          + 'ثمَّ من لم يوقِّع بعد — والترتيبُ نفسُه في الكشف المطبوع. '
          + 'والعضو يُطالَب بالميثاق عند أول دخول، ولا يتابع عمله قبل توقيعه. '
          + `والنسخةُ الجاريةُ ${ch.version}: من وقَّع نسخةً سابقةً يُطالَب بها من جديد، `
          + 'ويبقى توقيعُه الأولُ بنصِّه وتاريخه، فيُحتجُّ عليه به فيما كان قبلها.'),
        table(roster)) : null,

      moved.length ? h('details.cd-more',
        h('summary', `وقَّعوا هذا الميثاق ثم نُقلوا إلى فريقٍ آخر (${moved.length})`),
        h('div.card.stack',
          h('p.small.muted', 'هؤلاء ليسوا من أهل هذا الميثاق اليوم، فلا يُحسَبون في '
            + 'أعداده ولا يدخلون كشفَ طباعته، ولا يُطالَبون به. وإنما يبقى توقيعُهم '
            + 'السابقُ قائمًا بنصِّه وتاريخه، فيُحتجُّ به عليهم فيما كان قبل نقلهم، '
            + 'ووثيقةُ إثباته تُطبَع من هنا.'),
          table(moved))) : null,

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
        class: c.id === cur.id ? 'primary' : '' }, c.tab);
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
