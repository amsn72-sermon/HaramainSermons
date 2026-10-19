// وثيقةُ إثبات التوقيع على الميثاق: تُطبَع على كليشة الهيئة (ملاحظة ٤٢٥)
//
//   إذا خالف عضوٌ السريةَ ثم أنكر توقيعَه، فهذه الورقةُ هي الحجّة:
//   فيها اسمُه ورقمُ عضويته، والاسمُ الذي وقَّع به، ونسخةُ الميثاق
//   ووقتُ توقيعه، وعنوانُ شبكته ووصفُ جهازه، وبصمةُ sha256 للنصِّ
//   الذي عُرِض عليه حرفًا بحرف، ورمزُ تحقُّقٍ يُراجَع به في المنصة.
//
//   ونصُّ البند يُنقَل من النسخة التي وقَّع عليها هو، لا من النسخة
//   الجارية: فمن وقَّع على ١.١ لا يُحتجُّ عليه بما استُحدث في ١.٢.
import { fmtHijri, fmtDateTime, toast } from './ui.js';
import { db } from './sb.js';
import { PAGE, LETTERHEAD, FONT_FACE_CSS, NASKH_STACK } from './page.js';
import { qrDataUri } from './qr.js';
import { policyOf, policyBreachClause, POLICY_KEY } from './policy.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const ARD = v => (v ? fmtDateTime(v) : '—');

// سجلُّ توقيعِ عضوٍ: نسخُه كلُّها، الأحدثُ أولًا
export async function signatureRecords(memberId, { key = POLICY_KEY } = {}) {
  try {
    const rows = await db.rpc('policy_proof',
      { p_member: memberId, p_version: null, p_key: key });
    return Array.isArray(rows) ? rows : (rows ? [rows] : []);
  } catch { return []; }
}

export function proofHtml(r) {
  const p = policyOf(r.policy_version);
  const clause = policyBreachClause(r.policy_version);
  const code = r.proof_code || '';
  const qr = code ? qrDataUri(code, { margin: 1, dark: '#1d2b3a' }) : null;
  const BOX_W = PAGE.w - PAGE.side * 2;

  const row = (k, v, ltr) => `<tr><th>${esc(k)}</th>`
    + `<td${ltr ? ' dir="ltr" class="ltr"' : ''}>${esc(v || '—')}</td></tr>`;

  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>${esc(`وثيقة إثبات التوقيع — ${r.full_name || ''}`)}</title>
<style>
  ${FONT_FACE_CSS()}
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: #1d2b3a;
         font-family: ${NASKH_STACK}; }
  .sheet { position: relative; width: ${PAGE.w}mm; height: ${PAGE.h}mm; overflow: hidden; background: #fff; }
  .sheet img.lh { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
  .win { position: absolute; top: ${PAGE.top}mm; inset-inline-start: ${PAGE.side}mm;
         width: ${BOX_W}mm; height: ${PAGE.h - PAGE.top - PAGE.bottom}mm; }
  h1 { font-size: 16pt; text-align: center; margin: 0 0 2mm; }
  .sub { text-align: center; font-size: 9.5pt; color: #6b6257; margin: 0 0 6mm; }
  table.rec { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
  table.rec th, table.rec td { border: .3mm solid #bc9661; padding: 1.6mm 2.4mm; vertical-align: top; }
  table.rec th { width: 42mm; background: rgb(188 150 97 / 14%); color: #8a6835;
                 font-weight: 700; text-align: start; white-space: nowrap; }
  td.ltr { direction: ltr; text-align: left; font-family: ui-monospace, "Courier New", monospace;
           font-size: 9pt; word-break: break-all; }
  .clause { margin: 6mm 0 0; border-inline-start: 1mm solid #bc9661; padding: 0 3mm;
            font-size: 10.5pt; line-height: 1.9; }
  .clause b { display: block; color: #8a6835; font-size: 9.5pt; margin-bottom: 1mm; }
  .note { margin: 5mm 0 0; font-size: 9pt; color: #6b6257; line-height: 1.8; }
  footer { position: absolute; bottom: 0; inset-inline: 0; display: flex;
           align-items: flex-end; justify-content: space-between; gap: 6mm; }
  .code { font-size: 9pt; color: #3b3630; }
  .code .no { font-size: 13pt; font-weight: 700; direction: ltr; letter-spacing: 1px; }
  .qr { text-align: center; font-size: 8pt; color: #6b6257; }
  .qr img { width: 24mm; height: 24mm; display: block; margin: 0 auto 1mm; }
  @media screen { body { background: #d9d9d9; } .sheet { margin: 16px auto; box-shadow: 0 2px 12px #0003; } }
</style></head><body><div class="sheet">
<img class="lh" src="${esc(new URL(LETTERHEAD, location.origin).href)}" alt="">
<div class="win">
  <h1>وثيقةُ إثبات التوقيع على ${esc(p.title)}</h1>
  <p class="sub">مشروع خادم الحرمين الشريفين لترجمة خطب الحرمين — الهيئة العامة للعناية بشؤون المسجد الحرام والمسجد النبوي</p>
  <table class="rec">
    ${row('اسمُ العضو', r.full_name)}
    ${row('رقمُ العضوية', r.member_no == null ? '' : String(r.member_no))}
    ${row('البريدُ الإلكتروني', r.email, true)}
    ${row('الاسمُ الذي وقَّع به', r.signed_name)}
    ${row('نسخةُ الميثاق', r.policy_version)}
    ${row('وقتُ التوقيع', ARD(r.accepted_at))}
    ${row('تاريخُه الهجري', r.accepted_at ? fmtHijri(String(r.accepted_at).slice(0, 10)) : '')}
    ${row('عنوانُ الشبكة', r.sign_ip, true)}
    ${row('الجهازُ والمتصفح', r.sign_agent, true)}
    ${row('بصمةُ النصِّ الموقَّع (SHA-256)', r.doc_hash, true)}
  </table>
  <div class="clause"><b>بندُ المخالفة في النسخة ${esc(r.policy_version)} — بنصِّه</b>${esc(clause)}</div>
  <p class="note">
    وقَّع العضوُ إلكترونيًّا على ${esc(p.title)} بنسخته ${esc(r.policy_version)} في الوقت المبيَّن أعلاه،
    وقد أقرَّ في توقيعه بأنَّ توقيعَه الإلكترونيَّ يقوم مقام التوقيع الخطي.
    ${r.doc_hash ? 'وبصمةُ النصِّ أعلاه محسوبةٌ على النصِّ الذي عُرِض عليه حرفًا بحرف، فتُطابَق بها نسخةُ الميثاق المرفقة.'
      : 'ولم تُحفظْ بصمةُ النصِّ في هذا التوقيع لأنه سابقٌ لاستحداثها، والمحتجُّ به نصُّ نسخته المحفوظُ في المنصة.'}
    ويُراجَع هذا السجلُّ في المنصة من: الفريق ← ${esc(p.title)} ← التحقُّقُ برمزِ الوثيقة.
  </p>
  <footer>
    <div class="code"><div>رمزُ التحقُّق من الوثيقة</div><div class="no">${esc(code || '—')}</div></div>
    ${qr ? `<div class="qr"><img src="${qr}" alt="رمز التحقق">رمزُ الوثيقة</div>` : ''}
  </footer>
</div></div></body></html>`;
}

// تُفتح في نافذةٍ للطباعة أو الحفظ PDF — ولا يُخزَّن منها ملف
export function printProof(r) {
  const w = window.open('', '_blank');
  if (!w) { toast('امنعْ حجبَ النوافذ لتُفتح الوثيقة.', 'bad'); return false; }
  w.document.write(proofHtml(r));
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch { /* يطبع المستخدم بنفسه */ } }, 400);
  return true;
}

// زرُّ الوثيقة: يقرأ السجلَّ ثم يطبع. ومن لم يوقِّعْ لا وثيقةَ له.
export async function proofFor(memberId, version = null) {
  const rows = await signatureRecords(memberId);
  if (!rows.length) { toast('لا توقيعَ مسجَّلٌ لهذا العضو.', 'warn'); return false; }
  const r = version ? rows.find(x => x.policy_version === version) || rows[0] : rows[0];
  return printProof(r);
}
