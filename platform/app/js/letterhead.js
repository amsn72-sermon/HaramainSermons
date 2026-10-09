// الكليشات: ما تُصدَّر عليه الخطبةُ المفردة (ملاحظتا ٤٠٩ و٤١١)
//
//   الكليشةُ عندنا صورةٌ تملأ الصفحةَ وهوامشُ الكتابة عليها، لا أكثر.
//   فالتصميمُ يُصنَع خارجًا وتُرفَع صورتُه، ويُضبَط هنا موضعُ الكتابة.
import { h, dialog, toast } from './ui.js';
import { db, storage } from './sb.js';
import { PAGE, LETTERHEAD } from './page.js';

export const LH_DEFAULT = () => ({
  v: 1,
  bg: null,                       // مسارُ الصورة في مستودع الهوية
  page: { top: PAGE.top, bottom: PAGE.bottom, side: PAGE.side }
});

export const normLh = t => {
  const d = LH_DEFAULT();
  if (!t || typeof t !== 'object') return d;
  const num = (v, min, max, dflt) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
  };
  return {
    v: 1,
    bg: typeof t.bg === 'string' && t.bg ? t.bg : null,
    page: {
      top: num((t.page || {}).top, 0, 120, d.page.top),
      bottom: num((t.page || {}).bottom, 0, 120, d.page.bottom),
      side: num((t.page || {}).side, 0, 80, d.page.side)
    }
  };
};

export const lhList = () => db.rpc('letterhead_list').catch(() => []);

// يُحوَّل القالبُ المحفوظ إلى ما يفهمه التصدير: صورةٌ وهوامش
export async function lhForPrint(id) {
  if (!id) return null;
  const rows = await db.rpc('letterhead_get', { p_id: id }).catch(() => []);
  const row = (Array.isArray(rows) ? rows[0] : rows) || null;
  if (!row) return null;
  const t = normLh(row.tpl);
  let src = new URL(LETTERHEAD, location.origin).href;
  if (t.bg) {
    try { src = await storage.signedUrl('brand', t.bg, 1800); } catch { /* تبقى كليشةُ الهيئة */ }
  }
  return { src, page: t.page, name: row.name };
}

// نافذةُ «تصديرٌ من قالبٍ مختار»: كليشةٌ أو قالبُ مجمَّع (ملاحظة ٤٠٩)
export async function pickExportTemplate() {
  let rows = [];
  try { rows = await db.rpc('export_templates') || []; } catch { rows = []; }
  const lhs = rows.filter(r => r.kind === 'letterhead');
  const books = rows.filter(r => r.kind === 'book');
  const sel = h('select', { 'aria-label': 'القالب' },
    h('option', { value: 'official' }, 'كليشةُ الهيئة'),
    lhs.length
      ? h('optgroup', { label: 'الكليشات' },
          lhs.map(r => h('option', { value: `lh:${r.id}` },
            r.name + (r.is_default ? ' — الأصل' : ''))))
      : null,
    books.length
      ? h('optgroup', { label: 'قوالبُ المجمَّع' },
          books.map(r => h('option', { value: `book:${r.id}` }, r.name)))
      : null);
  const res = await dialog({
    title: 'تصديرٌ من قالب',
    body: h('div.stack',
      h('p.small.muted', 'كليشةُ الهيئة هي الأصل، وما سواها يُصمَّم في «قوالب التصدير».'),
      h('label.field', 'القالب', sel)),
    buttons: [{ label: 'صدِّرْ', kind: 'primary', value: () => sel.value },
              { label: 'إلغاء', value: null }]
  });
  if (!res) return null;
  if (res === 'official') return { kind: 'official' };
  const [kind, id] = res.split(':');
  return { kind, id };
}

// رفعُ صورة الكليشة إلى مستودع الهوية
export async function uploadLhImage(file) {
  if (!file) throw new Error('اختَرْ صورةً');
  if (file.size > 8 * 1024 * 1024) throw new Error('الحد الأقصى 8 ميغابايت.');
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `lh-${Date.now()}.${ext}`;
  await storage.upload('brand', path, file);
  return path;
}

export const lhToast = e => toast(e.message, 'bad');
