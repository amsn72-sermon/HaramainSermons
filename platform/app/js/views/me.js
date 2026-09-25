// «بياناتي»: بيانات العضو كاملة، وصورته الشخصية، وحسابه البنكي أسفلها (ملاحظة ٨٥)
import { h, toast, busy, dialog, fmtDate, fmtDateTime } from '../ui.js';
import { db, storage } from '../sb.js';
import { state, ROLE_LABEL, STATUS_LABEL, langName } from '../store.js';
import { PHOTO_RULES, preparePhoto, readStashed, clearStashed, dataUrlToBlob, urlToDataUrl } from '../photo.js';
import { bankSection } from './bank.js';
import { normalizeLayout, staticCard, HARAMAIN_LOGO, CARD } from '../carddesign.js';

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

  // ------------------------------------------------------------------
  // الصورة الشخصية
  // ------------------------------------------------------------------
  const photoBox = h('div.photo-box');
  const rules = h('details.photo-rules',
    h('summary', 'شروط الصورة الشخصية'),
    h('ul', PHOTO_RULES.map(t => h('li', t))));

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
      photoBox.replaceChildren(h('div.photo-empty', h('b', '٤ × ٦'), h('span', 'لم تُرفع صورة بعد')));
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
      h('div', h('dt', 'الصفة'), h('dd', ROLE_LABEL[me.role] || me.role)),
      h('div', h('dt', 'حالة الحساب'), h('dd', STATUS_LABEL[me.status] || me.status)),
      h('div', h('dt', 'تاريخ التسجيل'), h('dd', fmtDate(me.created_at))),
      h('div', h('dt', 'اللغات'),
        h('dd', langs.length ? langs.map(c => h('span.chip', langName(c))) : '—',
          h('div.small.muted', 'تُسنَد اللغات من المنسق بحسب الاختبار.')))),
    h('p.small.muted', 'لتصحيح الاسم أو رقم الهوية راسل منسق المشروع — فهما يظهران في بطاقة العمل والتصاريح.'));

  // ------------------------------------------------------------------
  // بيانات يعدّلها العضو
  // ------------------------------------------------------------------
  const f = {
    whatsapp: h('input', { dir: 'ltr', value: priv.whatsapp || '', placeholder: '05xxxxxxxx', maxlength: 24 }),
    nationality: h('input', { value: priv.nationality || '', maxlength: 60 }),
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

  const card = await cardSection(me, privRows[0] || {}, langRows.map(r => r.language_code),
    cardRows[0] || null, settingsRows[0] || null);
  const bank = await bankSection(ctx);

  return h('div',
    h('div.page-head', h('div.grow', h('div.eyebrow', 'حسابي'), h('h1', 'بياناتي'),
      h('p.muted', 'بياناتك كما هي مسجّلة في المشروع، وصورتك الشخصية، وحسابك البنكي.'))),
    h('div.me-top',
      h('div.card.photo-card',
        h('h3', 'الصورة الشخصية'),
        photoBox,
        h('label.field', 'رفع الصورة أو تغييرها', h('small', 'تُقصّ تلقائيًّا إلى مقاس ٤×٦'), picker),
        rules),
      fixed),
    editable,
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
  const roleLabel = ROLE_LABEL[me.role] || me.role;

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

  const build = scale => staticCard(h, { layout, member: me, cfg, roleLabel, langsText, logoSrc, photoUrl, customUrls, scale });

  const expired = validUntil && new Date(validUntil) < new Date(new Date().toDateString());
  const showBtn = h('button.btn.primary', { type: 'button' }, 'إبراز البطاقة');
  showBtn.onclick = () => dialog({
    // تكبير يملأ الشاشة دون أن يتجاوزها — تُبرز على الجوال كما على الحاسب
    title: cfg.title,
    body: h('div.card-show', build(Math.max(3.2, Math.min(10, (Math.min(window.innerWidth, 760) - 76) / CARD.w))),
      h('p.small.muted', `${me.full_name} — ${roleLabel}${cfg.valid_until_text ? ` · سارية حتى ${cfg.valid_until_text}` : ''}`)),
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
