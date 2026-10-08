// صفحةُ خطةٍ تدريبية: بابٌ قائمٌ بنفسه (ملاحظات ٣٦٠–٣٦٣)
//
//   كانت مكتبةُ الموادِّ واحدةً للخطط كلِّها، وسجلُّ التأهيل كذلك، فإذا
//   كثرت الخططُ اختلطت موادُّها. فصارت الخطةُ تُفتَح صفحةً: وحداتُها
//   ومستهدَفوها وقاعتُها، ثم مكتبةُ موادِّها وسجلُّ تأهيلها — وما يُضاف
//   هنا يُضاف فيها لا في مكتبةٍ عامّة.
import { h, fill, toast, busy, dialog, confirm, emptyState, fmtDate } from '../ui.js';
import { db } from '../sb.js';
import { state, isAdmin } from '../store.js';
import { LEVEL, STATUS, KIND, TARGET_GROUPS, mayTrain, planDialog,
         uploadDialog, shareDialog, viewMaterial, downloadMaterial,
         enrollDialog } from './training.js';

const AR = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn');

export async function render(ctx) {
  const id = ctx?.params?.id;
  if (!id) return h('p.muted', 'لم تُحدَّد الخطة.');

  let p = {};
  const loadPlan = async () => {
    try {
      const r = await db.rpc('training_plan', { p_id: id });
      p = (Array.isArray(r) ? r[0] : r) || {};
    } catch (e) { p = { _err: e.message }; }
  };
  await loadPlan();
  if (p._err) return h('p.small.bad', p._err);
  if (!p.id) return h('p.muted', 'لم تُوجد الخطة.');

  const admin = mayTrain();
  const head = h('div.stack');
  const matBox = h('div.stack');
  const recBox = h('div.stack');

  // -------------------------------------------------------------------
  // بطاقةُ الخطة: وحداتُها ومستهدَفوها وقاعتُها
  // -------------------------------------------------------------------
  function drawHead() {
    const tg = (p.targets && typeof p.targets === 'object') ? p.targets : {};
    const gs = (Array.isArray(tg.groups) ? tg.groups : [])
      .map(k => TARGET_GROUPS[k]).filter(Boolean);
    const names = Array.isArray(p.target_names) ? p.target_names : [];
    const units = Array.isArray(p.units) ? p.units : [];
    fill(head,
      h('section.card.stack.plan-head',
        h('div.row.between.wrap',
          h('div.grow',
            h('b', 'عن الخطة'),
            p.goal ? h('p.small', p.goal) : h('p.small.muted', 'لا هدفَ مكتوب.'),
            h('p.small.muted', [LEVEL[p.level], p.audience,
              p.hours ? `${AR(p.hours)} ساعة` : null,
              `${AR(units.length)} وحدة`].filter(Boolean).join(' · '))),
          admin
            ? h('div.row', { style: { gap: '6px' } },
                h('button.btn.sm', { type: 'button', onclick: async () => {
                  if (await planDialog({ ...p, units })) { await loadPlan(); drawHead(); }
                } }, '✎ حرِّرِ الخطة'),
                h('button.btn.sm.ghost', { type: 'button', onclick: enrollTargets },
                  '⇪ ألحِقِ المستهدَفين'))
            : null),
        units.length
          ? h('ol.ab-chips', units.map((u, i) =>
              h('li', h('span.ab-chip-num', String(i + 1)),
                u.title,
                u.hours ? h('span.sub', `${AR(u.hours)} ساعة`) : null,
                u.outline ? h('span.sub', u.outline) : null)))
          : h('p.small.muted', 'لا وحداتَ بعد — حرِّرِ الخطةَ لتضيفَها.'),
        h('div.row.wrap', { style: { gap: '8px' } },
          h('div.grow',
            h('b.small', 'المستهدَفون'),
            (gs.length || names.length)
              ? h('div.chips',
                  ...gs.map(g => h('span.badge.ok', g)),
                  ...names.map(n => h('span.badge', n.name)))
              : h('p.small.muted', 'لم يُحدَّدوا بعد.')),
          h('div.grow',
            h('b.small', 'قاعةُ الخطة'),
            p.room_id
              ? h('div.row.wrap', { style: { gap: '6px' } },
                  h('span.badge.ok', p.room_name || 'قاعة'),
                  h('a.btn.xs', { href: `/app/meet/room/${p.room_id}` }, 'ادخلِ القاعة'),
                  admin ? h('a.btn.xs.ghost', { href: '/app/rooms' }, 'إعداداتُها') : null)
              : h('p.small.muted', 'تُنشَأ قاعتُها تلقائيًّا عند حفظ الخطة.')))));
  }

  async function enrollTargets() {
    const tg = (p.targets && typeof p.targets === 'object') ? p.targets : {};
    const gs = (Array.isArray(tg.groups) ? tg.groups : []).length;
    const ms = (Array.isArray(tg.members) ? tg.members : []).length;
    if (!gs && !ms) return toast('حدِّدِ المستهدَفين أوّلًا من تحرير الخطة.', 'warn');
    if (!await confirm('إلحاقُ المستهدَفين',
      'يُلحَق مستهدَفو الخطة بها دفعةً واحدة، ومن كان ملتحقًا يبقى على حاله.',
      'ألحِقْهم')) return;
    try {
      const n = await db.rpc('enroll_plan_targets', { p_plan: id });
      toast(`أُلحق ${AR(n || 0)}.`, 'ok');
      drawRec();
    } catch (e) { toast(e.message, 'bad'); }
  }

  // -------------------------------------------------------------------
  // مكتبةُ موادِّ هذه الخطة — ما يُضاف هنا يُضاف فيها (ملاحظة ٣٦٠)
  // -------------------------------------------------------------------
  async function drawMats() {
    fill(matBox, h('p.muted', 'يُحمَّل…'));
    let mats = [];
    try { mats = await db.rpc('training_plan_materials', { p_plan: id }) || []; }
    catch (e) { return fill(matBox, h('p.small.warn', e.message)); }
    fill(matBox, mats.length
      ? h('div.table-wrap', h('table.responsive',
          h('thead', h('tr', ['المادة', 'النوع', 'المشاركات', ''].map(t => h('th', t)))),
          h('tbody', mats.map(m => h('tr',
            h('td', { 'data-label': 'المادة' }, h('b', m.title),
              m.note ? h('span.sub', m.note) : null),
            h('td', { 'data-label': 'النوع' }, KIND[m.kind] || 'ملف'),
            h('td', { 'data-label': 'المشاركات' }, Number(m.shares)
              ? h('span', AR(m.shares),
                  Number(m.dl_shares)
                    ? h('span.sub', `${AR(m.dl_shares)} بالتنزيل`)
                    : h('span.sub', 'مشاهدةً فقط'))
              : h('span.muted', 'لم تُشارَك')),
            h('td', h('div.row',
              h('button.btn.xs', { type: 'button',
                onclick: () => viewMaterial(m, false) }, 'افتح'),
              h('button.btn.xs.ghost', { type: 'button',
                onclick: () => downloadMaterial(m) }, '⤓ نزِّلْ موسومةً'),
              admin ? h('button.btn.xs', { type: 'button', onclick: async () => {
                if (await shareDialog(m)) drawMats();
              } }, 'شارِك') : null,
              isAdmin() ? h('button.btn.xs.ghost', { type: 'button', onclick: async () => {
                if (!await confirm(`حذفُ «${m.title}»؟`)) return;
                try { await db.rpc('delete_training_material', { p_id: m.id }); drawMats(); }
                catch (e) { toast(e.message, 'bad'); }
              } }, 'احذف') : null)))))))
      : emptyState('لا موادَّ في هذه الخطة',
          'ارفعْ مادةً فتُضاف إلى هذه الخطة وحدَها.'));
  }

  // -------------------------------------------------------------------
  // سجلُّ تأهيلِ هذه الخطة (ملاحظة ٣٦١)
  // -------------------------------------------------------------------
  async function drawRec() {
    fill(recBox, h('p.muted', 'يُحمَّل…'));
    let rows = [];
    try { rows = await db.rpc('training_plan_record', { p_plan: id }) || []; }
    catch (e) { return fill(recBox, h('p.small.warn', e.message)); }
    fill(recBox, rows.length
      ? h('div.table-wrap', h('table.responsive',
          h('thead', h('tr', ['العضو', 'المدرِّب', 'الحال', 'من', 'إلى', ''].map(t => h('th', t)))),
          h('tbody', rows.map(r => h('tr',
            h('td', { 'data-label': 'العضو' }, r.full_name),
            h('td', { 'data-label': 'المدرِّب' }, r.trainer_name || '—'),
            h('td', { 'data-label': 'الحال' }, r.status === 'done'
              ? h('span.badge.ok', STATUS[r.status])
              : h('span.badge', STATUS[r.status] || r.status)),
            h('td', { 'data-label': 'من' }, r.started_at ? fmtDate(r.started_at) : '—'),
            h('td', { 'data-label': 'إلى' }, r.done_at ? fmtDate(r.done_at) : '—'),
            h('td', admin ? h('button.btn.xs', { type: 'button', onclick: async () => {
              if (await enrollDialog(r)) drawRec();
            } }, 'حرّر') : null))))))
      : emptyState('لا ملتحقين بعد',
          'ألحِقِ المستهدَفين دفعةً واحدة، أو أضِفْ التحاقًا فردًا.'));
  }

  drawHead();
  await Promise.all([drawMats(), drawRec()]);

  const upBtn = admin
    ? h('button.btn.sm.primary', { type: 'button' }, '＋ ارفعْ مادةً للخطة')
    : null;
  if (upBtn) {
    upBtn.onclick = () => busy(upBtn, async () => {
      const rooms = p.room_id ? [{ id: p.room_id, name: p.room_name || 'قاعة الخطة' }] : [];
      if (await uploadDialog([{ id: p.id, title: p.title }], rooms,
        { plan_id: p.id, room_id: p.room_id || null })) drawMats();
    });
  }
  const enrBtn = admin
    ? h('button.btn.sm', { type: 'button' }, '＋ التحاقٌ فردي')
    : null;
  if (enrBtn) {
    enrBtn.onclick = async () => {
      if (await enrollDialog(null, { plan_id: p.id })) drawRec();
    };
  }

  return h('div',
    h('div.page-head',
      h('div.row.wrap', { style: { marginInlineStart: 'auto', order: 2 } },
        upBtn, enrBtn,
        h('a.btn.sm.ghost', { href: '/app/training' }, '← كلُّ الخطط')),
      h('div.grow',
        h('div.eyebrow', 'التدريب'),
        h('h1', p.title || 'خطةُ تدريب'),
        h('p.muted', 'وحداتُها ومستهدَفوها وقاعتُها، ومكتبةُ موادِّها وسجلُّ تأهيلها — '
          + 'كلُّها في هذه الصفحة.'))),
    head,
    h('section.card.stack',
      h('div.row.between', h('h3', 'مكتبةُ موادِّ الخطة'),
        h('span.small.muted', 'ما يُرفَع هنا يُضاف إلى هذه الخطة وحدَها')),
      h('p.small.muted', 'ولكلِّ مشاركةٍ مفتاحُها: يُتاح التنزيلُ أو تكون للمشاهدة فقط. '
        + 'والمنزَّلُ يخرج موسومًا ببريد مَن نزَّله ووقتِ تنزيله.'),
      matBox),
    h('section.card.stack',
      h('div.row.between', h('h3', 'سجلُّ تأهيل الخطة'),
        h('span.small.muted', 'من التحق بها وما أتمَّه ومن درّبه')),
      recBox));
}

export default render;
