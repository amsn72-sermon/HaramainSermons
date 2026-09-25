#!/usr/bin/env python3
"""إرسال إشعارات المنصة بالبريد — ملاحظة ٨٣

يقرأ الطابور من قاعدة البيانات ويرسله عبر بريد الهيئة (أوراكل الرياض)،
ثم يعلّم كل إشعار مرسَلًا أو فاشلًا. لا يغادر شيء من البيانات المملكة.

    sudo python3 notify.py               تجربة يدوية
    sudo python3 notify.py --install-cron  جدولة كل دقيقة
"""
import os, re, ssl, subprocess, sys, smtplib
from email.message import EmailMessage
from email.utils import formataddr

PROJECT = os.environ.get('PROJECT', '/opt/haramain/supabase')
LIMIT = int(os.environ.get('LIMIT', '50'))
SENDER_NAME = os.environ.get('SENDER_NAME', 'منصة ترجمة الحرمين الشريفين')
SEP = '\x1f'   # فاصل حقول لا يظهر في النصوص


def env(name, default=''):
    """قراءة متغيّر من ملف إعدادات المشروع."""
    try:
        with open(os.path.join(PROJECT, '.env'), encoding='utf-8') as fh:
            for line in fh:
                if line.startswith(name + '='):
                    return line.split('=', 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return default


def psql(sql, tuples_only=True):
    cmd = ['docker', 'exec', '-i', '-e', 'PGPASSWORD=' + env('POSTGRES_PASSWORD'),
           'supabase-db', 'psql', '-h', '127.0.0.1', '-U', 'supabase_admin', '-d', 'postgres',
           '-v', 'ON_ERROR_STOP=1', '-F', SEP]
    cmd += ['-tA'] if tuples_only else ['-A']
    cmd += ['-c', sql]
    out = subprocess.run(cmd, capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip())
    return out.stdout


def install_cron():
    here = os.path.dirname(os.path.abspath(__file__))
    with open('/etc/cron.d/haramain-notify', 'w', encoding='utf-8') as fh:
        fh.write('PATH=/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n')
        fh.write(f'* * * * * root PROJECT={PROJECT} python3 {here}/notify.py '
                 '>> /var/log/haramain-notify.log 2>&1\n')
    os.chmod('/etc/cron.d/haramain-notify', 0o644)
    print('scheduled every minute. log: /var/log/haramain-notify.log')


def main():
    if '--install-cron' in sys.argv:
        return install_cron()

    host = env('SMTP_HOST')
    port = int(env('SMTP_PORT', '587') or 587)
    user = env('SMTP_USER')
    password = env('SMTP_PASS')
    sender = env('SMTP_ADMIN_EMAIL') or env('SMTP_SENDER_NAME')
    if not (host and user and password and sender):
        print('SMTP غير مضبوط في .env — لا إرسال')
        return

    rows = [r for r in psql(f'select * from public.pending_notifications({LIMIT})').splitlines() if r.strip()]
    if not rows:
        return

    ctx = ssl.create_default_context()
    sent = failed = 0
    with smtplib.SMTP(host, port, timeout=30) as smtp:
        smtp.ehlo()
        smtp.starttls(context=ctx)
        smtp.login(user, password)
        for row in rows:
            parts = row.split(SEP)
            if len(parts) < 5:
                continue
            nid, email, full_name, subject, body = parts[0], parts[1], parts[2], parts[3], SEP.join(parts[4:])
            body = body.replace('\\n', '\n')
            try:
                msg = EmailMessage()
                msg['Subject'] = subject
                msg['From'] = formataddr((SENDER_NAME, sender))
                msg['To'] = formataddr((full_name, email))
                msg.set_content(
                    f'{full_name}،\n\n{body}\n\n—\n{SENDER_NAME}\n'
                    'الهيئة العامة للعناية بشؤون المسجد الحرام والمسجد النبوي\n'
                    'https://platform.haramainsermons.com')
                smtp.send_message(msg)
                psql(f'select public.mark_notification({int(nid)}, true, null)')
                sent += 1
            except Exception as err:                      # noqa: BLE001 — نسجّل السبب ونكمل
                reason = re.sub(r'\s+', ' ', str(err))[:400].replace("'", "''")
                psql(f"select public.mark_notification({int(nid)}, false, '{reason}')")
                failed += 1
    print(f'sent={sent} failed={failed}')


if __name__ == '__main__':
    main()
