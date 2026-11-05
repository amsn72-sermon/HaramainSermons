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
//
//   ويُبوَّب الكشفُ بالفريق ثم المدينة، وفي رأسه بيانٌ بما طُبع
//   (ملاحظة ٤٨٠): فالاستفسارُ يأتي عن موقِّعي فريقٍ في مدينةٍ بعينها،
//   فيُطبَع لهم كشفُهم مبوَّبًا معدودًا لا يُخلَط بغيرهم. وميثاقُ كلِّ
//   فريقٍ نصُّه هو (ملاحظة ٤٨١).
import { h, fill, fmtHijri, fmtDate, fmtDateTime, toast, dialog } from './ui.js';
import { db } from './sb.js';
import { qrDataUri } from './qr.js';
import { printOnLetterhead } from './lhprint.js';
import { policyBreachClause, charterDoc, isFieldMember,
         FIELD_KEY, POLICY_KEY, POLICY_VERSION } from './policy.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const AR = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn');

// الفرقُ بترتيبها، والمدن (ملاحظة ٤٨٠)
export const TRACK_ORDER = ['translation', 'field', 'answers'];
const TRACK_AR = {
  translation: 'المترجمون المتخصصون',
  field: 'المرشدون المكانيون',
  answers: 'فريقُ إجابة السائلين'
};
const CITY_AR = { makkah: 'مكة المكرمة', madinah: 'المدينة المنورة' };
export const CITY_ORDER = ['makkah', 'madinah'];
// ورتبةُ المدينة بترتيبها المعروف لا بحروف رمزها اللاتينية، وبلا مدينةٍ آخرًا
const cityRank = c => { const i = CITY_ORDER.indexOf(c || ''); return i < 0 ? 9 : i; };
export const trackName = t => TRACK_AR[t] || 'فريقٌ غيرُ محدَّد';
export const cityName = c => CITY_AR[c] || 'مدينةٌ غيرُ محدَّدة';
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
function charterHtml(version, key = POLICY_KEY) {
  const p = charterDoc(key, version);
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
  const key = r.policy_key || POLICY_KEY;
  const clause = policyBreachClause(r.policy_version, key);
  const code = r.proof_code || '';
  const qr = code ? qrDataUri(signVerifyUrl(code), { margin: 1, dark: '#1d2b3a' }) : null;

  const row = (k, v, ltr) => `<tr><th>${esc(k)}</th>`
    + `<td${ltr ? ' class="ltr"' : ''}>${esc(v || '—')}</td></tr>`;

  return `<div class="doc">
${charterHtml(r.policy_version, key)}
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
export async function proofFor(memberId, version = null, key = POLICY_KEY) {
  const rows = await signatureRecords(memberId, { key });
  if (!rows.length) { toast('لا توقيعَ مسجَّلٌ لهذا العضو.', 'warn'); return false; }
  const r = version ? rows.find(x => x.policy_version === version) || rows[0] : rows[0];
  return printProof(r);
}

// ---------------------------------------------------------------------
// كشفُ الموقِّعين: نصُّ الميثاق ثم جدولُ من اختير (ملاحظة ٤٢٩)
// ---------------------------------------------------------------------
// الكشفُ يُقطَّع جداولَ صغيرةً كلٌّ برأسه، وكلُّ جدولٍ كتلةٌ لا تُقطَع:
//   فلا ينقسم صفُّ عضوٍ على صفحتين، ويتكرّر الرأسُ في كلِّ صفحة
//   (ملاحظة ٤٦٢)
const chunk = (rows, n) => {
  const out = [];
  rows.forEach((r, i) => {
    if (i % n === 0) out.push([]);
    out[out.length - 1].push({ r, i });
  });
  return out;
};

export function rosterHtml(rows, { version = POLICY_VERSION, key = POLICY_KEY,
                                   note = '', head = '', band = '' } = {}) {
  const n = rows.length;
  const signed = rows.filter(r => r.signed).length;

  // التبويبُ بالفريق ثم المدينة: ولا تُطبَع عناوينُ الأبواب إذا كان
  //   الكشفُ بابًا واحدًا، فالعنوانُ حينئذٍ تكرارٌ لرأس الكشف
  //   وإذا جاء الكشفُ من بابٍ مسمًّى في الشاشة — كبابِ الإداريين — فاسمُ
  //   الباب هو عنوانُ أبوابه، لا مسارُ العضو: فمنسِّقٌ مسارُه الميدان
  //   ليس مرشدًا مكانيًّا، وتسميتُه بذلك خلطٌ (ملاحظة ٤٨٢)
  const bins = new Map();
  rows.forEach(r => {
    const k = band ? (r.city || '') : `${r.track || ''}|${r.city || ''}`;
    if (!bins.has(k)) bins.set(k, { track: r.track || '', city: r.city || '', rows: [] });
    bins.get(k).rows.push(r);
  });
  const groups = [...bins.values()].sort((a, b) => {
    const ta = TRACK_ORDER.indexOf(a.track), tb = TRACK_ORDER.indexOf(b.track);
    if (ta !== tb) return (ta < 0 ? 9 : ta) - (tb < 0 ? 9 : tb);
    return cityRank(a.city) - cityRank(b.city);
  });
  const many = groups.length > 1;

  const table = part => `<table class="roster keep">
  <thead><tr>
    <th style="width:9mm">م</th><th>العضو</th><th style="width:26mm">رقمُ الهوية</th>
    <th style="width:20mm">الحال</th><th style="width:16mm">النسخة</th>
    <th style="width:32mm">تاريخُ التوقيع</th><th style="width:20mm">التحقُّق</th>
  </tr></thead>
  <tbody>
    ${part.map(({ r, i }) => {
      // باركودُ كلِّ عضوٍ في صفِّه، يُفتَح به إثباتُه وحدَه (ملاحظة ٤٣٢)
      const q = (r.signed || r.prev) && r.proof_code
        ? qrDataUri(signVerifyUrl(r.proof_code), { margin: 0, dark: '#1d2b3a' }) : null;
      return `<tr>
      <td>${AR(i + 1)}</td>
      <td>${esc(r.full_name)}</td>
      <td class="ltr">${esc(r.national_id || '—')}</td>
      <td>${r.signed ? 'وقَّع' : r.prev ? 'وقَّع نسخةً سابقة' : 'لم يوقِّعْ'}</td>
      <td>${esc(r.signed || r.prev ? r.policy_version : '—')}</td>
      <td>${esc(r.signed || r.prev ? ARD(r.accepted_at) : '—')}</td>
      <td class="qr-cell">${q
        ? `<img src="${q}" alt="${esc(r.proof_code)}"><span>${esc(r.proof_code)}</span>`
        : '—'}</td>
    </tr>`;
    }).join('')}
  </tbody>
</table>`;

  return `<div class="doc">
${charterHtml(version, key)}
<h2>كشفُ التوقيع على الميثاق</h2>
${head ? `<p class="note">${esc(head)}</p>` : ''}
<p class="note">${esc(note || `عددُ من في الكشف ${AR(n)}، وقَّع منهم ${AR(signed)}.`)}
  وتاريخُ الكشف ${esc(fmtDate(new Date()))}.</p>
${groups.map(g => {
  const sg = g.rows.filter(r => r.signed).length;
  const title = many
    ? `<h3>${esc(band || trackName(g.track))} — ${esc(cityName(g.city))}`
      + ` <span class="cnt">(${AR(g.rows.length)}، وقَّع منهم ${AR(sg)})</span></h3>`
    : '';
  const parts = chunk(g.rows, 9).map(table);
  // عنوانُ الباب يلزم جدولَه الأوَّل فلا يبقى وحدَه في ذيل صفحة
  const first = `<div class="keep">${title}${parts[0] || ''}</div>`;
  return first + parts.slice(1).join('');
}).join('')}
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
export async function rosterRows({ key = POLICY_KEY, pick = null,
                                   version = null } = {}) {
  let rows = [];
  try {
    const r = await db.rpc('policy_roster', { p_key: key });
    rows = Array.isArray(r) ? r : (r ? [r] : []);
  } catch { rows = []; }
  // ولا يُحشَر في كشفِ ميثاقٍ من ليس من أهله: أهلُ الميدان في ميثاقهم،
  //   وسائرُ الفريق — والحساباتُ الإدارية — في ميثاق المترجمين
  //   (ملاحظة ٤٨١). والفصلُ تامٌّ: من وقَّع ميثاقًا ثم نُقل إلى فريقٍ
  //   آخر لا يدخل كشفَ ميثاقه الأول ولا يُحسَب في عدده، وإنما توقيعُه
  //   السابقُ في بابه المستقلِّ في الشاشة ووثيقتُه تُطبَع منه.
  rows = rows.filter(r => (key === FIELD_KEY) === isFieldMember(r));
  // ثم بقدر ما تعرضه الشاشة: الإداريون وحدَهم أو المترجمون وحدَهم
  if (pick) rows = rows.filter(pick);
  // والموقِّعُ من وقَّع النسخةَ الجاريةَ، كما في الشاشة سواءً. ومن وقَّع
  //   نسخةً سابقةً يُبيَّن أمرُه في صفِّه ولا يُعَدُّ في الموقِّعين، فالعددُ
  //   في الورقة هو العددُ على الشاشة (ملاحظة ٤٢٦)
  return rows.map(r => {
    const has = !!r.accepted_at;
    const cur = has && (!version || r.policy_version === version);
    return {
      id: r.member_id, full_name: r.full_name, member_no: r.member_no,
      national_id: r.national_id, signed: cur, prev: has && !cur,
      role: r.role || '', track: r.track || '', city: r.city || '',
      policy_version: r.policy_version || '', accepted_at: r.accepted_at,
      proof_code: r.proof_code || ''
    };
  });
}

// نافذةُ اختيار من يُرفَق في الكشف (ملاحظتا ٤٢٩ و٤٨٠)
//
//   ويُرشَّح المعروضُ بالفريق والمدينة، والأزرارُ الثلاثةُ تعمل في
//   المرشَّح وحدَه لا في الكشف كلِّه: فمن أراد عددًا من المترجمين وعددًا
//   من المكانيين رشَّح الأولَ واختار، ثم رشَّح الثانيَ واختار، والشاشةُ
//   باقيةٌ واختيارُه محفوظ.
export async function rosterDialog(people, { key = POLICY_KEY,
                                             version = POLICY_VERSION,
                                             band = '' } = {}) {
  const chosen = new Set(people.map(p => p.id));
  const q = h('input', { type: 'search', placeholder: 'ابحثْ بالاسم',
    'aria-label': 'البحث عن عضو' });

  // الفرقُ والمدنُ الموجودةُ فعلًا في هذا الكشف لا كلُّ ما يمكن.
  //   و«بلا مدينة» خيارٌ له قيمتُه الخاصّة، فلا يلتبس بـ«المدنُ كلُّها»
  //   فيبدو مرشِّحًا لا يُرشِّح
  const NO_CITY = '\u0000none';
  const tracks = [...new Set(people.map(m => m.track || ''))]
    .sort((a, b) => TRACK_ORDER.indexOf(a) - TRACK_ORDER.indexOf(b));
  const cities = [...new Set(people.map(m => m.city || ''))].filter(Boolean)
    .sort((a, b) => cityRank(a) - cityRank(b));
  const anyNoCity = people.some(m => !m.city);

  const opt = (v, t) => h('option', { value: v }, t);
  const fTrack = (!band && tracks.length > 1)
    ? h('select', opt('', 'الفرقُ كلُّها'), tracks.map(t => opt(t, trackName(t))))
    : null;
  const fCity = (cities.length + (anyNoCity ? 1 : 0)) > 1
    ? h('select', opt('', 'المدنُ كلُّها'),
        cities.map(c => opt(c, cityName(c))),
        anyNoCity ? opt(NO_CITY, 'بلا مدينةٍ مسجَّلة') : null)
    : null;
  const fState = h('select', opt('', 'الموقِّعون وغيرُهم'),
    opt('signed', 'الموقِّعون وحدَهم'), opt('unsigned', 'من لم يوقِّعْ'));

  const box = h('div.pick-list.tall');
  const tally = h('span.small.muted');

  // المعروضُ الآن بعد الترشيح والبحث
  const shown = () => {
    const k = q.value.trim();
    return people.filter(m =>
      (!k || (m.full_name || '').includes(k))
      && (!fTrack || !fTrack.value || (m.track || '') === fTrack.value)
      && (!fCity || !fCity.value
        || (fCity.value === NO_CITY ? !m.city : (m.city || '') === fCity.value))
      && (!fState.value || (fState.value === 'signed' ? m.signed : !m.signed)));
  };

  const count = () => {
    const sh = shown();
    const inSh = sh.filter(m => chosen.has(m.id)).length;
    tally.textContent = `اختير ${AR(chosen.size)} من ${AR(people.length)}`
      + (sh.length === people.length ? ''
        : ` — والمعروضُ الآن ${AR(sh.length)}، اختير منه ${AR(inSh)}`);
  };

  const paint = () => {
    const sh = shown();
    fill(box, sh.length ? sh.map(m => {
      const on = h('input', { type: 'checkbox', checked: chosen.has(m.id),
        'aria-label': m.full_name });
      on.onchange = () => { on.checked ? chosen.add(m.id) : chosen.delete(m.id); count(); };
      return h('label.check.pick-row', on,
        h('span', m.full_name,
          h('span.small.muted',
            ` · ${m.signed ? 'وقَّع' : m.prev ? 'وقَّع نسخةً سابقة' : 'لم يوقِّعْ'}`
            + ` · ${band || trackName(m.track)}`
            + `${m.city ? ` · ${cityName(m.city)}` : ''}`)));
    }) : [h('p.small.muted', 'لا أحدَ بهذا الترشيح.')]);
    count();
  };
  q.oninput = paint;
  // أوّلُ ترشيحٍ: يُفهَم منه أنه يريد بعضَهم لا كلَّهم، فيُفرَّغ الاختيارُ
  //   الشاملُ مرَّةً واحدةً ثم يُبنى بالأزرار أو بالعلامات، ويبقى ما اختاره
  //   بعد ذلك محفوظًا ولو بدَّل الترشيح
  let narrowed = false;
  const onFilter = () => {
    if (!narrowed) { narrowed = true; chosen.clear(); }
    paint();
  };
  if (fTrack) fTrack.onchange = onFilter;
  if (fCity) fCity.onchange = onFilter;
  fState.onchange = onFilter;
  paint();

  // والأزرارُ في المعروض وحدَه، فلا يُفسد الترشيحُ اختيارًا سابقًا
  const all = h('button.btn.xs', { type: 'button' }, 'اختَرِ المعروض');
  all.onclick = () => { shown().forEach(m => chosen.add(m.id)); paint(); };
  const none = h('button.btn.xs.ghost', { type: 'button' }, 'ألغِ المعروض');
  none.onclick = () => { shown().forEach(m => chosen.delete(m.id)); paint(); };
  const onlySigned = h('button.btn.xs', { type: 'button' }, 'الموقِّعون من المعروض');
  onlySigned.onclick = () => {
    shown().forEach(m => (m.signed ? chosen.add(m.id) : chosen.delete(m.id)));
    paint();
  };
  const clear = h('button.btn.xs.ghost', { type: 'button' }, 'تفريغُ الاختيار');
  clear.onclick = () => { chosen.clear(); paint(); };

  // ـــ بيانٌ في رأس الكشف بما طُبع: الفريقُ والمدينةُ والحال
  const headLine = picked => {
    const t = [...new Set(picked.map(m => m.track || ''))];
    const c = [...new Set(picked.map(m => m.city || ''))].filter(Boolean)
      .sort((a, b) => cityRank(a) - cityRank(b));
    const none = picked.some(m => !m.city);
    const bits = [];
    bits.push(band || (t.length === 1 ? trackName(t[0])
      : t.map(x => trackName(x)).join(' و')));
    if (c.length) {
      bits.push(c.map(x => cityName(x)).join(' و')
        + (none ? ' ومن لا مدينةَ له' : ''));
    }
    const sg = picked.filter(m => m.signed).length;
    return `طُبع هذا الكشفُ لـ${bits.join(' — ')}: ${AR(picked.length)} عضوًا،`
      + ` وقَّع منهم ${AR(sg)}`
      + (sg === picked.length ? '' : ` ولم يوقِّعْ ${AR(picked.length - sg)}`) + '.';
  };

  const res = await dialog({
    title: 'طباعةُ كشف التوقيع',
    body: h('div.stack',
      h('p.small.muted', 'يبدأ الكشفُ بنصِّ الميثاق منسَّقًا، ثم جدولُ من تختاره '
        + 'من الأعضاء وتاريخِ توقيعهم، مبوَّبًا بالفريق ثم المدينة. '
        + 'ولا تدخله تفاصيلُ الشبكة والجهاز.'),
      h('div.row.wrap',
        fTrack ? h('label.field.tight', 'الفريق', fTrack) : null,
        fCity ? h('label.field.tight', 'المدينة', fCity) : null,
        h('label.field.tight', 'الحال', fState)),
      h('p.small.muted', 'والكشفُ ابتداءً شاملٌ لمن في هذه الشاشة. '
        + 'فإن رشَّحتَ أُفرِغ الاختيارُ لتبنيَه بنفسك: '
        + 'رشِّحْ ثم «اختَرِ المعروض» أو ضعِ العلامةَ على من تريد، '
        + 'ثم بدِّلِ الترشيحَ واختَرْ آخرين — ويبقى اختيارُك الأول.'),
      h('div.row.wrap', all, onlySigned, none, clear),
      h('label.field', 'الأسماء', q),
      box, tally),
    buttons: [{ label: '🖨 اطبعِ الكشف', kind: 'primary',
      validate: () => (chosen.size ? true : 'اختَرْ عضوًا واحدًا على الأقل'),
      value: () => people.filter(m => chosen.has(m.id)) },
      { label: 'إلغاء', value: null }]
  });
  if (!res) return false;
  return printRoster(res, { key, version, band, head: headLine(res) });
}
