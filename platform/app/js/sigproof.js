// وثيقةُ إثبات التوقيع على الميثاق، وكشفُ الموقِّعين — على كليشة الهيئة
// (ملاحظات ٤٢٥ و٤٢٧ و٤٢٩)
//
//   الوثيقةُ تبدأ بنصِّ الميثاق كاملًا منسَّقًا كما هو في المنصة، ثم
//   تُختَم ببيانات الإثبات ورمزِ التحقُّق وباركودِه. فمن قرأها قرأ ما
//   وقَّع عليه الرجلُ حرفًا بحرف، ثم رأى إثباتَ توقيعه عليه.
//
//   ونصُّ الميثاق يُؤخَذ من النسخة التي وقَّعها هو لا من النسخة الجارية:
//   فمن وقَّع ١.١ لا يُحتجُّ عليه بما استُحدث في ١.٢.
//
//   والكشفُ كذلك: نصُّ الميثاق أولًا، ثم جدولُ من اختير من الأعضاء
//   وتواريخُ توقيعهم — بلا تفاصيل الشبكة والجهاز، فتلك في وثيقة العضو.
import { h, fill, fmtHijri, fmtDate, fmtDateTime, toast, dialog } from './ui.js';
import { db } from './sb.js';
import { qrDataUri } from './qr.js';
import { printOnLetterhead } from './lhprint.js';
import { policyOf, policyBreachClause, POLICY_KEY, POLICY_VERSION } from './policy.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const AR = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn');
const ARD = v => (v ? fmtDateTime(v) : '—');

const AUTHORITY = 'مشروع خادم الحرمين الشريفين لترجمة خطب الحرمين — '
  + 'الهيئة العامة للعناية بشؤون المسجد الحرام والمسجد النبوي';

// رابطُ صفحة التحقُّق العامّة التي يفتحها الباركود (ملاحظة ٤٢٨)
export const signVerifyUrl = code =>
  `${location.origin}/verify-sign?c=${encodeURIComponent(code || '')}`;

// سجلُّ توقيعِ عضوٍ: نسخُه كلُّها، الأحدثُ أولًا
export async function signatureRecords(memberId, { key = POLICY_KEY } = {}) {
  try {
    const rows = await db.rpc('policy_proof',
      { p_member: memberId, p_version: null, p_key: key });
    return Array.isArray(rows) ? rows : (rows ? [rows] : []);
  } catch { return []; }
}

// ـــ نصُّ الميثاق منسَّقًا كما يُعرَض في المنصة
function charterHtml(version) {
  const p = policyOf(version);
  return `<h1>${esc(p.title)}</h1>
<p class="sub">${esc(AUTHORITY)} — النسخة ${esc(version)}</p>
<p>${esc(p.intro)}</p>
${p.sections.map(([t, items], i) => `<h2>${AR(i + 1)}) ${esc(t)}</h2>
<ul>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`).join('')}
<h2>الإقرار</h2>
<p>${esc(p.ack)}</p>`;
}

// ـــ وثيقةُ إثبات توقيع عضوٍ بعينه
export function proofHtml(r) {
  const clause = policyBreachClause(r.policy_version);
  const code = r.proof_code || '';
  const qr = code ? qrDataUri(signVerifyUrl(code), { margin: 1, dark: '#1d2b3a' }) : null;

  const row = (k, v, ltr) => `<tr><th>${esc(k)}</th>`
    + `<td${ltr ? ' class="ltr"' : ''}>${esc(v || '—')}</td></tr>`;

  return `<div class="doc">
${charterHtml(r.policy_version)}
<div class="keep">
<h2>إثباتُ التوقيع</h2>
<table class="rec">
  ${row('اسمُ العضو', r.full_name)}
  ${row('رقمُ العضوية', r.member_no == null ? '' : String(r.member_no))}
  ${row('رقمُ الهوية أو الإقامة', r.national_id, true)}
  ${row('البريدُ الإلكتروني', r.email, true)}
  ${row('الاسمُ الذي وقَّع به', r.signed_name)}
  ${row('نسخةُ الميثاق', r.policy_version)}
  ${row('وقتُ التوقيع', ARD(r.accepted_at))}
  ${row('تاريخُه الهجري', r.accepted_at ? fmtHijri(String(r.accepted_at).slice(0, 10)) : '')}
  ${row('عنوانُ الشبكة', r.sign_ip, true)}
  ${row('الجهازُ والمتصفح', r.sign_agent, true)}
  ${row('بصمةُ النصِّ الموقَّع (SHA-256)', r.doc_hash, true)}
</table>
</div>
<div class="keep">
<div class="clause"><b>بندُ المخالفة في النسخة ${esc(r.policy_version)} — بنصِّه</b>${esc(clause)}</div>
<p class="note">
  وقَّع العضوُ إلكترونيًّا على الميثاق بنسخته ${esc(r.policy_version)} المعروضة أعلاه بنصِّها،
  في الوقت المبيَّن، وقد أقرَّ في توقيعه بأنَّ توقيعَه الإلكترونيَّ يقوم مقام التوقيع الخطي.
  ${r.doc_hash
    ? 'وبصمةُ النصِّ أعلاه محسوبةٌ على النصِّ الذي عُرِض عليه حرفًا بحرف، وهي بصمةُ النصِّ المطبوع في هذه الوثيقة.'
    : 'ولم تُحفظْ بصمةُ النصِّ في هذا التوقيع لأنه سابقٌ لاستحداثها، والمحتجُّ به نصُّ نسخته المطبوعُ أعلاه.'}
</p>
<div class="seal">
  <div class="code"><div>رمزُ التحقُّق من الوثيقة</div><div class="no">${esc(code || '—')}</div>
    ${qr ? '<div style="font-size:8pt;color:#6b6257">امسحِ الباركود ليُتحقَّق منها</div>' : ''}</div>
  ${qr ? `<div class="qr"><img src="${qr}" alt="رمز التحقق">تحقُّقٌ مباشر</div>` : ''}
</div>
</div>
</div>`;
}

// تُفتح في نافذةٍ للطباعة أو الحفظ PDF — ولا يُخزَّن منها ملف
export function printProof(r) {
  const ok = printOnLetterhead(proofHtml(r),
    { title: `وثيقة إثبات التوقيع — ${r.full_name || ''}` });
  if (!ok) toast('امنعْ حجبَ النوافذ لتُفتح الوثيقة.', 'bad');
  return ok;
}

// زرُّ الوثيقة: يقرأ السجلَّ ثم يطبع. ومن لم يوقِّعْ لا وثيقةَ له.
export async function proofFor(memberId, version = null) {
  const rows = await signatureRecords(memberId);
  if (!rows.length) { toast('لا توقيعَ مسجَّلٌ لهذا العضو.', 'warn'); return false; }
  const r = version ? rows.find(x => x.policy_version === version) || rows[0] : rows[0];
  return printProof(r);
}

// ---------------------------------------------------------------------
// كشفُ الموقِّعين: نصُّ الميثاق ثم جدولُ من اختير (ملاحظة ٤٢٩)
// ---------------------------------------------------------------------
export function rosterHtml(rows, { version = POLICY_VERSION, note = '' } = {}) {
  const n = rows.length;
  const signed = rows.filter(r => r.signed).length;
  return `<div class="doc">
${charterHtml(version)}
<h2>كشفُ التوقيع على الميثاق</h2>
<p class="note">${esc(note || `عددُ من في الكشف ${AR(n)}، وقَّع منهم ${AR(signed)}.`)}
  وتاريخُ الكشف ${esc(fmtDate(new Date()))}.</p>
<table class="roster">
  <thead><tr>
    <th style="width:9mm">م</th><th>العضو</th><th style="width:26mm">رقمُ الهوية</th>
    <th style="width:20mm">الحال</th><th style="width:16mm">النسخة</th>
    <th style="width:32mm">تاريخُ التوقيع</th><th style="width:20mm">التحقُّق</th>
  </tr></thead>
  <tbody>
    ${rows.map((r, i) => {
      // باركودُ كلِّ عضوٍ في صفِّه، يُفتَح به إثباتُه وحدَه (ملاحظة ٤٣٢)
      const q = r.signed && r.proof_code
        ? qrDataUri(signVerifyUrl(r.proof_code), { margin: 0, dark: '#1d2b3a' }) : null;
      return `<tr>
      <td>${AR(i + 1)}</td>
      <td>${esc(r.full_name)}</td>
      <td class="ltr">${esc(r.national_id || '—')}</td>
      <td>${r.signed ? 'وقَّع' : 'لم يوقِّعْ'}</td>
      <td>${esc(r.signed ? r.policy_version : '—')}</td>
      <td>${esc(r.signed ? ARD(r.accepted_at) : '—')}</td>
      <td class="qr-cell">${q
        ? `<img src="${q}" alt="${esc(r.proof_code)}"><span>${esc(r.proof_code)}</span>`
        : '—'}</td>
    </tr>`;
    }).join('')}
  </tbody>
</table>
<p class="note">هذا الكشفُ بيانٌ بمن وقَّع على الميثاق المعروض أعلاه وتاريخِ توقيعه.
  ويُمسَح باركودُ كلِّ صفٍّ فيُفتَح إثباتُ صاحبه وحدَه. وتفصيلُ التوقيع —
  عنوانُ الشبكة والجهازُ وبصمةُ النصِّ — في وثيقة إثباته الخاصّة.</p>
</div>`;
}

export function printRoster(rows, opts = {}) {
  if (!rows.length) { toast('اختَرْ عضوًا واحدًا على الأقل.', 'warn'); return false; }
  const ok = printOnLetterhead(rosterHtml(rows, opts), { title: 'كشف التوقيع على الميثاق' });
  if (!ok) toast('امنعْ حجبَ النوافذ ليُفتح الكشف.', 'bad');
  return ok;
}

// كشفُ الموقِّعين من القاعدة: فيه الهويةُ ورمزُ الوثيقة (ملاحظتا ٤٣٢ و٤٣٣)
export async function rosterRows({ key = POLICY_KEY } = {}) {
  let rows = [];
  try { rows = await db.rpc('policy_roster', { p_key: key }) || []; } catch { rows = []; }
  return rows.map(r => ({
    id: r.member_id, full_name: r.full_name, member_no: r.member_no,
    national_id: r.national_id, signed: !!r.accepted_at,
    policy_version: r.policy_version || '', accepted_at: r.accepted_at,
    proof_code: r.proof_code || ''
  }));
}

// نافذةُ اختيار من يُرفَق في الكشف (ملاحظة ٤٢٩)
export async function rosterDialog(people) {
  const chosen = new Set(people.map(p => p.id));
  const q = h('input', { type: 'search', placeholder: 'ابحثْ بالاسم',
    'aria-label': 'البحث عن عضو' });
  const box = h('div.pick-list.tall');
  const tally = h('span.small.muted');
  const count = () => { tally.textContent = `اختير ${AR(chosen.size)} من ${AR(people.length)}`; };

  const paint = () => {
    const k = q.value.trim();
    fill(box, people
      .filter(m => !k || (m.full_name || '').includes(k))
      .map(m => {
        const on = h('input', { type: 'checkbox', checked: chosen.has(m.id),
          'aria-label': m.full_name });
        on.onchange = () => { on.checked ? chosen.add(m.id) : chosen.delete(m.id); count(); };
        return h('label.check.pick-row', on,
          h('span', m.full_name,
            h('span.small.muted', ` · ${m.signed ? 'وقَّع' : 'لم يوقِّعْ'}`)));
      }));
  };
  q.oninput = paint; paint(); count();

  const all = h('button.btn.xs', { type: 'button' }, 'الكلّ');
  all.onclick = () => { people.forEach(m => chosen.add(m.id)); paint(); count(); };
  const none = h('button.btn.xs.ghost', { type: 'button' }, 'لا أحد');
  none.onclick = () => { chosen.clear(); paint(); count(); };
  const onlySigned = h('button.btn.xs', { type: 'button' }, 'الموقِّعون وحدَهم');
  onlySigned.onclick = () => {
    chosen.clear();
    people.filter(m => m.signed).forEach(m => chosen.add(m.id));
    paint(); count();
  };

  const res = await dialog({
    title: 'طباعةُ كشف التوقيع',
    body: h('div.stack',
      h('p.small.muted', 'يبدأ الكشفُ بنصِّ الميثاق منسَّقًا، ثم جدولُ من تختاره '
        + 'من الأعضاء وتاريخِ توقيعهم. ولا تدخله تفاصيلُ الشبكة والجهاز.'),
      h('div.row.wrap', all, onlySigned, none),
      h('label.field', 'الأسماء', q),
      box, tally),
    buttons: [{ label: '🖨 اطبعِ الكشف', kind: 'primary',
      validate: () => (chosen.size ? true : 'اختَرْ عضوًا واحدًا على الأقل'),
      value: () => people.filter(m => chosen.has(m.id)) },
      { label: 'إلغاء', value: null }]
  });
  if (!res) return false;
  return printRoster(res);
}
