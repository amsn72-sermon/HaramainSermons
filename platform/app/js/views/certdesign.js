// مصمِّمُ الشهادات: شاشةٌ كشاشة بطاقات العمل — مربّعٌ واحدٌ بلا فراغ،
// خصائصُ العنصر يمينًا، ولوحةُ التصميم وسطًا، وشريطُ أيقوناتٍ يسارًا
// كلُّ أيقونةٍ تفتح بابَها وحدَها (ملاحظة ٣١٢).
//
//   واللوحةُ تُرسَم بالمولِّد نفسِه الذي تُطبَع به الشهادة (certHtml)،
//   فما تراه هو ما يُطبَع حرفًا بحرف — لا نموذجٌ يُشبهه.
import { h, fill, toast, busy, confirm } from '../ui.js';
import { db } from '../sb.js';
import { state, isManager, can } from '../store.js';
import { certHtml, CERT_THEMES, DEFAULT_CERT_MARKS, printCertificate } from '../certdoc.js';
import { prepareMark } from '../photo.js';

// شهادةٌ تجريبيةٌ تُرسَم بها اللوحةُ قبل أن تُمنَح شهادةٌ حقيقية
const SAMPLE = {
  kind: 'course', status: 'issued',
  title: 'مهاراتُ الترجمة الشرعية',
  subject: 'مصطلحاتُ الخطبة ومقاصدُها',
  hours: 12, place: 'مكة المكرمة', provider: 'مشروع خادم الحرمين الشريفين للترجمة',
  start_on: '2026-03-01', end_on: '2026-03-04',
  signer_name: 'عبدالرحمن بن محمد', signer_role: 'مدير المشروع',
  signature: 'blank', serial_no: 'HS-1448-0147', verify_key: 'preview',
  issued_at: new Date().toISOString()
};

// الشعاراتُ الثلاثةُ الافتراضية (ملاحظة ٣١٠)
export const DEFAULT_MARKS = () => DEFAULT_CERT_MARKS.map(g => ({ ...g }));

export async function render() {
  if (!(isManager() || can('cert_design'))) {
    return h('div', h('div.page-head', h('div.grow',
      h('div.eyebrow', 'الفريق'), h('h1', 'تصميمُ الشهادة'))),
      h('div.card', h('p.muted', 'هذا خارجَ نطاقِ عملك الحالي.')));
  }

  let d = {};
  try { d = (await db.rpc('cert_design')) || {}; } catch { d = {}; }
  if (!d || typeof d !== 'object') d = {};
  if (!Array.isArray(d.logos) || !d.logos.length) d.logos = DEFAULT_MARKS();
  if (d.header === undefined) d.header = false;      // الرأسُ من الشعارات لا من واحدٍ ثابت

  const stage = h('div.cert-stage');
  const frame = h('iframe.cert-frame', { title: 'لوحةُ تصميم الشهادة',
    sandbox: 'allow-same-origin' });
  stage.append(frame);
  const panel = h('div.cd-panel');
  const body = h('div.stack.cd-tabbody');

  // ------------------------------------------------------------------
  // الرسمُ: المولِّدُ نفسُه، مصغَّرًا في اللوحة
  // ------------------------------------------------------------------
  // اللوحةُ تعرض الشهادةَ بمقاسها الحقيقيِّ مصغَّرةً، فالنسبُ محفوظة
  const fit = () => {
    const land = d.landscape !== false;
    const mm = v => (v * 96) / 25.4;
    const w = mm(land ? 297 : 210);
    const box = stage.getBoundingClientRect();
    if (!box.width) return;
    frame.style.transform = `scale(${box.width / w})`;
  };

  const paint = () => {
    const c = { ...SAMPLE, design: { ...d } };
    frame.srcdoc = certHtml(c, 'محمد بن عبدالله الأنصاري');
    const land = d.landscape !== false;
    stage.classList.toggle('portrait', !land);
    requestAnimationFrame(fit);
    drawHandles();
  };
  window.addEventListener('resize', fit);

  // مقابضُ السحب: تُرسَم فوق اللوحة، فيُحرَّك الشعارُ بالفأرة
  //   كما يُحرَّك عنصرُ بطاقة العمل (ملاحظة ٣١٢)
  const handles = h('div.cert-handles');
  stage.append(handles);
  let picked = -1;

  function drawHandles() {
    handles.replaceChildren(...(d.logos || []).map((g, i) => {
      const el = h('div.cert-handle' + (i === picked ? '.on' : ''), {
        title: 'اسحبْه إلى موضعه',
        style: { insetInlineStart: `${g.x}%`, top: `${g.y}%`,
          width: `${Math.max(4, (Number(g.h) || 14) * 0.9)}%`,
          height: `${(Number(g.h) || 14) * 1.3}%` }
      });
      el.onpointerdown = e => {
        e.preventDefault();
        picked = i; drawProps(); drawHandles();
        const box = stage.getBoundingClientRect();
        const move = ev => {
          g.x = Math.max(0, Math.min(94, ((ev.clientX - box.left) / box.width) * 100));
          g.y = Math.max(0, Math.min(94, ((ev.clientY - box.top) / box.height) * 100));
          // في RTL يُقاس من اليمين
          if (getComputedStyle(stage).direction === 'rtl') {
            g.x = Math.max(0, Math.min(94, ((box.right - ev.clientX) / box.width) * 100));
          }
          el.style.insetInlineStart = `${g.x}%`;
          el.style.top = `${g.y}%`;
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          paint();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      };
      return el;
    }));
  }

  // ------------------------------------------------------------------
  // خصائصُ العنصر المختار
  // ------------------------------------------------------------------
  const num = (label, val, min, max, step, set) => {
    const i = h('input', { type: 'range', min: String(min), max: String(max),
      step: String(step), value: String(val), 'aria-label': label });
    const out = h('span.small.muted', String(Math.round(val * 10) / 10));
    i.oninput = () => { out.textContent = String(Math.round(Number(i.value) * 10) / 10); set(Number(i.value)); };
    return h('label.field', h('span.row.between', h('span', label), out), i);
  };

  function drawProps() {
    const g = d.logos[picked];
    if (!g) {
      fill(panel, h('p.small.muted', 'اختر شعارًا من اللوحة لتظهر خصائصُه، '
        + 'أو أضِفْ شعارًا من «الشعارات».'));
      return;
    }
    fill(panel,
      h('div.row.between', h('b', `الشعار ${picked + 1}`),
        h('img.mark-thumb', { src: g.src, alt: '' })),
      num('من اليمين ٪', g.x, 0, 94, 0.5, v => { g.x = v; paint(); }),
      num('من الأعلى ٪', g.y, 0, 94, 0.5, v => { g.y = v; paint(); }),
      num('الارتفاع مم', Number(g.h) || 14, 5, 60, 0.5, v => { g.h = v; paint(); }),
      h('div.row',
        h('button.btn.sm.ghost', { type: 'button', onclick: () => {
          d.logos.splice(picked, 1); picked = -1; paint(); drawProps();
        } }, 'احذفْ هذا الشعار')));
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

  const marksBox = () => {
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true,
      'aria-label': 'ملفُّ الشعار' });
    const add = h('button.btn.sm', { type: 'button' }, '＋ أضِفْ شعارًا');
    add.onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files?.[0]; if (!f) return;
      try {
        d.logos.push({ src: await prepareMark(f, 500), x: 45, y: 5, h: 16 });
        picked = d.logos.length - 1;
        paint(); drawProps(); drawTabs();
      } catch (e) { toast(e.message, 'bad'); }
      file.value = '';
    };
    const reset = h('button.btn.sm.ghost', { type: 'button' }, 'أعِدِ الثلاثةَ الافتراضية');
    reset.onclick = async () => {
      if (!await confirm('إعادةُ الشعارات', 'تُستبدَل الشعاراتُ الحاليةُ بالثلاثة '
        + 'الافتراضية: الهيئةُ والشؤونُ الدينيةُ وجامعةُ أمِّ القرى.')) return;
      d.logos = DEFAULT_MARKS(); picked = -1; paint(); drawProps(); drawTabs();
    };
    return h('div.stack',
      h('p.small.muted', 'ثلاثةُ شعاراتٍ افتراضية: الهيئةُ والشؤونُ الدينيةُ يمينًا، '
        + 'وجامعةُ أمِّ القرى يسارًا. وتُضاف وتُحذَف وتُحرَّك بالسحب على اللوحة.'),
      h('div.row', add, file, reset),
      h('div.stack', { style: { gap: '6px' } },
        (d.logos || []).map((g, i) => {
          const b = h('button.btn.xs' + (i === picked ? '.primary' : ''), { type: 'button' },
            h('img.mark-thumb', { src: g.src, alt: '' }), `الشعار ${i + 1}`);
          b.onclick = () => { picked = i; drawProps(); drawHandles(); drawTabs(); };
          return b;
        })));
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

  const saveBtn = h('button.btn.primary', { type: 'button' }, '💾 احفظِ القالب');
  saveBtn.onclick = () => busy(saveBtn, async () => {
    try {
      await db.rpc('save_cert_design', { p: d });
      toast('حُفظ القالب — يسري على ما يُصدَر بعده.', 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  });

  const tryBtn = h('button.btn.sm', { type: 'button' }, '🖨 جرّبْ طباعتها');
  tryBtn.onclick = () => {
    if (!printCertificate({ ...SAMPLE, design: { ...d } }, 'محمد بن عبدالله الأنصاري')) {
      toast('امنع حجبَ النوافذ لتُفتح الشهادة.', 'bad');
    }
  };

  const saveBox = () => h('div.stack',
    h('p.small.muted', 'يُحفَظ القالبُ فيصير قالبَ شهادات الفريق كلِّه، '
      + 'ولكلِّ شهادةٍ أن تخرج عنه عند إصدارها.'),
    h('div.row', saveBtn, tryBtn));

  // ------------------------------------------------------------------
  const TABS = [
    ['theme', '▦', 'القالبُ والاتجاه', 'ثلاثةُ قوالبَ وأفقيٌّ ورأسيّ', themeBox],
    ['marks', '🖼', 'الشعارات', 'تُضاف وتُحرَّك بالسحب', marksBox],
    ['wm',    '◈', 'العلامةُ المائية', 'شعارُ الهيئة في الوسط', markBox],
    ['sign',  '✒', 'توقيعُ المسؤول', 'يُرفع صورةً أو يُترك فراغًا', signBox],
    ['save',  '💾', 'حفظُ القالب', 'يسري على ما يُصدَر بعده', saveBox]
  ];
  const tools = h('div.cd-tools');
  let open = 'theme';
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
  paint();

  return h('div',
    h('div.page-head', h('div.grow',
      h('div.eyebrow', 'الفريق'), h('h1', 'تصميمُ الشهادة'),
      h('p.muted', 'ما تراه هنا هو ما يُطبَع: اللوحةُ تُرسَم بالمولِّد نفسِه. '
        + 'اسحبِ الشعارَ إلى موضعه، واضبطِ العلامةَ والتوقيع، ثم احفظِ القالب.'))),
    h('div.card.cd-board',
      h('div.cd-wrap',
        h('div.stack.cd-props', h('h3', 'خصائصُ العنصر'), panel),
        h('div.stack.cd-stage',
          h('h3', 'لوحةُ التصميم'),
          h('div.cert-stage-wrap', stage),
          h('p.small.muted', 'اسحبِ الشعارَ بالفأرة، أو اضبطْ موضعَه بالأشرطة.')),
        h('div.stack.cd-side', tools, body))));
}
