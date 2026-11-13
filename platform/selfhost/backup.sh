#!/bin/sh
# نسخة احتياطية ليلية: قاعدة البيانات + ملفات التخزين، مشفّرة، إلى Oracle Object Storage في الرياض.
# البيانات لا تغادر المملكة: الخادم والحاوية كلاهما في me-riyadh-1.
#
# الإعداد مرة واحدة (انظر README):
#   1) أنشئ حاوية (Bucket) خاصة في منطقة Riyadh باسم haramain-backups
#   2) أنشئ Customer Secret Key من My profile ← Tokens and keys، ثم على الخادم:
#        sudo aws configure --profile oci        (Access Key و Secret فقط، المنطقة me-riyadh-1)
#   3) sudo sh -c 'openssl rand -base64 48 > /root/.haramain-backup-key && chmod 600 /root/.haramain-backup-key'
#      واحفظ نسخة من هذا المفتاح خارج الخادم — بدونه لا يمكن فك النسخ.
#   4) sudo OCI_NAMESPACE=<namespace> sh backup.sh     (تجربة يدوية)
#   5) الجدولة:  sudo sh backup.sh --install-cron <namespace>
#
# الاستعادة: restore.sh

set -e
PROJECT="${PROJECT:-/opt/haramain/supabase}"
BUCKET="${BUCKET:-haramain-backups}"
REGION="${REGION:-me-riyadh-1}"
PROFILE="${PROFILE:-oci}"
KEYFILE="/root/.haramain-backup-key"
KEEP_LOCAL_DAYS=3

# ـــ الجدولةُ التلقائيّة (ملاحظة ٧ من دفعة ٥٠٢)
#
#   نسخةٌ كلَّ ليلةٍ في 2:30 فجرًا بتوقيت الرياض، فأقصى ما يضيع يومٌ
#   واحدٌ لا أسبوع. ومعها نسخةُ الأحد تُعَلَّم أسبوعيّةً فتُحفَظ في
#   مجلَّدٍ مستقلٍّ أطولَ مدّةً، فيبقى لكلِّ أسبوعٍ شاهدٌ ولو مُسحت
#   اليوميّاتُ. ولا تدخُّلَ بعدها من أحد.
if [ "$1" = "--install-cron" ]; then
    [ -n "$2" ] || { echo "الاستخدام: sh backup.sh --install-cron <namespace> [daily|weekly|both]" >&2; exit 1; }
    MODE="${3:-both}"
    SELF="$(cd "$(dirname "$0")" && pwd)/backup.sh"
    ENV_LINE="OCI_NAMESPACE=$2 PROJECT=$PROJECT REGION=$REGION PROFILE=$PROFILE"
    LOG=">> /var/log/haramain-backup.log 2>&1"
    : > /etc/cron.d/haramain-backup
    # 02:30 بتوقيت الرياض = 23:30 UTC. ويومُ الأحد في الرياض يبدأ ليلةَ
    #   السبت بـUTC، فالأحدُ الأسبوعيُّ يُكتَب بـ6 (السبت UTC)
    if [ "$MODE" != "weekly" ]; then
        echo "30 23 * * * root $ENV_LINE sh $SELF $LOG" >> /etc/cron.d/haramain-backup
    fi
    if [ "$MODE" != "daily" ]; then
        echo "10 22 * * 6 root $ENV_LINE KIND=weekly sh $SELF $LOG" >> /etc/cron.d/haramain-backup
    fi
    chmod 644 /etc/cron.d/haramain-backup
    case "$MODE" in
      daily)  echo "جُدولت نسخةٌ يوميّةٌ 2:30 فجرًا بتوقيت الرياض." ;;
      weekly) echo "جُدولت نسخةٌ أسبوعيّةٌ ليلةَ الأحد 1:10 فجرًا بتوقيت الرياض." ;;
      *)      echo "جُدولت نسخةٌ يوميّةٌ 2:30 فجرًا، ونسخةُ الأحد الأسبوعيّةُ 1:10 فجرًا — بتوقيت الرياض." ;;
    esac
    echo "السجل: /var/log/haramain-backup.log"
    exit 0
fi

: "${OCI_NAMESPACE:?حدد OCI_NAMESPACE (Object Storage namespace من إعدادات Tenancy)}"
[ -s "$KEYFILE" ] || { echo "مفتاح التشفير غير موجود: $KEYFILE" >&2; exit 1; }
# توافق AWS CLI الحديث مع واجهة S3 في Oracle
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
aws configure set s3.addressing_style path --profile "$PROFILE"
ENDPOINT="https://${OCI_NAMESPACE}.compat.objectstorage.${REGION}.oraclecloud.com"

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$PROJECT/../backups"
mkdir -p "$OUT"; chmod 700 "$OUT"
PGPASS=$(grep '^POSTGRES_PASSWORD=' "$PROJECT/.env" | cut -d= -f2-)

# أثرُ التشغيل في قاعدة البيانات، لتعرضه بطاقةُ المنصة (ملاحظة ٢٤٧)
log_run() {   # log_run ok|fail db_bytes files_bytes note
    docker exec -i -e PGPASSWORD="$PGPASS" supabase-db \
        psql -h 127.0.0.1 -U supabase_admin -d postgres -q -v ON_ERROR_STOP=1 \
        -c "select public.log_backup_run($1, nullif('$2','')::bigint, nullif('$3','')::bigint, '$BUCKET', nullif('$4',''))" \
        >/dev/null 2>&1 || true
}
trap 'log_run false "" "" "توقّف النسخُ قبل تمامه"' EXIT

echo "[$STAMP] بدء النسخ"
# قاعدة البيانات كاملة (يشمل auth و storage و public) بصيغة custom
docker exec -e PGPASSWORD="$PGPASS" supabase-db \
    pg_dump -h 127.0.0.1 -U supabase_admin -d postgres -Fc \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -pass file:"$KEYFILE" -out "$OUT/db-$STAMP.dump.enc"

# الملفات المرفوعة (المصادر، الصوت، الوثائق الخاصة)
tar -C "$PROJECT/volumes" -czf - storage \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -pass file:"$KEYFILE" -out "$OUT/storage-$STAMP.tgz.enc"

# النسخةُ الأسبوعيّةُ في مجلَّدٍ مستقلّ، فلا تُخلَط باليوميّات ولا يشملها
#   تقليمُها (ملاحظة ٥٠٢)
PREFIX="$(date -u +%Y/%m)"
[ "${KIND:-daily}" = "weekly" ] && PREFIX="weekly/$(date -u +%Y)"
for f in "$OUT/db-$STAMP.dump.enc" "$OUT/storage-$STAMP.tgz.enc"; do
    aws --profile "$PROFILE" --region "$REGION" --endpoint-url "$ENDPOINT" \
        s3 cp "$f" "s3://$BUCKET/$PREFIX/$(basename "$f")" --only-show-errors
done

find "$OUT" -name '*.enc' -mtime +$KEEP_LOCAL_DAYS -delete

DB_B=$(wc -c < "$OUT/db-$STAMP.dump.enc" 2>/dev/null || echo '')
FL_B=$(wc -c < "$OUT/storage-$STAMP.tgz.enc" 2>/dev/null || echo '')
trap - EXIT
log_run true "$DB_B" "$FL_B" ""
echo "[$STAMP] تم: $(du -ch "$OUT"/*-"$STAMP".* | tail -1 | cut -f1) إلى $BUCKET في الرياض"
