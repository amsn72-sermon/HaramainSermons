// أرشيف أعمال الترجمة: كل مادة في سطر واحد، مرقّمة، بأسماء ملفات واضحة واختصارات بالأيقونات
import { h, toast, busy, emptyState, fmtDateTime, fmtSermonDate } from '../ui.js';
import { db, storage } from '../sb.js';
import { state, langName, hadLateness, isManager, MOSQUE } from '../store.js';
import { downloadDocx, printTranslation } from '../export.js';
import { heading, fileName } from '../page.js';
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

let player = null;          // مشغّل واحد للأرشيف كله
let playingBtn = null;

export async function render(ctx) {
  const fetched = await db.select('tracks', {
    select: 'id,language_code,translation_html,audio_path,completed_at,is_published,receipt_late_seconds,deleted_at,stages:track_stages!track_stages_track_id_fkey(stage_key,late_seconds),material:materials(*,khateeb:khateebs(name))',
    status: 'eq.completed', order: 'completed_at.desc', limit: 500
  });
  // المحذوف مخفي، ويراه مدير المشروع في قائمة مستقلة ليسترجعه (ملاحظة ٦٦)
  const isDeleted = t => !!(t.deleted_at || t.material?.deleted_at);
  const rows = fetched.filter(t => !isDeleted(t));
  const trashed = fetched.filter(isDeleted);
  let showTrash = false;
  const trashBtn = h('button.btn.sm', { type: 'button', onclick: () => { showTrash = !showTrash; draw(); } });
  const q = h('input', { type: 'search', placeholder: 'العنوان أو الخطيب أو اللغة', 'aria-label': 'البحث في الأرشيف' });
  const lang = h('select', { 'aria-label': 'اللغة' }, h('option', { value: '' }, 'كل اللغات'), state.languages.map(l => h('option', { value: l.code }, l.name_ar)));
  const box = h('div');

  function play(btn, t) {
    if (!player) player = new Audio();
    if (playingBtn === btn && !player.paused) { player.pause(); return; }
    if (playingBtn) playingBtn.replaceChildren(icon('play'));
    player.src = storage.publicUrl('audio', t.audio_path);
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

  // تقسيم الأرشيف حسب نوع المادة، والخطب حسب المسجد. لا يُعرض قسم بلا مواد (ملاحظة ٥٩)
  const groupKey = t => {
    const m = t.material;
    if (m.material_type === 'خطب') return `خطب:${m.mosque}`;
    return `نوع:${m.material_type || 'أخرى'}`;
  };
  const groupLabel = key => key.startsWith('خطب:')
    ? `خطب ${MOSQUE[key.slice(4)] || ''}`.trim()
    : key.slice(4);
  const GROUP_ORDER = ['خطب:makkah', 'خطب:madinah', 'نوع:دروس علمية', 'نوع:كتب', 'نوع:مطويات',
    'نوع:منشورات', 'نوع:إعلانات', 'نوع:توجيهات'];
  const groupRank = key => { const i = GROUP_ORDER.indexOf(key); return i === -1 ? GROUP_ORDER.length : i; };

  function draw() {
    const s = q.value.trim();
    const list = rows.filter(t => (!lang.value || t.language_code === lang.value) &&
      (!s || t.material.title.includes(s) || langName(t.language_code).includes(s) || (t.material.khateeb?.name || '').includes(s)));

    const groups = new Map();
    for (const t of list) {
      const k = groupKey(t);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
    const ordered = [...groups.entries()].sort((a, b) => groupRank(a[0]) - groupRank(b[0]) || a[0].localeCompare(b[0], 'ar'));

    const rowEl = t => {
      const khateeb = t.material.khateeb?.name;
      const args = { material: t.material, track: t, khateeb };
      const name = fileName(t.material, t.language_code, khateeb);
      const n = rows.length - rows.indexOf(t);            // رقم ثابت حسب ترتيب الاكتمال
      const late = hadLateness(t);
      return h('li.arch-row', { title: name },
        h('span.arch-n', String(n).padStart(3, '0')),
        h('span.arch-name',
          h('b', `${heading(t.material)} (${t.material.title})`),
          h('span.muted', [khateeb, t.material.sermon_date && fmtSermonDate(t.material.sermon_date), langName(t.language_code)].filter(Boolean).join('، '))),
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
            () => reopenDialog(t.material, mode => { if (mode === 'annotate') ctx.navigate(`/app/revise/${t.material.id}`); else ctx.navigate('/app/archive', { replace: true }); }))
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

    box.replaceChildren(ordered.length
      ? h('div.stack', ordered.map(([key, items]) => h('section.arch-group',
          h('div.arch-group-head', h('h3', groupLabel(key)), h('span.badge.gold', `${items.length}`)),
          h('ol.archive', items.map(rowEl)))))
      : emptyState(rows.length ? 'لا نتائج مطابقة' : 'لا توجد ترجمات مكتملة بعد', rows.length ? '' : 'تظهر الترجمة هنا بعد اكتمال مسارها.'));

    if (isManager() && trashed.length) {
      trashBtn.textContent = showTrash ? `إخفاء المحذوفة (${trashed.length})` : `عرض المحذوفة (${trashed.length})`;
      box.append(h('section.arch-group', { style: { marginTop: '26px' } },
        h('div.arch-group-head', h('h3', 'المحذوفة'), trashBtn),
        showTrash ? h('ol.archive', trashed.map(trashRow)) : h('p.small.muted', 'مخفية عن الأرشيف، وتُسترجع بضغطة.')));
    }
  }
  [q, lang].forEach(el => el.addEventListener('input', draw));
  draw();

  return h('div',
    h('div.page-head', h('div.grow', h('div.eyebrow', 'الأرشيف'), h('h1', 'أرشيف أعمال الترجمة')), h('span.badge.gold', `${rows.length} ترجمة نهائية`)),
    h('div.grid', { style: { marginBottom: '16px' } }, h('label.field', 'البحث', q), h('label.field', 'اللغة', lang)),
    box);
}
