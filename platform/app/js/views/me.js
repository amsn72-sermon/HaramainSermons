// «بياناتي»: بيانات العضو كاملة، وصورته الشخصية، وحسابه البنكي أسفلها (ملاحظة ٨٥)
import { h, toast, busy, dialog, fmtDate, fmtDateTime } from '../ui.js';
import { db, storage } from '../sb.js';
import { state, ROLE_LABEL, STATUS_LABEL, TRACK_LABEL, CITY, NO_FATWA, langName, roleLabel} from '../store.js';
import { PHOTO_RULES, preparePhoto, readStashed, clearStashed, dataUrlToBlob, urlToDataUrl } from '../photo.js';
import { bankSection } from './bank.js';
import { normalizeLayout, staticCard, HARAMAIN_LOGO, CARD } from '../carddesign.js';
import { nationalitySelect } from '../nationalities.js';
import { signaturePad, signatureImg, signatureUpload } from '../signature.js';

const ID_LABEL = { national: 'رقم الهوية أو الإقامة', passport: 'رقم جواز السفر' };

export async function render(ctx) {
  const me = state.profile;
  const [privRows, langRows, cardRows, settingsRows] = await Promise.all([
    db.select('profile_private', { select: '*', id: `eq.${me.id}` }).catch(() => []),
    db.select('member_languages', { select: 'language_code', member_id: `eq.${me.id}` }).catch(() => []),
    db.select('member_cards', { select: '*', member_id: `eq.${me.id}` }).catch(() => []),
    db.select('card_settings', { select: '*' }).catch(() => [])
  ]);
  const priv = privRows[0] || {};
  const langs = langRows.map(r => r.language_code);
  const missing = await db.rpc('profile_missing', { p_id: me.id }).catch(() => []);
  const dataState = priv.data_status || 'incomplete';

  // ------------------------------------------------------------------
  // الصورة الشخصية
  // ------------------------------------------------------------------
  const photoBox = h('div.photo-box');
  const rules = h('details.photo-rules',
    h('summary', 'شروط الصورة الشخصية'),
    h('ul', PHOTO_RULES.map(t => h('li', t))));

  // حالة اعتماد المستندات: تُعتمد من الإدارة أو تُعاد بسبب مكتوب (ملاحظة ٩٨)
  const docState = (status, note, kind) => {
    const s = status || 'pending';
    if (!priv[kind === 'photo' ? 'photo_path' : 'iqama_path']) return null;
    if (s === 'approved') return h('div.policy-state.signed', h('span.tick', { 'aria-hidden': 'true' }, '✓'), 'معتمَدة من الإدارة');
    if (s === 'rejected') return h('div.policy-state.unsigned',
      h('b', 'أُعيدت إليك — ارفع بديلًا'), note ? h('div.small', 'السبب: ', note) : null);
    return h('div.policy-state.unsigned', 'تحت المراجعة');
  };

  const upload = async blob => {
    const path = `${me.id}/photo-${Date.now()}.jpg`;
    await storage.upload('member-photos', path, blob);
    await db.rpc('set_member_photo', { p_path: path });
  };

  const picker = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
  picker.onchange = () => busy(picker, async () => {
    const file = picker.files[0]; if (!file) return;
    try {
      const { blob } = await preparePhoto(file);
      await upload(blob);
      toast('حُفظت صورتك الشخصية.', 'ok');
      ctx.navigate('/app/me', { replace: true });
    } catch (e) { toast(e.message, 'bad'); }
  });

  const drawPhoto = () => {
    if (priv.photo_path) {
      const img = h('img.photo-4x6', { alt: 'صورتك الشخصية' });
      storage.signedUrl('member-photos', priv.photo_path, 600)
        .then(url => { img.src = url; })
        .catch(() => photoBox.replaceChildren(h('div.photo-empty', 'تعذّر عرض الصورة')));
      photoBox.replaceChildren(img);
    } else {
      photoBox.replaceChildren(h('div.photo-empty', h('b', '4 × 6'), h('span', 'لم تُرفع صورة بعد')));
    }
  };
  drawPhoto();

  // صورة أُرفقت عند التسجيل تُرفع عند أول دخول
  const pending = !priv.photo_path && readStashed(me.email);
  if (pending) {
    upload(dataUrlToBlob(pending))
      .then(() => { clearStashed(); toast('رُفعت صورتك المرفقة عند التسجيل.', 'ok'); ctx.navigate('/app/me', { replace: true }); })
      .catch(() => { /* تبقى محفوظة حتى يرفعها بنفسه */ });
  }

  // ------------------------------------------------------------------
  // البيانات الأساسية: لا يعدّلها العضو
  // ------------------------------------------------------------------
  const fixed = h('div.card.stack',
    h('div.row.between', h('h3', 'البيانات الأساسية'),
      h('span.badge', 'لا تُعدَّل إلا من المنسق')),
    h('dl.data-list',
      h('div', h('dt', 'الاسم الكامل'), h('dd', me.full_name)),
      h('div', h('dt', ID_LABEL[priv.id_type] || ID_LABEL.national),
        h('dd', { dir: 'ltr' }, priv.national_id || '—')),
      h('div', h('dt', 'رقم العضوية'), h('dd', { dir: 'ltr' }, me.member_no ?? '—')),
      h('div', h('dt', 'البريد الإلكتروني'), h('dd', { dir: 'ltr' }, me.email)),
      h('div', h('dt', 'الصفة'), h('dd', roleLabel(me))),
      h('div', h('dt', 'الفريق'), h('dd', TRACK_LABEL[me.track] || TRACK_LABEL.translation,
        // لا فتوى لأحدٍ البتّة: ينقل السؤال ثم ينقل الجواب (ملاحظة ١٨٦)
        me.track === 'answers' ? h('div.small.bad', NO_FATWA) : null)),
      me.track === 'field' ? h('div', h('dt', 'مدينة العمل'),
        h('dd', CITY[me.city] || '—')) : null,
      priv.iqama_path ? h('div', h('dt', 'صورة الهوية أو الإقامة'),
        h('dd', docState(priv.iqama_status, priv.iqama_note, 'iqama'))) : null,
      h('div', h('dt', 'حالة الحساب'), h('dd', STATUS_LABEL[me.status] || me.status)),
      h('div', h('dt', 'تاريخ التسجيل'), h('dd', fmtDate(me.created_at))),
      h('div', h('dt', 'اللغات'),
        h('dd', langs.length ? langs.map(c => h('span.chip', langName(c))) : '—',
          h('div.small.muted', dataState === 'accepted'
            ? 'دُقِّقت لغاتك وقُبلت — تعديلها من المنسق.'
            : 'اخترها من بطاقة «أكمل بياناتك» أعلاه، ويدققها المنسق.')))),
    h('p.small.muted', 'لتصحيح الاسم أو رقم الهوية راسل منسق المشروع — فهما يظهران في بطاقة العمل والتصاريح.'));

  // ------------------------------------------------------------------
  // أكمل بياناتك: ما بقي منها، ولغاتك، وصورة هويتك (ملاحظة ١٧٩)
  // ------------------------------------------------------------------
  const DATA_STATE = {
    incomplete: ['warn', 'بياناتك لم تُرفع بعد'],
    submitted: ['gold', 'مرفوعة للتدقيق'],
    accepted: ['ok', 'دُقِّقت وقُبلت'],
    returned: ['bad', 'أُعيدت لاستكمالها']
  };

  // اللغات: يختارها العضو بنفسه حتى تُقبل بياناته
  const picked = new Set(langs);
  const langSel = h('select', { 'aria-label': 'أضف لغة' });
  const langChips = h('div.lang-pills.chosen');
  const drawPicked = () => {
    const rest = state.languages.filter(l => l.is_active && !picked.has(l.code));
    langSel.replaceChildren(
      h('option', { value: '' }, rest.length ? '— أضف لغة —' : '— أُضيفت كل اللغات —'),
      ...rest.map(l => h('option', { value: l.code }, l.name_ar)));
    langChips.replaceChildren(...(picked.size
      ? [...picked].map(code => h('button', { type: 'button', title: 'إزالة اللغة',
          'aria-label': `إزالة ${langName(code)}`,
          onclick: () => { picked.delete(code); drawPicked(); } },
          h('span.tick', { 'aria-hidden': 'true' }, '✓'), langName(code),
          h('span.x', { 'aria-hidden': 'true' }, '×')))
      : [h('span.small.muted', 'لم تُختر لغة بعد')]));
  };
  langSel.onchange = () => { if (langSel.value) { picked.add(langSel.value); drawPicked(); } };
  drawPicked();

  // اللغةُ الأمّ: لسانُه الذي يُترجم به المواد المهمة، واحدةٌ لا غير (ملاحظة ٢٤٩)
  const nativeSel = h('select', { 'aria-label': 'اللغة الأم' },
    h('option', { value: '' }, '— اختر لغتك الأم —'),
    state.languages.map(l => h('option',
      { value: l.code, selected: me.native_lang === l.code }, l.name_ar)));
  nativeSel.onchange = () => { if (nativeSel.value) { picked.add(nativeSel.value); drawPicked(); } };

  const langSave = h('button.btn.sm', { type: 'button' }, 'حفظ اللغات');
  langSave.onclick = () => busy(langSave, async () => {
    if (!nativeSel.value) return toast('اختر لغتك الأمّ أولًا.', 'bad');
    try {
      await db.rpc('set_native_lang', { p_member: me.id, p_lang: nativeSel.value });
      await db.rpc('set_my_languages', { p_codes: [...picked] });
      toast('حُفظت لغاتك.', 'ok');
      ctx.navigate('/app/me', { replace: true });
    } catch (e) { toast(e.message, 'bad'); }
  });

  // تاريخُ انتهاء الهوية: يحفظه العضوُ لنفسه (ملاحظة ٣٠٧)
  const expiry = h('input', { type: 'date', value: priv.id_expiry || '',
    'aria-label': 'تاريخ انتهاء الهوية' });
  expiry.onchange = () => busy(expiry, async () => {
    try {
      await db.rpc('set_my_id_expiry', { p_expiry: expiry.value || null });
      priv.id_expiry = expiry.value || null;
      toast('حُفظ تاريخُ انتهاء الهوية.', 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  });

  // صورة الهوية أو الإقامة
  const idFile = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,application/pdf',
    'aria-label': 'صورة الهوية أو الإقامة' });
  const idUp = h('button.btn.sm', { type: 'button' }, priv.iqama_path ? 'تغيير الصورة' : 'رفع الصورة');
  idUp.onclick = () => busy(idUp, async () => {
    const file = idFile.files[0];
    if (!file) return toast('اختر الملف أولًا.', 'bad');
    if (file.size > 10 * 1024 * 1024) return toast('الحد الأقصى 10 ميغابايت.', 'bad');
    try {
      const ext = (file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1]) || 'jpg';
      const path = `${me.id}/iqama-${Date.now()}.${ext}`;
      await storage.upload('private-docs', path, file);
      await db.update('profile_private', { id: `eq.${me.id}` }, { iqama_path: path });
      toast('رُفعت الصورة.', 'ok');
      ctx.navigate('/app/me', { replace: true });
    } catch (e) { toast(e.message, 'bad'); }
  });

  const sendBtn = h('button.btn.primary', { type: 'button' }, 'أرسل بياناتي للتدقيق');
  sendBtn.onclick = () => busy(sendBtn, async () => {
    try {
      await db.rpc('submit_profile_data');
      toast('رُفعت بياناتك، ويدققها المنسق.', 'ok');
      ctx.navigate('/app/me', { replace: true });
    } catch (e) { toast(e.message, 'bad'); }
  });

  const [badgeKind, badgeText] = DATA_STATE[dataState] || DATA_STATE.incomplete;
  const completeCard = dataState === 'accepted' ? null : h('section.card.stack.complete-card',
    h('div.row.between',
      h('h3', 'أكمل بياناتك'),
      h('span.badge', { class: badgeKind }, badgeText)),
    dataState === 'returned' && priv.data_note
      ? h('p.small.bad', `ملاحظة المنسق: ${priv.data_note}`) : null,
    h('p.small.muted', 'سجّلت عند التسجيل أربعة بيانات لا غير. وهذه بقيتها، '
      + 'تستكملها على مهل ثم ترسلها، فيدققها المنسق ويقبلها.'),
    (missing || []).length
      ? h('div.stack',
          h('b.small', 'بقي عليك'),
          h('ul.small.tight', missing.map(x => h('li', x))))
      : h('p.small.ok', 'اكتملت بياناتك — أرسلها للتدقيق.'),
    h('div.card.stack',
      h('b', 'لغاتك'),
      me.native_lang ? null : h('p.small.warn', 'لم تُحدَّد لغتُك الأمّ بعد — وهي مطلوبةٌ كالبريد والهوية.'),
      h('label.field', 'اللغة الأمّ', nativeSel,
        h('small', 'لسانُك الذي تُترجم به المواد المهمة — واحدةٌ لا غير')),
      h('p.small.muted', 'ثم اللغاتُ التي تُتقنها وتترجم بها أو ترشد بها — لغةٌ واحدة على الأقل. '
        + 'واعتمادُ لغات الإسناد بيد الإدارة.'),
      langSel, langChips, h('div.row', langSave)),
    h('div.card.stack',
      h('b', 'صورة الهوية أو الإقامة'),
      h('p.small.muted', 'صورةٌ أو ملف PDF، ولا يطّلع عليها إلا المنسق ومدير المشروع.'),
      h('div.row', idFile, idUp),
      priv.iqama_path ? h('span.small.ok', 'مرفوعة') : null,
      // تاريخُ الانتهاء يُطلب منك لتُنبَّه قبل أن تقف أعمالُك (ملاحظة ٣٠٧)
      h('label.field', 'تاريخُ انتهاء الهوية', expiry,
        h('small', 'نُنبّهك قبل انتهائها بمدّة، فتُجدّدها في وقتها'))),
    h('p.small.muted', 'والجنسية ومكان الإقامة والصورة الشخصية من بطاقتيهما في هذه الصفحة.'),
    h('div.row', sendBtn,
      dataState === 'submitted' ? h('span.small.muted', 'بياناتك عند المنسق الآن.') : null));

  // ------------------------------------------------------------------
  // بيانات يعدّلها العضو
  // ------------------------------------------------------------------
  const f = {
    whatsapp: h('input', { dir: 'ltr', value: priv.whatsapp || '', placeholder: '05xxxxxxxx', maxlength: 24 }),
    nationality: nationalitySelect(h, priv.nationality),
    residence: h('input', { value: priv.residence || '', maxlength: 120, placeholder: 'المدينة والحي' })
  };
  const err = h('div.form-errors', { hidden: true, role: 'alert' });
  const saveBtn = h('button.btn.primary', { type: 'button' }, 'حفظ التعديلات');
  saveBtn.onclick = () => busy(saveBtn, async () => {
    const list = [];
    const phone = f.whatsapp.value.trim();
    if (phone && !/^[+0-9\s-]{8,20}$/.test(phone)) list.push('رقم الجوال غير صحيح');
    err.replaceChildren(h('ul', list.map(t => h('li', t)))); err.hidden = !list.length;
    if (list.length) return;
    try {
      await db.rpc('update_my_contact', {
        p_whatsapp: phone || null,
        p_nationality: f.nationality.value.trim() || null,
        p_residence: f.residence.value.trim() || null
      });
      toast('حُفظت بياناتك.', 'ok');
    } catch (e) { err.replaceChildren(h('ul', h('li', e.message))); err.hidden = false; }
  });

  const editable = h('div.card.stack',
    h('h3', 'بيانات التواصل'),
    err,
    h('div.grid-2',
      h('label.field', 'رقم الجوال', f.whatsapp),
      h('label.field', 'الجنسية', f.nationality)),
    h('label.field', 'مكان الإقامة', f.residence),
    h('div.row', saveBtn));

  // التوقيع اليدوي: يُرسم مرة ويُحفظ، ويُدرَج على ما يوقّعه العضو (ملاحظة ١١٠)
  const sigBox = h('div.stack');
  const drawSig = async () => {
    if (priv.signature_path) {
      let url = null;
      try { url = await storage.signedUrl('signatures', priv.signature_path, 600); } catch { /* يُعاد لاحقًا */ }
      const replace = h('button.btn.sm', { type: 'button' }, 'تغيير التوقيع');
      const remove = h('button.btn.sm.danger', { type: 'button' }, 'حذف التوقيع');
      replace.onclick = () => padUI();
      remove.onclick = () => busy(remove, async () => {
        try { await db.rpc('set_my_signature', { p_path: null }); priv.signature_path = null; toast('حُذف التوقيع.', 'ok'); drawSig(); }
        catch (e) { toast(e.message, 'bad'); }
      });
      sigBox.replaceChildren(
        url ? signatureImg(url, 'توقيعك المحفوظ') : h('p.small.muted', 'تعذّر عرض التوقيع'),
        h('p.small.muted', priv.signature_at ? `حُفظ في ${fmtDateTime(priv.signature_at)}` : ''),
        h('div.row', replace, remove));
    } else {
      const start = h('button.btn.primary', { type: 'button' }, 'رسم التوقيع');
      start.onclick = () => padUI();
      sigBox.replaceChildren(
        h('p.small.muted', 'ارسم توقيعك مرة واحدة أو ارفع صورته، فيُدرَج تلقائيًّا كلما وقّعت بالعلم على المراسلات.'),
        h('div.row', start),
        signatureUpload({ memberId: me.id, onSaved: path => {
          priv.signature_path = path; priv.signature_at = new Date().toISOString(); drawSig();
        } }));
    }
  };
  const padUI = () => {
    const pad = signaturePad();
    const clear = h('button.btn.sm', { type: 'button', onclick: () => pad.clear() }, 'مسح');
    const save = h('button.btn.primary', { type: 'button' }, 'حفظ التوقيع');
    save.onclick = () => busy(save, async () => {
      if (pad.isEmpty()) return toast('ارسم توقيعك أولًا.', 'bad');
      try {
        const blob = await pad.toBlob();
        const path = `${me.id}/sig-${Date.now()}.png`;
        await storage.upload('signatures', path, blob);
        await db.rpc('set_my_signature', { p_path: path });
        priv.signature_path = path; priv.signature_at = new Date().toISOString();
        toast('حُفظ توقيعك.', 'ok');
        drawSig();
      } catch (e) { toast(e.message, 'bad'); }
    });
    sigBox.replaceChildren(
      h('p.small.muted', 'ارسم توقيعك داخل الإطار بإصبعك على الجوال أو بالفأرة على الحاسب.'),
      pad.el, h('div.row', save, clear),
      signatureUpload({ memberId: me.id, onSaved: path => {
        priv.signature_path = path; priv.signature_at = new Date().toISOString(); drawSig();
      } }));
  };
  drawSig();

  const sigCard = h('div.card.stack',
    h('div.row.between', h('h3', 'التوقيع اليدوي'),
      priv.signature_path ? h('span.badge.ok', 'محفوظ') : h('span.badge.warn', 'لم يُرسم بعد')),
    sigBox);

  // التحقق بخطوتين: حالته ورابط تفعيله (ملاحظة ١٠٣)
  const mfaCard = h('div.card.stack',
    h('div.row.between', h('h3', 'التحقق بخطوتين'),
      state.mfaEnrolled ? h('span.badge.ok', h('span.tick', { 'aria-hidden': 'true' }, '✓'), 'مفعَّل')
                        : h('span.badge.warn', 'غير مفعَّل')),
    // التفعيلُ والإيقافُ بيد إدارة المشروع، ويبقى للعضو تجديدُ رموز
    // استرداده وحدها (ملاحظة ٢١٢)
    h('p.small.muted', state.mfaEnrolled
      ? 'يُطلب منك رمز من تطبيق المصادقة عند كل دخول، فلا يدخل حسابك أحد بكلمة المرور وحدها.'
      : 'يُفعَّل لحسابك من إدارة المشروع. وما دام لم يُفعَّل، فحسابك يُفتح بكلمة المرور وحدها.'),
    state.mfaEnrolled
      ? h('div.row', h('a.btn', { href: '/mfa' }, 'رموز الاسترداد'))
      : null);

  const card = await cardSection(me, privRows[0] || {}, langRows.map(r => r.language_code),
    cardRows[0] || null, settingsRows[0] || null);
  const bank = await bankSection(ctx);
  // الورديات والمستحقات: لا تظهر إلا لمن له وردية أو كشف معتمد (ملاحظتا ١١٦ و١١٧)
  const { salarySection, shiftsSection } = await import('./mypay.js');
  const { contribCard } = await import('./glossary.js');
  const [shifts, salary, contrib] = await Promise.all([
    shiftsSection().catch(() => null),
    salarySection().catch(() => null),
    contribCard({ own: true }).catch(() => null)          // مشاركتي في الدليل (ملاحظة ٢٣٥)
  ]);

  // ------------------------------------------------------------------
  // مستنداتي وتجديدُها: يبتدئه العضوُ متى شاء، وتطلبه الإدارةُ بسبب
  //   مكتوب. والقديمُ معمولٌ به حتى يُعتمد الجديد (ملاحظة ٣٠٨)
  // ------------------------------------------------------------------
  const DOC_NAME = { iqama: 'الهوية أو الإقامة', photo: 'الصورة الشخصية',
    bank: 'الحساب البنكي' };
  const docsCard = h('div.card.stack');
  (async () => {
    let rows = [];
    try { rows = await db.rpc('my_docs_state') || []; } catch { return; }
    rows = rows.filter(r => r.status || r.renewal_open);
    if (!rows.length) return;

    const askOwn = async r => {
      const why = h('input', { 'aria-label': 'السبب',
        placeholder: 'جدّدتُ هويتي · بدّلتُ حسابي…' });
      const res = await dialog({
        title: `تجديدُ ${DOC_NAME[r.kind] || r.kind}`,
        body: h('div.stack',
          h('p.small.muted', 'يُفتح لك بابُ الرفع، ويبقى القديمُ معمولًا به حتى '
            + 'يُعتمد الجديد. ولا يلزمك إذنٌ سابق.'),
          h('label.field', 'لِمَ تُجدّده؟ (اختياري)', why)),
        buttons: [
          { label: 'اطلبِ التجديد', kind: 'primary', value: () => ({ why: why.value.trim() }) },
          { label: 'إلغاء', value: null }
        ]
      });
      if (!res) return;
      try {
        await db.rpc('ask_renewal',
          { p_member: me.id, p_kind: r.kind, p_reason: res.why || null });
        toast('فُتح بابُ التجديد — ارفعِ الجديد.', 'ok');
        ctx.navigate('/app/me', { replace: true });
      } catch (e) { toast(e.message, 'bad'); }
    };

    const row = r => {
      const expired = r.days_left != null && Number(r.days_left) < 0;
      const soon = r.days_left != null && Number(r.days_left) >= 0 && Number(r.days_left) <= 90;
      return h('div.row.between.wrap.doc-row',
        h('div.stack', { style: { gap: '2px' } },
          h('b', DOC_NAME[r.kind] || r.kind),
          r.id_expiry
            ? h('span.small', { class: expired ? 'bad' : soon ? 'warn' : 'muted' },
                expired ? `انتهت في ${fmtDate(r.id_expiry)}`
                  : `تنتهي في ${fmtDate(r.id_expiry)}`)
            : null,
          r.renewal_open
            ? h('span.small.warn', r.asked_by_admin
                ? `طُلب منك تجديدُها${r.renewal_reason ? ` — ${r.renewal_reason}` : ''}`
                : 'طلبُ تجديدٍ مفتوح — ارفعِ الجديد')
            : null,
          r.note ? h('span.small.bad', `سببُ الإعادة: ${r.note}`) : null),
        h('div.row', { style: { gap: '6px' } },
          h('span.badge', { class: r.status === 'approved' ? 'ok'
            : r.status === 'rejected' ? 'bad' : 'warn' },
            r.status === 'approved' ? 'معتمَد'
              : r.status === 'rejected' ? 'أُعيد إليك' : 'تحت المراجعة'),
          (!r.renewal_open && r.status === 'approved')
            ? h('button.btn.xs', { type: 'button', onclick: () => askOwn(r) }, 'تجديد')
            : null));
    };

    docsCard.replaceChildren(
      h('b', 'مستنداتي'),
      h('p.small.muted', 'ما اعتُمد منها يبقى معمولًا به. وإن جدّدتَ هويتَك أو بدّلتَ '
        + 'حسابك فاطلبِ التجديدَ من هنا، ثم ارفعِ الجديد.'),
      h('div.stack', { style: { gap: '8px' } }, rows.map(row)));
  })();

  return h('div',
    h('div.page-head', h('div.grow', h('div.eyebrow', 'حسابي'), h('h1', 'بياناتي'),
      h('p.muted', 'بياناتك كما هي مسجّلة في المشروع، وصورتك الشخصية، وحسابك البنكي.'))),
    h('div.me-top',
      h('div.card.photo-card',
        h('h3', 'الصورة الشخصية'),
        photoBox,
        docState(priv.photo_status, priv.photo_note, 'photo'),
        h('label.field', 'رفع الصورة أو تغييرها', h('small', 'تُقصّ تلقائيًّا إلى مقاس 4×6'), picker),
        rules),
      fixed),
    completeCard,
    docsCard,
    shifts,
    salary,
    editable,
    sigCard,
    mfaCard,
    contrib,
    card,
    bank);
}

// ---------------------------------------------------------------------
// بطاقة العمل: تظهر للعضو بعد اعتمادها، يستعرضها ويبرزها عند الحاجة (ملاحظة ٨٧)
// ---------------------------------------------------------------------
async function cardSection(me, priv, langs, issued, settings) {
  if (!issued || !settings) {
    return h('div.card.stack',
      h('h3', 'بطاقة العمل'),
      h('p.small.muted', 'تظهر بطاقتك هنا بعد اعتمادها من إدارة المشروع، فتستعرضها وتبرزها عند الحاجة.'));
  }

  const layout = normalizeLayout(settings.layout);
  const validUntil = issued.valid_until || settings.valid_until;
  const cfg = {
    title: settings.title || 'بطاقة عمل',
    subtitle: settings.subtitle || '',
    official_name: settings.official_name || '',
    official_title: settings.official_title || '',
    valid_until_text: validUntil ? fmtDate(validUntil) : ''
  };
  const langsText = langs.map(c => langName(c)).join(' · ');
  const myRoleLabel = roleLabel(me);

  const logoSrc = settings.logo_kind === 'none' ? null
    : settings.logo_kind === 'custom' && settings.logo_path
      ? await storage.signedUrl('brand', settings.logo_path, 3600).catch(() => null)
      : HARAMAIN_LOGO;
  const photoUrl = priv.photo_path
    ? await storage.signedUrl('member-photos', priv.photo_path, 600).catch(() => null)
    : null;

  // صور العناصر المضافة إلى التصميم
  const customUrls = {};
  await Promise.all((layout.custom || []).filter(c => c.type === 'image' && c.path).map(async c => {
    try { customUrls[c.id] = await storage.signedUrl('brand', c.path, 600); } catch { /* تُتجاوز */ }
  }));

  const build = scale => staticCard(h, { layout, member: me, cfg, roleLabel: myRoleLabel, langsText, logoSrc, photoUrl, customUrls, scale });

  const expired = validUntil && new Date(validUntil) < new Date(new Date().toDateString());
  const showBtn = h('button.btn.primary', { type: 'button' }, 'إبراز البطاقة');
  showBtn.onclick = () => dialog({
    // تكبير يملأ الشاشة دون أن يتجاوزها — تُبرز على الجوال كما على الحاسب
    title: cfg.title,
    body: h('div.card-show', build(Math.max(3.2, Math.min(10, (Math.min(window.innerWidth, 760) - 76) / CARD.w))),
      h('p.small.muted', `${me.full_name} — ${myRoleLabel}${cfg.valid_until_text ? ` · سارية حتى ${cfg.valid_until_text}` : ''}`)),
    buttons: [{ label: 'إغلاق', value: null }]
  });

  const printBtn = h('button.btn', { type: 'button' }, 'طباعة البطاقة');
  printBtn.onclick = () => busy(printBtn, async () => {
    let logoData = logoSrc;
    if (logoSrc) { try { logoData = await urlToDataUrl(logoSrc); } catch { /* يبقى الرابط */ } }
    let photoData = null;
    if (photoUrl) { try { photoData = await urlToDataUrl(photoUrl); } catch { /* بلا صورة */ } }
    const customData = {};
    await Promise.all(Object.entries(customUrls).map(async ([id, u]) => {
      try { customData[id] = await urlToDataUrl(u); } catch { /* تُتجاوز */ }
    }));
    const { printOneCard } = await import('./cards.js');
    if (!printOneCard({ member: me, photo: photoData, langsText }, cfg, layout, logoData, customData)) {
      toast('اسمح بالنوافذ المنبثقة لإتمام الطباعة.', 'bad');
    }
  });

  return h('div.card.stack',
    h('div.row.between', h('h3', 'بطاقة العمل'),
      expired ? h('span.badge.warn', 'انتهت صلاحيتها') : h('span.badge.ok', 'معتمَدة')),
    h('div.card-show', build(6)),
    h('p.small.muted', `اعتُمدت في ${fmtDateTime(issued.issued_at)}${cfg.valid_until_text ? ` — سارية حتى ${cfg.valid_until_text}` : ''}.`),
    h('div.row', showBtn, printBtn));
}
