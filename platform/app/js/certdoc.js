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

function lines(c) {
  const out = [];
  if (c.kind === 'course') {
    out.push(`تشهد الهيئةُ العامة للعناية بشؤون المسجد الحرام والمسجد النبوي، `
      + `في مشروع خادم الحرمين الشريفين لترجمة خطب الحرمين، بأنّ`);
  } else {
    out.push(`تشهد الهيئةُ العامة للعناية بشؤون المسجد الحرام والمسجد النبوي، `
      + `في مشروع خادم الحرمين الشريفين لترجمة خطب الحرمين، بأنّ`);
  }
  return out;
}

function facts(c) {
  const rows = [];
  if (c.kind === 'course') {
    if (c.hours) rows.push(['مدّةُ البرنامج', `${c.hours} ساعة`]);
    if (c.start_on && c.end_on) rows.push(['تاريخُه', `${fmtHijri(c.start_on)} – ${fmtHijri(c.end_on)}`]);
    else if (c.start_on) rows.push(['تاريخُه', fmtHijri(c.start_on)]);
    if (c.subject)  rows.push(['موضوعُه', c.subject]);
    if (c.place)    rows.push(['مكانُه', c.place]);
    if (c.provider) rows.push(['الجهةُ المنفّذة', c.provider]);
  } else {
    if (c.role_text) rows.push(['الدور', c.role_text]);
    if (c.start_on && c.end_on) rows.push(['المدّة', `${fmtHijri(c.start_on)} – ${fmtHijri(c.end_on)}`]);
    if (c.body) rows.push(['ما باشره', c.body]);
  }
  return rows;
}

export function certHtml(c, memberName) {
  const d = c.design || {};
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
  /* الاتّزانُ: المتنُ متوسّطٌ كلُّه لا مُزاحٌ إلى حافّة (ملاحظة ٢٨١) */
  .body { position: relative; z-index: 1; display: flex; flex-direction: column; flex: 1;
          align-items: center; text-align: center; }
  .body > footer { width: 100%; }
  .kind { margin-top: 10mm; font-size: 13pt; color: var(--gold); letter-spacing: .08em; }
  h1 { margin: 2mm 0 0; font-size: 30pt; font-weight: 700; line-height: 1.3; }
  .orn { display: block; width: 46mm; height: 9mm; margin: 6mm auto 0; }
  .pre { margin: 7mm 0 0; font-size: 12.5pt; line-height: 2; max-width: 150mm; color: #4a4a4a; }
  .name { margin: 4mm 0 0; font-size: 22pt; font-weight: 700; }
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
<div class="spine"></div>
${d.watermark === false ? '' : `<div class="wm"><img src="${esc(d.wm_src || AUTH_LOGO)}" alt=""></div>`}
${(Array.isArray(d.logos) ? d.logos : []).map(g => `<div class="mark" style="`
  + `top:${Number(g.y) || 0}%; inset-inline-start:${Number(g.x) || 0}%;">`
  + `<img src="${esc(g.src)}" style="height:${Math.max(5, Math.min(60, Number(g.h) || 14))}mm" alt=""></div>`).join('')}
${c.status === 'revoked' ? '<div class="revoked">ملغاة</div>' : ''}
<div class="body">
<header>
  <img class="auth" src="${esc(d.header_src || AUTH_LOGO)}" alt="الهيئة العامة للعناية بشؤون المسجد الحرام والمسجد النبوي">
</header>
<div class="kind">${esc(KIND[c.kind] || '')}</div>
<h1>${esc(c.title || '')}</h1>
${ORNAMENT(th.gold)}
<div class="pre">${esc(lines(c)[0])}</div>
<div class="name">${esc(memberName || '')}</div>
<div class="facts">${facts(c).map(([k, v]) =>
  `<b>${esc(k)}</b><span>${esc(v)}</span>`).join('')}</div>
<footer>
  <div class="sign">
    <div class="space">${c.signature === 'image' && (c.design || {}).signature_src
      ? `<img src="${esc(c.design.signature_src)}" alt="">` : ''}</div>
    <div class="rule"></div>
    <b>${esc(c.signer_name || '')}</b>
    <small>${esc(c.signer_role || '')}</small>
  </div>
  <div class="no">${esc(c.serial_no || '')}${c.issued_at ? ' · ' + esc(fmtDate(c.issued_at)) : ''}</div>
  ${qr ? `<div class="stamp"><img src="${qr}" alt="رمز التحقق">للتحقق من الشهادة</div>` : ''}
</footer>
</div></div></body></html>`;
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
