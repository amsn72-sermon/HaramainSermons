// أرشيف أعمال الترجمة: كل مادة في سطر واحد، مرقّمة، بأسماء ملفات واضحة واختصارات بالأيقونات
import { h, toast, busy, emptyState, fmtDateTime, fmtSermonDate } from '../ui.js';
import { db, storage } from '../sb.js';
import { state, langName, hadLateness } from '../store.js';
import { downloadDocx, printTranslation } from '../export.js';
import { heading, fileName } from '../page.js';

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
  log: '<path d="M4 6h16M4 12h16M4 18h10"/>'
};
function icon(name) {
  const s = h('span.ico', { 'aria-hidden': 'true' });
  s.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return s;
}
const iconBtn = (name, title, onclick, extra = {}) => h('button.icon-btn', { type: 'button', title, 'aria-label': title, onclick, ...extra }, icon(name));

let player = null;          // مشغّل واحد للأرشيف كله
let playingBtn = null;

export async function render() {
  const rows = await db.select('tracks', {
    select: 'id,language_code,translation_html,audio_path,completed_at,is_published,receipt_late_seconds,stages:track_stages!track_stages_track_id_fkey(stage_key,late_seconds),material:materials(*,khateeb:khateebs(name))',
    status: 'eq.completed', order: 'completed_at.desc', limit: 500
  });
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

  function draw() {
    const s = q.value.trim();
    const list = rows.filter(t => (!lang.value || t.language_code === lang.value) &&
      (!s || t.material.title.includes(s) || langName(t.language_code).includes(s) || (t.material.khateeb?.name || '').includes(s)));
    box.replaceChildren(list.length ? h('ol.archive', list.map((t, i) => {
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
          h('a.icon-btn', { href: `/app/tasks/${t.id}`, title: 'السجل والتفاصيل', 'aria-label': 'السجل والتفاصيل' }, icon('log'))));
    }))
      : emptyState(rows.length ? 'لا نتائج مطابقة' : 'لا توجد ترجمات مكتملة بعد', rows.length ? '' : 'تظهر الترجمة هنا بعد اكتمال مسارها.'));
  }
  [q, lang].forEach(el => el.addEventListener('input', draw));
  draw();

  return h('div',
    h('div.page-head', h('div.grow', h('div.eyebrow', 'الأرشيف'), h('h1', 'أرشيف أعمال الترجمة')), h('span.badge.gold', `${rows.length} ترجمة نهائية`)),
    h('div.grid', { style: { marginBottom: '16px' } }, h('label.field', 'البحث', q), h('label.field', 'اللغة', lang)),
    box);
}
