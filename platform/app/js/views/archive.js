// أرشيف أعمال الترجمة: يُدخَل ببطاقات الأنواع كبطاقات المتابعة، ثم بطاقات الخطب
// بأنواعها، ثم قائمة الأعمال — وفي كل مستوى بحثٌ وفلترة وتصدير (ملاحظتا ١٣٧ و١٣٨)
import { h, toast, busy, emptyState, fmtDate, fmtDateTime, fmtSermonDate } from '../ui.js';
import { db, storage } from '../sb.js';
import { state, langName, hadLateness, isManager, MATERIAL_TYPES, SERMON_TYPES } from '../store.js';
import { downloadDocx, printTranslation } from '../export.js';
import { heading, fileName } from '../page.js';
import { exportExcel, exportPdf, exportWord } from '../teamexport.js';
import { reopenDialog } from './revise.js';
import { deleteDialog, restoreFromArchive } from './parts.js';

// أيقونات ثابتة (نص موثوق من الكود وليس من المستخدم)
const ICONS = {
  word: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/><path d="M9 12l1.5 6L12 14l1.5 4L15 12"/>',
  print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/>',
  view: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  pdf: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/><path d="M12 11v7m-3-3 3 3 3-3"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  pause: '<path d="M7 4h4v16H7zM14 4h4v16h-4z"/>',
  audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/><path d="M3 3l0 0"/>',
  dl: '<path d="M12 3v12m-5-5 5 5 5-5"/><path d="M4 21h16"/>',
  log: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  redo: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  undo: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  marks: '<path d="M4 4h16v16H4z"/><path d="M7 9h10M7 13h6"/><path d="M15 17l2 2 4-4"/>'
};
function icon(name) {
  const s = h('span.ico', { 'aria-hidden': 'true' });
  s.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return s;
}
const iconBtn = (name, title, onclick, extra = {}) => h('button.icon-btn', { type: 'button', title, 'aria-label': title, onclick, ...extra }, icon(name));

const TYPE_ICON = { 'خطب': '🕌', 'دروس علمية': '📖', 'كتب': '📚', 'مطويات': '📄',
  'منشورات': '📰', 'إعلانات': '📢', 'توجيهات': '📋' };
const SUB_ICON = '🗒';
const SCOPE_LABEL = { makkah: 'المسجد الحرام', madinah: 'المسجد النبوي', general: 'مادة عامة' };

const two = n => String(n).padStart(2, '0');
const monthOf = v => (v ? String(v).slice(0, 7) : '');
const yearOf = v => (v ? String(v).slice(0, 4) : '');
const todayMonth = () => { const d = new Date(); return `${d.getFullYear()}-${two(d.getMonth() + 1)}`; };

let player = null;          // مشغّل واحد للأرشيف كله
let playingBtn = null;

export async function render(ctx) {
  const fetched = await db.select('tracks', {
    select: 'id,language_code,translation_html,audio_path,completed_at,is_published,receipt_late_seconds,'
      + 'deleted_at,doc_no,doc_no_at,stages:track_stages!track_stages_track_id_fkey'
      + '(stage_key,late_seconds,assignee:profiles(full_name)),material:materials(*,khateeb:khateebs(name))',
    status: 'eq.completed', order: 'completed_at.desc', limit: 1000
  });
  // المحذوف مخفي، ويراه مدير المشروع في قائمة مستقلة ليسترجعه (ملاحظة ٦٦)
  const isDeleted = t => !!(t.deleted_at || t.material?.deleted_at);
  const rows = fetched.filter(t => !isDeleted(t));
  const trashed = fetched.filter(isDeleted);
  let showTrash = false;

  // ----------------------------------------------------------------
  // المستوى الحالي والمرشّحات — محفوظة في العنوان ليُشارَك الرابط
  // ----------------------------------------------------------------
  let level = { type: ctx.query.get('type') || '', sub: ctx.query.get('sub') || '' };
  const q = h('input', { type: 'search', placeholder: 'العنوان أو الخطيب أو اللغة أو رقم التوثيق',
    'aria-label': 'البحث في الأرشيف' });
  const lang = h('select', { 'aria-label': 'اللغة' }, h('option', { value: '' }, 'كل اللغات'),
    state.languages.map(l => h('option', { value: l.code }, l.name_ar)));
  const scope = h('select', { 'aria-label': 'الجهة' }, h('option', { value: '' }, 'كل الجهات'),
    Object.entries(SCOPE_LABEL).map(([k, v]) => h('option', { value: k }, v)));
  const mode = h('select', { 'aria-label': 'المدة' },
    h('option', { value: 'all' }, 'كل المدد'), h('option', { value: 'month' }, 'شهر'),
    h('option', { value: 'year' }, 'سنة'), h('option', { value: 'range' }, 'مدة محددة'));
  const month = h('input', { type: 'month', value: todayMonth(), 'aria-label': 'الشهر' });
  const year = h('input', { type: 'number', min: '2000', max: '2100', step: '1',
    value: String(new Date().getFullYear()), 'aria-label': 'السنة' });
  const from = h('input', { type: 'date', 'aria-label': 'من تاريخ' });
  const to = h('input', { type: 'date', 'aria-label': 'إلى تاريخ' });
  const monthBox = h('label.field', { hidden: true }, 'الشهر', month);
  const yearBox = h('label.field', { hidden: true }, 'السنة', year);
  const fromBox = h('label.field', { hidden: true }, 'من تاريخ', from);
  const toBox = h('label.field', { hidden: true }, 'إلى تاريخ', to);
  const box = h('div');

  const periodOk = t => {
    const d = (t.completed_at || '').slice(0, 10);
    if (!d) return mode.value === 'all';
    if (mode.value === 'month') return monthOf(d) === month.value;
    if (mode.value === 'year') return yearOf(d) === String(year.value);
    if (mode.value === 'range') return (!from.value || d >= from.value) && (!to.value || d <= to.value);
    return true;
  };
  const doneBy = t => [...new Set((t.stages || []).map(s => s.assignee?.full_name).filter(Boolean))];
  const matchText = t => {
    const s = q.value.trim();
    if (!s) return true;
    const hay = [t.material.title, t.material.khateeb?.name, t.material.author, langName(t.language_code),
      t.doc_no, t.material.material_type, t.material.sermon_type, ...doneBy(t)].filter(Boolean).join(' ');
    return hay.toLowerCase().includes(s.toLowerCase());
  };
  const inScope = t => !scope.value || (t.material.mosque || 'general') === scope.value;
  const filtered = () => rows.filter(t => (!lang.value || t.language_code === lang.value)
    && inScope(t) && periodOk(t) && matchText(t));
  // النوع «*» يعني عرض الأعمال كلها في قائمة واحدة بلا تصفّح بالبطاقات
  const inLevel = list => list.filter(t => (!level.type || level.type === '*' || t.material.material_type === level.type)
    && (!level.sub || (t.material.sermon_type || 'غير محدد') === level.sub));

  const periodLabel = () => {
    if (mode.value === 'month' && month.value) {
      const [y, m] = month.value.split('-');
      return `شهر ${new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { month: 'long', year: 'numeric' })
        .format(new Date(Number(y), Number(m) - 1, 1))}`;
    }
    if (mode.value === 'year') return `عام ${year.value}`;
    if (mode.value === 'range') return `من ${from.value || '—'} إلى ${to.value || '—'}`;
    return 'كل المدد';
  };
  const typeLabel = () => (level.type === '*' ? 'كل الأعمال' : level.type);
  const scopeLabel = () => [typeLabel() || 'كل الأنواع', level.sub || null].filter(Boolean).join(' — ');

  // ----------------------------------------------------------------
  // التصدير: كشف الأرشيف بالمدة المختارة — Excel وWord وPDF على الكليشة
  // ----------------------------------------------------------------
  function sheetOf(list) {
    const head = ['م', 'رقم التوثيق', 'نوع العمل', 'النوع الفرعي', 'الجهة', 'العنوان', 'الخطيب أو المؤلف',
      'تاريخ المادة', 'اللغة', 'تاريخ الاعتماد', 'النشر', 'مَن أنجزه'];
    const body = list.map((t, i) => [
      String(i + 1), t.doc_no || '—', t.material.material_type || '—', t.material.sermon_type || '—',
      SCOPE_LABEL[t.material.mosque] || 'مادة عامة', t.material.title || '—',
      t.material.khateeb?.name || t.material.author || '—',
      t.material.sermon_date ? fmtSermonDate(t.material.sermon_date) : '—',
      langName(t.language_code), t.completed_at ? fmtDateTime(t.completed_at) : '—',
      t.is_published ? 'منشورة' : 'غير منشورة', doneBy(t).join('، ') || '—'
    ]);
    // إجماليات التقرير: عدد الأعمال وتوزيعها على الأنواع واللغات
    const count = (key) => {
      const m = new Map();
      for (const t of list) { const k = key(t) || '—'; m.set(k, (m.get(k) || 0) + 1); }
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(' · ');
    };
    return [head, ...body,
      ['', '', '', '', '', '', '', '', '', '', '', ''],
      ['الإجمالي', `${list.length} عملًا`, 'التوزيع على الأنواع',
        count(t => t.material.sermon_type || t.material.material_type), '', '',
        'التوزيع على اللغات', count(t => langName(t.language_code)), '', '', '', '']];
  }
  function exportRow(list) {
    const title = `أرشيف أعمال الترجمة — ${scopeLabel()}`;
    const note = `${list.length} عملًا — ${periodLabel()} — أُصدر في ${fmtDate(new Date())}`;
    const wordBtn = h('button.btn.sm', { type: 'button' }, 'تصدير Word');
    wordBtn.onclick = () => busy(wordBtn, () => exportWord(sheetOf(list), title, { note })
      .catch(e => toast(e.message, 'bad')));
    return h('div.row.wrap.arch-exports',
      h('span.small.muted', `${list.length} عملًا — ${periodLabel()}`),
      h('button.btn.sm', { type: 'button', onclick: () => exportExcel(sheetOf(list), title) }, 'تصدير Excel'),
      wordBtn,
      h('button.btn.sm', { type: 'button',
        onclick: () => { if (!exportPdf(sheetOf(list), title, { note })) toast('اسمح بالنوافذ المنبثقة للتصدير', 'bad'); } },
        'تصدير PDF'));
  }

  // ----------------------------------------------------------------
  // تشغيل التسجيل وتنزيله
  // ----------------------------------------------------------------
  function play(btn, t) {
    if (!player) player = new Audio();
    if (playingBtn === btn && !player.paused) { player.pause(); return; }
    if (playingBtn) playingBtn.replaceChildren(icon('play'));
    player.src = storage.publicUrl('audio', t.audio_path);
    // استكمال مدة التسجيلات القديمة لتُحسب في دليل الإنتاج (ملاحظة ٩٠)
    player.onloadedmetadata = () => {
      const sec = Number.isFinite(player.duration) ? Math.round(player.duration) : 0;
      if (sec > 0) db.rpc('set_audio_duration', { p_track: t.id, p_path: t.audio_path, p_seconds: sec }).catch(() => {});
    };
    player.play().catch(err => toast(err.message, 'bad'));
    playingBtn = btn; btn.replaceChildren(icon('pause'));
    player.onpause = player.onended = () => { btn.replaceChildren(icon('play')); };
    player.onplay = () => { btn.replaceChildren(icon('pause')); };
  }
  async function downloadAudio(t, name) {
    const res = await fetch(storage.publicUrl('audio', t.audio_path));
    if (!res.ok) throw new Error('تعذّر تنزيل التسجيل');
    const blob = await res.blob();
    const ext = (t.audio_path.split('.').pop() || 'mp3').toLowerCase();
    const a = h('a', { href: URL.createObjectURL(blob), download: `${name}.${ext}` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ----------------------------------------------------------------
  // سطر العمل في القائمة
  // ----------------------------------------------------------------
  const rowEl = (t, n) => {
    const khateeb = t.material.khateeb?.name;
    const args = { material: t.material, track: t, khateeb };
    const name = fileName(t.material, t.language_code, khateeb, null, t.doc_no);
    const late = hadLateness(t);
    return h('li.arch-row', { title: name },
      h('span.arch-n', String(n).padStart(3, '0')),
      h('span.arch-name',
        h('b', `${heading(t.material)} (${t.material.title})`),
        h('span.muted', [khateeb, t.material.sermon_date && fmtSermonDate(t.material.sermon_date), langName(t.language_code)].filter(Boolean).join('، ')),
        t.doc_no ? h('span.doc-no', { dir: 'ltr', title: 'رقم التوثيق' }, t.doc_no) : null),
      h('span.arch-meta.small.muted', fmtDateTime(t.completed_at)),
      h('span.arch-badges',
        h('span.badge', { class: t.is_published ? 'ok' : '' }, t.is_published ? 'منشورة' : 'غير منشورة'),
        late && h('span.badge.bad', 'تأخير')),
      h('span.arch-actions',
        iconBtn('word', 'تصدير Word على الكليشة', e => busy(e.currentTarget, () => downloadDocx(args).catch(err => toast(err.message, 'bad')))),
        iconBtn('print', 'طباعة', () => printTranslation(args) || toast('اسمح بالنوافذ المنبثقة.', 'bad')),
        iconBtn('view', 'استعراض PDF', () => printTranslation(args, { autoPrint: false }) || toast('اسمح بالنوافذ المنبثقة.', 'bad')),
        iconBtn('pdf', 'تنزيل PDF (اختر «حفظ كـ PDF»)', () => printTranslation(args) || toast('اسمح بالنوافذ المنبثقة.', 'bad')),
        t.audio_path ? iconBtn('play', 'تشغيل التسجيل', e => play(e.currentTarget, t)) : h('span.icon-btn.off', { title: 'لا تسجيل' }, icon('audio')),
        t.audio_path ? iconBtn('dl', 'تنزيل التسجيل', e => busy(e.currentTarget, () => downloadAudio(t, name).catch(err => toast(err.message, 'bad'))))
          : h('span.icon-btn.off', { 'aria-hidden': 'true' }, icon('dl')),
        t.material.source_pdf_path
          ? h('a.icon-btn', { href: `/app/revise/${t.material.id}`, title: 'التحديدات على الأصل',
              'aria-label': 'التحديدات على الأصل' }, icon('marks'))
          : null,
        iconBtn('redo', 'إعادة تنشيط الخطبة للتعديل على أصلها', e => busy(e.currentTarget,
          () => reopenDialog(t.material, m => { if (m === 'annotate') ctx.navigate(`/app/revise/${t.material.id}`); else ctx.navigate('/app/archive', { replace: true }); }))
          .catch(err => toast(err.message, 'bad'))),
        h('a.icon-btn', { href: `/app/tasks/${t.id}`, title: 'السجل والتفاصيل', 'aria-label': 'السجل والتفاصيل' }, icon('log')),
        isManager() && iconBtn('trash', 'حذف من الأرشيف (إخفاء قابل للاسترجاع)', e => busy(e.currentTarget, async () => {
          try {
            if (await deleteDialog({ material: t.material, track: t, langLabel: langName(t.language_code) })) {
              toast('حُذفت من الأرشيف، ويمكن استرجاعها.', 'ok'); ctx.navigate('/app/archive', { replace: true });
            }
          } catch (err) { toast(err.message, 'bad'); }
        }), { class: 'danger' })));
  };

  const trashRow = t => h('li.arch-row.is-trashed', { title: fileName(t.material, t.language_code, t.material.khateeb?.name) },
    h('span.arch-n', '—'),
    h('span.arch-name', h('b', `${heading(t.material)} (${t.material.title})`),
      h('span.muted', [t.material.khateeb?.name, langName(t.language_code)].filter(Boolean).join('، '))),
    h('span.arch-meta.small.muted', 'حُذفت ' + fmtDateTime(t.deleted_at || t.material.deleted_at)),
    h('span.arch-badges', h('span.badge.bad', 'محذوفة')),
    h('span.arch-actions',
      iconBtn('undo', 'استرجاع إلى الأرشيف', e => busy(e.currentTarget, async () => {
        try {
          if (await restoreFromArchive({ material: t.material, track: t.deleted_at ? t : null })) {
            toast('استُرجعت.', 'ok'); ctx.navigate('/app/archive', { replace: true });
          }
        } catch (err) { toast(err.message, 'bad'); }
      }))));

  // ----------------------------------------------------------------
  // البطاقات: نوعُ عملٍ في كل بطاقة، وفيها عدده وآخر عمل ولغاته
  // ----------------------------------------------------------------
  function tile({ key, label, emoji, items, onclick }) {
    const langs = new Set(items.map(t => t.language_code));
    const last = items.map(t => t.completed_at).filter(Boolean).sort().at(-1);
    return h('button.kpi.arch-tile', { type: 'button', key, onclick,
      'aria-label': `${label}: ${items.length} عملًا` },
      h('span.arch-tile-emoji', { 'aria-hidden': 'true' }, emoji),
      h('b', String(items.length)),
      h('span', label),
      h('span.small.muted', `${langs.size} لغة`, last ? ` · آخرها ${fmtDate(last)}` : ''));
  }

  const go = (type, sub) => {
    level = { type: type || '', sub: sub || '' };
    const qs = new URLSearchParams();
    if (level.type) qs.set('type', level.type);
    if (level.sub) qs.set('sub', level.sub);
    history.replaceState(null, '', '/app/archive' + (qs.toString() ? `?${qs}` : ''));
    draw();
    window.scrollTo(0, 0);
  };

  function crumbs() {
    if (!level.type) return null;
    return h('nav.arch-crumbs', { 'aria-label': 'المسار' },
      h('button.btn.xs', { type: 'button', onclick: () => go('', '') }, '↩ كل الأنواع'),
      h('span.muted', '›'),
      level.sub
        ? h('button.btn.xs', { type: 'button', onclick: () => go(level.type, '') }, typeLabel())
        : h('b', typeLabel()),
      level.sub ? h('span.muted', '›') : null,
      level.sub ? h('b', level.sub) : null);
  }

  function draw() {
    const base = filtered();
    const list = inLevel(base);

    const groupBy = (items, key) => {
      const m = new Map();
      for (const t of items) { const k = key(t); if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
      return m;
    };

    let view;
    if (!level.type) {
      // المستوى الأول: بطاقة لكل نوع عمل
      const byType = groupBy(base, t => t.material.material_type || 'أخرى');
      const order = [...MATERIAL_TYPES, 'أخرى'];
      const tiles = order.filter(k => byType.has(k)).map(k => tile({
        key: k, label: k, emoji: TYPE_ICON[k] || '📁', items: byType.get(k),
        onclick: () => go(k, '')
      }));
      // بطاقة تجمع الأعمال كلها في قائمة واحدة لمن أراد الكشف مباشرة
      if (tiles.length) tiles.push(tile({ key: '*', label: 'كل الأعمال', emoji: '🗂',
        items: base, onclick: () => go('*', '') }));
      view = tiles.length
        ? h('div.stack', h('div.kpis.arch-tiles', tiles),
            h('p.small.muted', 'اختر نوع العمل لتصفّحه، أو صدّر كشف المدة كاملة من الأزرار أعلاه.'))
        : emptyState(rows.length ? 'لا نتائج مطابقة' : 'لا توجد ترجمات مكتملة بعد',
            rows.length ? 'وسّع المدة أو امسح البحث.' : 'تظهر الترجمة هنا بعد اكتمال مسارها.');
    } else if (level.type === 'خطب' && !level.sub) {
      // المستوى الثاني للخطب: بطاقة لكل نوع خطبة
      const bySub = groupBy(list, t => t.material.sermon_type || 'غير محدد');
      const order = [...SERMON_TYPES, 'غير محدد'];
      const keys = [...new Set([...order.filter(k => bySub.has(k)), ...bySub.keys()])];
      const tiles = keys.map(k => tile({
        key: k, label: k, emoji: SUB_ICON, items: bySub.get(k) || [],
        onclick: () => go('خطب', k)
      }));
      view = tiles.length
        ? h('div.stack', h('div.kpis.arch-tiles', tiles))
        : emptyState('لا خطب في هذه المدة', 'وسّع المدة أو امسح البحث.');
    } else {
      view = list.length
        ? h('ol.archive', list.map((t, i) => rowEl(t, list.length - i)))
        : emptyState('لا نتائج مطابقة', 'وسّع المدة أو امسح البحث.');
    }

    box.replaceChildren(h('div.stack', crumbs(), exportRow(list), view));

    if (isManager() && trashed.length && !level.type) {
      const trashBtn = h('button.btn.sm', { type: 'button',
        onclick: () => { showTrash = !showTrash; draw(); } },
        showTrash ? `إخفاء المحذوفة (${trashed.length})` : `عرض المحذوفة (${trashed.length})`);
      box.append(h('section.arch-group', { style: { marginTop: '26px' } },
        h('div.arch-group-head', h('h3', 'المحذوفة'), trashBtn),
        showTrash ? h('ol.archive', trashed.map(trashRow)) : h('p.small.muted', 'مخفية عن الأرشيف، وتُسترجع بضغطة.')));
    }
  }

  const syncPeriod = () => {
    monthBox.hidden = mode.value !== 'month';
    yearBox.hidden = mode.value !== 'year';
    fromBox.hidden = toBox.hidden = mode.value !== 'range';
  };
  [q, lang, scope, month, year, from, to].forEach(el => el.addEventListener('input', draw));
  mode.addEventListener('change', () => { syncPeriod(); draw(); });
  syncPeriod();
  draw();

  return h('div',
    h('div.page-head', h('div.grow', h('div.eyebrow', 'الأرشيف'), h('h1', 'أرشيف أعمال الترجمة'),
      h('p.muted', 'كل عمل مكتمل برقم توثيقه، مرتَّبًا بأنواعه — تصفّحٌ بالبطاقات، وكشفٌ يُطبع ويُسلَّم.')),
      h('span.badge.gold', `${rows.length} ترجمة نهائية`)),
    h('div.grid.arch-filters', { style: { marginBottom: '16px' } },
      h('label.field', 'البحث', q), h('label.field', 'اللغة', lang),
      h('label.field', 'الجهة', scope), h('label.field', 'المدة', mode),
      monthBox, yearBox, fromBox, toBox),
    box);
}
