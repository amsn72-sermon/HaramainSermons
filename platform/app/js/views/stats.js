// دليل الإنتاج: قوائم الأعمال بعدد كلماتها وصفحاتها ودقائقها، ومجموع يتحدّث (ملاحظة ٩٠)
import { h, toast, busy, fmtDate, fmtSermonDate } from '../ui.js';
import { db } from '../sb.js';
import { state, langName, MOSQUE_ANY, MATERIAL_TYPES } from '../store.js';
import { buildXlsx, downloadBlob } from '../xlsx.js';

// الصفحة المطبوعة على كليشة الهيئة ≈ ٢٥٠ كلمة
const WORDS_PER_PAGE = 250;
export const pagesOf = words => (words > 0 ? Math.max(1, Math.ceil(words / WORDS_PER_PAGE)) : 0);

// الأرقام لاتينية في كل الدليل ليسهل قراؤها ونقلها إلى التقارير
const ar = n => Number(n || 0).toLocaleString('en-US');
const minutes = sec => Math.round((sec || 0) / 60);

// المجاميع: الصفحات تُجمع صفحةً صفحة لتطابق عمود الجدول
const sums = list => ({
  words: list.reduce((s, r) => s + (r.words || 0), 0),
  pages: list.reduce((s, r) => s + pagesOf(r.words), 0),
  sec: list.reduce((s, r) => s + (r.audio_seconds || 0), 0)
});

const TYPE_ORDER = MATERIAL_TYPES;
const isSermonType = t => t === 'خطب' || t === 'دروس علمية';

export async function render(ctx) {
  const rows = await db.select('production_rows', { select: '*', order: 'sermon_date.desc' });
  const langs = [...new Set(rows.map(r => r.language_code))].sort();

  // ---------------- المرشّحات ----------------
  const f = {
    lang: h('select', h('option', { value: '' }, 'كل اللغات'),
      langs.map(c => h('option', { value: c }, langName(c)))),
    from: h('input', { type: 'date' }),
    to: h('input', { type: 'date' }),
    only: h('select',
      h('option', { value: 'all' }, 'كل الأعمال'),
      h('option', { value: 'done' }, 'المكتملة فقط'),
      h('option', { value: 'published' }, 'المنشورة فقط'))
  };

  const match = r => {
    if (f.lang.value && r.language_code !== f.lang.value) return false;
    if (f.only.value === 'done' && r.status !== 'completed') return false;
    if (f.only.value === 'published' && !r.published_at) return false;
    const d = r.sermon_date || (r.added_at || '').slice(0, 10);
    if (f.from.value && d && d < f.from.value) return false;
    if (f.to.value && d && d > f.to.value) return false;
    return r.words > 0 || r.audio_seconds > 0;
  };

  // ---------------- العدّاد ----------------
  const counter = h('div.counter-grid');
  const bigWords = h('b.counter-num', '٠');
  let shown = 0;

  function animateTo(target) {
    const start = shown, diff = target - start, t0 = performance.now(), dur = 900;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur);
      const v = Math.round(start + diff * (1 - Math.pow(1 - k, 3)));
      bigWords.textContent = ar(v);
      if (k < 1) requestAnimationFrame(step); else shown = target;
    };
    requestAnimationFrame(step);
  }

  function drawCounter(list) {
    const { words, pages, sec } = sums(list);
    const mats = new Set(list.map(r => r.material_id)).size;
    const lg = new Set(list.map(r => r.language_code)).size;
    counter.replaceChildren(
      h('div.counter-main',
        h('span.counter-label', 'مجموع الكلمات المترجمة حتى الآن'),
        bigWords,
        h('span.counter-sub', `${ar(pages)} صفحة تقديرًا`)),
      h('div.counter-side',
        h('div.counter-cell', h('b', ar(mats)), h('span', 'مادة')),
        h('div.counter-cell', h('b', ar(list.length)), h('span', 'عمل مترجَم')),
        h('div.counter-cell', h('b', ar(lg)), h('span', 'لغة')),
        h('div.counter-cell', h('b', ar(minutes(sec))), h('span', 'دقيقة صوتية'))));
    animateTo(words);
  }

  // ---------------- القوائم ----------------
  const tablesBox = h('div.stack');

  const rowTitle = r => r.sermon_type
    ? `${r.sermon_type}${r.mosque && MOSQUE_ANY[r.mosque] && r.mosque !== 'general' ? ` — ${MOSQUE_ANY[r.mosque]}` : ''}`
    : (r.material_type || 'مادة');

  function typeTable(type, list) {
    const sermon = isSermonType(type);
    const { words, pages, sec } = sums(list);
    const head = sermon
      ? ['العنوان', 'النوع', 'التاريخ', 'اللغة', 'الكلمات', 'الصفحات', 'الدقائق']
      : ['العنوان', 'التاريخ', 'اللغة', 'الكلمات', 'الصفحات'];
    const body = list.map(r => {
      const cells = sermon
        ? [r.title, rowTitle(r), r.sermon_date ? fmtSermonDate(r.sermon_date) : fmtDate(r.added_at),
           langName(r.language_code), ar(r.words), ar(pagesOf(r.words)), ar(minutes(r.audio_seconds))]
        : [r.title, r.sermon_date ? fmtSermonDate(r.sermon_date) : fmtDate(r.added_at),
           langName(r.language_code), ar(r.words), ar(pagesOf(r.words))];
      return h('tr', cells.map((v, i) => h('td', { 'data-label': head[i] }, v)));
    });
    const totalRow = sermon
      ? ['المجموع', '', '', `${ar(list.length)} عملًا`, ar(words), ar(pages), ar(minutes(sec))]
      : ['المجموع', '', `${ar(list.length)} عملًا`, ar(words), ar(pages)];

    return h('section.card.stack',
      h('div.row.between', h('h3', type),
        h('span.badge', `${ar(words)} كلمة · ${ar(pages)} صفحة`)),
      h('div.table-wrap', h('table.responsive.prod-table',
        h('thead', h('tr', head.map(t => h('th', t)))),
        h('tbody', body),
        h('tfoot', h('tr.total-row', totalRow.map((v, i) => h('td', { 'data-label': head[i] }, v)))))));
  }

  function draw() {
    const list = rows.filter(match);
    drawCounter(list);
    const groups = TYPE_ORDER
      .map(t => [t, list.filter(r => (r.material_type || 'مادة') === t)])
      .filter(([, l]) => l.length);
    const other = list.filter(r => !TYPE_ORDER.includes(r.material_type || ''));
    if (other.length) groups.push(['مواد أخرى', other]);

    const { words, pages, sec } = sums(list);

    tablesBox.replaceChildren(
      ...(groups.length ? groups.map(([t, l]) => typeTable(t, l))
        : [h('p.muted', 'لا أعمال ضمن هذا التحديد.')]),
      groups.length ? h('div.card.grand-total',
        h('div.row.between',
          h('b', 'المجموع العام'),
          h('span', `${ar(words)} كلمة · ${ar(pages)} صفحة · ${ar(minutes(sec))} دقيقة صوتية`))) : null);
  }

  for (const el of Object.values(f)) el.addEventListener('change', draw);

  // ---------------- تصدير: Excel وWord وPDF على كليشة الهيئة (ملاحظة ٩٨) ----------------
  const sheetRows = () => {
    const list = rows.filter(match);
    const out = [['النوع', 'العنوان', 'التاريخ', 'اللغة', 'الكلمات', 'الصفحات', 'الدقائق الصوتية']];
    for (const t of [...TYPE_ORDER, 'مواد أخرى']) {
      const l = list.filter(r => (r.material_type || 'مادة') === t
        || (t === 'مواد أخرى' && !TYPE_ORDER.includes(r.material_type || '')));
      for (const r of l) {
        out.push([t, r.title, r.sermon_date || (r.added_at || '').slice(0, 10), langName(r.language_code),
          String(r.words || 0), String(pagesOf(r.words)), String(minutes(r.audio_seconds))]);
      }
    }
    const { words, pages, sec } = sums(list);
    out.push(['المجموع', '', '', '', String(words), String(pages), String(minutes(sec))]);
    return { out, list, words, pages, sec };
  };
  const stamp = () => `دليل الإنتاج ${new Date().toISOString().slice(0, 10)}`;
  const noteOf = (list, words, pages, sec) =>
    `${ar(list.length)} عملًا مترجَمًا · ${ar(words)} كلمة · ${ar(pages)} صفحة · ${ar(minutes(sec))} دقيقة صوتية — ${fmtDate(new Date())}`;

  const fmtSel = h('select', { 'aria-label': 'صيغة التصدير' },
    h('option', { value: 'xlsx' }, 'Excel — جدول بيانات'),
    h('option', { value: 'docx' }, 'Word على كليشة الهيئة'),
    h('option', { value: 'pdf' }, 'PDF على كليشة الهيئة'));
  const xlsBtn = h('button.btn.sm', { type: 'button' }, 'تصدير الدليل');
  xlsBtn.onclick = () => busy(xlsBtn, async () => {
    const { out, list, words, pages, sec } = sheetRows();
    const note = noteOf(list, words, pages, sec);
    try {
      if (fmtSel.value === 'xlsx') {
        downloadBlob(buildXlsx(out, { sheetName: 'دليل الإنتاج', allText: true }), `${stamp()}.xlsx`);
      } else {
        // في المستندات تُكتب الأرقام بفواصل الآلاف لتسهل قراءتها
        const pretty = out.map((r, i) => i === 0 ? r : r.map((v, c) => (c >= 4 && /^[0-9]+$/.test(v) ? ar(v) : v)));
        const { exportWord, exportPdf } = await import('../teamexport.js');
        if (fmtSel.value === 'docx') await exportWord(pretty, 'دليل الإنتاج', { note });
        else if (!exportPdf(pretty, 'دليل الإنتاج', { note })) return toast('اسمح بالنوافذ المنبثقة.', 'bad');
      }
      toast('جرى التصدير.', 'ok');
    } catch (err) { toast(err.message, 'bad'); }
  });

  // تحديث مستمر: المجموع يتحدّث كلما أُنجز عمل
  const refresh = async () => {
    try {
      const fresh = await db.select('production_rows', { select: '*', order: 'sermon_date.desc' });
      rows.length = 0; rows.push(...fresh);
      draw();
    } catch { /* الشبكة تنقطع أحيانًا، ويُعاد المحاولة لاحقًا */ }
  };
  const timer = setInterval(refresh, 60000);
  // يتوقف المؤقّت حين تُغادر الشاشة
  const stop = new MutationObserver(() => {
    if (!document.body.contains(counter)) { clearInterval(timer); stop.disconnect(); }
  });
  stop.observe(document.body, { childList: true, subtree: true });

  draw();

  return h('div',
    h('div.page-head',
      h('div.row', { style: { marginInlineStart: 'auto', order: 2 } }, fmtSel, xlsBtn),
      h('div.grow', h('div.eyebrow', 'الإدارة'), h('h1', 'دليل الإنتاج'),
        h('p.muted', 'كل عمل مترجَم بعدد كلماته وصفحاته، مرتَّبًا بنوع المادة، والمجموع يتحدّث كلما أُنجز عمل.'))),
    counter,
    h('div.card.stack',
      h('div.grid-2',
        h('label.field', 'اللغة', f.lang),
        h('label.field', 'الحالة', f.only),
        h('label.field', 'من تاريخ', f.from),
        h('label.field', 'إلى تاريخ', f.to))),
    tablesBox,
    h('p.small.muted', 'الكلمات تُحسب من نص الترجمة نفسه. والصفحات تقديرية على أساس 250 كلمة للصفحة المطبوعة على كليشة الهيئة.'));
}

// عدّاد مختصر لصدر شاشة المتابعة
export async function counterChip() {
  try {
    const t = await db.rpc('production_totals');
    const row = Array.isArray(t) ? t[0] : t;
    if (!row) return null;
    const words = Number(row.words || 0);
    return h('a.prod-chip', { href: '/app/stats', title: 'دليل الإنتاج' },
      h('b', ar(words)), h('span', 'كلمة مترجَمة'),
      h('span.sep', '·'), h('b', ar(minutes(row.audio_seconds))), h('span', 'دقيقة'));
  } catch { return null; }
}
