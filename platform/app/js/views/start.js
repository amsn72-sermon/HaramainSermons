// «اختر وجهتك» — الشاشة الرئيسية للنسخة الأولى
import { h } from '../ui.js';
import { auth } from '../sb.js';
import { brand, themeToggle, footer } from './shell.js';

export function render() {
  const card = (num, title, forWho, text, label, href, primary = true) =>
    h('article.portal-card',
      h('span.num', num), h('h2', title), h('span.for', forWho), h('p', text),
      h('a.btn', { class: primary ? 'primary' : '', href }, label));
  return h('div',
    h('header.topbar', h('div.inner', brand(undefined, undefined, '/start'), h('div.spacer'), themeToggle())),
    h('main#main.portals', { tabindex: '-1' },
      h('div.portal-title',
        h('div.eyebrow', 'ترجمة الحرمين الشريفين'),
        h('h1', 'اختر وجهتك'),
        h('p', 'إدارة العمل، إنجاز الترجمة، والوصول إلى الخطب بلغتك.')),
      h('div.portal-grid',
        card('01', 'الإدارة', 'للمنسقين ومدير المشروع',
          'إضافة المواد وإسنادها، متابعة المراحل، إدارة الفريق، والاعتماد النهائي.',
          'دخول الإدارة', auth.session ? '/app' : '/login?next=%2Fapp'),
        card('02', 'المترجم', 'للمترجمين والمراجعين',
          'استلام التكليفات، تحرير الترجمة، رفع الصوت، ومتابعة المراجعات.',
          'دخول المترجم', auth.session ? '/app/tasks' : '/login?next=%2Fapp%2Ftasks'),
        card('03', 'المستفيدون والنشر العام', 'خطب الحرمين الشريفين بلغات العالم',
          'تصفح الخطب المنشورة حسب اللغة والمكان، واقرأ الترجمة، وشاهد البث المباشر.',
          'تصفح الخطب', '/')),
      h('p.fine', 'لست عضوًا بعد؟ ', h('a', { href: '/register' }, 'التسجيل في فريق الترجمة'))),
    footer());
}
