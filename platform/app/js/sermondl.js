// تنزيلُ خطبةٍ من أرشيف الخطب: Word وPDF على كليشة الهيئة، والملفُّ
// المرفوعُ كما هو (ملاحظة ٣٣٢)
//
//   أيقونةُ التنزيل كانت تفتح نافذةَ العرض ولا تُنزِّل شيئًا. وفي
//   أرشيف الترجمة ثلاثُ أيقونات: Word على الكليشة، وPDF عليها، والأصلُ
//   المرفوع. فجُعلت هنا مثلَها، وبُنيت على المُصدِّر نفسِه — فالمُخرَجُ
//   واحدٌ في الأرشيفين لا مُخرَجان.
import { db, storage } from './sb.js';
import { toast, dialog, h, fmtHijri } from './ui.js';
import { langName, MOSQUE } from './store.js';

// خطبةُ الأرشيف ← ما يفهمه مُصدِّرُ الترجمة: مادةٌ ومسارُ لغة
export function asExportArgs(s, v, text) {
  const material = {
    id: s.id,
    title: s.title || '—',
    material_type: 'خطب',
    sermon_type: s.sermon_type || 'خطبة جمعة',
    mosque: s.mosque || null,
    sermon_date: s.sermon_date || null,
    khateeb: s.khateeb ? { name: s.khateeb } : null,
  };
  const track = {
    id: `${s.id}:${v.language_code}`,
    language_code: v.language_code,
    translation_html: text?.body_html || '',
    doc_no: text?.doc_no || null,
    doc_no_at: s.sermon_date || null,
    completed_at: s.sermon_date || null,
  };
  return { material, track, khateeb: s.khateeb || null };
}

async function versionText(sermonId, code) {
  const r = await db.rpc('arch_version_text', { p_sermon: sermonId, p_lang: code });
  return (Array.isArray(r) ? r[0] : r) || {};
}

async function sermonOf(id) {
  const r = await db.rpc('arch_sermon', { p_id: id });
  return (Array.isArray(r) ? r[0] : r) || {};
}

// أيُّ نسخةٍ تُنزَّل؟ الواحدةُ تُؤخذ بلا سؤال، والكثيرُ يُنتقى منه.
//   وما لا يصلح للمطلوب لا يُعرَض: من أراد Word لا يُعرَض عليه ما لا
//   نصَّ له، ومن أراد الأصلَ لا يُعرَض عليه ما لا ملفَّ له.
async function pickVersion(s, prefer, need) {
  const all = s.versions || [];
  const vs = need ? all.filter(v => v[need]) : all;
  if (!vs.length) {
    toast(need === 'has_text' ? 'لا نصَّ محفوظٌ في نسخةٍ من هذه الخطبة.'
      : need === 'has_file' ? 'لا ملفَّ مرفوعٌ في نسخةٍ من هذه الخطبة.'
      : 'لا نسخَ محفوظةٌ لهذه الخطبة.', 'bad');
    return null;
  }
  if (prefer) {
    const hit = vs.find(v => v.language_code === prefer);
    if (hit) return hit;
  }
  if (vs.length === 1) return vs[0];
  const sel = h('select', { 'aria-label': 'اللغة' },
    vs.map(v => h('option', { value: v.language_code },
      v.language_code === 'ar' ? 'العربية (الأصل)' : langName(v.language_code))));
  const res = await dialog({
    title: 'أيُّ نسخةٍ تُنزَّل؟',
    body: h('div.stack',
      h('p.small.muted', `${s.title || 'خطبة'} — ${MOSQUE[s.mosque] || 'بلا مسجد'}`),
      h('label.field', 'اللغة', sel)),
    buttons: [{ label: 'تابِعْ', kind: 'primary', value: () => sel.value },
              { label: 'إلغاء', value: null }]
  });
  if (!res) return null;
  return vs.find(v => v.language_code === res) || null;
}

// Word على كليشة الهيئة
export async function downloadSermonWord(id, prefer = null) {
  const s = await sermonOf(id);
  const v = await pickVersion(s, prefer, 'has_text');
  if (!v) return;
  const text = await versionText(id, v.language_code);
  if (!text.body_html) { toast('لا نصَّ محفوظٌ لهذه النسخة.', 'bad'); return; }
  const { downloadDocx } = await import('./export.js');
  await downloadDocx(asExportArgs(s, v, text));
}

// PDF على كليشة الهيئة: تُفتح نافذةُ الطباعة فيُحفَظ منها PDF
export async function downloadSermonPdf(id, prefer = null, { autoPrint = true } = {}) {
  const s = await sermonOf(id);
  const v = await pickVersion(s, prefer, 'has_text');
  if (!v) return;
  const text = await versionText(id, v.language_code);
  if (!text.body_html) { toast('لا نصَّ محفوظٌ لهذه النسخة.', 'bad'); return; }
  const { printTranslation } = await import('./export.js');
  if (!printTranslation(asExportArgs(s, v, text), { autoPrint })) {
    toast('اسمح بالنوافذ المنبثقة.', 'bad');
  }
}

// الملفُّ المرفوعُ كما هو (PDF أو Word رفعه صاحبُه)
export async function openSermonFile(id, prefer = null) {
  const s = await sermonOf(id);
  const v = await pickVersion(s, prefer, 'has_file');
  if (!v) return;
  const text = await versionText(id, v.language_code);
  if (!text.file_path) { toast('لا ملفَّ مرفوعٌ لهذه النسخة.', 'bad'); return; }
  try {
    window.open(await storage.signedUrl('repo', text.file_path, 600), '_blank', 'noopener');
  } catch (e) { toast(e.message, 'bad'); }
}

// سطرُ معلوماتٍ مختصرٌ يُستعمل في العناوين
export const sermonCaption = s => [s.sermon_type, MOSQUE[s.mosque],
  s.hijri_text || (s.sermon_date ? fmtHijri(s.sermon_date) : null)].filter(Boolean).join(' · ');
