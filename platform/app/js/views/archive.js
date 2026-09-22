// أرشيف الترجمات المكتملة
import { h, toast, busy, emptyState, fmtDateTime, fmtSermonDate } from '../ui.js';
import { db, storage } from '../sb.js';
import { state, MOSQUE, langName, hadLateness } from '../store.js';
import { downloadDocx, printTranslation } from '../export.js';
import { lateSummary } from './parts.js';

export async function render() {
  const rows = await db.select('tracks', {
    select: 'id,language_code,translation_html,audio_path,completed_at,is_published,receipt_late_seconds,stages:track_stages!track_stages_track_id_fkey(stage_key,late_seconds),material:materials(*,khateeb:khateebs(name))',
    status: 'eq.completed', order: 'completed_at.desc', limit: 500
  });
  const q = h('input', { type: 'search', placeholder: 'عنوان الخطبة أو اللغة أو الخطيب', 'aria-label': 'البحث في الأرشيف' });
  const lang = h('select', { 'aria-label': 'اللغة' }, h('option', { value: '' }, 'كل اللغات'), state.languages.map(l => h('option', { value: l.code }, l.name_ar)));
  const box = h('div');

  function draw() {
    const s = q.value.trim();
    const list = rows.filter(t => (!lang.value || t.language_code === lang.value) &&
      (!s || t.material.title.includes(s) || langName(t.language_code).includes(s) || (t.material.khateeb?.name || '').includes(s)));
    box.replaceChildren(list.length ? h('div.table-wrap', h('table.responsive',
      h('thead', h('tr', ['المادة', 'الموقع والخطيب', 'اللغة', 'اكتمل', 'الملفات', 'النشر'].map(x => h('th', x)))),
      h('tbody', list.map(t => {
        const args = { material: t.material, track: t, khateeb: t.material.khateeb?.name };
        return h('tr',
          h('td', { 'data-label': 'المادة' }, h('b', t.material.title), h('span.sub', t.material.sermon_type || t.material.material_type),
            t.material.sermon_date && h('span.sub', fmtSermonDate(t.material.sermon_date)), hadLateness(t) ? lateSummary(t) : null),
          h('td', { 'data-label': 'الموقع' }, MOSQUE[t.material.mosque], h('span.sub', t.material.khateeb?.name || '')),
          h('td', { 'data-label': 'اللغة' }, langName(t.language_code)),
          h('td', { 'data-label': 'اكتمل' }, fmtDateTime(t.completed_at)),
          h('td', { 'data-label': 'الملفات' }, h('div.row',
            h('button.btn.sm', { onclick: e => busy(e.currentTarget, () => downloadDocx(args).catch(err => toast(err.message, 'bad'))) }, 'Word'),
            h('button.btn.sm', { onclick: () => printTranslation(args) || toast('اسمح بالنوافذ المنبثقة.', 'bad') }, 'PDF'),
            t.audio_path && h('a.btn.sm', { href: storage.publicUrl('audio', t.audio_path), target: '_blank', rel: 'noopener' }, 'الصوت'),
            h('a.btn.sm.ghost', { href: `/app/tasks/${t.id}` }, 'السجل'))),
          h('td', { 'data-label': 'النشر' }, h('span.badge', { class: t.is_published ? 'ok' : '' }, t.is_published ? 'منشورة' : 'غير منشورة')));
      }))))
      : emptyState(rows.length ? 'لا نتائج مطابقة' : 'لا توجد ترجمات مكتملة بعد', rows.length ? '' : 'تظهر الترجمة هنا بعد اكتمال مسارها.'));
  }
  [q, lang].forEach(el => el.addEventListener('input', draw));
  draw();

  return h('div',
    h('div.page-head', h('div.grow', h('div.eyebrow', 'الأرشيف'), h('h1', 'أرشيف أعمال الترجمة')), h('span.badge.gold', `${rows.length} ترجمة نهائية`)),
    h('div.grid', { style: { marginBottom: '16px' } }, h('label.field', 'البحث', q), h('label.field', 'اللغة', lang)),
    box);
}
