// الإجازةُ وتأمينُ البديل (ملاحظتا ١١ و١٢ من دفعة ٥٠٢)
//
//   للعضو: يطلب إجازةً لمدّةٍ، ببديلٍ أو بدونه. وإن أمَّن بديلًا لم
//   يُكلَّفْ ببياناته — اسمُه ورقمُ جوّاله لا غير.
//   وللإدارة: قبولان لا واحد — قبولُ الإجازة وقبولُ البديل. فإذا قُبل
//   البديلُ أُنشئ رمزُه السرِّيُّ ورابطُه، فيُرسَل إلى جوّاله.
import { h, fill, toast, busy, dialog, confirm, fmtDate, fmtDateTime } from '../ui.js';
import { db } from '../sb.js';
import { isAdmin, can } from '../store.js';

const CITY = { makkah: 'مكة المكرمة', madinah: 'المدينة المنورة' };
const TRACK = { translation: 'مترجمٌ متخصص', field: 'مرشدٌ مكاني', answers: 'مجيبٌ عن الأسئلة' };
const STATE = {
  pending: ['warn', 'معلَّق'], approved: ['ok', 'مقبولة'],
  rejected: ['bad', 'غيرُ مقبولة'], cancelled: ['', 'مسحوبة']
};
const SUB_STATE = {
  none: ['', 'بلا بديل'], pending: ['warn', 'بديلٌ ينتظر'],
  approved: ['ok', 'بديلٌ مقبول'], rejected: ['bad', 'بديلٌ مردود'],
  done: ['ok', 'سجَّل البديل']
};
const badge = (map, v) => {
  const [cls, txt] = map[v] || ['', v || '—'];
  return h('span.badge', { class: cls }, txt);
};

export const subUrl = token =>
  `${location.origin}/sub?t=${encodeURIComponent(token || '')}`;

// رسالةُ واتساب جاهزةٌ إلى رقم البديل: لا اشتراكَ ولا بوابةَ رسائل،
//   والمرسِلُ هو المسؤولُ بنفسه فيُعرَف من أرسل
const waLink = (phone, text) => {
  const p = String(phone || '').replace(/[^0-9]/g, '').replace(/^0+/, '');
  const full = p.startsWith('966') ? p : `966${p}`;
  return `https://wa.me/${full}?text=${encodeURIComponent(text)}`;
};

export async function render() {
  const box = h('div.stack');
  const mine = h('div.stack');

  // ـــ طلبُ العضو لنفسه
  const askLeave = async () => {
    const from = h('input', { type: 'date', 'aria-label': 'من تاريخ' });
    const to = h('input', { type: 'date', 'aria-label': 'إلى تاريخ' });
    const why = h('textarea', { rows: 3, placeholder: 'سببُ الإجازة (اختياري)',
      'aria-label': 'السبب' });
    const withSub = h('input', { type: 'checkbox' });
    const subName = h('input', { placeholder: 'اسمُ البديل', 'aria-label': 'اسم البديل' });
    const subPhone = h('input', { type: 'tel', dir: 'ltr', placeholder: '05XXXXXXXX',
      'aria-label': 'رقم جوال البديل' });
    const subBox = h('div.stack', { hidden: true },
      h('label.field', 'اسمُ البديل', subName),
      h('label.field', 'رقمُ جوّاله', subPhone),
      h('p.small.muted', 'لا يُطلَب منك غيرُ هذين. فإذا قُبل البديلُ وصله '
        + 'رابطٌ خاصٌّ به يُكمِل فيه بياناته بنفسه.'));
    withSub.onchange = () => { subBox.hidden = !withSub.checked; };

    const v = await dialog({
      title: 'طلبُ إجازة',
      body: h('div.stack',
        h('div.row.wrap',
          h('label.field.tight', 'من', from),
          h('label.field.tight', 'إلى', to)),
        h('label.field', 'السبب', why),
        h('label.check', withSub, h('span', 'أؤمِّن بديلًا عنّي')),
        subBox,
        h('p.small.muted', 'والإجازةُ بلا بديلٍ جائزة: يُسنَد العملُ من الإدارة '
          + 'إلى غيرك، ولا يُحسَب عليك تأخيرٌ في مدّتها.')),
      buttons: [
        { label: 'أرسِلِ الطلب', kind: 'primary',
          validate: () => {
            if (!from.value || !to.value) return 'حدِّدْ مدّةَ الإجازة';
            if (to.value < from.value) return 'تاريخُ النهاية قبل البداية';
            if (withSub.checked && (!subName.value.trim() || !subPhone.value.trim()))
              return 'اكتبْ اسمَ البديل ورقمَ جوّاله';
            return true;
          },
          value: () => ({ from: from.value, to: to.value, why: why.value.trim(),
            sub: withSub.checked, name: subName.value.trim(), phone: subPhone.value.trim() }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!v) return;
    try {
      await db.rpc('request_leave', {
        p_from: v.from, p_to: v.to, p_reason: v.why || null,
        p_with_sub: v.sub, p_sub_name: v.name || null, p_sub_phone: v.phone || null
      });
      toast('أُرسِل الطلب. يصلك قرارُه في المنصة وبريدك.', 'ok');
      loadMine();
    } catch (e) { toast(e.message, 'bad'); }
  };

  const askBtn = h('button.btn.primary', { type: 'button', onclick: askLeave },
    '＋ اطلبْ إجازة');

  const loadMine = async () => {
    fill(mine, h('p.small.muted', 'تُحمَّل طلباتُك…'));
    try {
      const r = await db.rpc('my_leaves');
      const rows = Array.isArray(r) ? r : [];
      fill(mine, rows.length
        ? h('div.table-wrap', h('table.responsive',
            h('thead', h('tr', ['المدّة', 'السبب', 'البديل', 'الحال', ''].map(t => h('th', t)))),
            h('tbody', rows.map(x => h('tr',
              h('td', { 'data-label': 'المدّة' }, `${fmtDate(x.from_date)} — ${fmtDate(x.to_date)}`),
              h('td', { 'data-label': 'السبب' }, x.reason || '—'),
              h('td', { 'data-label': 'البديل' },
                x.with_sub ? h('span', x.sub_name || '—', ' ', badge(SUB_STATE, x.sub_state))
                  : h('span.muted', 'بلا بديل')),
              h('td', { 'data-label': 'الحال' }, badge(STATE, x.state),
                x.admin_note ? h('div.small.muted', x.admin_note) : null),
              h('td', x.state === 'pending'
                ? h('button.btn.xs.ghost', { type: 'button',
                    onclick: e => busy(e.currentTarget, async () => {
                      if (!await confirm('سحبُ الطلب', 'يُسحَب طلبُك ولا يُبَتُّ فيه.',
                        'اسحبْه', 'danger')) return;
                      try { await db.rpc('cancel_leave', { p_id: x.id }); loadMine(); }
                      catch (err) { toast(err.message, 'bad'); }
                    }) }, 'اسحبْه')
                : '—'))))))
        : h('p.small.muted', 'لا طلباتٍ لك بعد.'));
    } catch (e) { fill(mine, h('p.bad', e.message)); }
  };

  // ـــ كشفُ الإدارة: القبولان، ورابطُ البديل
  const adminBox = h('div.stack');
  const filter = h('select', { 'aria-label': 'الحال' },
    h('option', { value: 'pending' }, 'المعلَّقة'),
    h('option', { value: '' }, 'الكلّ'),
    h('option', { value: 'approved' }, 'المقبولة'),
    h('option', { value: 'rejected' }, 'المردودة'));

  const shareInvite = (row, token) => {
    const url = subUrl(token);
    const text = `السلام عليكم ${row.sub_name || ''}\n`
      + `أنت بديلٌ عن ${row.full_name} في مشروع ترجمة خطب الحرمين `
      + `للمدّة ${fmtDate(row.from_date)} — ${fmtDate(row.to_date)}.\n`
      + `افتحْ هذا الرابطَ لإكمال بياناتك:\n${url}`;
    const field = h('input', { value: url, dir: 'ltr', readonly: true,
      'aria-label': 'رابط البديل', style: { width: '100%' } });
    dialog({
      title: 'رابطُ البديل',
      body: h('div.stack',
        h('p.small.muted', 'رابطٌ سرِّيٌّ خاصٌّ بهذا البديل وحدَه، مدّتُه أسبوعان، '
          + 'ويبطل بتمام تسجيله. لا يُنشَر ولا يُرسَل إلى غيره.'),
        field,
        h('div.row.wrap',
          h('a.btn.sm.primary', { href: waLink(row.sub_phone, text),
            target: '_blank', rel: 'noopener' }, '↗ أرسِلْه في واتساب'),
          h('button.btn.sm', { type: 'button',
            onclick: () => {
              field.select();
              navigator.clipboard?.writeText(url)
                .then(() => toast('نُسخ الرابط.', 'ok'))
                .catch(() => toast('انسخه بيدك من الحقل.', 'warn'));
            } }, 'انسخِ الرابط'))),
      buttons: [{ label: 'إغلاق', value: null }]
    });
  };

  const decide = async (row, leaveState) => {
    const subSel = row.with_sub && leaveState === 'approved'
      ? h('select', { 'aria-label': 'البديل' },
          h('option', { value: 'approved' }, 'أقبلُ البديل'),
          h('option', { value: 'rejected' }, 'أردُّ البديل'))
      : null;
    const note = h('input', { placeholder: 'ملاحظةٌ تصل صاحبَ الطلب (اختياري)',
      maxlength: 200, 'aria-label': 'ملاحظة' });
    const v = await dialog({
      title: leaveState === 'approved' ? 'قبولُ الإجازة' : 'ردُّ الإجازة',
      body: h('div.stack',
        h('p', `${row.full_name} — ${fmtDate(row.from_date)} إلى ${fmtDate(row.to_date)}`),
        row.reason ? h('p.small.muted', row.reason) : null,
        subSel ? h('div.stack',
          h('p.small.muted', `البديلُ المؤمَّن: ${row.sub_name || '—'} · ${row.sub_phone || '—'}`),
          h('label.field', 'البديل', subSel)) : null,
        h('label.field', 'ملاحظة', note)),
      buttons: [
        { label: leaveState === 'approved' ? 'اقبلْ' : 'ردَّ', kind: 'primary',
          value: () => ({ sub: subSel ? subSel.value : null, note: note.value.trim() }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!v) return;
    try {
      const r = await db.rpc('decide_leave', {
        p_id: row.id, p_leave: leaveState, p_sub: v.sub, p_note: v.note || null
      });
      const o = Array.isArray(r) ? r[0] : r;
      toast('سُجِّل القرار.', 'ok');
      if (o && o.token) shareInvite(row, o.token);
      loadAdmin();
    } catch (e) { toast(e.message, 'bad'); }
  };

  const loadAdmin = async () => {
    fill(adminBox, h('p.small.muted', 'تُحمَّل الطلبات…'));
    try {
      const r = await db.rpc('leave_sheet', { p_state: filter.value || null });
      const rows = Array.isArray(r) ? r : [];
      fill(adminBox, rows.length
        ? h('div.table-wrap', h('table.responsive',
            h('thead', h('tr', ['العضو', 'المدّة', 'البديل', 'الحال', 'القرار']
              .map(t => h('th', t)))),
            h('tbody', rows.map(x => h('tr',
              h('td', { 'data-label': 'العضو' }, h('b', x.full_name),
                h('div.small.muted', [TRACK[x.track] || x.track, CITY[x.city]]
                  .filter(Boolean).join(' · '))),
              h('td', { 'data-label': 'المدّة' },
                `${fmtDate(x.from_date)} — ${fmtDate(x.to_date)}`,
                h('div.small.muted', `طُلبت ${fmtDateTime(x.created_at)}`)),
              h('td', { 'data-label': 'البديل' },
                x.with_sub
                  ? h('span', h('b', x.sub_name || '—'),
                      h('div.small.muted', { dir: 'ltr' }, x.sub_phone || ''),
                      badge(SUB_STATE, x.sub_state),
                      x.sub_member ? h('div.small.ok', `سجَّل: ${x.sub_member}`) : null)
                  : h('span.muted', 'بلا بديل')),
              h('td', { 'data-label': 'الحال' }, badge(STATE, x.state),
                x.admin_note ? h('div.small.muted', x.admin_note) : null),
              h('td', h('div.row.wrap', { style: { gap: '4px' } },
                x.state === 'pending'
                  ? h('button.btn.xs.primary', { type: 'button',
                      onclick: () => decide(x, 'approved') }, 'اقبلْ')
                  : null,
                x.state === 'pending'
                  ? h('button.btn.xs.ghost', { type: 'button',
                      onclick: () => decide(x, 'rejected') }, 'ردَّ')
                  : null,
                // رابطُ البديل يُعاد إنشاؤه إن انتهت مدّتُه ولم يسجِّل
                x.sub_state === 'approved'
                  ? h('button.btn.xs', { type: 'button',
                      title: 'رابطٌ جديدٌ للبديل، ويبطل القديم',
                      onclick: e => busy(e.currentTarget, async () => {
                        try {
                          const r2 = await db.rpc('resend_sub_invite', { p_id: x.id });
                          const o2 = Array.isArray(r2) ? r2[0] : r2;
                          if (o2 && o2.token) shareInvite(x, o2.token);
                        } catch (err) { toast(err.message, 'bad'); }
                      }) }, '🔗 رابطُ البديل')
                  : null)))))))
        : h('p.small.muted', 'لا طلباتٍ بهذا الترشيح.'));
    } catch (e) { fill(adminBox, h('p.bad', e.message)); }
  };
  filter.onchange = loadAdmin;

  loadMine();
  if (isAdmin() && can('tm_view')) loadAdmin();

  return h('div',
    h('div.page-head', h('div.grow',
      h('div.eyebrow', 'الفريق'),
      h('h1', 'الإجازات وتأمينُ البدلاء'),
      h('p.muted', 'يعتذر العضوُ لسفرٍ أو عذرٍ فيطلب إجازةً، ويؤمِّن بديلًا إن شاء — '
        + 'فلا يبقى الأمرُ في المراسلات، ويُعرَف من أُجيز ومن حلَّ محلَّه.')),
      h('div.row', { style: { marginInlineStart: 'auto' } }, askBtn)),
    h('div.card.stack', h('h3', 'طلباتي'), mine),
    isAdmin() && can('tm_view')
      ? h('div.card.stack', { style: { marginTop: '18px' } },
          h('div.row', h('h3', 'طلباتُ الفريق'),
            h('span', { style: { marginInlineStart: 'auto' } },
              h('label.field.tight', 'الحال', filter))),
          h('p.small.muted', 'قبولُ الإجازةِ وقبولُ البديل قراران: فقد تُقبَل الإجازةُ '
            + 'ويُرَدُّ البديل. فإذا قُبل البديلُ ظهر رابطُه السرِّيُّ لترسله إلى جوّاله.'),
          adminBox)
      : null);
}
