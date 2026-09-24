// إعدادات الاتصال بخادم Supabase المستضاف في الرياض — قيم علنية مصممة للاستخدام داخل المتصفح.
// الحماية الفعلية في سياسات قاعدة البيانات (RLS) لا في إخفاء هذه القيم.
// لا تضع هنا أبدًا مفتاح service_role ولا كلمة مرور قاعدة البيانات.
window.HS_CONFIG = {
  supabaseUrl: 'https://api.haramainsermons.com',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzkwMTk1NDQ5LCJleHAiOjE5NDc4NzU0NDl9.YD5pDfF-3_LgUT0DuUBE2Y60kfIcAkXAzXlGLaZEoEs',
  // مصدر أرشيف يوتيوب الذي تحدّثه مزامنة المستودع كل ١٥ دقيقة
  feedUrl: 'https://raw.githubusercontent.com/amsn72-sermon/HaramainSermons/main/archive/feed.json',
  // الأصل العربي لخطبة عرفة: قائمة يوتيوب للسنة لا تتضمنه، فيُضاف هنا لكل سنة
  // (المفتاح سنة هجرية، والقيمة معرّف الفيديو) — يُحدَّث مرة واحدة في السنة
  arafahOriginal: { 1447: 'Ea664JHx2rY' }
};
