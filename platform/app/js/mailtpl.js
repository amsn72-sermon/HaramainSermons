// قالبُ بريد المشروع: صورةُ الرسالة كما تصل إلى المخاطَب (ملاحظة ٥٠١)
//
//   وهو نظيرُ القالب في `selfhost/notify.py` حرفًا بحرف: ما يُعايِنه
//   المرسِلُ هنا هو ما يُرسَل هناك. والمحفوظُ في الطابور متنُ الرسالة
//   وحدَه — لا الصفحةُ كلُّها — ثمَّ يُلبِسه الخادمُ هذه الهويةَ عند
//   الإرسال، فإن بُدِّلت الهويةُ يومًا لم تَبقَ الرسائلُ القديمةُ على
//   هيئةٍ متروكة.
//
//   ومبناه جداولُ وأنماطٌ داخلَ السمات لا ورقةُ أنماط: برامجُ البريد
//   تُسقِط ما سواها. ولا صورةَ فيه، فالشعارُ نصٌّ: لا تُحجَب الهويةُ
//   عمّن أوقف تحميلَ الصور، ولا يُحسَب بريدًا دعائيًّا.
const AUTHORITY = 'الهيئة العامة للعناية بشؤون المسجد الحرام والمسجد النبوي';
const PROJECT_NAME = 'مشروع خادم الحرمين الشريفين لترجمة خطب الحرمين';
const SITE = 'https://platform.haramainsermons.com';
const GOLD = '#bc9661';
const INK = '#1d2b3a';

const esc = s => String(s ?? '').replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// متنُ الرسالة: فقراتٌ من النصِّ المكتوب، وما فيه من وسومٍ يُهرَّب
export function mailBody(text) {
  const parts = String(text || '').trim().split(/\n\s*\n/);
  const out = parts.map(p => {
    const lines = p.split('\n').map(x => x.trim()).filter(Boolean).map(esc);
    return lines.length ? `<p style="margin:0 0 12px;">${lines.join('<br>')}</p>` : '';
  }).filter(Boolean);
  return out.join('\n      ') || '<p style="margin:0;">&nbsp;</p>';
}

export function mailFrame(fullName, subject, inner) {
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f1ec;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
  style="background:#f4f1ec;padding:24px 10px;">
<tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
    style="width:600px;max-width:100%;background:#ffffff;border:1px solid #e6ded2;
    border-radius:10px;overflow:hidden;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
    <tr><td style="background:${INK};padding:18px 22px;color:#ffffff;text-align:right;">
      <div style="font-size:13px;color:${GOLD};letter-spacing:.3px;">${AUTHORITY}</div>
      <div style="font-size:17px;font-weight:bold;padding-top:4px;">${PROJECT_NAME}</div>
    </td></tr>
    <tr><td style="height:3px;background:${GOLD};font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td style="padding:24px 22px;color:#222;font-size:15px;line-height:1.9;text-align:right;">
      <p style="margin:0 0 14px;font-weight:bold;">${esc(fullName)}، وفَّقه الله</p>
      ${inner}
    </td></tr>
    <tr><td style="padding:16px 22px;background:#faf7f2;border-top:1px solid #eee4d6;
      color:#6b6257;font-size:12px;line-height:1.8;text-align:right;">
      <div>هذه رسالةٌ من منصة ${PROJECT_NAME}.</div>
      <div><a href="${SITE}" style="color:${GOLD};text-decoration:none;">${SITE}</a></div>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}
