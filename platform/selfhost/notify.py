#!/usr/bin/env python3
"""إرسال إشعارات المنصة بالبريد — ملاحظة ٨٣

يقرأ الطابور من قاعدة البيانات ويرسله عبر بريد الهيئة (أوراكل الرياض)،
ثم يعلّم كل إشعار مرسَلًا أو فاشلًا. لا يغادر شيء من البيانات المملكة.

    sudo python3 notify.py               تجربة يدوية
    sudo python3 notify.py --install-cron  جدولة كل دقيقة
"""
import html as _html
import os, re, ssl, subprocess, sys, smtplib
from email.message import EmailMessage
from email.utils import formataddr

PROJECT = os.environ.get('PROJECT', '/opt/haramain/supabase')
LIMIT = int(os.environ.get('LIMIT', '50'))
SENDER_NAME = os.environ.get('SENDER_NAME', 'منصة ترجمة الحرمين الشريفين')
SEP = '\x1f'   # فاصل حقول لا يظهر في النصوص

AUTHORITY = 'الهيئة العامة للعناية بشؤون المسجد الحرام والمسجد النبوي'
PROJECT_NAME = 'مشروع خادم الحرمين الشريفين لترجمة خطب الحرمين'
SITE = 'https://platform.haramainsermons.com'
GOLD = '#bc9661'
INK = '#1d2b3a'


def template(full_name, subject, body_html):
    """قالبُ الرسالة بهويّة المشروع — ملاحظة ٥٠١

    مبنيٌّ بجداولَ وأنماطٍ داخلَ السمات، لا بورقةِ أنماطٍ ولا بخصائصَ
    حديثة: فبرامجُ البريد — وOutlook خاصّةً — تُسقِط ما سواها. ولا صورةَ
    فيه: الشعارُ نصٌّ، فلا تُحجَب الهويةُ عمّن أوقف تحميلَ الصور، ولا
    يُحسَب بريدًا دعائيًّا.
    """
    return f"""<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{_html.escape(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f1ec;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
  style="background:#f4f1ec;padding:24px 10px;">
<tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
    style="width:600px;max-width:100%;background:#ffffff;border:1px solid #e6ded2;
    border-radius:10px;overflow:hidden;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
    <tr><td style="background:{INK};padding:18px 22px;color:#ffffff;text-align:right;">
      <div style="font-size:13px;color:{GOLD};letter-spacing:.3px;">{AUTHORITY}</div>
      <div style="font-size:17px;font-weight:bold;padding-top:4px;">{PROJECT_NAME}</div>
    </td></tr>
    <tr><td style="height:3px;background:{GOLD};font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td style="padding:24px 22px;color:#222;font-size:15px;line-height:1.9;text-align:right;">
      <p style="margin:0 0 14px;font-weight:bold;">{_html.escape(full_name)}، وفَّقه الله</p>
      {body_html}
    </td></tr>
    <tr><td style="padding:16px 22px;background:#faf7f2;border-top:1px solid #eee4d6;
      color:#6b6257;font-size:12px;line-height:1.8;text-align:right;">
      <div>هذه رسالةٌ من منصة {PROJECT_NAME}.</div>
      <div><a href="{SITE}" style="color:{GOLD};text-decoration:none;">{SITE}</a></div>
    </td></tr>
  </table>
</td></tr></table>
</body></html>"""


def body_to_html(body):
    """النصُّ المجرَّدُ يُصاغ فقراتٍ، وما فيه من HTML يُهرَّب."""
    out = []
    for para in re.split(r'\n\s*\n', body.strip()):
        lines = [_html.escape(x.strip()) for x in para.splitlines() if x.strip()]
        if lines:
            out.append('<p style="margin:0 0 12px;">' + '<br>'.join(lines) + '</p>')
    return '\n      '.join(out) or '<p style="margin:0;">&nbsp;</p>'


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
    # ـــ عنوانُ المرسِل: بريدُ المشروع الرسميُّ إن ضُبط، وإلّا فالقديمُ
    #   ويُجعَل الردُّ إلى الرسميِّ — ملاحظة ٥٠١
    sender = env('MAIL_FROM') or env('SMTP_ADMIN_EMAIL') or env('SMTP_SENDER_NAME')
    reply_to = env('MAIL_REPLY_TO')
    sender_name = env('MAIL_FROM_NAME') or SENDER_NAME
    if not (host and user and password and sender):
        print('SMTP غير مضبوط في .env — لا إرسال')
        return

    # ـــ تجربةُ الإرسال قبل الاعتماد: python3 notify.py --test عنوان@مثال
    if '--test' in sys.argv:
        i = sys.argv.index('--test')
        to = sys.argv[i + 1] if len(sys.argv) > i + 1 else sender
        ctx = ssl.create_default_context()
        with smtplib.SMTP(host, port, timeout=30) as smtp:
            smtp.ehlo(); smtp.starttls(context=ctx); smtp.login(user, password)
            msg = EmailMessage()
            msg['Subject'] = 'تجربةُ بريد المنصة'
            msg['From'] = formataddr((sender_name, sender))
            msg['To'] = to
            if reply_to:
                msg['Reply-To'] = reply_to
            text = 'هذه رسالةُ تجربةٍ من منصة ترجمة خطب الحرمين، للتأكُّد من إعدادات البريد.'
            msg.set_content(text)
            msg.add_alternative(template(to, 'تجربةُ بريد المنصة', body_to_html(text)),
                                subtype='html')
            smtp.send_message(msg)
        print(f'test sent to {to} from {sender}'
              + (f' (reply-to {reply_to})' if reply_to else ''))
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
            nid, email, full_name, subject, body = parts[0], parts[1], parts[2], parts[3], parts[4]
            body = body.replace('\\n', '\n')
            # النسخةُ المنسَّقةُ إن جاءت من الطابور، وإلّا بُنيت من النصّ
            rich = SEP.join(parts[5:]).strip() if len(parts) > 5 else ''
            try:
                msg = EmailMessage()
                msg['Subject'] = subject
                msg['From'] = formataddr((sender_name, sender))
                msg['To'] = formataddr((full_name, email))
                if reply_to:
                    msg['Reply-To'] = reply_to
                msg.set_content(
                    f'{full_name}،\n\n{body}\n\n—\n{sender_name}\n'
                    f'{AUTHORITY}\n{SITE}')
                # ونسخةٌ منسَّقةٌ بهويّة المشروع، والنصُّ المجرَّدُ بديلٌ لمن
                #   لا يقبلها — ملاحظة ٥٠١
                msg.add_alternative(
                    template(full_name, subject, rich or body_to_html(body)),
                    subtype='html')
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
