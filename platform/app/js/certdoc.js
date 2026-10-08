// توليدُ الشهادة عند الطلب: لا يُخزَّن ملفُّ PDF أصلًا، وإنما تُحفظ
// بياناتُ الشهادة سطرًا في الجدول وتُرسَم هنا من القالب والبيانات،
// فتكون متطابقةً في كلِّ مرة. والأرشيفُ أرشيفُ سجلّاتٍ لا ملفّات.
// (ملاحظة ٢٦٧ ح)
import { fmtHijri, fmtDate } from './ui.js';
import { PUBLIC_SITE } from './page.js';
import { qrDataUri } from './qr.js';

export const certVerifyUrl = c =>
  `${PUBLIC_SITE}/verify-cert?no=${encodeURIComponent(c.serial_no || '')}&k=${encodeURIComponent(c.verify_key || '')}`;

const esc = s => String(s ?? '').replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const KIND = { course: 'شهادةُ حضورِ دورةٍ تدريبية', experience: 'شهادةُ خبرة' };

// شعارُ الهيئة الداكن: اسمُ الهيئة مكتوبٌ فيه، فلا يُعاد تحته نصًّا
export const AUTH_LOGO = '/assets/alharamain-logo-dark.png';

// القوالبُ الثلاثة: أبيضُ الأرضيةِ كلُّها، لا تختلف إلا في اللون
// والحلية — فالاحترافُ في النسبة والخطّ لا في الحبر (ملاحظة ٢٧٣)
export const CERT_THEMES = {
  classic: { name: 'كلاسيكي', ink: '#1d2b3a', gold: '#b9975b' },
  calm:    { name: 'هادئ',    ink: '#2f2a24', gold: '#8c7a55' },
  plain:   { name: 'مجرَّد',   ink: '#222222', gold: '#6b6257' }
};

// حِليةٌ هندسيةٌ خطّيّةٌ واحدة: نجمةٌ ثمانيةٌ مجرَّدة، رفيعةُ الخطوط
// تُطبع نظيفةً على أيِّ آلة
const ORNAMENT = gold => `<svg class="orn" viewBox="0 0 120 24" aria-hidden="true">
  <line x1="0" y1="12" x2="44" y2="12" stroke="${gold}" stroke-width="1"/>
  <line x1="76" y1="12" x2="120" y2="12" stroke="${gold}" stroke-width="1"/>
  <g fill="none" stroke="${gold}" stroke-width="1.1">
    <rect x="52" y="4" width="16" height="16"/>
    <rect x="52" y="4" width="16" height="16" transform="rotate(45 60 12)"/>
  </g></svg>`;

const PRE_TEXT = 'تشهد الهيئةُ العامة للعناية بشؤون المسجد الحرام والمسجد النبوي، '
  + 'في مشروع خادم الحرمين الشريفين لترجمة خطب الحرمين،';

// ---------------------------------------------------------------------
// نصوصُ الشهادة مصفوفةٌ بترتيبها من أعلى إلى أسفل (ملاحظة ٣٥٦)
//
//   أمامَ كلِّ نصٍّ علامةُ صحٍّ: مرفوعةً يَظهر، مخفوضةً يُحجَب — وما
//   بعده يرتفع مكانَه فلا يبقى بياضٌ في موضعه. وكلُّ نصٍّ يُحرَّر،
//   فما كُتب هنا مقترَحٌ لا محتوم، وعناوينُ الجدول كذلك.
// ---------------------------------------------------------------------
export const CERT_BLOCKS = kind => (kind === 'experience'
  ? [
      { key: 'kind',  on: true, text: 'شهادةُ خبرة',  label: 'سطرُ نوع الشهادة' },
      { key: 'title', on: true, text: '',             label: 'عنوانُ الشهادة (من بياناتها)' },
      { key: 'orn',   on: true, text: '',             label: 'الحليةُ الهندسية' },
      { key: 'pre',   on: true, text: PRE_TEXT,       label: 'سطرُ الشهادة' },
      { key: 'bian',  on: true, text: 'بأنّ',          label: 'بأنّ' },
      { key: 'name',  on: true, text: '',             label: 'اسمُ صاحب الشهادة' },
      { key: 'done',  on: true, text: 'قد باشر العملَ الآتي بيانُه',
        label: 'سطرُ الإتمام' },
      { key: 'f.role',   on: true, text: 'الدور',     label: 'بيان: الدور' },
      { key: 'f.period', on: true, text: 'المدّة',     label: 'بيان: المدّة' },
      { key: 'f.body',   on: true, text: 'ما باشره',  label: 'بيان: ما باشره' },
      { key: 'sign',   on: true, text: '', label: 'كتلةُ التوقيع' },
      { key: 'serial', on: true, text: '', label: 'رقمُ الشهادة وتاريخُها' },
      { key: 'qr',     on: true, text: 'للتحقق من الشهادة', label: 'رمزُ التحقُّق' }
    ]
  : [
      { key: 'kind',  on: true, text: 'شهادةُ حضورِ دورةٍ تدريبية', label: 'سطرُ نوع الشهادة' },
      { key: 'title', on: true, text: '',       label: 'عنوانُ الشهادة (من بياناتها)' },
      { key: 'orn',   on: true, text: '',       label: 'الحليةُ الهندسية' },
      { key: 'pre',   on: true, text: PRE_TEXT, label: 'سطرُ الشهادة' },
      { key: 'bian',  on: true, text: 'بأنّ',    label: 'بأنّ' },
      { key: 'name',  on: true, text: '',       label: 'اسمُ صاحب الشهادة' },
      { key: 'done',  on: true, text: 'قد أتمَّ حضورَ الدورة التدريبية بنجاح',
        label: 'سطرُ الإتمام' },
      { key: 'f.hours',    on: true, text: 'مدّةُ البرنامج',   label: 'بيان: المدّة' },
      { key: 'f.dates',    on: true, text: 'تاريخُه',          label: 'بيان: التاريخ' },
      { key: 'f.subject',  on: true, text: 'موضوعُه',          label: 'بيان: الموضوع' },
      { key: 'f.place',    on: true, text: 'مكانُه',           label: 'بيان: المكان' },
      { key: 'f.provider', on: true, text: 'الجهةُ المنفّذة',   label: 'بيان: الجهة' },
      { key: 'sign',   on: true, text: '', label: 'كتلةُ التوقيع' },
      { key: 'serial', on: true, text: '', label: 'رقمُ الشهادة وتاريخُها' },
      { key: 'qr',     on: true, text: 'للتحقق من الشهادة', label: 'رمزُ التحقُّق' }
    ]);

// القالبُ المحفوظُ قديمًا بلا قائمةٍ تأخذ الافتراضية، والمحفوظُ ناقصًا
// يُستكمَل بما استُحدث — فلا يختفي سطرٌ لأنَّ القالبَ أقدمُ منه
export function normalizeBlocks(saved, kind) {
  const base = CERT_BLOCKS(kind);
  if (!Array.isArray(saved) || !saved.length) return base;
  const seen = new Set();
  const out = [];
  for (const b of saved) {
    const def = base.find(x => x.key === b?.key);
    if (!def || seen.has(b.key)) continue;
    seen.add(b.key);
    out.push({ ...def, on: b.on !== false,
      text: b.text != null && String(b.text).length ? String(b.text) : def.text });
  }
  for (const def of base) if (!seen.has(def.key)) out.push({ ...def });
  return out;
}

// قيمةُ كلِّ بيانٍ من بيانات الشهادة
const FACT_VALUE = {
  'f.hours':    c => (c.hours ? `${c.hours} ساعة` : ''),
  'f.dates':    c => (c.start_on && c.end_on
                        ? `${fmtHijri(c.start_on)} – ${fmtHijri(c.end_on)}`
                        : (c.start_on ? fmtHijri(c.start_on) : '')),
  'f.subject':  c => c.subject || '',
  'f.place':    c => c.place || '',
  'f.provider': c => c.provider || '',
  'f.role':     c => c.role_text || '',
  'f.period':   c => (c.start_on && c.end_on
                        ? `${fmtHijri(c.start_on)} – ${fmtHijri(c.end_on)}` : ''),
  'f.body':     c => c.body || ''
};

// الشعاراتُ الثلاثةُ الافتراضية: الهيئةُ والشؤونُ الدينيةُ يمينًا،
//   وجامعةُ أمِّ القرى يسارًا (ملاحظتا ٣١٠ و٣١٢)
export const DEFAULT_CERT_MARKS = [
  { src: AUTH_LOGO,                x: 6,  y: 5, h: 18 },
  { src: '/assets/presidency.png', x: 22, y: 5, h: 18 },
  { src: '/assets/uqu-logo.png',   x: 82, y: 5, h: 18 }
];

// الحقولُ التي يملؤها القالبُ من بيانات صاحب الشهادة (ملاحظة ٣٢٤)
export const CERT_VARS = {
  'الاسم': (c, n) => n || '',
  'رقم الهوية': c => (c.fields || {}).national_id || '',
  'رقم العضوية': c => (c.fields || {}).member_no || '',
  'الجنسية': c => (c.fields || {}).nationality || '',
  'الدور': c => (c.fields || {}).role || '',
  'اللغات': c => (c.fields || {}).langs || '',
  'عنوان الشهادة': c => c.title || '',
  'الموضوع': c => c.subject || '',
  'الساعات': c => (c.hours == null ? '' : String(c.hours)),
  'المكان': c => c.place || '',
  'الجهة': c => c.provider || '',
  'من تاريخ': c => (c.start_on ? fmtHijri(c.start_on) : ''),
  'إلى تاريخ': c => (c.end_on ? fmtHijri(c.end_on) : ''),
  'رقم الشهادة': c => c.serial_no || '',
  'تاريخ الإصدار': c => (c.issued_at ? fmtHijri(String(c.issued_at).slice(0, 10)) : ''),
  'الموقِّع': c => c.signer_name || '',
  'صفة الموقِّع': c => c.signer_role || '',
};

export function fillVars(text, c, memberName) {
  return String(text || '').replace(/\{\s*([^}]+?)\s*\}/g, (m, k) => {
    const fn = CERT_VARS[k.trim()];
    return fn ? String(fn(c || {}, memberName) ?? '') : m;
  });
}

export function certHtml(c, memberName) {
  const d = c.design || {};
  const marks = Array.isArray(d.logos) && d.logos.length ? d.logos : DEFAULT_CERT_MARKS;
  const th = CERT_THEMES[d.theme] || CERT_THEMES.classic;
  const land = d.landscape !== false;        // الأفقيُّ هو الأصل
  const qr = c.serial_no ? qrDataUri(certVerifyUrl(c), { margin: 1, dark: th.ink }) : null;

  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>${esc(c.serial_no || 'شهادة')}</title>
<style>
  @page { size: A4 ${land ? 'landscape' : 'portrait'}; margin: 0; }
  :root { --ink: ${th.ink}; --gold: ${th.gold}; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: var(--ink);
         font-family: "Noto Naskh Arabic", "Amiri", Garamond, serif; }
  .sheet { position: relative; width: ${land ? '297mm' : '210mm'}; height: ${land ? '210mm' : '297mm'};
           background: #fff; overflow: hidden; display: flex; flex-direction: column;
           padding: 18mm 24mm 16mm 24mm; }
  /* شريطٌ رفيعٌ على الحافة الداخلية: وحدَه ما يحمل لونًا ممتدًّا */
  .spine { position: absolute; inset-inline-end: 0; top: 0; bottom: 0; width: 14mm;
           background: var(--gold); opacity: .14; }
  .spine::after { content: ''; position: absolute; inset-inline-start: 0; top: 0; bottom: 0;
                  width: 1.2mm; background: var(--gold); }
  /* شعارُ الهيئة وحدَه متوسّطًا، واسمُها مكتوبٌ فيه (ملاحظة ٢٨١) */
  header { display: flex; align-items: center; justify-content: center; }
  header img.auth { height: ${Math.max(10, Math.min(34, Number(d.logo_h) || 20))}mm; }
  /* علامةٌ مائيةٌ شفّافةٌ في الوسط (ملاحظة ٢٨٢) */
  .wm { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
        pointer-events: none; }
  .wm img { width: ${Math.max(20, Math.min(90, Number(d.wm_size) || 55))}%;
            opacity: ${Math.max(0.02, Math.min(0.3, Number(d.wm_opacity) || 0.07))}; }
  /* شعاراتٌ تُضاف وتُحرَّك بحرية (ملاحظة ٢٨٢) */
  .mark { position: absolute; }
  .mark img { display: block; }
  /* خلفيةٌ مرفوعةٌ تملأ الورقة (ملاحظة ٣٢٢) */
  .bg { position: absolute; inset: 0; z-index: 0; }
  .bg img { width: 100%; height: 100%; object-fit: cover; display: block; }
  /* نصوصٌ حرّةٌ تُضاف وتُحرَّك (ملاحظة ٣٢٣) */
  .tx { position: absolute; z-index: 2; white-space: pre-wrap; line-height: 1.6; }
  /* الاتّزانُ: المتنُ متوسّطٌ كلُّه لا مُزاحٌ إلى حافّة (ملاحظة ٢٨١) */
  .body { position: relative; z-index: 1; display: flex; flex-direction: column; flex: 1;
          align-items: center; text-align: center; }
  .body > footer { width: 100%; }
  .kind { margin-top: 10mm; font-size: 13pt; color: var(--gold); letter-spacing: .08em; }
  h1 { margin: 2mm 0 0; font-size: 30pt; font-weight: 700; line-height: 1.3; }
  .orn { display: block; width: 46mm; height: 9mm; margin: 6mm auto 0; }
  .pre { margin: 7mm 0 0; font-size: 12.5pt; line-height: 2; max-width: 150mm; color: #4a4a4a; }
  .bian { margin: 3mm 0 0; font-size: 12.5pt; color: #4a4a4a; }
  .name { margin: 4mm 0 0; font-size: 22pt; font-weight: 700; }
  .done { margin: 4mm 0 0; font-size: 13pt; color: var(--ink); }
  .facts { margin: 7mm 0 0; display: inline-grid; grid-template-columns: auto auto; gap: 2.5mm 8mm;
           font-size: 12pt; max-width: 170mm; text-align: start; }
  .facts b { color: var(--gold); font-weight: 600; }
  footer { margin-top: auto; display: flex; align-items: flex-end; justify-content: space-between; gap: 10mm; }
  .sign { text-align: center; min-width: 60mm; }
  .sign .space { height: ${c.signature === 'blank' ? '18mm' : '6mm'}; }
  .sign img { max-height: 16mm; }
  .sign .rule { border-top: .4mm solid var(--gold); margin: 2mm 0 2mm; }
  .sign b { display: block; font-size: 12pt; }
  .sign small { color: #6b6257; font-size: 9.5pt; }
  .stamp { text-align: center; font-size: 8.5pt; color: #6b6257; }
  .stamp img { width: 22mm; height: 22mm; display: block; margin: 0 auto 1.5mm; }
  .no { font-size: 9.5pt; color: #6b6257; letter-spacing: .04em; direction: ltr; }
  .revoked { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
             font-size: 60pt; color: rgba(180, 40, 40, .12); transform: rotate(-20deg); font-weight: 700; }
  @media print { .sheet { page-break-after: always; } }
</style></head><body><div class="sheet">
${d.bg_src ? `<div class="bg"><img src="${esc(d.bg_src)}" alt=""></div>` : ''}
${d.spine === false || d.bg_src ? '' : '<div class="spine"></div>'}
${d.watermark === false ? '' : `<div class="wm"><img src="${esc(d.wm_src || AUTH_LOGO)}" alt=""></div>`}
${marks.map(g => `<div class="mark" style="`
  + `top:${Number(g.y) || 0}%; inset-inline-start:${Number(g.x) || 0}%;">`
  + `<img src="${esc(g.src)}" style="height:${Math.max(5, Math.min(60, Number(g.h) || 14))}mm" alt=""></div>`).join('')}
${(Array.isArray(d.texts) ? d.texts : []).map(t => {
  const al = ['center', 'end'].includes(t.align) ? t.align : 'start';
  return `<div class="tx" style="`
    + `top:${Number(t.y) || 0}%; inset-inline-start:${Number(t.x) || 0}%;`
    + `width:${Math.max(5, Math.min(100, Number(t.w) || 40))}%;`
    + `font-size:${Math.max(6, Math.min(60, Number(t.size) || 12))}pt;`
    + `font-weight:${t.bold ? 700 : 400};`
    + `color:${esc(t.color || th.ink)};`
    + `text-align:${al};`
    + (t.font ? `font-family:${esc(t.font)};` : '')
    + (t.rotate ? `transform:rotate(${Number(t.rotate) || 0}deg);` : '')
    + `">${esc(fillVars(t.text || '', c, memberName))}</div>`;
}).join('')}
${c.status === 'revoked' ? '<div class="revoked">ملغاة</div>' : ''}
<div class="body">
${d.header === false ? '<div style="height:20mm"></div>' : `<header>
  <img class="auth" src="${esc(d.header_src || AUTH_LOGO)}" alt="الهيئة العامة للعناية بشؤون المسجد الحرام والمسجد النبوي">
</header>`}
${bodyHtml(c, memberName, th, qr)}
</div></div></body></html>`;
}

// المتنُ يُرسَم على ترتيب القائمة، والمحجوبُ يُطوى فيرتفع ما بعده
function bodyHtml(c, memberName, th, qr) {
  const d = c.design || {};
  const blocks = normalizeBlocks(d.blocks, c.kind).filter(b => b.on !== false);
  const at = k => blocks.find(b => b.key === k);
  const out = [];
  let facts = [];
  const flushFacts = () => {
    if (!facts.length) return;
    out.push(`<div class="facts">${facts.join('')}</div>`);
    facts = [];
  };
  for (const b of blocks) {
    if (b.key.startsWith('f.')) {
      const v = (FACT_VALUE[b.key] || (() => ''))(c);
      if (v) facts.push(`<b data-block="${esc(b.key)}">${esc(b.text || '')}</b>`
        + `<span>${esc(v)}</span>`);
      continue;
    }
    flushFacts();
    if (b.key === 'kind') {
      out.push(`<div class="kind" data-block="kind">${esc(b.text || KIND[c.kind] || '')}</div>`);
    } else if (b.key === 'title') {
      out.push(`<h1 data-block="title">${esc(c.title || '')}</h1>`);
    } else if (b.key === 'orn') {
      out.push(ORNAMENT(th.gold));
    } else if (b.key === 'pre') {
      out.push(`<div class="pre" data-block="pre">${esc(b.text || PRE_TEXT)}</div>`);
    } else if (b.key === 'bian') {
      out.push(`<div class="bian" data-block="bian">${esc(b.text || 'بأنّ')}</div>`);
    } else if (b.key === 'name') {
      out.push(`<div class="name" data-block="name">${esc(memberName || '')}</div>`);
    } else if (b.key === 'done') {
      out.push(`<div class="done" data-block="done">${esc(b.text || '')}</div>`);
    }
  }
  flushFacts();

  const sign = at('sign') ? `<div class="sign">
    <div class="space">${c.signature === 'image' && d.signature_src
      ? `<img src="${esc(d.signature_src)}" alt="">` : ''}</div>
    <div class="rule"></div>
    <b>${esc(c.signer_name || '')}</b>
    <small>${esc(c.signer_role || '')}</small>
  </div>` : '<div class="sign"></div>';
  const serial = at('serial')
    ? `<div class="no">${esc(c.serial_no || '')}`
      + `${c.issued_at ? ' · ' + esc(fmtDate(c.issued_at)) : ''}</div>`
    : '';
  const stamp = (qr && at('qr'))
    ? `<div class="stamp"><img src="${qr}" alt="رمز التحقق">`
      + `${esc(at('qr').text || 'للتحقق من الشهادة')}</div>`
    : '';
  out.push(`<footer>${sign}${serial}${stamp}</footer>`);
  return out.join('\n');
}

// تُفتح في نافذةٍ للطباعة أو الحفظ PDF — ولا يُخزَّن منها ملف
export function printCertificate(c, memberName) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(certHtml(c, memberName));
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch { /* يطبع المستخدم بنفسه */ } }, 400);
  return true;
}
