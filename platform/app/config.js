// إعدادات الاتصال بخادم Supabase المستضاف في الرياض — قيم علنية مصممة للاستخدام داخل المتصفح.
// الحماية الفعلية في سياسات قاعدة البيانات (RLS) لا في إخفاء هذه القيم.
// لا تضع هنا أبدًا مفتاح service_role ولا كلمة مرور قاعدة البيانات.
window.HS_CONFIG = {
  supabaseUrl: 'https://api.haramainsermons.com',
  supabaseAnonKey: 'YOUR-ANON-KEY', // يطبعه install.sh في نهاية التثبيت
  // مصدر أرشيف يوتيوب الذي تحدّثه مزامنة المستودع كل ١٥ دقيقة
  feedUrl: 'https://raw.githubusercontent.com/amsn72-sermon/HaramainSermons/main/archive/feed.json',
  // البث المباشر الرسمي — الروابط نفسها المعتمدة في sermons.json
  liveChannels: [
    { mosque: 'makkah', name: 'قناة القرآن الكريم', place: 'المسجد الحرام — مكة المكرمة', embed: 'https://www.youtube-nocookie.com/embed/Dwtn6Z6wjtI' },
    { mosque: 'madinah', name: 'قناة السنة النبوية', place: 'المسجد النبوي — المدينة المنورة', embed: 'https://www.youtube-nocookie.com/embed/MC9pr1Vz8Lk' }
  ]
};
