// محرر الترجمة: ورقة A4 على كليشة الهيئة بمساحة كتابة ثابتة، مع أدوات تنسيق متقدمة وتنقية لما يُلصق.
import { h } from './ui.js';
import { sanitize } from './sanitize.js';
import { letterheadPage, PAGE, BOX, flowStarts, fontsSettled } from './page.js';

const PT_SIZES = [9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28];
const LINE_HEIGHTS = [['1', 'مفرد'], ['1.15', '1.15'], ['1.5', '1.5'], ['1.8', '1.8'], ['2', 'مزدوج'], ['2.5', '2.5']];
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

export function createEditor({ html = '', dir = 'rtl', placeholder = 'اكتب هنا…', readOnly = false, label = 'النص', onChange, top = null, plain = false, detachTools = false } = {}) {
  const area = h('div.area', {
    contenteditable: readOnly ? 'false' : 'true', dir, role: 'textbox', 'aria-multiline': 'true',
    'aria-label': label, 'data-placeholder': placeholder, spellcheck: 'true'
  });
  area.innerHTML = sanitize(html);
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
    const starts = flowStarts(measure, { boxPx });
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

  // تحويل ناتج fontSize المؤقت (size=7) إلى حجم بالنقاط نسبةً لحجم الصفحة الأساسي (12pt)
  function fontSizePt(pt) {
    cmd('fontSize', '7');
    area.querySelectorAll('font[size="7"]').forEach(f => {
      const s = h('span', { style: { fontSize: `${(pt / 12).toFixed(4).replace(/0+$/, '')}em` } });
      s.append(...f.childNodes); f.replaceWith(s);
    });
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
  function lineHeight(v) {
    const saved = lastRange && area.contains(lastRange.startContainer)
      ? [offsetOf(lastRange.startContainer, lastRange.startOffset), offsetOf(lastRange.endContainer, lastRange.endOffset)] : null;
    ensureBlocks();
    area.focus();
    if (saved) {
      const r = document.createRange(); r.setStart(...pointAt(saved[0])); r.setEnd(...pointAt(saved[1]));
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    }
    selectedBlocks().forEach(b => { b.style.lineHeight = v; });
    changed();
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

  function insertTable(spec) {
    const [r, c] = spec.split('x').map(Number);
    const row = tag => `<tr>${Array.from({ length: c }, () => `<${tag}><br></${tag}>`).join('')}</tr>`;
    cmd('insertHTML', `<table><tbody>${row('th')}${Array.from({ length: r - 1 }, () => row('td')).join('')}</tbody></table><p><br></p>`);
  }

  const btn = (text, title, fn, cls) => h('button', { type: 'button', title, 'aria-label': title, class: cls, onmousedown: e => e.preventDefault(), onclick: fn }, text);
  const sel = (title, options, fn) => h('select', { 'aria-label': title, title, onchange: e => { fn(e.target.value); e.target.selectedIndex = 0; } },
    options.map(([v, t]) => h('option', { value: v }, t)));
  const color = (title, value, fn) => h('label.color', { title }, h('input', { type: 'color', value, 'aria-label': title, onchange: e => fn(e.target.value) }));
  const sep = () => h('span.sep', { 'aria-hidden': 'true' });

  const tools = h('div.tools', { role: 'toolbar', 'aria-label': 'تنسيق النص' },
    // الخطوط: ومنها خطُّ النسخ المرفقُ بالمنصة، وTraditional Arabic
    //   بالاسم لمن كان عنده مثبَّتًا — وسلسلةُ التراجع واحدة (ملاحظة ٤٢٤)
    sel('الخط', FONT_CHOICES, v => v && cmd('fontName', v)),
    sel('حجم الخط', [['', 'الحجم'], ...PT_SIZES.map(p => [String(p), `${p} pt`])], v => v && fontSizePt(Number(v))),
    sel('نوع الفقرة', [['', 'الفقرة'], ['p', 'نص عادي'], ['h2', 'عنوان رئيسي'], ['h3', 'عنوان فرعي'], ['blockquote', 'اقتباس']], v => v && cmd('formatBlock', v)),
    sel('تباعد الأسطر', [['', 'التباعد'], ...LINE_HEIGHTS], v => v && lineHeight(v)),
    sep(),
    btn('B', 'عريض (Ctrl+B)', () => cmd('bold'), 'b'),
    btn('I', 'مائل (Ctrl+I)', () => cmd('italic'), 'i'),
    btn('U', 'تسطير (Ctrl+U)', () => cmd('underline'), 'u'),
    btn('S', 'شطب', () => cmd('strikeThrough'), 's'),
    btn('x²', 'نص علوي', () => cmd('superscript')),
    btn('x₂', 'نص سفلي', () => cmd('subscript')),
    color('لون النص', '#bc9661', v => cmd('foreColor', v)),
    color('تظليل', '#fff3b0', v => cmd('hiliteColor', v)),
    btn('⌧', 'إزالة التظليل', () => clearHighlight()),
    sep(),
    btn('⇥', 'محاذاة لليمين', () => cmd('justifyRight')),
    btn('≡', 'توسيط', () => cmd('justifyCenter')),
    btn('⇤', 'محاذاة لليسار', () => cmd('justifyLeft')),
    btn('☰', 'ضبط', () => cmd('justifyFull')),
    btn('•', 'قائمة نقطية', () => cmd('insertUnorderedList')),
    btn('1.', 'قائمة مرقمة', () => cmd('insertOrderedList')),
    btn('⇲', 'زيادة المسافة البادئة', () => cmd('indent')),
    btn('⇱', 'إنقاص المسافة البادئة', () => cmd('outdent')),
    sel('إدراج جدول', [['', 'جدول'], ['2x2', '2 × 2'], ['3x2', '3 صفوف × 2'], ['3x3', '3 × 3'], ['4x3', '4 صفوف × 3'], ['5x4', '5 صفوف × 4']], v => v && insertTable(v)),
    btn('―', 'خط فاصل', () => cmd('insertHorizontalRule')),
    sep(),
    btn('↶', 'تراجع (Ctrl+Z)', () => cmd('undo')),
    btn('↷', 'إعادة (Ctrl+Y)', () => cmd('redo')),
    btn('⌫', 'مسح التنسيق', () => cmd('removeFormat')),
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
    set html(v) { area.innerHTML = sanitize(v); updatePages(); },
    get text() { return (area.textContent || '').trim(); },
    focus() { area.focus(); }
  };
}
