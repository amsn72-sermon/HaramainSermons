// محرر الترجمة: ورقة A4 على كليشة الهيئة بمساحة كتابة ثابتة، مع أدوات تنسيق متقدمة وتنقية لما يُلصق.
import { h } from './ui.js';
import { sanitize } from './sanitize.js';
import { letterheadPage, pagesEstimate } from './page.js';

const PT_SIZES = [9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28];
const LINE_HEIGHTS = [['1', 'مفرد'], ['1.15', '1.15'], ['1.5', '1.5'], ['1.8', '1.8'], ['2', 'مزدوج'], ['2.5', '2.5']];
const BLOCKS = 'P,H2,H3,BLOCKQUOTE,LI,DIV,TD,TH';

export function createEditor({ html = '', dir = 'rtl', placeholder = 'اكتب هنا…', readOnly = false, label = 'النص', onChange, top = null, plain = false, detachTools = false } = {}) {
  const area = h('div.area', {
    contenteditable: readOnly ? 'false' : 'true', dir, role: 'textbox', 'aria-multiline': 'true',
    'aria-label': label, 'data-placeholder': placeholder, spellcheck: 'true'
  });
  area.innerHTML = sanitize(html);
  const { page, body } = plain ? { page: area, body: area } : letterheadPage(top, area);
  const pages = h('span.small.muted.pages-est');
  const changed = () => { updatePages(); onChange && onChange(); };
  function updatePages() { if (plain) return; requestAnimationFrame(() => { pages.textContent = `≈ ${pagesEstimate(body)} صفحة عند الطباعة`; }); }

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
    sel('الخط', [['', 'الخط'], ['Haramain Arabic', 'خط المنصة'], ['Arial', 'Arial'], ['Tahoma', 'Tahoma'], ['Times New Roman', 'Times New Roman'], ['Georgia', 'Georgia'], ['Verdana', 'Verdana']], v => v && cmd('fontName', v)),
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
    sel('إدراج جدول', [['', 'جدول'], ['2x2', '٢ × ٢'], ['3x2', '٣ صفوف × ٢'], ['3x3', '٣ × ٣'], ['4x3', '٤ صفوف × ٣'], ['5x4', '٥ صفوف × ٤']], v => v && insertTable(v)),
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

  const el = h('div.editor', { class: (readOnly ? 'readonly ' : '') + (plain ? 'plain' : 'paged') }, readOnly || detachTools ? null : tools, page, plain ? null : h('div.editor-foot', pages));
  updatePages();
  return {
    el, page, tools: readOnly ? null : tools,
    get html() { return sanitize(area.innerHTML); },
    set html(v) { area.innerHTML = sanitize(v); updatePages(); },
    get text() { return (area.textContent || '').trim(); },
    focus() { area.focus(); }
  };
}
