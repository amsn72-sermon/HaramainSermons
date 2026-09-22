# استضافة الخادم داخل المملكة — Oracle Cloud (الرياض + جدة)

Supabase السحابي لا يملك منطقة في الشرق الأوسط، ولا يمكن نقل مشروع بين المناطق. لذلك يُشغَّل Supabase نفسه (النسخة الرسمية مفتوحة المصدر) على خادم في **الرياض**، وتُحفظ النسخ الاحتياطية المشفّرة في **جدة**. الموقع نفسه (ملفات ثابتة لا بيانات فيها) يبقى على Cloudflare Pages.

```
المتصفح ──► haramainsermons.com           Cloudflare Pages  (واجهة فقط، بلا بيانات)
        └─► api.haramainsermons.com       خادم Oracle — الرياض  me-riyadh-1
                                            Caddy (HTTPS) ► Supabase: Auth · REST · Storage · Postgres
                                            └─ كل ليلة ► نسخة مشفّرة ► Object Storage — جدة  me-jeddah-1
```

| الملف | عمله |
| --- | --- |
| `install.sh` | يشغّل سكربت Supabase الرسمي، يضبط الدومين والبريد، يفعّل HTTPS، يغلق Studio وقاعدة البيانات عن الإنترنت، ويطبّق مخطط المنصة |
| `Caddyfile` | لا يُخدَم على الإنترنت إلا `/auth/v1` و`/rest/v1` و`/storage/v1`؛ ولوحة Studio على `127.0.0.1:3001` فقط |
| `docker-compose.haramain.yml` | يربط منفذ قاعدة البيانات (5432/6543) ولوحة Studio بـ`127.0.0.1` |
| `backup.sh` | نسخة يومية مشفّرة (AES-256) لقاعدة البيانات والملفات إلى جدة |
| `restore.sh` | استعادة نسخة على خادم جديد |

> **قبل البدء:** الجهات الحكومية ملزمة غالبًا بمزوّد سحابي مرخّص من هيئة الاتصالات والفضاء والتقنية وبتصنيف البيانات وفق مكتب إدارة البيانات الوطنية. راجع إدارة تقنية المعلومات في الهيئة: هل Oracle Cloud مقبول، أم هناك سحابة معتمدة لديهم؟ هذه الحزمة تعمل على أي خادم Ubuntu، فإن اختاروا مزوّدًا آخر لا يتغيّر شيء غير الخطوة الأولى.

---

## ما تفعله أنت، وما أساعدك فيه

| الخطوة | من |
| --- | --- |
| إنشاء حساب Oracle Cloud، وإدخال بيانات الدفع، وتسجيل الدخول | أنت فقط |
| إنشاء الخادم والحاوية وسجل DNS | أنت، أو أنا بإذنك بعد أن تسجّل الدخول في المتصفح |
| تشغيل `install.sh` على الخادم | أنت (أمر واحد) |
| إدخال كلمة مرور البريد ومفاتيح التخزين | أنت فقط — لا تلصقها في المحادثة |

---

## ١. حساب Oracle Cloud

1. سجّل في oracle.com/cloud/free.
2. **Home Region: Saudi Arabia Central (Riyadh)**. هذا الاختيار دائم ولا يُغيَّر لاحقًا، والموارد المجانية تعمل فيه وحده.
3. للنسخ الاحتياطي في جدة: **Billing ← Upgrade to Pay As You Go**، ثم **Governance & Administration ← Region Management ← Subscribe** إلى **Saudi Arabia West (Jeddah)**. الترقية لا تلغي الموارد المجانية؛ الذي يُدفع هو ما تجاوزها فقط (تخزين النسخ في جدة، وحجمه صغير).
4. احتياطًا: **Billing ← Budgets ← Create Budget** بحد شهري صغير مع تنبيه بالبريد، كي لا تفاجئك أي تكلفة.

## ٢. الخادم في الرياض (مجاني)

**Compute ← Instances ← Create instance**:

| الإعداد | القيمة |
| --- | --- |
| Name | `haramain-api` |
| Image | Canonical Ubuntu 24.04 (نسخة aarch64 تُختار تلقائيًا مع Ampere) |
| Shape | **Ampere ← `VM.Standard.A1.Flex`** — 2 OCPU و12 GB ذاكرة (الحد المجاني كاملًا) — تظهر عليه علامة Always Free-eligible |
| Networking | VCN جديدة مع Public subnet، و**Assign a public IPv4 address** مفعّل |
| SSH keys | ارفع مفتاحك العام أو نزّل المفتاح الذي يولّده، واحفظه |
| Boot volume | 100 GB (المجاني حتى 200 GB) |

إن ظهرت رسالة **Out of capacity** فخوادم A1 المجانية نفدت مؤقتًا في الرياض: أعد المحاولة بعد ساعات، أو غيّر **Availability domain** إن وُجد غيره. البديل المدفوع: `VM.Standard.E5.Flex` بـ2 OCPU و8–16 GB، والتثبيت هو نفسه.

بعد الإنشاء:

- **Networking ← Reserved public IPs**: حوّل عنوان الخادم إلى عنوان محجوز، كي لا يتغيّر إن أُعيد تشغيله.
- **VCN ← Security Lists ← Default ← Add Ingress Rules**: أضف `0.0.0.0/0` لكل من TCP 80 وTCP 443. لا تفتح غيرهما مع 22.
- الأفضل تقييد 22 بعنوان مكتبك فقط إن كان ثابتًا.

## ٣. سجل DNS في Cloudflare

بعد نقل خوادم أسماء الدومين من Porkbun إلى Cloudflare:

**DNS ← Records ← Add record**:

- Type: `A`
- Name: `api`
- IPv4: العنوان المحجوز للخادم
- Proxy status: **DNS only** (سحابة رمادية)

الرمادية تعني أن الطلبات تصل الخادم في الرياض مباشرة، ويصدر Caddy شهادة HTTPS بنفسه.

## ٤. التثبيت

من جهازك:

```bash
ssh -i <مفتاحك> ubuntu@<عنوان الخادم>
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/amsn72-sermon/HaramainSermons.git
cd HaramainSermons/platform/selfhost
sudo sh install.sh
```

- يسأل عن دومين الـAPI ورابط الموقع؛ القيم الافتراضية صحيحة، فاضغط Enter.
- ثم يسأل عن إعدادات بريد SMTP الرسمي. إن لم تكن جاهزة، اتركها فارغة الآن.
- يستغرق ١٠–١٥ دقيقة أول مرة.
- يطبع في نهايته **مفتاح anon**؛ ضعه في `platform/app/config.js` وارفع التعديل.
- رابط الخادم مضبوط مسبقًا على `https://api.haramainsermons.com`.

فحص:

```bash
curl -s https://api.haramainsermons.com/auth/v1/health -H "apikey: <anon>"
```

الأسرار كلها في `/opt/haramain/supabase/.env` على الخادم فقط: كلمة مرور قاعدة البيانات، JWT، ومفتاح service_role. لا تُنسخ إلى المستودع ولا إلى `app/`.

### البريد

تأكيد الحساب واستعادة كلمة المرور يحتاجان SMTP حقيقيًا، والأفضل بريد الهيئة الرسمي.

عدّل `SMTP_*` في `.env` ثم:

```bash
cd /opt/haramain/supabase && sudo sh run.sh recreate auth
```

### لوحة Studio

Studio غير متاحة على الإنترنت إطلاقًا. افتحها من جهازك عبر نفق:

```bash
ssh -i <مفتاحك> -L 3001:127.0.0.1:3001 ubuntu@<عنوان الخادم>
```

- الرابط: http://localhost:3001
- المستخدم: `supabase`
- كلمة المرور: يعرضها `sudo sh /opt/haramain/supabase/run.sh secrets` (السطر `DASHBOARD_PASSWORD`).

### أول مدير

بعد تسجيلك من `/register` وتأكيد بريدك، افتح Studio ← **SQL Editor** ونفّذ:

```sql
update public.profiles set role = 'manager', status = 'active' where email = 'بريدك';
```

## ٥. النسخ الاحتياطي إلى جدة

1. **في منطقة Jeddah:** **Storage ← Buckets ← Create bucket**.
   - الاسم: `haramain-backups`
   - الوصول: Private
   - فعّل **Object Versioning**.
   - أضف من **Lifecycle Policy** قاعدة حذف بعد ٩٠ يومًا، أو ما تحدده سياسة الهيئة.
2. **Identity ← Users:** أنشئ مستخدمًا مخصصًا للنسخ صلاحيته الكتابة على هذه الحاوية فقط.
   - أنشئ له **Customer Secret Key**، واحفظ المفتاحين.
3. **Tenancy details:** انسخ **Object Storage Namespace**.
4. على الخادم:

```bash
sudo aws configure --profile jeddah
#   Access Key ID / Secret: من الخطوة ٢ — Region: me-jeddah-1 — Output: json
sudo sh -c 'openssl rand -base64 48 > /root/.haramain-backup-key && chmod 600 /root/.haramain-backup-key'
sudo cat /root/.haramain-backup-key     # احفظه في مكان آمن خارج الخادم
cd ~/HaramainSermons/platform/selfhost
sudo OCI_NAMESPACE=<namespace> sh backup.sh            # تجربة
sudo sh backup.sh --install-cron <namespace>            # يوميًا 2:30 فجرًا بتوقيت الرياض
```

**مفتاح التشفير** هو الوحيد القادر على فك النسخ. إن ضاع مع الخادم ضاعت النسخ معه.

**جرّب الاستعادة مرة واحدة على الأقل** على خادم تجريبي قبل الإطلاق: شغّل `install.sh`، ثم `restore.sh`.

## ٦. الصيانة

| المهمة | الأمر (من `/opt/haramain/supabase`) |
| --- | --- |
| حالة الخدمات | `sudo docker compose ps` |
| السجلات | `sudo sh run.sh logs auth` |
| إعادة التشغيل | `sudo sh run.sh restart` |
| تحديث Supabase | `sudo sh update.sh` — بعد نسخة احتياطية |
| تحديثات Ubuntu الأمنية | `sudo apt-get update && sudo apt-get upgrade -y` شهريًا |

فعّل من Oracle: **Monitoring ← Alarms** على استهلاك القرص فوق ٨٠٪ والمعالج فوق ٩٠٪، مع تنبيه بالبريد.
