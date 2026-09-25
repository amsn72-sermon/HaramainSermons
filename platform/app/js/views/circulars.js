// المراسلات: تعاميم وتوجيهات وتحذيرات ودعوات — إرسالٌ من الإدارة وتوقيعٌ بالعلم من العضو (ملاحظة ٨١)
import { h, fill, toast, busy, dialog, emptyState, fmtDateTime } from '../ui.js';
import { db, storage, auth } from '../sb.js';
import { state, isAdmin, ROLE_LABEL, langName, loadCircularState } from '../store.js';
import { pdfViewer } from '../pdfview.js';

export const KIND_LABEL = {
  notice: 'تعميم', directive: 'توجيه', warning: 'تحذير', invitation: 'دعوة'
};
const KIND_CLASS = { notice: '', directive: 'gold', warning: 'bad', invitation: 'ok' };

const SELECT = '*,sender:profiles!circulars_sent_by_fkey(full_name),'
  + 'recipients:circular_recipients(member_id,read_at,acked_at,signed_name,member:profiles(full_name,role))';

// بطاقة الرسالة كما يراها العضو، مع التوقيع بالعلم
function readerCard(c, mine, onDone) {
  const body = h('div.stack');
  // لا توقيع قبل تصفّح صفحات المرفق كلها (ملاحظة ٨٩)
  let seenAll = !c.pdf_path;
  const seenNote = h('p.small.muted', { hidden: true }, 'تصفّح صفحات المرفق كلها ليُفتح لك التوقيع.');
  if (c.body) body.append(h('div.circular-body', ...String(c.body).split(/\n{2,}/).map(p => h('p', p))));
  if (c.pdf_path) {
    const box = h('div.circular-doc', h('p.muted', 'جارٍ تحميل المرفق…'));
    const who = auth.user?.email || state.profile?.full_name || '';
    const stamp = new Date().toLocaleString('ar-SA-u-ca-gregory-nu-latn');
    db.rpc('log_circular_view', { p_circular: c.id }).catch(() => {});
    storage.signedUrl('circulars', c.pdf_path, 900)
      .then(url => box.replaceChildren(
        h('p.small.muted', 'المرفق يُعرض داخل المنصة فقط: لا تنزيل ولا طباعة، وعليه علامة مائية تحمل هويتك، وكل فتح يُسجَّل.'),
        pdfViewer({ url, lines: [`${state.profile?.full_name || ''} — ${who}`, `سري — ${stamp}`],
          onPage: (page, total) => {
            if (page >= total) { seenAll = true; ackBtn.disabled = false; seenNote.hidden = true; }
          } })))
      .catch(() => box.replaceChildren(h('p.small.bad', 'تعذّر فتح المرفق')));
    body.append(box);
  }

  const signed = !!mine?.acked_at;
  const name = h('input', { autocomplete: 'off', placeholder: state.profile?.full_name || 'اكتب اسمك الكامل' });
  const ackBtn = h('button.btn.primary', { type: 'button', disabled: !seenAll }, 'اطّلعت وأوقّع بالعلم');
  if (!seenAll) seenNote.hidden = false;
  ackBtn.onclick = () => busy(ackBtn, async () => {
    if (name.value.trim().length < 3) return toast('اكتب اسمك الكامل توقيعًا بالعلم.', 'bad');
    try {
      await db.rpc('ack_circular', { p_circular: c.id, p_name: name.value.trim() });
      await loadCircularState(true).catch(() => {});
      toast('سُجّل توقيعك بالعلم.', 'ok');
      onDone && onDone();
    } catch (err) { toast(err.message, 'bad'); }
  });

  return h('div.stack',
    h('div.row',
      h('span.badge', { class: KIND_CLASS[c.kind] || '' }, KIND_LABEL[c.kind] || 'تعميم'),
      h('span.small.muted', `${c.sender?.full_name || ''} — ${fmtDateTime(c.sent_at)}`)),
    body,
    signed
      ? h('div.policy-state.signed', `وقّعتَ بالعلم باسم «${mine.signed_name}» في ${fmtDateTime(mine.acked_at)}`)
      : (c.require_ack
          ? h('div.stack',
              h('div.policy-state.unsigned', 'لم توقّع بالعلم على هذه الرسالة بعد'),
              h('label.field', 'التوقيع: اكتب اسمك الكامل', name),
              seenNote,
              h('div.row', ackBtn))
          : h('p.small.muted', 'هذه الرسالة للعلم فقط ولا تحتاج توقيعًا.')));
}

export async function render(ctx) {
  const rows = await db.select('circulars', { select: SELECT, order: 'sent_at.desc', limit: 200 });
  const me = state.profile.id;
  const mineOf = c => (c.recipients || []).find(r => r.member_id === me) || null;
  const reload = () => ctx.navigate('/app/circulars', { replace: true });

  async function open(c) {
    const mine = mineOf(c);
    if (mine && !mine.read_at) db.rpc('mark_circular_read', { p_circular: c.id }).catch(() => {});
    await dialog({
      title: c.title,
      body: readerCard(c, mine, () => { document.querySelector('dialog[open]')?.close(); reload(); }),
      buttons: [{ label: 'إغلاق', value: null }]
    });
  }

  async function who(c) {
    const list = (c.recipients || []).slice()
      .sort((a, b) => (a.acked_at ? 1 : 0) - (b.acked_at ? 1 : 0));
    await dialog({
      title: `من وقّع على «${c.title}»`,
      body: h('div.table-wrap', h('table.responsive',
        h('thead', h('tr', ['العضو', 'الدور', 'الاطلاع', 'التوقيع بالعلم'].map(t => h('th', t)))),
        h('tbody', list.map(r => h('tr',
          h('td', { 'data-label': 'العضو' }, r.member?.full_name || '—'),
          h('td', { 'data-label': 'الدور' }, ROLE_LABEL[r.member?.role] || '—'),
          h('td', { 'data-label': 'الاطلاع' }, r.read_at ? fmtDateTime(r.read_at) : h('span.muted', 'لم يطّلع')),
          h('td', { 'data-label': 'التوقيع' }, r.acked_at
            ? h('span', h('span.badge.ok', 'وقّع'), h('span.sub', `${r.signed_name || ''} — ${fmtDateTime(r.acked_at)}`))
            : h('span.badge.warn', 'لم يوقّع'))))))),
      buttons: [{ label: 'إغلاق', value: null }]
    });
  }

  async function compose() {
    const f = {
      title: h('input', { maxlength: 200, placeholder: 'عنوان الرسالة' }),
      kind: h('select', Object.entries(KIND_LABEL).map(([k, v]) => h('option', { value: k }, v))),
      audience: h('select',
        h('option', { value: 'all' }, 'كل الفريق'),
        h('option', { value: 'translators' }, 'المترجمون والمراجعون'),
        h('option', { value: 'coordinators' }, 'المنسقون ومدير المشروع'),
        h('option', { value: 'selected' }, 'أعضاء أحددهم')),
      body: h('textarea', { rows: 6, placeholder: 'نص الرسالة — يمكن تركه إذا أرفقت ملف PDF' }),
      pdf: h('input', { type: 'file', accept: 'application/pdf' }),
      require_ack: h('input', { type: 'checkbox', checked: true }),
      blocking: h('input', { type: 'checkbox' })
    };
    // الإلزام لا يقوم بلا توقيع
    f.require_ack.addEventListener('change', () => {
      if (!f.require_ack.checked) f.blocking.checked = false;
      f.blocking.disabled = !f.require_ack.checked;
    });
    const members = await db.select('profiles', { select: 'id,full_name,role', status: 'eq.active', order: 'full_name.asc' });
    const picked = new Set();
    const pickBox = h('div.pick-list', members.map(m => {
      const cb = h('input', { type: 'checkbox' });
      cb.onchange = () => cb.checked ? picked.add(m.id) : picked.delete(m.id);
      return h('label.check', cb, h('span', m.full_name, h('span.small.muted', ` — ${ROLE_LABEL[m.role]}`)));
    }));
    const pickWrap = h('fieldset', { hidden: true }, h('legend', 'الأعضاء المحددون'), pickBox);
    f.audience.addEventListener('change', () => { pickWrap.hidden = f.audience.value !== 'selected'; });

    const res = await dialog({
      title: 'رسالة جديدة إلى الفريق',
      body: h('div.stack',
        h('div.grid-2', h('label.field', 'النوع', f.kind), h('label.field', 'المرسَل إليهم', f.audience)),
        pickWrap,
        h('label.field', 'العنوان', f.title),
        h('label.field', 'نص الرسالة', f.body),
        h('label.field', 'مرفق PDF (اختياري)', h('small', 'حتى ٢٠ ميغابايت'), f.pdf),
        h('label.check', f.require_ack, 'يلزم توقيع العضو بالعلم'),
        h('label.check.top', f.blocking,
          h('span', h('b', 'تعميم ملزم: '),
            'يُطالَب به عند كل دخول، ولا يتابع العضو مهامه حتى يطّلع ويوقّع.'))),
      buttons: [
        { label: 'إرسال', kind: 'primary', validate: () => {
          if (f.title.value.trim().length < 3) { toast('اكتب عنوان الرسالة.', 'bad'); return false; }
          if (!f.body.value.trim() && !f.pdf.files[0]) { toast('اكتب نص الرسالة أو أرفق ملف PDF.', 'bad'); return false; }
          if (f.audience.value === 'selected' && !picked.size) { toast('اختر عضوًا واحدًا على الأقل.', 'bad'); return false; }
          const file = f.pdf.files[0];
          if (file && file.size > 20 * 1024 * 1024) { toast('الحد الأقصى ٢٠ ميغابايت.', 'bad'); return false; }
          return true;
        }, value: () => ({
          title: f.title.value.trim(), kind: f.kind.value, audience: f.audience.value,
          body: f.body.value.trim() || null, file: f.pdf.files[0] || null,
          require_ack: f.require_ack.checked, blocking: f.blocking.checked, members: [...picked]
        }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!res) return;
    try {
      let path = null;
      if (res.file) {
        path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`;
        await storage.upload('circulars', path, res.file);
      }
      await db.rpc('send_circular', {
        p_title: res.title, p_kind: res.kind, p_body: res.body, p_pdf_path: path,
        p_audience: res.audience, p_members: res.audience === 'selected' ? res.members : null,
        p_require_ack: res.require_ack, p_blocking: res.blocking
      });
      toast('أُرسلت الرسالة.', 'ok');
      reload();
    } catch (err) { toast(err.message, 'bad'); }
  }

  const stats = Object.fromEntries((await db.select('circular_stats', { select: '*' }).catch(() => []))
    .map(s => [s.circular_id, s]));

  const list = rows.length ? h('div.stack', rows.map(c => {
    const mine = mineOf(c);
    const st = stats[c.id] || {};
    const pending = mine && c.require_ack && !mine.acked_at;
    return h('article.card.circular-row', { class: pending ? 'pending' : '' },
      h('div.row',
        h('span.badge', { class: KIND_CLASS[c.kind] || '' }, KIND_LABEL[c.kind] || 'تعميم'),
        h('b', { style: { flex: 1, minWidth: '180px' } }, c.title),
        mine && (mine.acked_at ? h('span.badge.ok', 'وقّعتَ بالعلم')
          : c.require_ack ? h('span.badge.warn', 'بانتظار توقيعك') : h('span.badge', 'للعلم')),
        c.blocking && h('span.badge.bad', 'ملزم'),
        isAdmin() && h('span.small.muted', `وقّع ${st.acked ?? 0} من ${st.recipients ?? 0}`)),
      h('p.small.muted', `${c.sender?.full_name || ''} — ${fmtDateTime(c.sent_at)}${c.pdf_path ? ' — مرفق PDF' : ''}`),
      c.body && h('p.clamp-2', c.body),
      h('div.row',
        h('button.btn.sm', { type: 'button', onclick: () => open(c) }, pending ? 'اطّلع ووقّع' : 'عرض'),
        isAdmin() && h('button.btn.sm', { type: 'button', onclick: () => who(c) }, 'من وقّع')));
  })) : emptyState('لا مراسلات بعد', isAdmin() ? 'أرسل أول رسالة إلى الفريق.' : 'تظهر هنا التعاميم والتوجيهات الموجّهة إليك.');

  return h('div',
    h('div.page-head',
      isAdmin() && h('div.row', { style: { marginInlineStart: 'auto', order: 2 } },
        h('button.btn.sm.primary', { type: 'button', onclick: compose }, '＋ رسالة جديدة')),
      h('div.grow', h('div.eyebrow', 'المراسلات'), h('h1', 'مراسلات الفريق'),
        h('p.muted', 'تعاميم وتوجيهات وتحذيرات ودعوات. ما يلزمه توقيع بالعلم يبقى معلّمًا حتى توقّع عليه.'))),
    state.blockingCirculars > 0 && h('div.policy-state.unsigned.gate-note',
      `لديك ${state.blockingCirculars} تعميمًا ملزمًا بانتظار توقيعك — لا تتابع مهامك قبل الاطّلاع عليه والتوقيع بالعلم.`),
    list);
}
