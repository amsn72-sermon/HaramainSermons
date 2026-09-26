// بطاقات عمل فريق الترجمة: تصميمها بالسحب والإفلات وطباعتها (ملاحظتا ٨٥ و٨٦)
import { h, toast, busy, escapeHtml, fmtDate } from '../ui.js';
import { db, storage } from '../sb.js';
import { ROLE_LABEL, langName } from '../store.js';
import { urlToDataUrl } from '../photo.js';
import {
  CARD, HARAMAIN_LOGO, ITEM_LABEL, ITEM_ORDER, COLORS, PRESETS, PRESET_LAYOUT,
  DEFAULT_LAYOUT, normalizeLayout, clampLayout, photoH, itemText, itemStyle,
  bandStyle, ruleStyle, scaleStyle, logoExtra, newCustom, customLabel, CARD_FONTS, fontStack
} from '../carddesign.js';

const SCALE = 6;                           // بكسل لكل مليمتر على الشاشة
const px = mm => `${mm * SCALE}px`;
const round = v => Math.round(v * 10) / 10;

export async function render(ctx) {
  const [members, priv, langRows, settingsRows, cardRows] = await Promise.all([
    db.select('profiles', { select: 'id,full_name,role,status,member_no,email,track', order: 'full_name.asc' }),
    db.select('profile_private', { select: 'id,photo_path' }).catch(() => []),
    db.select('member_languages', { select: 'member_id,language_code' }).catch(() => []),
    db.select('card_settings', { select: '*' }).catch(() => []),
    db.select('member_cards', { select: '*' }).catch(() => [])
  ]);
  const photoOf = Object.fromEntries(priv.map(p => [p.id, p.photo_path]));
  const langsOf = {};
  for (const r of langRows) (langsOf[r.member_id] ||= []).push(r.language_code);
  const saved = settingsRows[0] || {};
  const issuedOf = Object.fromEntries((cardRows || []).map(c => [c.member_id, c]));

  let layout = normalizeLayout(saved.layout);
  let logoKind = saved.logo_kind || 'haramain';
  let logoPath = saved.logo_path || null;
  let logoUrl = null;                       // رابط الشعار المرفوع بعد جلبه
  let selected = 'name';
  const customUrls = {};                    // روابط صور العناصر المضافة
  const cus = id => (layout.custom || []).find(c => c.id === id) || null;
  const curItem = () => (selected.startsWith('c:') ? cus(selected.slice(2)) : layout.items[selected]);
  const loadCustomImg = async c => {
    if (!c.path || customUrls[c.id]) return;
    try { customUrls[c.id] = await storage.signedUrl('brand', c.path, 3600); } catch { /* يُعاد لاحقًا */ }
  };

  const pool = members.filter(m => m.status === 'active');
  const picked = new Set(pool.filter(m => m.role === 'translator' && m.track !== 'field').map(m => m.id));

  const f = {
    title: h('input', { value: saved.title || 'بطاقة عمل', maxlength: 60 }),
    subtitle: h('input', { value: saved.subtitle || 'مشروع خادم الحرمين الشريفين للترجمة', maxlength: 90 }),
    official_name: h('input', { value: saved.official_name || '', maxlength: 90 }),
    official_title: h('input', { value: saved.official_title || '', maxlength: 90, placeholder: 'مثال: مدير مشروع الترجمة' }),
    valid_until: h('input', { type: 'date', value: saved.valid_until || '' })
  };

  const cfg = () => ({
    title: f.title.value.trim() || 'بطاقة عمل',
    subtitle: f.subtitle.value.trim(),
    official_name: f.official_name.value.trim(),
    official_title: f.official_title.value.trim(),
    valid_until: f.valid_until.value || null,
    valid_until_text: f.valid_until.value ? fmtDate(f.valid_until.value) : ''
  });

  // ------------------------------------------------------------------
  // لوحة التصميم: البطاقة بمقاسها الحقيقي مضروبًا في SCALE
  // ------------------------------------------------------------------
  const stage = h('div.card-stage', { tabindex: '0', 'aria-label': 'لوحة تصميم البطاقة' });
  const panel = h('div.cd-panel');
  const bandBox = h('div.stack');
  const fontBox = h('div');   // نوع الخط ظاهر دائمًا لا داخل التفاصيل المطوية
  const logoBox = h('div.stack');
  const sampleOf = () => pool.find(m => picked.has(m.id)) || pool[0] || null;
  const logoSrc = () => (logoKind === 'none' ? null : logoKind === 'custom' ? logoUrl : HARAMAIN_LOGO);

  function elFor(key, member) {
    const it = layout.items[key];
    if (!it.show) return null;
    const style = { ...itemStyle(it, key), left: px(it.x), top: px(it.y), width: px(it.w) };
    if (key === 'photo') style.height = px(photoH(it.w));
    if (it.size) style.fontSize = `${it.size * SCALE * 25.4 / 72}px`;

    let inner;
    if (key === 'logo') {
      const src = logoSrc();
      if (!src) return null;
      Object.assign(style, scaleStyle(logoExtra(it), SCALE) || {});
      inner = h('img', { src, alt: '', style: { width: '100%', height: 'auto', display: 'block' } });
    } else if (key === 'photo') {
      inner = (member && photoOf[member.id])
        ? h('img.cd-photo-img', { alt: '' })
        : h('span.cd-photo-ph', '٤×٦');
    } else {
      const text = itemText(key, {
        member: member || { full_name: 'اسم المترجم' }, cfg: cfg(),
        roleLabel: ROLE_LABEL[member?.role] || 'مترجم',
        langsText: (langsOf[member?.id] || []).map(c => langName(c)).join(' · ')
      });
      inner = document.createTextNode(text || `(${ITEM_LABEL[key]})`);
    }

    const box = h(`div.cd-item.editable.cd-${key}`, { style, 'data-key': key }, inner);
    if (key === selected) box.classList.add('sel');
    box.addEventListener('pointerdown', e => startDrag(e, key, box));
    return box;
  }

  function drawStage() {
    const member = sampleOf();
    const band = layout.band;
    stage.style.width = px(CARD.w);
    stage.style.height = px(CARD.h);
    stage.style.background = layout.card.bg;
    stage.style.borderColor = layout.card.border;
    stage.style.fontFamily = fontStack(layout.font);   // نوع الخط العام للبطاقة (ملاحظة ١٠٠)
    const kids = [];
    const bs = scaleStyle(bandStyle(band), SCALE);
    if (bs) kids.push(h('div.cd-band', { style: bs }));
    for (const k of ['top', 'bottom']) {
      const rs = scaleStyle(ruleStyle(layout.rules[k]), SCALE);
      if (rs) kids.push(h('div.cd-rule', { style: rs }));
    }
    for (const key of ITEM_ORDER) {
      const el = elFor(key, member);
      if (el) kids.push(el);
    }
    for (const c of (layout.custom || [])) {
      if (!c.show) continue;
      const st = { ...itemStyle(c, c.type === 'image' ? 'ci' : 'ct'),
        left: px(c.x), top: px(c.y), width: px(c.w) };
      if (c.size) st.fontSize = `${c.size * SCALE * 25.4 / 72}px`;
      let inner;
      if (c.type === 'image') {
        Object.assign(st, scaleStyle(logoExtra(c), SCALE) || {});
        inner = customUrls[c.id]
          ? h('img', { src: customUrls[c.id], alt: '', style: { width: '100%', height: 'auto', display: 'block' } })
          : h('span.cd-photo-ph', 'صورة');
      } else inner = document.createTextNode(c.text || '(نص)');
      const box = h('div.cd-item.editable', { style: st, 'data-key': `c:${c.id}` }, inner);
      if (selected === `c:${c.id}`) box.classList.add('sel');
      box.addEventListener('pointerdown', e => startDrag(e, `c:${c.id}`, box));
      kids.push(box);
    }
    stage.replaceChildren(...kids);
    const img = stage.querySelector('.cd-photo-img');
    if (img && member && photoOf[member.id]) {
      storage.signedUrl('member-photos', photoOf[member.id], 600).then(u => { img.src = u; }).catch(() => {});
    }
    drawPanel();
  }

  // ------------------------------------------------------------------
  // السحب والإفلات، والتحريك بالأسهم
  // ------------------------------------------------------------------
  function startDrag(e, key, box) {
    if (e.button) return;
    selected = key;
    stage.querySelectorAll('.cd-item').forEach(el => el.classList.toggle('sel', el.dataset.key === key));
    drawPanel();
    const it = key.startsWith('c:') ? cus(key.slice(2)) : layout.items[key];
    if (!it) return;
    const startX = e.clientX, startY = e.clientY, ox = it.x, oy = it.y;
    box.setPointerCapture?.(e.pointerId);
    const move = ev => {
      it.x = ox + (ev.clientX - startX) / SCALE;
      it.y = oy + (ev.clientY - startY) / SCALE;
      clampLayout(layout);
      box.style.left = px(it.x); box.style.top = px(it.y);
      drawPanel();
    };
    const up = () => {
      box.removeEventListener('pointermove', move);
      box.removeEventListener('pointerup', up);
      box.removeEventListener('pointercancel', up);
    };
    box.addEventListener('pointermove', move);
    box.addEventListener('pointerup', up);
    box.addEventListener('pointercancel', up);
    e.preventDefault();
  }

  stage.addEventListener('keydown', e => {
    const step = e.shiftKey ? 2 : 0.5;
    const d = { ArrowRight: [step, 0], ArrowLeft: [-step, 0], ArrowDown: [0, step], ArrowUp: [0, -step] }[e.key];
    if (!d) return;
    const it = curItem();
    if (!it) return;
    it.x += d[0]; it.y += d[1];
    clampLayout(layout); drawStage();
    e.preventDefault();
  });

  // ------------------------------------------------------------------
  // خصائص العنصر المختار
  // ------------------------------------------------------------------
  function sizeRange(value, min, max, step, set) {
    const r = h('input', { type: 'range', min, max, step, value, 'aria-label': 'المقاس' });
    r.oninput = () => { set(Number(r.value)); clampLayout(layout); drawStage(); };
    return r;
  }
  function colorRow(current, set) {
    return h('div.color-row', COLORS.map(([c, name]) => {
      const b = h('button.swatch', { type: 'button', title: name, 'aria-label': name,
        style: { background: c }, 'aria-pressed': c === current ? 'true' : 'false' });
      if (c === current) b.classList.add('on');
      b.onclick = () => { set(c); drawStage(); };
      return b;
    }));
  }
  // اختيار نوع الخط: للبطاقة كلها، أو لعنصر بعينه مع خيار «كخط البطاقة»
  function fontSelect(current, set, allowInherit) {
    // تسمية صريحة: اسم القائمة لا يجرّ معه أسماء الخطوط فيلتبس البحث
    const sel = h('select', { 'aria-label': allowInherit ? 'خط هذا العنصر' : 'نوع خط البطاقة' },
      allowInherit ? h('option', { value: '', selected: !current ? true : null }, 'كخط البطاقة') : null,
      CARD_FONTS.map(([k, label, stack]) =>
        h('option', { value: k, selected: k === current ? true : null, style: { fontFamily: stack } }, label)));
    sel.onchange = () => { set(sel.value); drawStage(); };
    return sel;
  }

  const chip = (label, on, fn) => {
    const b = h('button.btn.sm', { type: 'button', 'aria-pressed': on ? 'true' : 'false' }, label);
    if (on) b.classList.add('primary');
    b.onclick = () => { fn(); drawStage(); };
    return b;
  };

  function drawPanel() {
    const isCustom = selected.startsWith('c:');
    const it = curItem();
    if (!it) { selected = 'name'; return drawPanel(); }

    const pick = h('select', { 'aria-label': 'العنصر' },
      ITEM_ORDER.map(k => h('option', { value: k, selected: k === selected ? true : null }, ITEM_LABEL[k])),
      (layout.custom || []).map((c, i) =>
        h('option', { value: `c:${c.id}`, selected: `c:${c.id}` === selected ? true : null }, customLabel(c, i))));
    pick.onchange = () => { selected = pick.value; drawStage(); };

    const posX = h('input', { type: 'number', step: '0.5', value: round(it.x), 'aria-label': 'البُعد الأفقي' });
    const posY = h('input', { type: 'number', step: '0.5', value: round(it.y), 'aria-label': 'البُعد الرأسي' });
    posX.onchange = () => { it.x = Number(posX.value); clampLayout(layout); drawStage(); };
    posY.onchange = () => { it.y = Number(posY.value); clampLayout(layout); drawStage(); };

    const kids = [
      h('label.field', 'العنصر', pick),
      h('div.row', chip(it.show ? 'العنصر ظاهر' : 'العنصر مخفي', it.show, () => { it.show = !it.show; })),
      h('div.grid-2',
        h('label.field', 'من اليسار (مم)', posX),
        h('label.field', 'من الأعلى (مم)', posY)),
      h('label.field', `${selected === 'photo' || it.type === 'image' ? 'عرض الصورة' : 'عرض الحقل'} (${round(it.w)} مم)`,
        sizeRange(it.w, 3, CARD.w, 0.5, v => { it.w = v; }))
    ];

    // نص العنصر المضاف يُكتب هنا
    if (isCustom && it.type === 'text') {
      const txt = h('input', { value: it.text || '', maxlength: 300, 'aria-label': 'نص العنصر' });
      txt.oninput = () => { it.text = txt.value; drawStage(); };
      kids.splice(1, 0, h('label.field', 'النص', txt));
    }
    if (isCustom && it.type === 'image') {
      const up = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/svg+xml',
        'aria-label': 'صورة العنصر' });
      up.onchange = () => busy(up, async () => {
        const file = up.files[0]; if (!file) return;
        if (file.size > 3 * 1024 * 1024) return toast('الحد الأقصى ٣ ميغابايت.', 'bad');
        try {
          const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
          const path = `card-${it.id}-${Date.now()}.${ext}`;
          await storage.upload('brand', path, file);
          it.path = path;
          customUrls[it.id] = await storage.signedUrl('brand', path, 3600);
          toast('رُفعت الصورة — احفظ التصميم لتثبيتها.', 'ok');
          drawStage();
        } catch (e) { toast(e.message, 'bad'); }
      });
      kids.splice(1, 0, h('label.field', it.path ? 'استبدال الصورة أو الشعار' : 'رفع الصورة أو الشعار',
        h('small', 'PNG بخلفية شفافة أفضل — حتى ٣ ميغابايت'), up));
      kids.push(h('div.row', chip(it.badge ? 'خلفية داكنة خلفها' : 'بلا خلفية', it.badge,
        () => { it.badge = !it.badge; })));
    }

    if ('size' in it && !(isCustom && it.type === 'image')) {
      kids.push(
        h('label.field', `حجم الخط (${round(it.size)} نقطة)`,
          h('div.row.tight',
            h('button.btn.sm', { type: 'button', 'aria-label': 'تصغير الخط',
              onclick: () => { it.size = Math.max(4, round(it.size - 0.4)); drawStage(); } }, 'أصغر'),
            sizeRange(it.size, 4, 20, 0.2, v => { it.size = v; }),
            h('button.btn.sm', { type: 'button', 'aria-label': 'تكبير الخط',
              onclick: () => { it.size = Math.min(20, round(it.size + 0.4)); drawStage(); } }, 'أكبر'))),
        h('div.row',
          chip('عريض', it.bold, () => { it.bold = !it.bold; }),
          chip('يمين', it.align === 'right', () => { it.align = 'right'; }),
          chip('وسط', it.align === 'center', () => { it.align = 'center'; }),
          chip('يسار', it.align === 'left', () => { it.align = 'left'; })),
        h('label.field', 'اللون', colorRow(it.color, v => { it.color = v; })),
        h('label.field', 'خط هذا العنصر', fontSelect(it.font || '', v => { it.font = v; }, true)));
    }

    // إضافة عنصر جديد وحذف المضاف
    const addText = h('button.btn.sm', { type: 'button' }, '＋ نص');
    addText.onclick = () => {
      const c = newCustom('text', (layout.custom || []).length + 1);
      layout.custom = [...(layout.custom || []), c];
      selected = `c:${c.id}`; clampLayout(layout); drawStage();
    };
    const addImg = h('button.btn.sm', { type: 'button' }, '＋ صورة أو شعار');
    addImg.onclick = () => {
      const c = newCustom('image', (layout.custom || []).length + 1);
      layout.custom = [...(layout.custom || []), c];
      selected = `c:${c.id}`; clampLayout(layout); drawStage();
    };
    kids.push(h('hr'), h('div.field', h('span.field-head', 'إضافة عنصر'), h('div.row', addText, addImg)));

    if (isCustom) {
      const del = h('button.btn.sm.ghost', { type: 'button' }, 'حذف هذا العنصر');
      del.onclick = () => {
        layout.custom = (layout.custom || []).filter(c => c.id !== it.id);
        selected = 'name'; drawStage();
        toast('حُذف العنصر.', '');
      };
      kids.push(h('div.row', del));
    }

    panel.replaceChildren(...kids);
  }

  // ------------------------------------------------------------------
  // الشريط العلوي والخلفية والشعار
  // ------------------------------------------------------------------
  function drawBand() {
    const b = layout.band;
    const toggle = h('button.btn.sm', { type: 'button' }, b.show ? 'الشريط ظاهر' : 'الشريط مخفي');
    if (b.show) toggle.classList.add('primary');
    toggle.onclick = () => { b.show = !b.show; drawStage(); drawBand(); };

    const side = h('select', { 'aria-label': 'مكان الشريط' },
      h('option', { value: 'top', selected: b.side !== 'right' ? true : null }, 'شريط علوي'),
      h('option', { value: 'right', selected: b.side === 'right' ? true : null }, 'شريط جانبي على اليمين'));
    side.onchange = () => { b.side = side.value; drawStage(); drawBand(); };

    const ruleCtl = (key, label) => {
      const r = layout.rules[key];
      const t = h('button.btn.sm', { type: 'button' }, r.show ? 'ظاهر' : 'مخفي');
      if (r.show) t.classList.add('primary');
      t.onclick = () => { r.show = !r.show; drawStage(); drawBand(); };
      return h('fieldset', h('legend', label),
        h('div.row', t),
        h('label.field', `موضعه من الأعلى (${round(r.y)} مم)`, sizeRange(r.y, 0, CARD.h, 0.2, v => { r.y = v; drawBand(); })),
        h('label.field', `عرضه (${round(r.w)} مم)`, sizeRange(r.w, 2, CARD.w, 0.5, v => { r.w = v; drawBand(); })),
        h('label.field', 'لونه', colorRow(r.color, v => { r.color = v; drawBand(); })));
    };

    fontBox.replaceChildren(
      h('label.field', 'نوع خط البطاقة', h('small', 'يسري على كل النصوص ما لم يُخصَّص عنصر بخط آخر'),
        fontSelect(layout.font || 'haramain', v => { layout.font = v; drawBand(); }, false)));
    bandBox.replaceChildren(
      h('div.row', toggle),
      h('label.field', 'مكان الشريط', side),
      h('label.field', `${b.side === 'right' ? 'عرض' : 'ارتفاع'} الشريط (${round(b.h)} مم)`,
        sizeRange(b.h, 0, b.side === 'right' ? 45 : 30, 0.5, v => { b.h = v; drawBand(); })),
      h('label.field', 'لون الشريط', colorRow(b.bg, v => { b.bg = v; drawBand(); })),
      h('label.field', 'لون خط الشريط', colorRow(b.line, v => { b.line = v; drawBand(); })),
      h('label.field', 'خلفية البطاقة', colorRow(layout.card.bg, v => { layout.card.bg = v; drawBand(); })),
      ruleCtl('top', 'الفاصل العلوي'),
      ruleCtl('bottom', 'الفاصل السفلي'));
  }

  // قالب جاهز: يُطبَّق ثم يُعدَّل عليه
  const presetSel = h('select', { 'aria-label': 'قالب جاهز' },
    PRESETS.map(([k, label]) => h('option', { value: k }, label)));
  const applyPreset = h('button.btn.sm', { type: 'button' }, 'تطبيق القالب');
  applyPreset.onclick = () => {
    layout = PRESET_LAYOUT[presetSel.value]();
    clampLayout(layout);
    drawStage(); drawBand(); drawLogo();
    toast('طُبّق القالب — عدّل عليه ثم احفظ.', 'ok');
  };

  function drawLogo() {
    const sel = h('select', { 'aria-label': 'الشعار' },
      h('option', { value: 'haramain', selected: logoKind === 'haramain' ? true : null }, 'شعار الحرمين (أبيض — على شريط داكن)'),
      h('option', { value: 'custom', selected: logoKind === 'custom' ? true : null }, 'شعار مرفوع'),
      h('option', { value: 'none', selected: logoKind === 'none' ? true : null }, 'بلا شعار'));
    sel.onchange = () => { logoKind = sel.value; drawStage(); drawLogo(); };
    const up = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/svg+xml' });
    up.onchange = () => busy(up, async () => {
      const file = up.files[0]; if (!file) return;
      if (file.size > 3 * 1024 * 1024) return toast('الحد الأقصى ٣ ميغابايت.', 'bad');
      try {
        const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
        const path = `card-logo-${Date.now()}.${ext}`;
        await storage.upload('brand', path, file);
        logoPath = path; logoKind = 'custom';
        logoUrl = await storage.signedUrl('brand', path, 3600);
        toast('رُفع الشعار — احفظ التصميم لتثبيته.', 'ok');
        drawStage(); drawLogo();
      } catch (e) { toast(e.message, 'bad'); }
    });
    logoBox.replaceChildren(
      h('label.field', 'الشعار على البطاقة', sel),
      h('label.field', 'رفع شعار الهيئة أو شعارًا آخر',
        h('small', 'PNG بخلفية شفافة أفضل — حتى ٣ ميغابايت'), up),
      h('label.field', `عرض الشعار (${round(layout.items.logo.w)} مم)`,
        sizeRange(layout.items.logo.w, 4, 40, 0.5, v => { layout.items.logo.w = v; drawLogo(); })),
      h('div.row', (() => {
        const it = layout.items.logo;
        const t = h('button.btn.sm', { type: 'button' }, it.badge ? 'خلفية داكنة خلف الشعار' : 'بلا خلفية خلف الشعار');
        if (it.badge) t.classList.add('primary');
        t.onclick = () => { it.badge = !it.badge; drawStage(); drawLogo(); };
        return t;
      })()));
  }

  for (const c of (layout.custom || [])) {
    if (c.type === 'image' && c.path) loadCustomImg(c).then(() => drawStage()).catch(() => {});
  }

  if (logoKind === 'custom' && logoPath) {
    storage.signedUrl('brand', logoPath, 3600).then(u => { logoUrl = u; drawStage(); }).catch(() => {});
  }

  // ------------------------------------------------------------------
  // اختيار الأعضاء
  // ------------------------------------------------------------------
  const counter = h('p.small.muted');
  const allBox = h('input', { type: 'checkbox' });
  const listBox = h('div.pick-list');
  const count = () => {
    counter.textContent = `المحدد: ${picked.size} من ${pool.length}`;
    allBox.checked = picked.size === pool.length && pool.length > 0;
  };
  const drawList = () => {
    listBox.replaceChildren(...pool.map(m => {
      const cb = h('input', { type: 'checkbox', checked: picked.has(m.id) ? true : null });
      cb.onchange = () => { cb.checked ? picked.add(m.id) : picked.delete(m.id); count(); drawStage(); };
      return h('label.check', cb, h('span', m.full_name,
        h('span.small.muted', ` — ${ROLE_LABEL[m.role]}`),
        m.track === 'field' && h('span.badge', 'إرشاد مكاني'),
        !photoOf[m.id] && h('span.badge.warn', 'بلا صورة'),
        issuedOf[m.id] && h('span.badge.ok', 'بطاقته معتمَدة')));
    }));
  };
  allBox.onchange = () => { picked.clear(); if (allBox.checked) pool.forEach(m => picked.add(m.id)); drawList(); count(); drawStage(); };
  const onlyTranslators = h('button.btn.sm.ghost', { type: 'button' }, 'المترجمون فقط');
  onlyTranslators.onclick = () => {
    picked.clear(); pool.filter(m => m.role === 'translator' && m.track !== 'field').forEach(m => picked.add(m.id));
    drawList(); count(); drawStage();
  };

  // ------------------------------------------------------------------
  // الحفظ والطباعة
  // ------------------------------------------------------------------
  const saveBtn = h('button.btn', { type: 'button' }, 'حفظ التصميم والبيانات');
  saveBtn.onclick = () => busy(saveBtn, async () => {
    const v = cfg();
    try {
      await db.rpc('save_card_settings', {
        p_title: v.title, p_subtitle: v.subtitle || null,
        p_official_name: v.official_name || null, p_official_title: v.official_title || null,
        p_valid_until: v.valid_until, p_layout: layout,
        p_logo_kind: logoKind, p_logo_path: logoPath
      });
      toast('حُفظ تصميم البطاقة.', 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  });

  const resetBtn = h('button.btn.sm.ghost', { type: 'button' }, 'إعادة التصميم الافتراضي');
  resetBtn.onclick = () => { layout = DEFAULT_LAYOUT(); drawStage(); drawBand(); drawLogo(); toast('أُعيد التصميم الافتراضي.', ''); };

  // اعتماد البطاقة يجعلها تظهر في حساب المترجم (ملاحظة ٨٧)
  const issueBtn = h('button.btn', { type: 'button' }, 'اعتماد البطاقة للمحددين');
  issueBtn.onclick = () => busy(issueBtn, async () => {
    const ids = [...picked];
    if (!ids.length) return toast('اختر عضوًا واحدًا على الأقل.', 'bad');
    try {
      const n = await db.rpc('issue_member_cards', { p_members: ids, p_issued: true });
      const count = Number(Array.isArray(n) ? n[0] : n) || ids.length;
      ids.forEach(id => { issuedOf[id] = { member_id: id, issued_at: new Date().toISOString() }; });
      drawList();
      toast(`اعتُمدت ${count} بطاقة — تظهر الآن في حساب أصحابها.`, 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  });

  const revokeBtn = h('button.btn.sm.ghost', { type: 'button' }, 'سحب الاعتماد');
  revokeBtn.onclick = () => busy(revokeBtn, async () => {
    const ids = [...picked];
    if (!ids.length) return toast('اختر عضوًا واحدًا على الأقل.', 'bad');
    try {
      await db.rpc('issue_member_cards', { p_members: ids, p_issued: false });
      ids.forEach(id => { delete issuedOf[id]; });
      drawList();
      toast('سُحب الاعتماد، ولم تعد البطاقة تظهر في حساباتهم.', 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  });

  const printBtn = h('button.btn.primary', { type: 'button' }, 'تصدير البطاقات (PDF أو طباعة)');
  printBtn.onclick = () => busy(printBtn, async () => {
    const chosen = pool.filter(m => picked.has(m.id));
    if (!chosen.length) return toast('اختر عضوًا واحدًا على الأقل.', 'bad');
    const missing = chosen.filter(m => !photoOf[m.id]);
    if (missing.length) toast(`${missing.length} من المحددين بلا صورة — تُطبع بطاقاتهم بمكان فارغ للصورة.`, '');
    const photos = {};
    await Promise.all(chosen.filter(m => photoOf[m.id]).map(async m => {
      try { photos[m.id] = await urlToDataUrl(await storage.signedUrl('member-photos', photoOf[m.id], 600)); }
      catch { /* بطاقة بلا صورة خير من توقف الطباعة */ }
    }));
    let logoData = null;
    const src = logoSrc();
    if (src) { try { logoData = await urlToDataUrl(src); } catch { logoData = src; } }
    // صور العناصر المضافة
    const customData = {};
    await Promise.all((layout.custom || []).filter(c => c.type === 'image' && c.path).map(async c => {
      try {
        const u = customUrls[c.id] || await storage.signedUrl('brand', c.path, 600);
        customData[c.id] = await urlToDataUrl(u);
      } catch { /* عنصر بلا صورة لا يوقف الطباعة */ }
    }));
    const ok = printCards(chosen.map(m => ({
      member: m, photo: photos[m.id] || null,
      langsText: (langsOf[m.id] || []).map(c => langName(c)).join(' · ')
    })), cfg(), layout, logoData, customData);
    if (!ok) toast('اسمح بالنوافذ المنبثقة لإتمام الطباعة.', 'bad');
  });

  for (const el of Object.values(f)) el.addEventListener('input', drawStage);
  drawList(); count(); drawBand(); drawLogo(); drawStage();

  return h('div',
    h('div.page-head', h('div.grow', h('div.eyebrow', 'الإدارة'), h('h1', 'بطاقات العمل'),
      h('p.muted', 'بطاقة بمقاس الهوية الوطنية ٨٥٫٦×٥٤ مم. اسحب أي عنصر إلى مكانه، وغيّر حجم خطه ولونه، ثم اطبع.'))),
    // ثلاثة أعمدة تملأ الشاشة: الخصائص، ثم لوحة التصميم، ثم البيانات والشكل (ملاحظة ١٣٠)
    h('div.cd-wrap',
      h('div.card.stack.cd-props', h('h3', 'خصائص العنصر'), panel),
      h('div.card.stack.cd-stage',
        h('h3', 'لوحة التصميم'),
        h('div.card-stage-wrap', stage),
        h('p.small.muted', 'اسحب العنصر بالفأرة، أو اخترَه ثم حرّكه بالأسهم (مع Shift خطوة أكبر).'),
        h('div.row', resetBtn)),
      h('div.stack.cd-side',
        h('div.card.stack',
          h('h3', 'بيانات البطاقة'),
          h('label.field', 'عنوان البطاقة', f.title),
          h('label.field', 'السطر تحته', f.subtitle),
          h('label.field', 'اسم المسؤول', f.official_name),
          h('label.field', 'منصب المسؤول', f.official_title),
          h('label.field', 'صلاحية البطاقة حتى', f.valid_until),
          h('label.field', 'قالب جاهز', h('div.row.tight', presetSel, applyPreset)),
          h('div.row', saveBtn)),
        h('div.card.stack', h('h3', 'الشكل والشعار'),
          fontBox,
          h('details.cd-more', h('summary', 'الشعار وخياراته'), logoBox),
          h('details.cd-more', h('summary', 'الشريط والفواصل وخلفية البطاقة'), bandBox)))),
    h('div.card.stack',
      h('div.row.between', h('h3', 'من تُطبع بطاقته'), h('div.row', onlyTranslators, counter)),
      h('label.check', allBox, h('b', 'تحديد الكل')),
      listBox,
      h('p.small.muted', 'الاعتماد يُظهر البطاقة في حساب صاحبها ضمن «بياناتي» ليبرزها عند الحاجة.'),
      h('div.row', printBtn, issueBtn, revokeBtn)));
}

// بطاقة واحدة — من شاشة «بياناتي»
export function printOneCard(row, cfg, layout, logoData, customData) {
  return printCards([row], cfg, layout, logoData, customData);
}

// ---------------------------------------------------------------------
// صفحة الطباعة: نفس النموذج بالمليمتر، عشر بطاقات في صفحة A4
// ---------------------------------------------------------------------
function printCards(rows, cfg, layout, logoData, customData = {}) {
  const w = window.open('', '_blank');
  if (!w) return false;
  const esc = escapeHtml;
  const css = (it, key) => Object.entries(itemStyle(it, key))
    .map(([k, v]) => `${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}:${v}`).join(';');

  const itemHtml = (key, row) => {
    const it = layout.items[key];
    if (!it.show) return '';
    const style = css(it, key);
    if (key === 'logo') {
      const extra = Object.entries(logoExtra(it))
        .map(([k, v]) => `;${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}:${v}`).join('');
      return logoData
        ? `<div class="cd-item" style="${style}${extra}"><img src="${logoData}" alt="" style="width:100%;height:auto;display:block"></div>`
        : '';
    }
    if (key === 'photo') {
      return `<div class="cd-item cd-photo" style="${style}">${
        row.photo ? `<img src="${row.photo}" alt="">` : '<span>٤×٦</span>'}</div>`;
    }
    const text = itemText(key, {
      member: row.member, cfg,
      roleLabel: ROLE_LABEL[row.member.role] || row.member.role,
      langsText: row.langsText
    });
    return text ? `<div class="cd-item" style="${style}">${esc(text)}</div>` : '';
  };

  const styleStr = o => o ? Object.entries(o)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}:${v}`).join(';') : '';
  const band = bandStyle(layout.band) ? `<div style="${styleStr(bandStyle(layout.band))}"></div>` : '';
  const rules = ['top', 'bottom']
    .map(k => ruleStyle(layout.rules[k]) ? `<div style="${styleStr(ruleStyle(layout.rules[k]))}"></div>` : '')
    .join('');
  // العناصر المضافة: نصوص وصور فوق البطاقة (ملاحظة ٩٥)
  const customHtml = (layout.custom || []).map(c => {
    if (!c.show) return '';
    const st = css(c, c.type === 'image' ? 'ci' : 'ct');
    if (c.type === 'image') {
      const src = customData[c.id];
      if (!src) return '';
      const extra = Object.entries(logoExtra(c))
        .map(([k, v]) => `;${k.replace(/[A-Z]/g, ch => '-' + ch.toLowerCase())}:${v}`).join('');
      return `<div class="cd-item" style="${st}${extra}"><img src="${src}" alt="" style="width:100%;height:auto;display:block"></div>`;
    }
    return c.text ? `<div class="cd-item" style="${st}">${esc(c.text)}</div>` : '';
  }).join('');

  const card = row => `<div class="wcard">${band}${rules}${ITEM_ORDER.map(k => itemHtml(k, row)).join('')}${customHtml}</div>`;

  const perPage = 10;
  const pages = [];
  for (let i = 0; i < rows.length; i += perPage) pages.push(rows.slice(i, i + perPage));

  w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>${esc(cfg.title)}</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  @font-face { font-family: 'HS'; src: url('/assets/arabic-regular.ttf') format('truetype'); font-weight: 400; }
  @font-face { font-family: 'HS'; src: url('/assets/arabic-bold.ttf') format('truetype'); font-weight: 700; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font-family: 'HS', system-ui, sans-serif; background: #f3f3f3; color: #1c1a17; }
  .sheet { width: 190mm; min-height: 277mm; margin: 0 auto 8mm; background: #fff; padding: 2mm;
           display: grid; grid-template-columns: repeat(2, ${CARD.w}mm); gap: 4mm 6mm;
           justify-content: center; align-content: start; }
  .wcard { position: relative; width: ${CARD.w}mm; height: ${CARD.h}mm; overflow: hidden;
           background: ${layout.card.bg}; border: .3mm solid ${layout.card.border}; border-radius: 2.5mm;
           font-family: ${fontStack(layout.font)}; }
  .cd-item { position: absolute; }
  .cd-photo { border: .3mm solid #ded5c5; border-radius: 1mm; background: #f6f3ee; overflow: hidden;
              display: flex; align-items: center; justify-content: center; }
  .cd-photo img { width: 100%; height: 100%; object-fit: cover; }
  .cd-photo span { font-size: 6pt; color: #a79c8c; }
  @media print { body { background: #fff; } .sheet { margin: 0; page-break-after: always; } }
</style></head><body>
${pages.map(p => `<div class="sheet">${p.map(card).join('')}</div>`).join('')}
<script>window.addEventListener('load', () => setTimeout(() => window.print(), 700));<\/script>
</body></html>`);
  w.document.close();
  return true;
}
