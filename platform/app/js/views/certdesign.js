// مصمِّمُ الشهادات: قوالبُ مسمّاةٌ متعدّدة، يُملأ في القالب كلُّ ثابتٍ
// فلا يبقى في المنح إلا اسمُ صاحبها (ملاحظات ٣١٢ و٣٢٢–٣٢٥)
//
//   شاشةٌ كشاشة بطاقات العمل: خصائصُ العنصر يمينًا، ولوحةُ التصميم
//   وسطًا، وشريطُ أيقوناتٍ يسارًا كلُّ أيقونةٍ تفتح بابَها وحدَها.
//
//   واللوحةُ تُرسَم بالمولِّد نفسِه الذي تُطبَع به الشهادة (certHtml)،
//   فما تراه هو ما يُطبَع حرفًا بحرف — لا نموذجٌ يُشبهه.
//
//   والشعاراتُ أصولٌ محفوظةٌ في المنصة: نزعُها من القالب لا يُتلفها،
//   وإنما تُنزَع من اللوحة وتبقى في المكتبة (٣٢٥). والخلفيةُ تُرفَع
//   ملفَّ PDF مصمَّمًا فتُرسَم بدقّة الطباعة (٣٢٢). والنصوصُ الحرّةُ
//   تُكتب وتُنسَّق وتُحمَل حقولًا متغيّرةً تُملأ لكلِّ شهادة (٣٢٣).
import { h, fill, toast, busy, dialog, confirm } from '../ui.js';
import { db, storage } from '../sb.js';
import { isManager, can } from '../store.js';
import { certHtml, CERT_THEMES, DEFAULT_CERT_MARKS, CERT_VARS, printCertificate } from '../certdoc.js';
import { prepareMark } from '../photo.js';
import { bgImage } from '../pdfview.js';

const AR = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn');

// شهادةٌ تجريبيةٌ تُرسَم بها اللوحةُ قبل أن تُمنَح شهادةٌ حقيقية
const SAMPLE = {
  kind: 'course', status: 'issued',
  title: 'مهاراتُ الترجمة الشرعية',
  subject: 'مصطلحاتُ الخطبة ومقاصدُها',
  hours: 12, place: 'مكة المكرمة', provider: 'مشروع خادم الحرمين الشريفين للترجمة',
  start_on: '2026-03-01', end_on: '2026-03-04',
  signer_name: 'عبدالرحمن بن محمد', signer_role: 'مدير المشروع',
  signature: 'blank', serial_no: 'HS-1448-0147', verify_key: 'preview',
  issued_at: new Date().toISOString(),
  fields: { national_id: '1012345678', member_no: 24, nationality: 'سعودي',
            role: 'مترجم', langs: 'الإنجليزية، الأردية' }
};

export const DEFAULT_MARKS = () => DEFAULT_CERT_MARKS.map(g => ({ ...g }));

const FONTS = [
  ['', 'خطُّ الشهادة'],
  ['"Noto Naskh Arabic", serif', 'نسخ'],
  ['"Amiri", serif', 'أميري'],
  ['"Noto Kufi Arabic", sans-serif', 'كوفي'],
  ['Garamond, serif', 'Garamond'],
  ['Georgia, serif', 'Georgia'],
];

const FIXED = [
  ['title', 'عنوانُ الشهادة', 'text'],
  ['subject', 'الموضوع', 'text'],
  ['hours', 'عددُ الساعات', 'number'],
  ['start_on', 'من تاريخ', 'date'],
  ['end_on', 'إلى تاريخ', 'date'],
  ['place', 'المكان', 'text'],
  ['provider', 'الجهةُ المنفّذة', 'text'],
  ['role_text', 'الدور (للخبرة)', 'text'],
  ['body', 'ما باشره (للخبرة)', 'text'],
  ['signer_name', 'الموقِّع', 'text'],
  ['signer_role', 'صفةُ الموقِّع', 'text'],
];

export async function render(ctx) {
  if (!(isManager() || can('cert_design'))) {
    return h('div', h('div.page-head', h('div.grow',
      h('div.eyebrow', 'الفريق'), h('h1', 'تصميمُ الشهادة'))),
      h('div.card', h('p.muted', 'هذا خارجَ نطاقِ عملك الحالي.')));
  }

  const wantId = ctx?.query?.tpl || null;

  // القالبُ: المطلوبُ، أو أوّلُ قالبٍ قائم، أو قالبٌ جديدٌ من التصميم القديم
  let list = [];
  try { list = await db.rpc('cert_templates_list', { p_active: null }) || []; } catch { list = []; }
  let tpl = (wantId && list.find(t => t.id === wantId)) || list[0] || null;

  let d = tpl ? { ...(tpl.tpl || {}) } : {};
  if (!tpl) {
    try { d = (await db.rpc('cert_design')) || {}; } catch { d = {}; }
  }
  if (!d || typeof d !== 'object') d = {};
  if (!Array.isArray(d.logos) || !d.logos.length) d.logos = DEFAULT_MARKS();
  if (!Array.isArray(d.texts)) d.texts = [];
  if (d.header === undefined) d.header = false;

  let fixed = { ...((tpl && tpl.fixed) || {}) };
  let name = tpl ? tpl.name : 'القالب الافتراضي';
  let kind = tpl ? tpl.kind : 'course';

  // مكتبةُ الأصول: الشعاراتُ والخلفياتُ تبقى فيها ولو نُزعت من القالب
  let assets = [];
  const loadAssets = async () => {
    try { assets = await db.rpc('design_assets_list', { p_kind: null }) || []; }
    catch { assets = []; }
  };
  await loadAssets();
  const assetUrl = async a => {
    if (a.url) return a.url;
    if (a.file_path) { try { return await storage.signedUrl('design', a.file_path, 3600); } catch { return ''; } }
    return '';
  };

  const stage = h('div.cert-stage');
  const frame = h('iframe.cert-frame', { title: 'لوحةُ تصميم الشهادة',
    sandbox: 'allow-same-origin' });
  stage.append(frame);
  const panel = h('div.cd-panel');
  const body = h('div.stack.cd-tabbody');

  let picked = -1;          // شعارٌ مختار
  let pickedText = -1;      // نصٌّ مختار

  const fit = () => {
    const land = d.landscape !== false;
    stage.classList.toggle('portrait', !land);
    const mm = v => (v * 96) / 25.4;
    const w = mm(land ? 297 : 210);
    const box = stage.getBoundingClientRect();
    if (!box.width) return;
    frame.style.transform = `scale(${box.width / w})`;
  };

  // اللوحةُ تُرسَم متى صارت في الصفحة: الإطارُ المنفصلُ لا وثيقةَ له
  let painted = false;
  function paint() {
    const doc = frame.contentDocument;
    if (!doc) { painted = false; return; }
    painted = true;
    doc.open();
    doc.write(certHtml({ ...SAMPLE, design: { ...d } }, 'محمد بن عبدالله الأنصاري'));
    doc.close();
    requestAnimationFrame(() => { fit(); drawHandles(); });
  }
  window.addEventListener('resize', fit);
  frame.addEventListener('load', () => { if (painted) fit(); else paint(); });

  // ------------------------------------------------------------------
  // مقابضُ السحب فوق اللوحة: للشعارات وللنصوص
  // ------------------------------------------------------------------
  const handles = h('div.cert-handles');
  stage.append(handles);

  function dragger(el, getXY, setXY, onPick) {
    el.onpointerdown = e => {
      e.preventDefault(); onPick();
      const box = stage.getBoundingClientRect();
      const start = getXY();
      const sx = e.clientX, sy = e.clientY;
      const move = ev => {
        const dx = (ev.clientX - sx) / box.width * 100;
        const dy = (ev.clientY - sy) / box.height * 100;
        // اللوحةُ من اليمين: الإزاحةُ بالمقلوب
        setXY(Math.max(0, Math.min(96, start.x - dx)),
              Math.max(0, Math.min(96, start.y + dy)));
        drawHandles();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        paint();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
  }

  function drawHandles() {
    const kids = [];
    (d.logos || []).forEach((g, i) => {
      const el = h('div.cert-handle' + (i === picked ? '.on' : ''), {
        style: { insetInlineStart: `${Number(g.x) || 0}%`, top: `${Number(g.y) || 0}%` },
        title: `الشعار ${AR(i + 1)}` }, h('span', AR(i + 1)));
      dragger(el, () => ({ x: Number(g.x) || 0, y: Number(g.y) || 0 }),
        (x, y) => { g.x = x; g.y = y; },
        () => { picked = i; pickedText = -1; drawProps(); });
      kids.push(el);
    });
    (d.texts || []).forEach((t, i) => {
      const el = h('div.cert-handle.text' + (i === pickedText ? '.on' : ''), {
        style: { insetInlineStart: `${Number(t.x) || 0}%`, top: `${Number(t.y) || 0}%` },
        title: t.text || 'نصّ' }, h('span', 'نص'));
      dragger(el, () => ({ x: Number(t.x) || 0, y: Number(t.y) || 0 }),
        (x, y) => { t.x = x; t.y = y; },
        () => { pickedText = i; picked = -1; drawProps(); });
      kids.push(el);
    });
    handles.replaceChildren(...kids);
  }

  // ------------------------------------------------------------------
  // خصائصُ العنصر المختار
  // ------------------------------------------------------------------
  const num = (label, val, min, max, step, set) => {
    const i = h('input', { type: 'range', min: String(min), max: String(max),
      step: String(step), value: String(val), 'aria-label': label });
    const out = h('span.small.muted', AR(Math.round(val * 10) / 10));
    i.oninput = () => { out.textContent = AR(Math.round(Number(i.value) * 10) / 10); set(Number(i.value)); };
    return h('label.field', h('span.row.between', h('span', label), out), i);
  };

  function drawProps() {
    if (pickedText >= 0) return drawTextProps();
    const g = d.logos[picked];
    if (!g) {
      fill(panel, h('p.small.muted', 'اختر شعارًا أو نصًّا من اللوحة لتظهر خصائصُه، '
        + 'أو أضِفْ من «الشعارات» و«النصوص».'));
      return;
    }
    fill(panel,
      h('div.row.between', h('b', `الشعار ${AR(picked + 1)}`),
        h('img.mark-thumb', { src: g.src, alt: '' })),
      num('من اليمين ٪', g.x, 0, 94, 0.5, v => { g.x = v; paint(); }),
      num('من الأعلى ٪', g.y, 0, 94, 0.5, v => { g.y = v; paint(); }),
      num('الارتفاع مم', Number(g.h) || 14, 5, 60, 0.5, v => { g.h = v; paint(); }),
      h('div.row',
        h('button.btn.sm.ghost', { type: 'button', onclick: () => {
          d.logos.splice(picked, 1); picked = -1; paint(); drawProps(); drawTabs();
        } }, 'انزعْه من التصميم')),
      h('p.small.muted', 'النزعُ من التصميم لا يحذف الشعارَ من المكتبة.'));
  }

  function drawTextProps() {
    const t = d.texts[pickedText];
    if (!t) { pickedText = -1; return drawProps(); }
    const area = h('textarea', { rows: 3, 'aria-label': 'النص' }, t.text || '');
    area.oninput = () => { t.text = area.value; paint(); };
    const font = h('select', { 'aria-label': 'الخط' },
      FONTS.map(([v, n]) => h('option', { value: v, selected: (t.font || '') === v }, n)));
    font.onchange = () => { t.font = font.value; paint(); };
    const align = h('select', { 'aria-label': 'المحاذاة' },
      h('option', { value: 'start', selected: (t.align || 'start') === 'start' }, 'إلى اليمين'),
      h('option', { value: 'center', selected: t.align === 'center' }, 'توسيط'),
      h('option', { value: 'end', selected: t.align === 'end' }, 'إلى اليسار'));
    align.onchange = () => { t.align = align.value; paint(); };
    const bold = h('input', { type: 'checkbox', checked: !!t.bold, 'aria-label': 'عريض' });
    bold.onchange = () => { t.bold = bold.checked; paint(); };
    const color = h('input', { type: 'color', value: t.color || '#2b2b2b', 'aria-label': 'اللون' });
    color.oninput = () => { t.color = color.value; paint(); };

    fill(panel,
      h('b', `النصُّ ${AR(pickedText + 1)}`),
      h('label.field', 'النص', area),
      h('details.vars',
        h('summary.small', 'الحقولُ المتغيّرة — تُكتب بين قوسين فتُملأ لكلِّ شهادة'),
        h('div.row.wrap', { style: { gap: '4px' } },
          Object.keys(CERT_VARS).map(k => {
            const b = h('button.btn.xs.ghost', { type: 'button' }, `{${k}}`);
            b.onclick = () => {
              t.text = `${t.text || ''}{${k}}`;
              area.value = t.text; paint();
            };
            return b;
          }))),
      h('div.grid-2',
        h('label.field', 'الخط', font),
        h('label.field', 'المحاذاة', align),
        h('label.field', 'اللون', color),
        h('label.check', bold, h('span', 'عريض'))),
      num('من اليمين ٪', Number(t.x) || 0, 0, 96, 0.5, v => { t.x = v; paint(); }),
      num('من الأعلى ٪', Number(t.y) || 0, 0, 96, 0.5, v => { t.y = v; paint(); }),
      num('العرض ٪', Number(t.w) || 40, 5, 100, 1, v => { t.w = v; paint(); }),
      num('حجمُ الخط pt', Number(t.size) || 12, 6, 60, 0.5, v => { t.size = v; paint(); }),
      num('الميل °', Number(t.rotate) || 0, -45, 45, 1, v => { t.rotate = v; paint(); }),
      h('div.row',
        h('button.btn.sm.ghost', { type: 'button', onclick: () => {
          d.texts.splice(pickedText, 1); pickedText = -1; paint(); drawProps(); drawTabs();
        } }, 'احذفْ هذا النص')));
  }

  // ------------------------------------------------------------------
  // أبوابُ الشريط
  // ------------------------------------------------------------------
  const themeBox = () => {
    const sel = h('select', { 'aria-label': 'القالب' },
      Object.entries(CERT_THEMES).map(([k, v]) =>
        h('option', { value: k, selected: (d.theme || 'classic') === k }, v.name)));
    sel.onchange = () => { d.theme = sel.value; paint(); };
    const land = h('button.btn.sm' + (d.landscape !== false ? '.primary' : ''),
      { type: 'button' }, d.landscape !== false ? 'أفقيّ' : 'رأسيّ');
    land.onclick = () => { d.landscape = !(d.landscape !== false); paint(); drawTabs(); };
    return h('div.stack',
      h('p.small.muted', 'ثلاثةُ قوالبَ لا تختلف إلا في اللون والحلية — '
        + 'فالاحترافُ في النسبة والخطّ لا في الحبر.'),
      h('label.field', 'القالب', sel),
      h('label.field', 'الاتجاه', h('div.row', land)));
  };

  // الشعارات: من المكتبة تُضاف، ومن اللوحة تُنزَع (ملاحظة ٣٢٥)
  const marksBox = () => {
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true,
      'aria-label': 'ملفُّ الشعار' });
    const add = h('button.btn.sm', { type: 'button' }, '＋ ارفعْ شعارًا إلى المكتبة');
    add.onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files?.[0]; if (!f) return;
      try {
        const src = await prepareMark(f, 600);
        const nm = (f.name || 'شعار').replace(/\.[^.]+$/, '');
        const path = `logos/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.png`;
        const blob = await (await fetch(src)).blob();
        await storage.upload('design', path, new File([blob], 'logo.png', { type: 'image/png' }));
        await db.rpc('add_design_asset', { p: { kind: 'logo', name: nm, file_path: path, mime: 'image/png' } });
        await loadAssets();
        d.logos.push({ src, x: 45, y: 5, h: 16 });
        picked = d.logos.length - 1; pickedText = -1;
        paint(); drawProps(); drawTabs();
        toast('أُضيف الشعارُ إلى المكتبة وإلى التصميم.', 'ok');
      } catch (e) { toast(e.message, 'bad'); }
      file.value = '';
    };

    const lib = assets.filter(a => a.kind === 'logo');
    const reset = h('button.btn.sm.ghost', { type: 'button' }, 'أعِدِ الثلاثةَ الافتراضية');
    reset.onclick = async () => {
      if (!await confirm('إعادةُ الشعارات', 'تُستبدَل شعاراتُ التصميم الحاليةُ بالثلاثة '
        + 'الافتراضية. والمكتبةُ لا تتأثر.')) return;
      d.logos = DEFAULT_MARKS(); picked = -1; paint(); drawProps(); drawTabs();
    };

    return h('div.stack',
      h('p.small.muted', 'الشعاراتُ محفوظةٌ في المكتبة: تُضاف إلى التصميم بضغطة، '
        + 'وتُنزَع منه بضغطة — والنزعُ لا يُتلفها.'),
      h('b.small', 'المكتبة'),
      h('div.row.wrap', { style: { gap: '6px' } },
        lib.length ? lib.map(a => {
          const b = h('button.btn.xs.ghost', { type: 'button', title: a.name },
            h('img.mark-thumb', { src: a.url || '', alt: '' }),
            a.name.length > 18 ? a.name.slice(0, 18) + '…' : a.name);
          b.onclick = async () => {
            const src = await assetUrl(a);
            if (!src) { toast('تعذّر فتحُ الشعار', 'bad'); return; }
            d.logos.push({ src, x: 45, y: 5, h: 16 });
            picked = d.logos.length - 1; pickedText = -1;
            paint(); drawProps(); drawTabs();
          };
          return b;
        }) : [h('span.small.muted', 'المكتبةُ فارغة')]),
      h('div.row', add, file, reset),
      h('b.small', 'في التصميم'),
      h('div.stack', { style: { gap: '6px' } },
        (d.logos || []).map((g, i) => {
          const b = h('button.btn.xs' + (i === picked ? '.primary' : ''), { type: 'button' },
            h('img.mark-thumb', { src: g.src, alt: '' }), `الشعار ${AR(i + 1)}`);
          b.onclick = () => { picked = i; pickedText = -1; drawProps(); drawHandles(); drawTabs(); };
          return b;
        })));
  };

  // النصوصُ الحرّة (ملاحظة ٣٢٣)
  const textsBox = () => {
    const add = h('button.btn.sm', { type: 'button' }, '＋ أضِفْ نصًّا');
    add.onclick = () => {
      d.texts.push({ text: 'نصٌّ جديد', x: 30, y: 40, w: 40, size: 14, align: 'center' });
      pickedText = d.texts.length - 1; picked = -1;
      paint(); drawProps(); drawTabs();
    };
    return h('div.stack',
      h('p.small.muted', 'نصوصٌ تُكتب وتُسحَب إلى مواضعها، ولكلٍّ خطُّه وحجمُه ولونُه. '
        + 'وما بين قوسين — مثل {الاسم} و{رقم الهوية} — يُملأ لكلِّ شهادةٍ من بيانات صاحبها.'),
      h('div.row', add),
      h('div.stack', { style: { gap: '6px' } },
        (d.texts || []).length ? d.texts.map((t, i) => {
          const b = h('button.btn.xs' + (i === pickedText ? '.primary' : ''), { type: 'button' },
            (t.text || '').slice(0, 24) || `نص ${AR(i + 1)}`);
          b.onclick = () => { pickedText = i; picked = -1; drawProps(); drawHandles(); drawTabs(); };
          return b;
        }) : [h('span.small.muted', 'لا نصوصَ بعد')]));
  };

  // الخلفيةُ من ملف PDF بدقّة الطباعة (ملاحظة ٣٢٢)
  const bgBox = () => {
    const file = h('input', { type: 'file', accept: '.pdf,image/*', hidden: true,
      'aria-label': 'ملفُّ الخلفية' });
    const up = h('button.btn.sm', { type: 'button' }, '⤒ ارفعْ خلفية (PDF أو صورة)');
    const note = h('p.small.muted');
    up.onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files?.[0]; if (!f) return;
      note.textContent = 'تُرسَم الخلفيةُ بدقّة الطباعة…';
      try {
        const land = d.landscape !== false;
        const img = await bgImage(f, { page: 1, mmWide: land ? 297 : 210, dpi: 300 });
        d.bg_src = img.url;
        d.bg_name = f.name;
        note.textContent = `جاهزة: ${f.name}`;
        paint(); drawTabs();
      } catch (e) { note.textContent = e.message; }
      file.value = '';
    };
    const clear = h('button.btn.sm.ghost', { type: 'button' }, 'احذفِ الخلفية');
    clear.onclick = () => { d.bg_src = null; d.bg_name = null; paint(); drawTabs(); };

    const spine = h('input', { type: 'checkbox', checked: d.spine !== false,
      'aria-label': 'الشريط الجانبي' });
    spine.onchange = () => { d.spine = spine.checked; paint(); };

    return h('div.stack',
      h('p.small.muted', 'صمِّمِ الخلفيةَ في Illustrator واحفظها PDF على مقاس الشهادة '
        + 'واتجاهِها، فتُرسَم هنا بثلاثمئة نقطةٍ في البوصة وتخرج في الطباعة بحدِّ دقّة طابعتك.'),
      h('div.row', up, file, d.bg_src ? clear : null),
      note,
      d.bg_name ? h('p.small', `الحالية: ${d.bg_name}`) : null,
      d.bg_src ? h('div.mark-prev', h('img', { src: d.bg_src, alt: 'الخلفية' })) : null,
      h('label.check', spine, h('span', 'أبقِ الشريطَ الجانبيَّ المرسوم')));
  };

  const markBox = () => {
    const on = h('input', { type: 'checkbox', checked: d.watermark === false ? null : true,
      'aria-label': 'علامة مائية' });
    on.onchange = () => { d.watermark = on.checked; paint(); };
    return h('div.stack',
      h('p.small.muted', 'شعارُ الهيئة شفّافًا في وسط الشهادة، يُرى ولا يزاحم النصّ.'),
      h('label.check', on, h('span', 'علامةٌ مائيةٌ في الوسط')),
      num('الحجم ٪', Number(d.wm_size) || 55, 20, 90, 1, v => { d.wm_size = v; paint(); }),
      num('الشفافية ٪', Math.round((Number(d.wm_opacity) || 0.07) * 100), 2, 30, 1,
        v => { d.wm_opacity = v / 100; paint(); }));
  };

  const signBox = () => {
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true,
      'aria-label': 'ملفُّ التوقيع' });
    const up = h('button.btn.sm', { type: 'button' }, '⤒ ارفعْ صورةَ التوقيع');
    up.onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files?.[0]; if (!f) return;
      try { d.signature_src = await prepareMark(f, 500); paint(); drawTabs(); }
      catch (e) { toast(e.message, 'bad'); }
      file.value = '';
    };
    const clear = h('button.btn.sm.ghost', { type: 'button' }, 'احذفِ التوقيع');
    clear.onclick = () => { d.signature_src = null; paint(); drawTabs(); };
    return h('div.stack',
      h('p.small.muted', 'توقيعُ مَن يعتمد الشهادات: يُرفع صورةً بخلفيةٍ شفافة، '
        + 'ويُترك فراغٌ للتوقيع باليد إن لم تُرفع.'),
      h('div.row', up, file, d.signature_src ? clear : null),
      d.signature_src
        ? h('div.mark-prev', h('img', { src: d.signature_src, alt: 'التوقيع' }))
        : h('p.small.muted', 'لم تُرفع صورةُ توقيع — ويُترك الفراغُ ليُوقَّع باليد.'));
  };

  // بياناتُ القالب الثابتة: تُملأ مرةً فلا تُسأل عند كلِّ منح (ملاحظة ٣٢٤)
  const fixedBox = () => {
    const nameIn = h('input', { value: name, 'aria-label': 'اسم القالب' });
    nameIn.oninput = () => { name = nameIn.value; };
    const kindSel = h('select', { 'aria-label': 'نوع الشهادة' },
      h('option', { value: 'course', selected: kind === 'course' }, 'شهادةُ دورة'),
      h('option', { value: 'experience', selected: kind === 'experience' }, 'شهادةُ خبرة'));
    kindSel.onchange = () => { kind = kindSel.value; paintSample(); };
    return h('div.stack',
      h('p.small.muted', 'ما يُملأ هنا يُكتب في كلِّ شهادةٍ تُمنَح بهذا القالب، '
        + 'فلا يبقى عند المنح إلا اسمُ صاحبها.'),
      h('label.field', 'اسمُ القالب', nameIn),
      h('label.field', 'نوعُ الشهادة', kindSel),
      h('div.grid-2', FIXED.map(([k, label, type]) => {
        const i = h('input', { type, value: fixed[k] ?? '', 'aria-label': label });
        i.oninput = () => { fixed[k] = i.value; paintSample(); };
        return h('label.field', label, i);
      })));
  };

  const paintSample = () => {
    Object.assign(SAMPLE, { kind }, Object.fromEntries(
      FIXED.map(([k]) => [k, fixed[k] || SAMPLE[k]])));
    paint();
  };

  // الحفظ: قالبٌ مسمًّى يُحفَظ ويُنسَخ (ملاحظة ٣٢٤)
  const saveBtn = h('button.btn.primary', { type: 'button' }, '💾 احفظِ القالب');
  saveBtn.onclick = () => busy(saveBtn, async () => {
    if (!String(name || '').trim()) { toast('سَمِّ القالبَ أولًا', 'warn'); return; }
    try {
      const id = await db.rpc('save_cert_template',
        { p: { id: tpl?.id || null, name: name.trim(), kind, tpl: d, fixed } });
      tpl = { ...(tpl || {}), id, name: name.trim(), kind };
      toast('حُفظ القالب.', 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  });

  const copyBtn = h('button.btn.sm.ghost', { type: 'button' }, '⧉ احفظْ نسخةً باسمٍ جديد');
  copyBtn.onclick = async () => {
    const i = h('input', { value: `${name} — نسخة`, 'aria-label': 'اسم القالب الجديد' });
    const res = await dialog({
      title: 'نسخةٌ من القالب',
      body: h('div.stack', h('label.field', 'الاسمُ الجديد', i)),
      buttons: [{ label: 'احفظْها', kind: 'primary',
        validate: () => (i.value.trim().length > 1 ? true : 'اكتبِ اسمَ القالب'),
        value: () => i.value.trim() }, { label: 'إلغاء', value: null }]
    });
    if (!res) return;
    try {
      const id = await db.rpc('save_cert_template', { p: { name: res, kind, tpl: d, fixed } });
      tpl = { id, name: res, kind };
      name = res;
      toast('حُفظت النسخة.', 'ok');
      drawTabs();
    } catch (e) { toast(e.message, 'bad'); }
  };

  const tryBtn = h('button.btn.sm', { type: 'button' }, '🖨 جرّبْ طباعتها');
  tryBtn.onclick = () => {
    if (!printCertificate({ ...SAMPLE, design: { ...d } }, 'محمد بن عبدالله الأنصاري')) {
      toast('امنع حجبَ النوافذ لتُفتح الشهادة.', 'bad');
    }
  };

  const saveBox = () => h('div.stack',
    h('p.small.muted', 'يُحفَظ القالبُ باسمه، ويُمنَح به في شاشة الشهادات. '
      + 'ولكلِّ شهادةٍ أن تخرج عنه عند إصدارها.'),
    h('div.row', saveBtn, tryBtn),
    h('div.row', copyBtn),
    h('a.btn.sm.ghost', { href: '/app/certificates?tab=templates' }, '← كلُّ القوالب'));

  // ------------------------------------------------------------------
  const TABS = [
    ['fixed', '✎', 'بياناتُ القالب', 'ما يُملأ مرةً لكلِّ الشهادات', fixedBox],
    ['theme', '▦', 'القالبُ والاتجاه', 'ثلاثةُ قوالبَ وأفقيٌّ ورأسيّ', themeBox],
    ['bg',    '🖼', 'الخلفية', 'PDF بدقّة الطباعة', bgBox],
    ['marks', '◆', 'الشعارات', 'من المكتبة، والنزعُ لا يُتلف', marksBox],
    ['texts', 'T', 'النصوص', 'تُكتب وتُنسَّق وتَحمل الحقول', textsBox],
    ['wm',    '◈', 'العلامةُ المائية', 'شعارُ الهيئة في الوسط', markBox],
    ['sign',  '✒', 'توقيعُ المسؤول', 'يُرفع صورةً أو يُترك فراغًا', signBox],
    ['save',  '💾', 'حفظُ القالب', 'باسمه، ويُمنَح به', saveBox]
  ];
  const tools = h('div.cd-tools');
  let open = 'fixed';
  function drawTabs() {
    tools.replaceChildren(...TABS.map(([key, icon, label, hint]) => {
      const b = h('button.cd-tool' + (key === open ? '.on' : ''),
        { type: 'button', 'aria-label': label, title: hint },
        h('i.cd-tool-icon', { 'aria-hidden': 'true' }, icon),
        h('b', label), h('span.small.muted', hint));
      b.onclick = () => { open = key; drawTabs(); };
      return b;
    }));
    const made = TABS.find(t => t[0] === open);
    body.replaceChildren(h('h3', made[2]), made[4]());
  }

  drawTabs();
  drawProps();
  paintSample();

  return h('div',
    h('div.page-head', h('div.grow',
      h('div.eyebrow', 'الفريق'), h('h1', `تصميمُ الشهادة — ${name}`),
      h('p.muted', 'ما تراه هنا هو ما يُطبَع: اللوحةُ تُرسَم بالمولِّد نفسِه. '
        + 'املأْ بياناتِ القالب، واسحبِ الشعاراتِ والنصوصَ إلى مواضعها، ثم احفظْه باسمه.'))),
    h('div.card.cd-board',
      h('div.cd-wrap',
        h('div.stack.cd-props', h('h3', 'خصائصُ العنصر'), panel),
        h('div.stack.cd-stage',
          h('h3', 'لوحةُ التصميم'),
          h('div.cert-stage-wrap', stage),
          h('p.small.muted', 'اسحبِ العنصرَ بالفأرة، أو اضبطْ موضعَه بالأشرطة.')),
        h('div.stack.cd-side', tools, body))));
}
