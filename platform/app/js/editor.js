// محرر الترجمة: ورقة A4 على كليشة الهيئة بمساحة كتابة ثابتة، مع أدوات تنسيق متقدمة وتنقية لما يُلصق.
import { h, toast } from './ui.js';
import { sanitize } from './sanitize.js';
import { letterheadPage, PAGE, BOX, flowStarts, fontsSettled } from './page.js';

const BLOCKS = 'P,H2,H3,BLOCKQUOTE,LI,DIV,TD,TH';

// تُنتظَر خطوطُ الصفحة مرّةً واحدةً لكلِّ الجلسة (ملاحظة ٤٣٠)
let FONTS_READY = null;

// ـــ الخطوط (ملاحظة ٤٢٤)
//
//   Traditional Arabic خطٌّ لا يُرفَق: ترخيصُه لا يسمح، فيُطلَب بالاسم
//   فيظهر عند من ثبَّته (وهو مثبَّتٌ مع Office في الغالب) ويظهر في Word
//   عند كلِّ من عنده. و«خطُّ النسخ» مرفقٌ بالمنصة في /assets، فهو
//   المرجعُ المضمونُ الذي لا يتوقَّف على جهاز العضو. وأوّلُ أسرةٍ في
//   السلسلة هي التي تُكتَب في ملفِّ Word، فجُعلت في كلٍّ أسرتَه.
export const FONT_CHOICES = [
  ['', 'الخط'],
  ['Haramain Arabic', 'خط المنصة'],
  ['"Haramain Naskh", "Traditional Arabic", "Noto Naskh Arabic", serif', 'نسخ (مرفقٌ بالمنصة)'],
  ['"Traditional Arabic", "Haramain Naskh", "Noto Naskh Arabic", serif', 'Traditional Arabic'],
  ['Arial', 'Arial'],
  ['Tahoma', 'Tahoma'],
  ['Times New Roman', 'Times New Roman'],
  ['Georgia', 'Georgia'],
  ['Verdana', 'Verdana']
];

export function createEditor({ html = '', dir = 'rtl', placeholder = 'اكتب هنا…', readOnly = false, label = 'النص', onChange, top = null, plain = false, detachTools = false, lang = '' } = {}) {
  const area = h('div.area', {
    contenteditable: readOnly ? 'false' : 'true', dir, role: 'textbox', 'aria-multiline': 'true',
    'aria-label': label, 'data-placeholder': placeholder, spellcheck: 'true'
  });
  area.innerHTML = sanitize(html);
  // الآيةُ المدرَجةُ لا تُحرَّر: وسمُ الإغلاق تُسقِطه التنقيةُ عند
  //   الحفظ، فيُعاد عند كلِّ عرضٍ من صفِّها (ملاحظة ٥٠٠)
  const lockAyat = () => {
    area.querySelectorAll('.aya').forEach(el => { el.contentEditable = 'false'; });
  };
  lockAyat();
  // والنقرُ على الآية يضع المؤشِّرَ بعدها لا داخلَها، فيُستأنَف الكلامُ
  //   في سطرها وتعمل أزرارُ المحاذاة على فقرتها (ملاحظتا ٨ و٩)
  const caretAfter = node => {
    try {
      // المؤشِّرُ يُوضَع داخلَ عقدةٍ نصّيّةٍ بعد القطعة المغلقة، لا بعدها
      //   عنصريًّا: المتصفِّحُ لا يقبل الكتابةَ ولا التنسيقَ إن كان
      //   الاختيارُ على حافّة عنصرٍ غيرِ محرَّر (ملاحظتا ٨ و٩)
      let next = node.nextSibling;
      if (!next || next.nodeType !== 3) {
        next = document.createTextNode('\u00A0');
        node.after(next);
      }
      const r = document.createRange();
      r.setStart(next, next.nodeValue.length);
      r.collapse(true);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    } catch { /* لا يُعطَّل التحريرُ إن تعذَّر الوضع */ }
  };
  area.addEventListener('click', ev => {
    if (readOnly) return;
    const a = ev.target && ev.target.closest ? ev.target.closest('.aya') : null;
    if (a && area.contains(a)) { caretAfter(a); area.focus(); }
  });
  const { page, body, num } = plain ? { page: area, body: area, num: null } : letterheadPage(top, area);
  const pages = h('span.small.muted.pages-est');
  const changed = () => { updatePages(); onChange && onChange(); };

  // علامات وهمية لا تُطبع: حدّ الهوامش، ونهاية كل صفحة وبداية التالية — ليُوازن النص
  // فتبدأ الخطبة الثانية في صفحة جديدة مثلًا (ملاحظة ١٣٣)
  const guides = plain ? null : h('div.lh-guides', { 'aria-hidden': 'true', contenteditable: 'false' });
  const margins = plain ? null : h('div.lh-margins', { 'aria-hidden': 'true' });
  // مواضعُ الفواصل بالبكسل كما يقطعها التصديرُ بالضبط، لا بارتفاع
  //   الصندوق مضروبًا في رقم الصفحة (ملاحظة ٤٢٣)
  let lastKey = '';
  function drawGuides(starts) {
    if (!guides) return;
    const key = starts.join(',');
    if (key === lastKey) return;
    lastKey = key;
    guides.replaceChildren(...starts.slice(1).map((px, i) => h('div.lh-brk',
      { style: { top: `${Math.round(px)}px` } },
      h('span.lh-brk-t', `نهاية الصفحة ${i + 1}`),
      h('span.lh-brk-t.next', `بداية الصفحة ${i + 2}`))));
  }
  // ـــ القياسُ بمقاس الطباعة لا بمقاس العرض (ملاحظة ٤٣٠)
  //
  //   الورقةُ على الشاشة أصغرُ من الورقة المطبوعة، فتُدوَّر أطوالُ السطور
  //   تدويرًا مختلفًا، فيتأرجح السطرُ الواقعُ على حافّة الصفحة بين
  //   الصفحتين. فيُنسَخ المحتوى في صندوقٍ خفيٍّ عرضُه عرضُ صندوق الكتابة
  //   بالملّيمتر وخطُّه ١٢ نقطةً — أي بمقاس PDF بعينه — فيُقاس فيه،
  //   ثمَّ تُردُّ المواضعُ إلى مقاس الشاشة بنسبةِ العرضَين.
  const measure = plain ? null : h('div.print-body.lh-measure', { 'aria-hidden': 'true' });

  function printStarts() {
    if (!measure) return { starts: [0], ratio: 1 };
    if (!measure.isConnected) document.body.append(measure);
    measure.dir = body.dir || dir;
    measure.innerHTML = body.innerHTML;
    measure.querySelectorAll('.lh-guides, .lh-num').forEach(x => x.remove());
    const probe = h('div', { style: {
      height: `${PAGE.h - PAGE.top - PAGE.bottom - BOX.numH - BOX.safeH}mm`,
      width: '1px', position: 'absolute', visibility: 'hidden' } });
    document.body.append(probe);
    const boxPx = probe.getBoundingClientRect().height || 1;
    probe.remove();
    const { starts } = flowStarts(measure, { boxPx });
    const mw = measure.getBoundingClientRect().width || 1;
    const bw = body.getBoundingClientRect().width || mw;
    return { starts, ratio: bw / mw };
  }

  let pending = null;
  function updatePages() {
    if (plain) return;
    if (pending) clearTimeout(pending);
    pending = setTimeout(async () => {
      pending = null;
      // ولا يُقاس قبل أن تستقرَّ خطوطُ الصفحة (ملاحظة ٤٣٠)
      FONTS_READY = FONTS_READY || fontsSettled(document);
      await FONTS_READY;
      if (!body.isConnected) { measure?.remove(); return; }
      const { starts, ratio } = printStarts();
      const n = Math.max(1, starts.length);
      pages.textContent = `≈ ${n} صفحة عند الطباعة`;
      if (num) num.dataset.n = String(n);
      drawGuides(starts.map(s => s * ratio));
    }, 180);
  }

  // آخر تحديد داخل الورقة: القوائم المنسدلة تأخذ التركيز، فنعيد التحديد قبل التنفيذ
  let lastRange = null;
  const onSel = () => {
    if (!area.isConnected && lastRange) { document.removeEventListener('selectionchange', onSel); return; }
    const sel = getSelection();
    if (sel.rangeCount && area.contains(sel.anchorNode)) lastRange = sel.getRangeAt(0).cloneRange();
  };
  document.addEventListener('selectionchange', onSel);
  // حفظ التحديد كمواضع نصية لاستعادته بعد إعادة ترتيب العقد
  const offsetOf = (node, off) => { const r = document.createRange(); r.setStart(area, 0); r.setEnd(node, off); return r.toString().length; };
  function pointAt(n) {
    const w = document.createTreeWalker(area, NodeFilter.SHOW_TEXT);
    let t, last = null;
    while ((t = w.nextNode())) { if (n <= t.length) return [t, n]; n -= t.length; last = t; }
    return last ? [last, last.length] : [area, area.childNodes.length];
  }
  const focus = () => {
    if (area.contains(document.activeElement)) return;
    area.focus();
    if (lastRange && area.contains(lastRange.startContainer)) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(lastRange); }
  };
  // يلف النص المباشر داخل الورقة في فقرات حتى تُطبَّق عليه خصائص الفقرة
  function ensureBlocks() {
    let p = null;
    for (const n of [...area.childNodes]) {
      if (n.nodeType === 1 && /^(P|H2|H3|BLOCKQUOTE|UL|OL|TABLE|DIV|HR)$/.test(n.tagName)) { p = null; continue; }
      if (n.nodeType === 3 && !n.textContent.trim() && !p) continue;
      if (!p) { p = document.createElement('p'); n.before(p); }
      p.append(n);
    }
  }
  const cmd = (name, value = null) => { focus(); document.execCommand('styleWithCSS', false, false); document.execCommand(name, false, value); changed(); };

  // ـــ المحاذاةُ بأيدينا لا بأمر المتصفِّح (ملاحظة ٩)
  //
  //   أمرُ `justify*` في المتصفِّح يمتنع عن الفقرة التي فيها قطعةٌ
  //   مغلقةٌ عن التحرير — كفقرةِ آيةٍ مدرَجة — فيرجع «نجح» ولا يُغيِّر
  //   شيئًا. فصارت المحاذاةُ تُكتَب على الفقرة نفسِها، فتعمل في كلِّ
  //   حال: في الآية وفي غيرها.
  function align(v) {
    focus();
    let blocks = selectedBlocks();
    if (!blocks.length && lastRange && area.contains(lastRange.startContainer)) {
      const n = lastRange.startContainer;
      const el = n.nodeType === 1 ? n : n.parentElement;
      const b = el && el.closest(BLOCKS);
      if (b && area.contains(b)) blocks = [b];
    }
    if (!blocks.length) { ensureBlocks(); blocks = [...area.children].filter(x => x.matches(BLOCKS)); }
    blocks.forEach(b => { b.style.textAlign = v; });
    changed();
  }

  function selectedBlocks() {
    const sel = getSelection();
    if (!sel.rangeCount || !area.contains(sel.anchorNode)) return [];
    const range = sel.getRangeAt(0);
    const all = [...area.querySelectorAll(BLOCKS)].filter(b => range.intersectsNode(b) && !b.querySelector(BLOCKS.split(',').map(t => `:scope > ${t}`).join(',')));
    if (all.length) return all;
    const start = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    return [start.closest(BLOCKS)].filter(b => b && area.contains(b));
  }
  // إزالة التظليل عن التحديد كاملًا (لا يكفي removeFormat في بعض المتصفحات)
  function clearHighlight() {
    focus();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('hiliteColor', false, 'transparent');
    const sel = getSelection();
    const range = sel.rangeCount ? sel.getRangeAt(0) : null;
    for (const el of area.querySelectorAll('[style*="background"], font[style], span[style]')) {
      if (range && !range.intersectsNode(el)) continue;
      el.style.removeProperty('background-color');
      el.style.removeProperty('background');
      if (!el.getAttribute('style')) el.removeAttribute('style');
      if (el.tagName === 'SPAN' && !el.attributes.length) el.replaceWith(...el.childNodes);
    }
    changed();
  }

  // ـــ أزرارُ التنسيق تتحكَّم في الآية المدرَجة كما تتحكَّم في سائر
  //   النصّ (ملاحظة ٩ المستأنَفة)
  //
  //   الآيةُ قطعةٌ مغلقةٌ عن التحرير حفظًا لحروفها، وأوامرُ المتصفِّح
  //   لا تنفذ إليها، فكان الزرُّ يُضغَط ولا يقع أثرُه. فصارت هيئتُها
  //   تُكتَب عليها هنا مباشرة: الغلظُ والميلُ والتسطيرُ والشطبُ واللونُ
  //   والتظليل. ونصُّها لا يُمَسُّ بحال، فالمقابلةُ في الخادم باقيةٌ
  //   على أصله.
  const ayasInSelection = () => {
    const all = [...area.querySelectorAll('.aya')];
    if (!all.length) return [];
    const sel = getSelection();
    const r = (sel && sel.rangeCount && area.contains(sel.anchorNode))
      ? sel.getRangeAt(0)
      : (lastRange && area.contains(lastRange.startContainer) ? lastRange : null);
    if (!r) return [];
    if (!r.collapsed) return all.filter(el => { try { return r.intersectsNode(el); } catch { return false; } });
    // والمؤشِّرُ الملاصقُ لآيةٍ يُعَدُّ اختيارًا لها: فالنقرُ عليها يضعه بعدها
    const n = r.startContainer;
    const prev = n.nodeType === 3
      ? (r.startOffset === 0 ? n.previousSibling
         : (/^[\s\u00A0]*$/.test(n.nodeValue.slice(0, r.startOffset)) ? n.previousSibling : null))
      : n.childNodes[r.startOffset - 1];
    const el = prev && prev.nodeType === 1 && prev.classList && prev.classList.contains('aya')
      ? prev : null;
    return el ? [el] : [];
  };

  // يُبدَّل بين قيمتين، ويُرَدُّ هل وقع الأثرُ على آية
  const styleAya = (prop, on, off) => {
    const list = ayasInSelection();
    if (!list.length) return false;
    const cur = list[0].style[prop];
    const next = (cur === on) ? off : on;
    list.forEach(el => { el.style[prop] = next; });
    changed();
    return true;
  };
  const setAya = (prop, v) => {
    const list = ayasInSelection();
    if (!list.length) return false;
    list.forEach(el => { el.style[prop] = v; });
    changed();
    return true;
  };

  function insertTable(spec) {
    const [r, c] = spec.split('x').map(Number);
    const row = tag => `<tr>${Array.from({ length: c }, () => `<${tag}><br></${tag}>`).join('')}</tr>`;
    cmd('insertHTML', `<table><tbody>${row('th')}${Array.from({ length: r - 1 }, () => row('td')).join('')}</tbody></table><p><br></p>`);
  }

  const btn = (text, title, fn, cls) => h('button', { type: 'button', title, 'aria-label': title, class: cls, onmousedown: e => e.preventDefault(), onclick: fn }, text);
  const sel = (title, options, fn) => h('select', { 'aria-label': title, title, onchange: e => { fn(e.target.value); e.target.selectedIndex = 0; } },
    options.map(([v, t]) => h('option', { value: v }, t)));
  // الآيةُ تُدرَج مغلقةً لا تُحرَّر، ويُفتَح تحتها سطرُ ترجمتها (ملاحظة ٥٠٠)
  async function insertAya() {
    try {
      const m = await import('./quran.js');
      const html = await m.ayaPick(lang);
      if (!html) return;
      // ـــ علامةٌ تُدرَج مع الآية ليُوضَع المؤشِّرُ بعدها (ملاحظة ٨)
      //
      //   الآيةُ قطعةٌ مغلقةٌ عن التحرير، والمتصفِّحُ بعد الإدراج يترك
      //   المؤشِّرَ داخلَها أو عند حافّتها، فلا يُكتَب بعدها ولا تعمل
      //   أزرارُ المحاذاة لأنَّ الاختيارَ ليس في فقرةٍ محرَّرة. فتُدرَج
      //   معها علامةٌ، ثمَّ تُستبدَل بفراغٍ ويُوضَع المؤشِّرُ بعده، فيصير
      //   الاستئنافُ في سطرها كما يُستأنَف بعد أيِّ كلمة.
      cmd('insertHTML', html + '<span data-ayac="1"></span>');
      // وقد يُخرِج المتصفِّحُ المُدرَجَ من فقرته عند الإدراج، فيُعاد لفُّ
      //   ما ليس في فقرةٍ قبل وضع المؤشِّر
      ensureBlocks();
      lockAyat();
      const mark = area.querySelector('[data-ayac]');
      if (mark) {
        const space = document.createTextNode('\u00A0');
        mark.replaceWith(space);
        try {
          const r = document.createRange();
          r.setStart(space, space.nodeValue.length);
          r.collapse(true);
          const sel = getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
        } catch { /* متصفِّحٌ لم يقبل الوضع: يبقى المؤشِّرُ حيث تركه */ }
      }
      area.focus();
      changed();
    } catch (e) { toast(e.message, 'bad'); }
  }

  const color = (title, value, fn) => h('label.color', { title }, h('input', { type: 'color', value, 'aria-label': title, onchange: e => fn(e.target.value) }));
  const sep = () => h('span.sep', { 'aria-hidden': 'true' });

  const tools = h('div.tools', { role: 'toolbar', 'aria-label': 'تنسيق النص' },
    // ـــ الخطُّ والمقاسُ والتباعدُ لم تبقَ اختيارًا: صارت من الكليشة
    //   وحدَها — أربعَ عشرةَ نقطةً بتباعد ١٫٩ — فلا تختلف ورقةٌ عن ورقة
    //   (ملاحظة ٤٩٩). ويبقى للمترجم نوعُ الفقرة: متنٌ أو عنوان
    sel('نوع الفقرة', [['', 'الفقرة'], ['p', 'نص عادي'], ['h2', 'عنوان رئيسي'], ['h3', 'عنوان فرعي'], ['blockquote', 'اقتباس']], v => v && cmd('formatBlock', v)),
    // ـــ إدراجُ الآية بالرسم العثمانيِّ من مصحف المنصة (ملاحظة ٥٠٠)
    btn('﴿آية﴾', 'إدراجُ آيةٍ بالرسم العثماني', () => insertAya()),
    sep(),
    btn('B', 'عريض (Ctrl+B)', () => { if (!styleAya('fontWeight', '700', '400')) cmd('bold'); }, 'b'),
    btn('I', 'مائل (Ctrl+I)', () => { if (!styleAya('fontStyle', 'italic', 'normal')) cmd('italic'); }, 'i'),
    btn('U', 'تسطير (Ctrl+U)', () => { if (!styleAya('textDecoration', 'underline', 'none')) cmd('underline'); }, 'u'),
    btn('S', 'شطب', () => { if (!styleAya('textDecoration', 'line-through', 'none')) cmd('strikeThrough'); }, 's'),
    btn('x²', 'نص علوي', () => cmd('superscript')),
    btn('x₂', 'نص سفلي', () => cmd('subscript')),
    color('لون النص', '#bc9661', v => { if (!setAya('color', v)) cmd('foreColor', v); }),
    color('تظليل', '#fff3b0', v => { if (!setAya('backgroundColor', v)) cmd('hiliteColor', v); }),
    btn('⌧', 'إزالة التظليل', () => { if (!setAya('backgroundColor', 'transparent')) clearHighlight(); }),
    sep(),
    btn('⇥', 'محاذاة لليمين', () => align('right')),
    btn('≡', 'توسيط', () => align('center')),
    btn('⇤', 'محاذاة لليسار', () => align('left')),
    btn('☰', 'ضبط', () => align('justify')),
    btn('•', 'قائمة نقطية', () => cmd('insertUnorderedList')),
    btn('1.', 'قائمة مرقمة', () => cmd('insertOrderedList')),
    btn('⇲', 'زيادة المسافة البادئة', () => cmd('indent')),
    btn('⇱', 'إنقاص المسافة البادئة', () => cmd('outdent')),
    sel('إدراج جدول', [['', 'جدول'], ['2x2', '2 × 2'], ['3x2', '3 صفوف × 2'], ['3x3', '3 × 3'], ['4x3', '4 صفوف × 3'], ['5x4', '5 صفوف × 4']], v => v && insertTable(v)),
    btn('―', 'خط فاصل', () => cmd('insertHorizontalRule')),
    sep(),
    btn('↶', 'تراجع (Ctrl+Z)', () => cmd('undo')),
    btn('↷', 'إعادة (Ctrl+Y)', () => cmd('redo')),
    btn('⌫', 'مسح التنسيق', () => {
      // ومسحُ التنسيق عن الآية يُعيدها إلى هيئتها المقرَّرة في الكليشة
      const list = ayasInSelection();
      if (list.length) { list.forEach(el => el.removeAttribute('style')); changed(); }
      else cmd('removeFormat');
    }),
    btn(dir === 'rtl' ? 'ع←' : '→A', 'تبديل اتجاه الفقرة', e => {
      const blocks = selectedBlocks();
      const target = blocks.length ? blocks : [area];
      const next = (target[0].getAttribute('dir') || getComputedStyle(target[0]).direction) === 'rtl' ? 'ltr' : 'rtl';
      target.forEach(b => b.setAttribute('dir', next));
      e.currentTarget.textContent = next === 'rtl' ? 'ع←' : '→A';
      changed();
    })
  );

  area.addEventListener('paste', e => {
    const data = e.clipboardData;
    if (!data) return;
    e.preventDefault();
    const pasted = data.getData('text/html');
    if (pasted) document.execCommand('insertHTML', false, sanitize(pasted));
    else document.execCommand('insertText', false, data.getData('text/plain'));
    changed();
  });
  area.addEventListener('input', changed);
  area.addEventListener('focus', () => { try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* */ } });
  new ResizeObserver(updatePages).observe(body);

  if (guides) body.append(guides);
  if (margins) page.append(margins);

  const el = h('div.editor', { class: (readOnly ? 'readonly ' : '') + (plain ? 'plain' : 'paged') }, readOnly || detachTools ? null : tools, page, plain ? null : h('div.editor-foot', pages));

  // زرّ إظهار العلامات وإخفائها، واختيار العضو محفوظ له في متصفحه (ملاحظة ١٣٣)
  if (!plain) {
    const KEY = 'hs-lh-guides';
    let on = true;
    try { on = localStorage.getItem(KEY) !== '0'; } catch { /* المتصفح قد يمنع الحفظ */ }
    const gBtn = h('button', { type: 'button', title: 'علامات الهوامش وحدود الصفحات (لا تُطبع)',
      'aria-label': 'علامات الهوامش وحدود الصفحات', onmousedown: e => e.preventDefault() }, '⊞');
    const paint = () => { el.classList.toggle('no-guides', !on); gBtn.classList.toggle('on', on); };
    gBtn.onclick = () => { on = !on; try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* */ } paint(); };
    tools.append(sep(), gBtn);
    paint();
    if (readOnly || detachTools) el.classList.add('guides-plain');
  }
  updatePages();
  return {
    el, page, tools: readOnly ? null : tools,
    get html() { return sanitize(area.innerHTML); },
    set html(v) { area.innerHTML = sanitize(v); lockAyat(); updatePages(); },
    get text() { return (area.textContent || '').trim(); },
    focus() { area.focus(); }
  };
}
