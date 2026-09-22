// محرر نصوص منسقة خفيف، مع تنقية ما يُلصق فيه
import { h } from './ui.js';
import { sanitize } from './sanitize.js';

export function createEditor({ html = '', dir = 'rtl', placeholder = 'اكتب هنا…', readOnly = false, label = 'النص', onChange } = {}) {
  const area = h('div.area', {
    contenteditable: readOnly ? 'false' : 'true', dir, role: 'textbox', 'aria-multiline': 'true',
    'aria-label': label, 'data-placeholder': placeholder, spellcheck: 'true'
  });
  area.innerHTML = sanitize(html);

  const cmd = (name, value = null) => { area.focus(); document.execCommand(name, false, value); onChange && onChange(); };
  const btn = (text, title, fn) => h('button', { type: 'button', title, 'aria-label': title, onmousedown: e => e.preventDefault(), onclick: fn }, text);
  const sel = (title, options, fn) => h('select', { 'aria-label': title, onchange: e => { fn(e.target.value); e.target.selectedIndex = 0; } },
    options.map(([v, t]) => h('option', { value: v }, t)));

  const tools = h('div.tools', { role: 'toolbar', 'aria-label': 'تنسيق النص' },
    sel('الخط', [['', 'الخط'], ['Haramain Arabic', 'خط المنصة'], ['Arial', 'Arial'], ['Tahoma', 'Tahoma'], ['Times New Roman', 'Times New Roman']], v => v && cmd('fontName', v)),
    sel('الحجم', [['', 'الحجم'], ['2', 'صغير'], ['3', 'عادي'], ['4', 'متوسط'], ['5', 'كبير'], ['6', 'كبير جدًا']], v => v && cmd('fontSize', v)),
    sel('نوع الفقرة', [['', 'الفقرة'], ['p', 'نص عادي'], ['h2', 'عنوان رئيسي'], ['h3', 'عنوان فرعي'], ['blockquote', 'اقتباس']], v => v && cmd('formatBlock', v)),
    btn('B', 'عريض', () => cmd('bold')),
    btn('I', 'مائل', () => cmd('italic')),
    btn('U', 'تسطير', () => cmd('underline')),
    btn('S', 'شطب', () => cmd('strikeThrough')),
    h('label', { title: 'لون النص', class: 'sr-label' }, h('input', { type: 'color', 'aria-label': 'لون النص', style: { width: '36px', padding: '2px', minHeight: '32px' }, onchange: e => cmd('foreColor', e.target.value) })),
    h('label', { title: 'تظليل' }, h('input', { type: 'color', value: '#fff3b0', 'aria-label': 'تظليل', style: { width: '36px', padding: '2px', minHeight: '32px' }, onchange: e => cmd('hiliteColor', e.target.value) })),
    btn('⇥', 'محاذاة لليمين', () => cmd('justifyRight')),
    btn('≡', 'توسيط', () => cmd('justifyCenter')),
    btn('⇤', 'محاذاة لليسار', () => cmd('justifyLeft')),
    btn('☰', 'ضبط', () => cmd('justifyFull')),
    btn('•', 'قائمة نقطية', () => cmd('insertUnorderedList')),
    btn('1.', 'قائمة مرقمة', () => cmd('insertOrderedList')),
    btn('↶', 'تراجع', () => cmd('undo')),
    btn('↷', 'إعادة', () => cmd('redo')),
    btn('⌫', 'مسح التنسيق', () => cmd('removeFormat')),
    btn(dir === 'rtl' ? 'ع←' : '→A', 'تبديل اتجاه الكتابة', e => {
      const next = area.dir === 'rtl' ? 'ltr' : 'rtl';
      area.dir = next; e.currentTarget.textContent = next === 'rtl' ? 'ع←' : '→A';
    })
  );

  area.addEventListener('paste', e => {
    const data = e.clipboardData;
    if (!data) return;
    e.preventDefault();
    const html = data.getData('text/html');
    if (html) document.execCommand('insertHTML', false, sanitize(html));
    else document.execCommand('insertText', false, data.getData('text/plain'));
    onChange && onChange();
  });
  area.addEventListener('input', () => onChange && onChange());

  const el = h('div.editor', { class: readOnly ? 'readonly' : '' }, readOnly ? null : tools, area);
  return {
    el,
    get html() { return sanitize(area.innerHTML); },
    set html(v) { area.innerHTML = sanitize(v); },
    get text() { return (area.textContent || '').trim(); },
    focus() { area.focus(); }
  };
}
