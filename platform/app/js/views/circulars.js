// المراسلات: تعاميم وتوجيهات وتحذيرات ودعوات — إرسالٌ من الإدارة وتوقيعٌ بالعلم من العضو (ملاحظة ٨١)
import { h, fill, toast, busy, dialog, confirm, emptyState, fmtDateTime } from '../ui.js';
import { db, storage, auth } from '../sb.js';
import { state, isAdmin, isManager, ROLE_LABEL, langName, loadCircularState } from '../store.js';
import { pdfViewer } from '../pdfview.js';
import { signaturePad, signatureImg } from '../signature.js';

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
    db.rpc('log_circular_view', { p_circular: c.id }).catch(() => {});
    storage.signedUrl('circulars', c.pdf_path, 900)
      .then(url => box.replaceChildren(
        h('p.small.muted', 'المرفق يُعرض داخل المنصة فقط: لا تنزيل ولا طباعة، وعليه علامة مائية تحمل هويتك، وكل فتح يُسجَّل.'),
        pdfViewer({ url, lines: [who],
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

  // التوقيع اليدوي: المحفوظ يُدرَج بضغطة، ومن لم يرسمه يرسمه هنا مرة واحدة (ملاحظة ١١٠)
  const sigWrap = h('div.stack', { style: { gap: '8px' } });
  let pad = null, savedSig = null;
  const drawSigArea = async () => {
    try {
      const rows = await db.select('profile_private', { select: 'signature_path', id: `eq.${state.profile.id}` });
      savedSig = rows[0]?.signature_path || null;
    } catch { savedSig = null; }
    if (savedSig) {
      let url = null;
      try { url = await storage.signedUrl('signatures', savedSig, 600); } catch { /* تُتجاوز */ }
      const redo = h('button.btn.sm', { type: 'button' }, 'رسم توقيع جديد');
      redo.onclick = () => { savedSig = null; showPad(); };
      sigWrap.replaceChildren(
        h('span.small.muted', 'يُدرَج توقيعك المحفوظ:'),
        url ? signatureImg(url, 'توقيعك') : h('span.small.muted', 'توقيع محفوظ'),
        h('div.row', redo));
    } else showPad();
  };
  const showPad = () => {
    pad = signaturePad({ height: 150 });
    const clear = h('button.btn.sm', { type: 'button', onclick: () => pad.clear() }, 'مسح');
    sigWrap.replaceChildren(
      h('span.small.muted', 'ارسم توقيعك هنا (يُحفظ في ملفك ويُستعمل في المرات القادمة):'),
      pad.el, h('div.row', clear));
  };
  drawSigArea();

  ackBtn.onclick = () => busy(ackBtn, async () => {
    if (name.value.trim().length < 3) return toast('اكتب اسمك الكامل توقيعًا بالعلم.', 'bad');
    try {
      // توقيع جديد يُرفع ويُحفظ في ملف العضو قبل التوقيع
      if (!savedSig && pad && !pad.isEmpty()) {
        const blob = await pad.toBlob();
        const path = `${state.profile.id}/sig-${Date.now()}.png`;
        await storage.upload('signatures', path, blob);
        await db.rpc('set_my_signature', { p_path: path });
        savedSig = path;
      }
      await db.rpc('ack_circular', { p_circular: c.id, p_name: name.value.trim(), p_signature: savedSig });
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
              sigWrap,
              seenNote,
              h('div.row', ackBtn))
          : h('p.small.muted', 'هذه الرسالة للعلم فقط ولا تحتاج توقيعًا.')));
}

// ---------------------------------------------------------------------
// شاشة المراسلات: قائمة ما أُرسل، وحاله، وإدارته (ملاحظة ١١٩)
// ---------------------------------------------------------------------
const AUDIENCE_LABEL = {
  all: 'كل الفريق',
  translators: 'المترجمون المتخصصون',
  field: 'المرشدون المكانيون',
  coordinators: 'المنسقون ومدير المشروع',
  selected: 'أعضاء محدَّدون'
};

export async function render(ctx) {
  const rows = await db.select('circulars', { select: SELECT, order: 'sent_at.desc', limit: 200 });
  const me = state.profile.id;
  const mineOf = c => (c.recipients || []).find(r => r.member_id === me) || null;
  const reload = () => ctx.navigate(location.pathname + location.search, { replace: true });

  const stats = Object.fromEntries((await db.select('circular_stats', { select: '*' }).catch(() => []))
    .map(s => [s.circular_id, s]));
  const stOf = c => stats[c.id] || { recipients: (c.recipients || []).length, acked: 0, opened: 0 };

  async function open(c) {
    const mine = mineOf(c);
    if (mine && !mine.read_at) db.rpc('mark_circular_read', { p_circular: c.id }).catch(() => {});
    await dialog({
      title: c.title,
      body: readerCard(c, mine, () => { document.querySelector('dialog[open]')?.close(); reload(); }),
      buttons: [{ label: 'إغلاق', value: null }]
    });
  }

  // ---------------- كشف من وُجّهت إليهم ----------------
  async function who(c) {
    let list = await db.rpc('circular_recipients_list', { p_circular: c.id }).catch(() => null);
    if (!Array.isArray(list)) {
      list = (c.recipients || []).map(r => ({
        member_id: r.member_id, full_name: r.member?.full_name, role: r.member?.role,
        read_at: r.read_at, acked_at: r.acked_at, signed_name: r.signed_name, signature_path: r.signature_path
      }));
    }
    const signed = list.filter(r => r.acked_at);
    const waiting = list.filter(r => !r.acked_at);

    const tableOf = (items, kind) => h('div.table-wrap', h('table.responsive',
      h('thead', h('tr', ['العضو', 'الدور', 'الاطّلاع', kind === 'signed' ? 'التوقيع بالعلم' : 'الحال'].map(t => h('th', t)))),
      h('tbody', items.map(r => h('tr',
        h('td', { 'data-label': 'العضو' }, r.full_name || '—', r.member_no ? h('div.small.muted', r.member_no) : null),
        h('td', { 'data-label': 'الدور' }, ROLE_LABEL[r.role] || '—'),
        h('td', { 'data-label': 'الاطّلاع' }, r.read_at ? fmtDateTime(r.read_at) : h('span.muted', 'لم يفتحها')),
        kind === 'signed'
          ? h('td', { 'data-label': 'التوقيع' },
              h('span.badge.ok', 'وقّع'), h('span.sub', `${r.signed_name || ''} — ${fmtDateTime(r.acked_at)}`),
              r.signature_path ? sigCell(r.signature_path) : null)
          : h('td', { 'data-label': 'الحال' },
              r.read_at ? h('span.badge.warn', 'اطّلع ولم يوقّع') : h('span.badge.bad', 'لم يفتحها')))))));

    const v = await dialog({
      title: `كشف «${c.title}»`,
      body: h('div.stack',
        h('div.pay-sum',
          h('div.pay-cell', h('span', 'وُجّهت إلى'), h('b', String(list.length))),
          h('div.pay-cell', h('span', 'وقّعوا'), h('b', String(signed.length))),
          h('div.pay-cell', { class: waiting.length ? 'warn' : '' },
            h('span', 'لم يوقّعوا'), h('b', String(waiting.length)))),
        h('p.small.muted', `أرسلها ${c.sender?.full_name || '—'} — ${fmtDateTime(c.sent_at)}`
          + (c.edited_at ? ` · عُدّلت ${fmtDateTime(c.edited_at)}` : '')
          + (c.reminded_at ? ` · آخر تذكير ${fmtDateTime(c.reminded_at)}` : '')),
        waiting.length ? h('div.stack', h('h3', `لم يوقّعوا (${waiting.length})`), tableOf(waiting, 'waiting')) : null,
        signed.length ? h('div.stack', h('h3', `وقّعوا (${signed.length})`), tableOf(signed, 'signed')) : null),
      buttons: [
        { label: 'تصدير الكشف', value: 'export' },
        { label: 'إغلاق', value: null }
      ]
    });
    if (v !== 'export') return;

    const sheet = [['العضو', 'الدور', 'الاطّلاع', 'التوقيع بالعلم', 'الاسم الموقَّع به'],
      ...list.map(r => [r.full_name || '—', ROLE_LABEL[r.role] || '—',
        r.read_at ? fmtDateTime(r.read_at) : 'لم يفتحها',
        r.acked_at ? fmtDateTime(r.acked_at) : 'لم يوقّع', r.signed_name || ''])];
    try {
      const { exportPdf } = await import('../teamexport.js');
      const note = `${signed.length} وقّعوا من ${list.length} — ${fmtDateTime(new Date())}`;
      if (!exportPdf(sheet, `كشف التواقيع: ${c.title}`, { note })) toast('اسمح بالنوافذ المنبثقة.', 'bad');
    } catch (err) { toast(err.message, 'bad'); }
  }

  // صورة التوقيع اليدوي داخل السجل
  function sigCell(path) {
    const box = h('div.sig-cell');
    storage.signedUrl('signatures', path, 600)
      .then(url => box.replaceChildren(signatureImg(url, 'التوقيع اليدوي')))
      .catch(() => { /* يبقى فارغًا */ });
    return box;
  }

  // ---------------- إنشاء رسالة ----------------
  // ما يُكتب لا يضيع: إن ردّ الخادم بخطأ عادت النافذة بما كُتب فيها (ملاحظة ١١٩)
  async function compose(prefill = null, error = null) {
    const d = prefill || {};
    const f = {
      title: h('input', { maxlength: 200, placeholder: 'عنوان الرسالة', value: d.title || '' }),
      kind: h('select', Object.entries(KIND_LABEL).map(([k, v]) => h('option', { value: k }, v))),
      audience: h('select', Object.entries(AUDIENCE_LABEL).map(([k, v]) => h('option', { value: k }, v))),
      body: h('textarea', { rows: 6, placeholder: 'نص الرسالة — يمكن تركه إذا أرفقت ملف PDF' }),
      pdf: h('input', { type: 'file', accept: 'application/pdf' }),
      require_ack: h('input', { type: 'checkbox', checked: d.require_ack !== false }),
      blocking: h('input', { type: 'checkbox', checked: !!d.blocking })
    };
    if (d.kind) f.kind.value = d.kind;
    if (d.audience) f.audience.value = d.audience;
    f.body.value = d.body || '';

    f.require_ack.addEventListener('change', () => {
      if (!f.require_ack.checked) f.blocking.checked = false;
      f.blocking.disabled = !f.require_ack.checked;
    });

    const members = await db.select('profiles', {
      select: 'id,full_name,role,track', status: 'eq.active', order: 'full_name.asc' });
    const picked = new Set(d.members || []);
    const counter = h('span.small.muted');
    const paintCount = () => {
      const n = f.audience.value === 'selected' ? picked.size
        : members.filter(m => f.audience.value === 'all'
            || (f.audience.value === 'translators' && m.role === 'translator' && m.track !== 'field')
            || (f.audience.value === 'field' && m.track === 'field')
            || (f.audience.value === 'coordinators' && ['coordinator', 'manager'].includes(m.role))).length;
      counter.textContent = n ? `تصل إلى ${n} عضوًا` : 'لا أعضاء في هذه الفئة — اختر غيرها';
      counter.className = 'small ' + (n ? 'muted' : 'bad');
    };
    const pickBox = h('div.pick-list', members.map(m => {
      const cb = h('input', { type: 'checkbox', checked: picked.has(m.id) ? true : null });
      cb.onchange = () => { cb.checked ? picked.add(m.id) : picked.delete(m.id); paintCount(); };
      return h('label.check', cb, h('span', m.full_name,
        h('span.small.muted', ` — ${ROLE_LABEL[m.role]}${m.track === 'field' ? ' · إرشاد مكاني' : ''}`)));
    }));
    const pickWrap = h('fieldset', { hidden: f.audience.value !== 'selected' },
      h('legend', 'الأعضاء المحددون'), pickBox);
    f.audience.addEventListener('change', () => {
      pickWrap.hidden = f.audience.value !== 'selected';
      paintCount();
    });
    paintCount();

    const res = await dialog({
      title: 'رسالة جديدة إلى الفريق',
      body: h('div.stack',
        error ? h('div.err-box',
          h('b', '⚠ لم تُرسَل الرسالة'),
          h('p.small', error),
          h('p.small.muted', 'ما كتبتَه محفوظ أمامك. عالج السبب ثم اضغط إرسال، أو احذف المرفق وأرسل النص وحده.')) : null,
        h('div.grid-2', h('label.field', 'النوع', f.kind),
          h('label.field', 'المرسَل إليهم', f.audience, counter)),
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

    let path = null;
    try {
      if (res.file) {
        path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`;
        await storage.upload('circulars', path, res.file);
      }
    } catch (err) {
      console.error('[circulars] upload failed', err);
      const size = (res.file.size / (1024 * 1024)).toFixed(1);
      return compose({ ...res, file: null },
        `تعذّر رفع المرفق «${res.file.name}» (${size} ميغابايت): ${err.message}. `
        + 'أعد اختيار الملف أو أرسل النص بلا مرفق.');
    }
    try {
      await db.rpc('send_circular', {
        p_title: res.title, p_kind: res.kind, p_body: res.body, p_pdf_path: path,
        p_audience: res.audience, p_members: res.audience === 'selected' ? res.members : null,
        p_require_ack: res.require_ack, p_blocking: res.blocking
      });
      toast('أُرسلت الرسالة.', 'ok');
      reload();
    } catch (err) {
      // النص محفوظ: تُفتح النافذة من جديد بما كُتب فيها مع بيان السبب
      console.error('[circulars] send_circular failed', err);
      toast(err.message, 'bad');
      return compose(res, err.message + (err.status ? ` (رمز ${err.status})` : ''));
    }
  }

  // ---------------- تحكّم الإدارة فيما أُرسل ----------------
  async function edit(c) {
    const f = {
      title: h('input', { maxlength: 200, value: c.title || '' }),
      kind: h('select', Object.entries(KIND_LABEL).map(([k, v]) => h('option', { value: k, selected: c.kind === k ? true : null }, v))),
      body: h('textarea', { rows: 6 }),
      require_ack: h('input', { type: 'checkbox', checked: c.require_ack ? true : null }),
      blocking: h('input', { type: 'checkbox', checked: c.blocking ? true : null })
    };
    f.body.value = c.body || '';
    const st = stOf(c);
    const res = await dialog({
      title: 'تعديل الرسالة',
      body: h('div.stack',
        (st.acked ?? 0) > 0 ? h('p.small.bad', `وقّع عليها ${st.acked} من ${st.recipients} — التعديل بعد التوقيع يُسجَّل، وذكّر الموقّعين إن كان جوهريًّا.`) : null,
        h('div.grid-2', h('label.field', 'النوع', f.kind), h('label.field', 'العنوان', f.title)),
        h('label.field', 'نص الرسالة', f.body),
        h('label.check', f.require_ack, 'يلزم توقيع العضو بالعلم'),
        h('label.check', f.blocking, 'تعميم ملزم يحجب متابعة المهام'),
        c.pdf_path ? h('p.small.muted', 'المرفق لا يُستبدل من هنا: أرسل رسالة جديدة بمرفق آخر ثم أرشف هذه.') : null),
      buttons: [
        { label: 'حفظ التعديل', kind: 'primary', validate: () => {
          if (f.title.value.trim().length < 3) { toast('اكتب عنوان الرسالة.', 'bad'); return false; }
          if (!f.body.value.trim() && !c.pdf_path) { toast('اكتب نص الرسالة.', 'bad'); return false; }
          return true;
        }, value: () => ({ title: f.title.value.trim(), body: f.body.value.trim(), kind: f.kind.value,
          require_ack: f.require_ack.checked, blocking: f.blocking.checked }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!res) return;
    try {
      await db.rpc('update_circular', { p_id: c.id, p_title: res.title, p_body: res.body, p_kind: res.kind,
        p_require_ack: res.require_ack, p_blocking: res.blocking });
      toast('حُفظ التعديل.', 'ok'); reload();
    } catch (err) { toast(err.message, 'bad'); }
  }

  async function remind(c) {
    try {
      const n = await db.rpc('remind_circular', { p_id: c.id });
      const count = Number(Array.isArray(n) ? n[0] : n) || 0;
      toast(count ? `أُرسل التذكير إلى ${count} عضوًا لم يوقّعوا.` : 'وقّع الجميع، فلا تذكير.', 'ok');
      reload();
    } catch (err) { toast(err.message, 'bad'); }
  }

  async function unblock(c) {
    if (!await confirm('إيقاف الإلزام', 'تبقى الرسالة ويبقى طلب التوقيع، لكنها لا تحجب متابعة المهام. متابعة؟', 'إيقاف الإلزام')) return;
    try { await db.rpc('update_circular', { p_id: c.id, p_blocking: false }); toast('رُفع الإلزام.', 'ok'); reload(); }
    catch (err) { toast(err.message, 'bad'); }
  }

  async function archive(c, on) {
    if (on && !await confirm('أرشفة الرسالة',
      `تُخفى «${c.title}» عن الفريق ويبقى سجلها وتواقيعها عندك في «المؤرشفة». متابعة؟`, 'أرشفة')) return;
    try {
      await db.rpc('archive_circular', { p_id: c.id, p_on: !!on });
      toast(on ? 'أُرشفت الرسالة.' : 'أُعيدت الرسالة إلى الفريق.', 'ok');
      reload();
    } catch (err) { toast(err.message, 'bad'); }
  }

  async function remove(c) {
    const st = stOf(c);
    if (!await confirm('حذف الرسالة',
      `تُحذف «${c.title}» نهائيًّا ومعها سجل من وقّع عليها (${st.acked ?? 0} توقيعًا) عند الجميع. ولو أردت إخفاءها مع حفظ السجل فاختر «أرشفة» بدلًا من الحذف.`,
      'حذف نهائي', 'danger')) return;
    try { await db.rpc('delete_circular', { p_id: c.id }); toast('حُذفت الرسالة.', 'ok'); reload(); }
    catch (err) { toast(err.message, 'bad'); }
  }

  // ---------------- بطاقة الرسالة في القائمة ----------------
  function card(c) {
    const mine = mineOf(c);
    const st = stOf(c);
    const waiting = Math.max(0, (st.recipients ?? 0) - (st.acked ?? 0));
    const pending = mine && c.require_ack && !mine.acked_at;
    const archived = !!c.archived_at;
    const pct = st.recipients ? Math.round(((st.acked ?? 0) / st.recipients) * 100) : 0;

    const admin = isAdmin() ? h('div.row.wrap',
      h('button.btn.sm', { type: 'button', onclick: () => who(c) }, 'من وقّع'),
      h('button.btn.sm', { type: 'button', title: 'تعديل نص الرسالة وخياراتها', onclick: () => edit(c) }, 'تعديل'),
      c.require_ack && waiting > 0 && !archived
        && h('button.btn.sm', { type: 'button', title: 'تذكير من لم يوقّع', onclick: e => busy(e.currentTarget, () => remind(c)) }, 'تذكير'),
      c.blocking && !archived && h('button.btn.sm', { type: 'button', title: 'رفع الإلزام فلا يُحجب العمل',
        onclick: e => busy(e.currentTarget, () => unblock(c)) }, 'إيقاف الإلزام'),
      h('button.btn.sm', { type: 'button', title: archived ? 'إعادتها إلى الفريق' : 'إخفاؤها عن الفريق مع حفظ سجلها',
        onclick: e => busy(e.currentTarget, () => archive(c, !archived)) }, archived ? 'إعادة النشر' : 'أرشفة'),
      isManager() && h('button.btn.sm.danger', { type: 'button', onclick: e => busy(e.currentTarget, () => remove(c)) }, 'حذف')) : null;

    return h('article.card.circular-row', { class: [pending ? 'pending' : '', archived ? 'archived' : ''].join(' ').trim() },
      h('div.row.wrap',
        h('span.badge', { class: KIND_CLASS[c.kind] || '' }, KIND_LABEL[c.kind] || 'تعميم'),
        h('b.grow', { style: { minWidth: '180px' } }, c.title),
        archived && h('span.badge', 'مؤرشفة'),
        c.blocking && !archived && h('span.badge.bad', 'ملزم'),
        mine && (mine.acked_at ? h('span.badge.ok', 'وقّعتَ بالعلم')
          : c.require_ack ? h('span.badge.warn', 'بانتظار توقيعك') : h('span.badge', 'للعلم'))),
      h('div.circ-meta.small.muted',
        h('span', '🕔 ' + fmtDateTime(c.sent_at)),
        h('span', '✎ ' + (c.sender?.full_name || '—')),
        h('span', '👥 ' + (AUDIENCE_LABEL[c.audience] || c.audience || '—')),
        c.pdf_path ? h('span', '📎 مرفق PDF') : null,
        c.edited_at ? h('span', 'عُدّلت ' + fmtDateTime(c.edited_at)) : null,
        c.reminded_at ? h('span', 'آخر تذكير ' + fmtDateTime(c.reminded_at)) : null),
      c.body && h('p.clamp-2', c.body),
      isAdmin() && c.require_ack ? h('div.circ-sign',
        h('div.progress', h('i', { style: { width: pct + '%' } })),
        h('span.small',
          h('b', `${st.acked ?? 0}`), ` وقّعوا من `, h('b', `${st.recipients ?? 0}`),
          waiting > 0 ? h('span.badge.warn', `${waiting} لم يوقّعوا`) : h('span.badge.ok', 'وقّع الجميع'))) : null,
      h('div.row.wrap',
        h('button.btn.sm.primary', { type: 'button', onclick: () => open(c) }, pending ? 'اطّلع ووقّع' : 'عرض'),
        admin));
  }

  // ---------------- القائمة ومرشّحاتها ----------------
  const visible = rows.filter(c => isAdmin() || !c.archived_at);
  const FILTERS = isAdmin()
    ? [['active', 'المرسلة'], ['waiting', 'بانتظار توقيع'], ['blocking', 'الملزمة'], ['archived', 'المؤرشفة'], ['all', 'الكل']]
    : [['all', 'الكل'], ['waiting', 'بانتظار توقيعي']];
  const match = (c, key) => {
    const st = stOf(c);
    const mine = mineOf(c);
    if (key === 'archived') return !!c.archived_at;
    if (key === 'active') return !c.archived_at;
    if (key === 'blocking') return c.blocking && !c.archived_at;
    if (key === 'waiting') {
      return isAdmin()
        ? !c.archived_at && c.require_ack && (st.recipients ?? 0) > (st.acked ?? 0)
        : !!(mine && c.require_ack && !mine.acked_at);
    }
    return true;
  };

  const listBox = h('div.stack');
  let current = FILTERS[0][0];
  const paint = () => {
    const items = visible.filter(c => match(c, current));
    listBox.replaceChildren(items.length
      ? h('div.stack', items.map(card))
      : emptyState('لا مراسلات في هذا التبويب',
          isAdmin() ? 'جرّب تبويب «الكل» أو أرسل رسالة جديدة.' : 'تظهر هنا التعاميم والتوجيهات الموجّهة إليك.'));
  };
  const tabs = FILTERS.map(([key, label]) => {
    const n = visible.filter(c => match(c, key)).length;
    const b = h('button.btn.tab', { type: 'button', role: 'tab' }, label, n ? h('span.nav-badge', String(n)) : null);
    b.onclick = () => {
      current = key;
      tabs.forEach((x, i) => {
        const on = FILTERS[i][0] === key;
        x.classList.toggle('on', on);
        x.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      paint();
    };
    return b;
  });
  tabs[0].classList.add('on');
  tabs[0].setAttribute('aria-selected', 'true');
  paint();

  const totals = isAdmin() ? h('div.pay-sum',
    h('div.pay-cell', h('span', 'المرسلة'), h('b', String(visible.filter(c => !c.archived_at).length))),
    h('div.pay-cell', { class: visible.some(c => match(c, 'waiting')) ? 'warn' : '' },
      h('span', 'بانتظار توقيع'), h('b', String(visible.filter(c => match(c, 'waiting')).length))),
    h('div.pay-cell', h('span', 'المؤرشفة'), h('b', String(visible.filter(c => c.archived_at).length)))) : null;

  return h('div',
    h('div.page-head',
      isAdmin() && h('div.row', { style: { marginInlineStart: 'auto', order: 2 } },
        h('button.btn.sm.primary', { type: 'button', onclick: () => compose() }, '＋ رسالة جديدة')),
      h('div.grow', h('div.eyebrow', 'المراسلات'), h('h1', 'مراسلات الفريق'),
        isAdmin() && h('p.muted', 'كل رسالة بتاريخها ووقتها ومن وُجّهت إليهم، ومن وقّع ومن لم يوقّع. والأرشفة تُخفيها عن الفريق ويبقى سجلها عندك.'))),
    state.blockingCirculars > 0 && h('div.policy-state.unsigned.gate-note',
      `لديك ${state.blockingCirculars} تعميمًا ملزمًا بانتظار توقيعك — لا تتابع مهامك قبل الاطّلاع عليه والتوقيع بالعلم.`),
    totals,
    h('div.tabs', { role: 'tablist' }, tabs),
    listBox);
}
