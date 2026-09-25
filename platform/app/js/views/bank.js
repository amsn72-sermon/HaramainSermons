// الحساب البنكي للعضو: داخل المملكة آيبان، وخارجها سويفت وما يلزم معه (ملاحظة ٨٤)
import { h, toast, busy, confirm, dialog, fmtDateTime } from '../ui.js';
import { db, storage } from '../sb.js';
import { state, isManager } from '../store.js';

const clean = v => String(v || '').replace(/\s+/g, '').toUpperCase();
export const ibanPretty = v => clean(v).replace(/(.{4})/g, '$1 ').trim();

// ما يلزم لكل دولة زيادةً على الآيبان وسويفت — إرشاد للعضو لا قيد
const ROUTING_HINT = [
  ['الولايات المتحدة', 'رقم التوجيه ABA (تسعة أرقام) مع رقم الحساب — ولا يوجد آيبان'],
  ['المملكة المتحدة', 'Sort code (ستة أرقام) ورقم الحساب (ثمانية) — والآيبان متاح أيضًا'],
  ['كندا', 'Transit number (خمسة) ورمز المؤسسة (ثلاثة) مع رقم الحساب'],
  ['أستراليا', 'BSB (ستة أرقام) مع رقم الحساب'],
  ['الهند', 'رمز IFSC (أحد عشر محرفًا) مع رقم الحساب'],
  ['باكستان ومصر وتركيا ودول أوروبا', 'الآيبان يكفي مع سويفت']
];

// قسم الحساب البنكي داخل شاشة «بياناتي» (ملاحظة ٨٥)
export async function bankSection(ctx) {
  const me = state.profile;
  const rows = await db.select('bank_accounts', { select: '*', member_id: `eq.${me.id}` }).catch(() => []);
  const acc = rows[0] || null;

  const f = {
    scope: h('select',
      h('option', { value: 'local' }, 'حساب داخل المملكة'),
      h('option', { value: 'international' }, 'حساب خارج المملكة')),
    account_holder: h('input', { value: acc?.account_holder || me.full_name || '', maxlength: 140 }),
    bank_name: h('input', { value: acc?.bank_name || '', maxlength: 140 }),
    iban: h('input', { dir: 'ltr', value: acc?.iban ? ibanPretty(acc.iban) : '', placeholder: 'SA00 0000 0000 0000 0000 0000' }),
    account_number: h('input', { dir: 'ltr', value: acc?.account_number || '' }),
    swift: h('input', { dir: 'ltr', value: acc?.swift || '', placeholder: 'ABCDSARIXXX', maxlength: 11 }),
    routing_code: h('input', { dir: 'ltr', value: acc?.routing_code || '' }),
    bank_address: h('input', { value: acc?.bank_address || '', placeholder: 'المدينة والدولة، والفرع إن وُجد' }),
    country: h('input', { value: acc?.country || '', placeholder: 'دولة البنك' }),
    currency: h('input', { dir: 'ltr', value: acc?.currency || '', placeholder: 'SAR أو USD أو EUR', maxlength: 8 }),
    intermediary: h('input', { value: acc?.intermediary || '', placeholder: 'اسم البنك الوسيط ورمز سويفت — إن طلبه البنك' }),
    notes: h('input', { value: acc?.notes || '', maxlength: 300 })
  };
  f.scope.value = acc?.scope || 'local';

  const localOnly = h('div.stack');
  const intlOnly = h('div.stack');
  const sync = () => {
    const intl = f.scope.value === 'international';
    localOnly.hidden = intl; intlOnly.hidden = !intl;
    f.iban.placeholder = intl ? 'الآيبان إن كان لبلد البنك آيبان' : 'SA00 0000 0000 0000 0000 0000';
  };
  f.scope.addEventListener('change', sync);

  localOnly.append(
    h('p.small.muted', 'الآيبان السعودي يبدأ بـ SA ويتكوّن من ٢٤ خانة. انسخه من تطبيق بنكك أو من شهادة الآيبان.'));

  // الإرشاد خلف رابط صغير لا يشغل الشاشة
  const guideBtn = h('button.btn.sm.ghost', { type: 'button' }, 'ما يلزم للحساب خارج المملكة؟');
  guideBtn.onclick = () => dialog({
    title: 'ما يلزم للحساب خارج المملكة',
    body: h('div.stack',
      h('ul',
        h('li', h('b', 'اسم صاحب الحساب '), 'كما هو مكتوب في البنك حرفًا بحرف — أي اختلاف يُرجِع الحوالة.'),
        h('li', h('b', 'الآيبان '), 'إن كان لبلد البنك آيبان (أوروبا، تركيا، مصر، باكستان…)، وإلا ', h('b', 'رقم الحساب'), '.'),
        h('li', h('b', 'رمز سويفت (BIC) '), 'ثمانية أو أحد عشر محرفًا — لازم دائمًا.'),
        h('li', h('b', 'اسم البنك وعنوانه '), 'المدينة والدولة، والفرع إن طلبه البنك.'),
        h('li', h('b', 'دولة الحساب وعملته '), 'مثل USD أو EUR — الحوالة بعملة الحساب أسلم وأقل كلفة.'),
        h('li', h('b', 'رمز التوجيه '), 'حيث يلزم: ABA في أمريكا، Sort code في بريطانيا، IFSC في الهند، BSB في أستراليا.'),
        h('li', h('b', 'بنك وسيط '), 'اسمه ورمز سويفت — لا يُطلب غالبًا، واسأل بنكك إن كانت عملتك نادرة.')),
      h('div.table-wrap', h('table.responsive',
        h('thead', h('tr', h('th', 'الدولة'), h('th', 'ما يُضاف'))),
        h('tbody', ROUTING_HINT.map(([c, t]) => h('tr',
          h('td', { 'data-label': 'الدولة' }, c),
          h('td', { 'data-label': 'ما يُضاف' }, t)))))))
  });

  intlOnly.append(
    h('div.grid-2', { id: 'intl-fields' },
      h('label.field', 'رقم الحساب', h('small', 'إن لم يكن لبلد البنك آيبان'), f.account_number),
      h('label.field', 'رمز سويفت (BIC)', f.swift),
      h('label.field', 'رمز التوجيه', h('small', 'ABA أو Sort code أو IFSC أو BSB'), f.routing_code),
      h('label.field', 'دولة البنك', f.country),
      h('label.field', 'عملة الحساب', f.currency),
      h('label.field', 'عنوان البنك', f.bank_address)),
    h('label.field', 'بنك وسيط', h('small', 'إن طلبه بنكك'), f.intermediary),
    h('div.row', guideBtn));

  const err = h('div.form-errors.bank-errors', { hidden: true, role: 'alert' });
  const showErr = list => { err.replaceChildren(h('ul', list.map(e => h('li', e)))); err.hidden = !list.length; };

  const save = h('button.btn.primary', { type: 'button' }, 'حفظ بيانات الحساب');
  save.onclick = () => busy(save, async () => {
    const intl = f.scope.value === 'international';
    const iban = clean(f.iban.value);
    const swift = clean(f.swift.value);
    const e = [];
    if (f.account_holder.value.trim().length < 3) e.push('اكتب اسم صاحب الحساب كما هو في البنك');
    if (f.bank_name.value.trim().length < 2) e.push('اكتب اسم البنك');
    if (!intl) {
      if (!/^SA[0-9]{22}$/.test(iban)) e.push('الآيبان السعودي يبدأ بـ SA ويتكوّن من ٢٤ خانة');
    } else {
      if (!iban && !f.account_number.value.trim()) e.push('اكتب الآيبان أو رقم الحساب');
      if (iban && !/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(iban)) e.push('صيغة الآيبان غير صحيحة');
      if (!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(swift)) e.push('رمز سويفت ثمانية أو أحد عشر محرفًا');
      if (!f.country.value.trim()) e.push('حدد دولة البنك');
    }
    showErr(e);
    if (e.length) return;
    try {
      await db.rpc('save_bank_account', {
        p_scope: f.scope.value, p_account_holder: f.account_holder.value.trim(),
        p_bank_name: f.bank_name.value.trim(), p_iban: iban || null,
        p_account_number: f.account_number.value.trim() || null, p_swift: swift || null,
        p_routing_code: f.routing_code.value.trim() || null, p_bank_address: f.bank_address.value.trim() || null,
        p_country: f.country.value.trim() || null, p_currency: clean(f.currency.value) || null,
        p_intermediary: f.intermediary.value.trim() || null, p_notes: f.notes.value.trim() || null
      });
      toast('حُفظت بيانات الحساب.', 'ok');
      ctx.navigate('/app/me', { replace: true });
    } catch (e2) { showErr([e2.message]); }
  });

  // خطاب البنك أو شهادة الآيبان
  const docBox = h('div.stack', { style: { gap: '8px' } });
  const drawDoc = () => {
    const view = h('div');
    if (acc?.doc_path) storage.signedUrl('bank-docs', acc.doc_path, 600)
      .then(url => view.replaceChildren(h('a.btn.sm', { href: url, target: '_blank', rel: 'noopener' }, 'عرض الخطاب (رابط مؤقت ١٠ دقائق)')))
      .catch(() => view.replaceChildren(h('span.small.muted', 'تعذّر فتح الملف')));
    else view.replaceChildren(h('span.small.muted', 'لم يُرفع خطاب البنك بعد'));
    const up = h('input', { type: 'file', accept: 'application/pdf,image/*', 'aria-label': 'رفع خطاب البنك' });
    up.onchange = () => busy(up, async () => {
      const file = up.files[0]; if (!file) return;
      if (file.size > 10 * 1024 * 1024) return toast('الحد الأقصى ١٠ ميغابايت.', 'bad');
      try {
        const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '');
        const path = `${me.id}/bank-${Date.now()}.${ext}`;
        await storage.upload('bank-docs', path, file);
        await db.rpc('set_bank_doc', { p_path: path });
        toast('رُفع خطاب البنك.', 'ok');
        ctx.navigate('/app/me', { replace: true });
      } catch (e3) { toast(e3.message, 'bad'); }
    });
    docBox.replaceChildren(view,
      h('label.field', 'رفع خطاب البنك أو شهادة الآيبان', h('small', 'PDF أو صورة، حتى ١٠ ميغابايت'), up));
  };
  drawDoc();

  // الحساب تحت المراجعة حتى يطابقه المنسق بخطاب البنك فيعتمده (ملاحظة ٩٨)
  const status = acc
    ? (acc.verified_at
        ? h('div.policy-state.signed', h('span.tick', { 'aria-hidden': 'true' }, '✓'), `معتمَد — موثّق في ${fmtDateTime(acc.verified_at)}`)
        : h('div.policy-state.unsigned', 'تحت المراجعة'))
    : h('p.small.muted', 'لم تُسجّل حسابك البنكي بعد.');
  const statusNote = acc && !acc.verified_at
    ? h('p.small.muted', 'بياناتك محفوظة، ويطابقها المنسق بخطاب البنك المرفق ثم يعتمدها. الصرف بعد الاعتماد.')
    : null;

  sync();
  return h('div.stack',
    h('div.card.stack',
      h('div.row.between', h('h3', 'الحساب البنكي'), status),
      h('p.small.muted', 'تُستخدم هذه البيانات لصرف مستحقات الترجمة، ولا يطّلع عليها إلا المنسق ومدير المشروع.'),
      statusNote,
      err),
    h('div.card.stack',
      h('label.field', 'مكان الحساب', f.scope),
      h('div.grid-2',
        h('label.field', 'اسم صاحب الحساب', h('small', 'كما هو في البنك حرفًا بحرف'), f.account_holder),
        h('label.field', 'اسم البنك', f.bank_name)),
      localOnly,
      h('label.field', 'الآيبان (IBAN)', f.iban),
      intlOnly,
      h('label.field', 'ملاحظة', f.notes),
      h('div.row', save)),
    h('div.card.stack', h('h3', 'خطاب البنك'), docBox));
}

// شاشة الإدارة: حسابات الفريق وتوثيقها
export async function adminList(ctx, opts = {}) {
  const [all, members] = await Promise.all([
    db.select('bank_accounts', { select: '*' }),
    db.select('profiles', { select: 'id,full_name,role,email', order: 'full_name.asc' })
  ]);
  // كل فريق وحساباته على حدة (ملاحظة ٩٩)
  const accounts = opts.only ? all.filter(a => opts.only.has(a.member_id)) : all;
  const byId = Object.fromEntries(members.map(m => [m.id, m]));
  const reload = () => ctx.navigate(opts.reloadPath || '/app/bank-accounts', { replace: true });

  const rowEl = a => {
    const m = byId[a.member_id] || {};
    return h('tr',
      h('td', { 'data-label': 'العضو' }, h('b', m.full_name || '—'), h('span.sub', { dir: 'ltr' }, m.email || '')),
      h('td', { 'data-label': 'البنك' }, a.bank_name, h('span.sub', a.scope === 'local' ? 'داخل المملكة' : `خارج المملكة — ${a.country || ''}`)),
      h('td', { 'data-label': 'الآيبان' }, h('span', { dir: 'ltr' }, a.iban ? ibanPretty(a.iban) : (a.account_number || '—')),
        a.swift && h('span.sub', { dir: 'ltr' }, a.swift)),
      h('td', { 'data-label': 'التوثيق' }, a.verified_at
        ? h('span.badge.ok', h('span.tick', { 'aria-hidden': 'true' }, '✓'), 'معتمَد')
        : h('span.badge.warn', 'تحت المراجعة')),
      h('td', h('div.row',
        a.doc_path && h('button.btn.sm', { type: 'button', onclick: e => busy(e.currentTarget, async () => {
          try { window.open(await storage.signedUrl('bank-docs', a.doc_path, 600), '_blank', 'noopener'); }
          catch (err) { toast(err.message, 'bad'); }
        }) }, 'الخطاب'),
        isManager() && h('button.btn.sm', { type: 'button', onclick: e => busy(e.currentTarget, async () => {
          const on = !a.verified_at;
          if (on && !await confirm('توثيق الحساب', `تؤكد مطابقة بيانات ${m.full_name} لخطاب البنك؟`, 'توثيق')) return;
          try { await db.rpc('verify_bank_account', { p_member: a.member_id, p_verified: on }); toast('تم.', 'ok'); reload(); }
          catch (err) { toast(err.message, 'bad'); }
        }) }, a.verified_at ? 'إلغاء التوثيق' : 'توثيق'))));
  };

  const body = accounts.length ? h('div.table-wrap', h('table.responsive',
    h('thead', h('tr', ['العضو', 'البنك', 'الآيبان / رقم الحساب', 'التوثيق', ''].map(t => h('th', t)))),
    h('tbody', accounts.map(rowEl))))
    : h('p.muted', 'لم يسجّل أحد حسابه البنكي بعد.');

  // جزء داخل شاشة «شؤون الفريق» الموحّدة (ملاحظة ٩٨)
  if (opts.parts) {
    return h('div.card.stack',
      h('div.row.between', h('h3', 'الحسابات البنكية'),
        h('span.badge', `${accounts.filter(a => !a.verified_at).length} تحت المراجعة`)),
      h('p.small.muted', 'يسجّل كل عضو حسابه بنفسه، ويعتمده مدير المشروع بعد مطابقته بخطاب البنك المرفق.'),
      body);
  }

  return h('div',
    h('div.page-head', h('div.grow', h('div.eyebrow', 'الإدارة'), h('h1', 'الحسابات البنكية'),
      h('p.muted', 'يسجّل كل عضو حسابه بنفسه، ويوثّقه مدير المشروع بعد مطابقته بخطاب البنك.'))),
    body);
}
