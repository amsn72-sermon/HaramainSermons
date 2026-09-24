// مكوّنات مشتركة بين شاشات الإدارة والمهام
import { h, countdown, fmtDateTime, fmtDuration, fmtMinutes } from '../ui.js';
import { TRACK_STATUS, stageName, currentStage, trackProgress, hadLateness, isLateNow } from '../store.js';

export function statusBadge(track) {
  const cur = currentStage(track);
  if (track.status === 'in_progress' && cur) {
    return h('span.badge', { class: isLateNow(track) ? 'bad' : 'gold' }, stageName(cur.stage_key));
  }
  const [label, kind] = TRACK_STATUS[track.status] || [track.status, ''];
  return h('span.badge', { class: isLateNow(track) ? 'bad' : kind }, label);
}

// الوقت المعروض للمسار: مهلة الاستلام قبل القبول، ثم وقت المرحلة الحالية
export function trackTimer(track) {
  if (track.status === 'awaiting_receipt') return h('span', h('span.small.muted', 'مهلة الاستلام: '), countdown(track.receipt_due_at));
  if (track.status === 'completed') return h('span.small.muted', 'اكتمل ' + fmtDateTime(track.completed_at));
  const cur = currentStage(track);
  if (!cur) return '—';
  if (cur.outside_sla) return h('span.small.muted', 'خارج وقت التنفيذ');
  return countdown(cur.due_at);
}

export function progressBar(track) {
  const p = trackProgress(track);
  return h('div', { title: `${p.done} من ${p.total} مرحلة` },
    h('div.progress', h('i', { style: { width: p.pct + '%' } })),
    h('span.small.muted', `${p.pct}٪ · ${p.done}/${p.total}`));
}

export function stageStrip(track) {
  return h('div.stages', (track.stages || []).map(s => {
    const late = (s.late_seconds || 0) > 0 || (s.status === 'active' && s.due_at && new Date(s.due_at) < new Date());
    let when;
    if (s.status === 'done') when = s.outside_sla ? 'اعتُمدت' : s.late_seconds > 0 ? `سُلّمت متأخرة ${fmtDuration(s.late_seconds)}` : 'في الوقت';
    else if (s.status === 'active') when = s.outside_sla ? 'بانتظار الاعتماد' : countdown(s.due_at);
    else when = s.outside_sla ? 'خارج وقت التنفيذ' : fmtMinutes(s.planned_minutes);
    return h('div.stage', { class: `${s.status} ${late ? 'late' : ''}` },
      h('b', (s.status === 'done' ? '✓ ' : '') + stageName(s.stage_key)),
      h('span.who', s.assignee?.full_name || '—'),
      h('div.when.small', when),
      s.rounds > 1 && h('span.badge.warn', `أُعيدت ${s.rounds - 1}`));
  }));
}

export function timelineTable(track) {
  return h('div.table-wrap', h('table.responsive',
    h('thead', h('tr', ['المرحلة', 'المسؤول', 'المدة المخططة', 'البدء', 'الموعد', 'الانتهاء', 'التأخير'].map(t => h('th', t)))),
    h('tbody', (track.stages || []).map(s => h('tr',
      h('td', { 'data-label': 'المرحلة' }, stageName(s.stage_key)),
      h('td', { 'data-label': 'المسؤول' }, s.assignee?.full_name || '—'),
      h('td', { 'data-label': 'المدة' }, s.outside_sla ? 'خارج وقت التنفيذ' : fmtMinutes(s.planned_minutes)),
      h('td', { 'data-label': 'البدء' }, fmtDateTime(s.started_at)),
      h('td', { 'data-label': 'الموعد' }, s.status === 'active' && s.due_at ? countdown(s.due_at) : fmtDateTime(s.due_at)),
      h('td', { 'data-label': 'الانتهاء' }, fmtDateTime(s.finished_at)),
      h('td', { 'data-label': 'التأخير' }, s.late_seconds > 0 ? h('span.badge.bad', fmtDuration(s.late_seconds)) : (s.status === 'done' ? h('span.badge.ok', 'لا') : '—'))
    )))));
}

export function lateSummary(track) {
  if (!hadLateness(track)) return null;
  const parts = [];
  if (track.receipt_late_seconds > 0) parts.push(`الاستلام ${fmtDuration(track.receipt_late_seconds)}`);
  for (const s of track.stages || []) if (s.late_seconds > 0) parts.push(`${stageName(s.stage_key)} ${fmtDuration(s.late_seconds)}`);
  return h('span.badge.bad', { title: parts.join('، ') }, 'سُجّل تأخير: ' + parts.join('، '));
}

// ---------------------------------------------------------------------
// الحذف من الأرشيف وقائمة العمل: إخفاء قابل للاسترجاع، لمدير المشروع وحده (ملاحظة ٦٦)
// ---------------------------------------------------------------------
export async function deleteDialog({ material, track, langLabel }) {
  const { h: hh, dialog, toast } = await import('../ui.js');
  const { db } = await import('../sb.js');
  const single = !!track;
  const scope = hh('select', { 'aria-label': 'نطاق الحذف' },
    single ? hh('option', { value: 'track' }, `هذه الترجمة وحدها${langLabel ? ' — ' + langLabel : ''}`) : null,
    hh('option', { value: 'material' }, 'المادة بكل لغاتها'));
  const reason = hh('input', { placeholder: 'مثال: أُدخلت خطأً، أو مكرّرة' });
  const res = await dialog({
    title: `حذف «${material.title}» من الأرشيف`,
    body: hh('div.stack',
      hh('p.small.muted', 'الحذف هنا إخفاء لا محو: تختفي المادة من الأرشيف وقائمة العمل، ويستطيع مدير المشروع استرجاعها من قائمة «المحذوفة». تُسجَّل العملية باسمك ووقتها.'),
      hh('label.field', 'ما الذي يُحذف', scope),
      hh('label.field', 'سبب الحذف', reason)),
    buttons: [
      { label: 'حذف', kind: 'danger', validate: () => {
        if (reason.value.trim().length < 3) { toast('اكتب سبب الحذف.', 'bad'); return false; }
        return true;
      }, value: () => ({ scope: scope.value, reason: reason.value.trim() }) },
      { label: 'إلغاء', value: null }
    ]
  });
  if (!res) return false;
  await db.rpc('set_archive_deleted', {
    p_material: res.scope === 'material' ? material.id : null,
    p_track: res.scope === 'material' ? null : track.id,
    p_deleted: true, p_reason: res.reason
  });
  return true;
}

export async function restoreFromArchive({ material, track }) {
  const { confirm } = await import('../ui.js');
  const { db } = await import('../sb.js');
  if (!await confirm('استرجاع', `تعود «${material.title}» إلى الأرشيف وقائمة العمل. متابعة؟`, 'استرجاع')) return false;
  await db.rpc('set_archive_deleted', {
    p_material: track ? null : material.id, p_track: track ? track.id : null, p_deleted: false, p_reason: null
  });
  return true;
}
