#!/bin/sh
# haramain-backup — سحبُ النسخة الاحتياطية إلى حاسبك (ملاحظة ٢٤٧ ج)
#
#   النسخُ الليليّةُ كلُّها داخل حساب أوراكل: على الخادم وفي الحاوية.
#   فإن ذهب الحسابُ ذهبت جميعًا. وهذا السكربتُ يُخرج منها نسخةً إلى
#   حاسبك، ومنه إلى فلاشةٍ شهريًّا.
#
# التثبيت مرةً واحدةً على حاسبك:
#   1) في ~/.ssh/config أضف مضيفًا اسمه haramain:
#        Host haramain
#          HostName 10.0.0.230
#          User ubuntu
#          IdentityFile ~/.ssh/haramain
#          ProxyCommand ssh -i ~/.ssh/haramain -W %h:%p -p 22 <OCID>@host.bastion.me-riyadh-1.oci.oraclecloud.com
#      (الـ OCID يُبدَّل كلما انتهت صلاحيةُ جلسة Bastion — وهو السطرُ الوحيدُ الذي يتغيّر)
#   2) sudo cp pull-backup.sh /usr/local/bin/haramain-backup && sudo chmod +x /usr/local/bin/haramain-backup
#
# الاستعمال:  haramain-backup           ← إلى ~/Haramain-Backups
#             haramain-backup /Volumes/USB/Haramain   ← إلى فلاشة

set -e
HOSTNAME_SSH="${HARAMAIN_HOST:-haramain}"
DEST="${1:-$HOME/Haramain-Backups}"
KEEP="${KEEP:-8}"           # كم ملفًّا يبقى محليًّا

mkdir -p "$DEST"

echo "⟳ تجهيز الملفات على الخادم…"
ssh "$HOSTNAME_SSH" "mkdir -p /home/ubuntu/pull && sudo sh -c 'cp /opt/haramain/backups/*.enc /home/ubuntu/pull/ && chown ubuntu:ubuntu /home/ubuntu/pull/*'"

echo "⟳ السحب — ينقل الجديدَ وحدَه ويستأنف إن انقطع…"
rsync -avP --partial "$HOSTNAME_SSH:pull/" "$DEST/"

echo "⟳ تنظيف الخادم…"
ssh "$HOSTNAME_SSH" "rm -rf /home/ubuntu/pull"

# إبقاءُ الأحدث فقط، فلا تتراكم
ls -1t "$DEST"/db-*.dump.enc 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
ls -1t "$DEST"/storage-*.tgz.enc 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo
echo "✓ تمّت النسخة في: $DEST"
ls -lh "$DEST" | tail -n +2
echo
echo "تذكير: مفتاحُ فكّ التشفير لا يُحفظ مع النسخ — موضعُه مدير كلمات المرور."
