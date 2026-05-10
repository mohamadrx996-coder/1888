
import { NextRequest, NextResponse } from 'next/server';
import { KEY_ACTIVATIONS, SERVER_POST_ACTIVATIONS, PRIME_KEY } from '@/lib/prime-store';
import { getLogWebhookUrl } from '@/lib/config';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderReviewPage(data: { requestId: string; userId: string; username: string; email: string }): string {
  const safeUsername = escapeHtml(data.username);
  const safeUserId = escapeHtml(data.userId);
  const safeRequestId = escapeHtml(data.requestId);
  const safeEmail = data.email ? escapeHtml(data.email) : '';
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>مراجعة طلب Prime - TRJ BOT</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  background: linear-gradient(135deg, #0a0a12 0%, #0d1117 50%, #0a0a12 100%);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 20px;
}
.card {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,215,0,0.15);
  border-radius: 24px;
  padding: 40px 32px;
  text-align: center;
  max-width: 460px;
  width: 100%;
  backdrop-filter: blur(20px);
  box-shadow: 0 0 80px rgba(255,215,0,0.05);
}
.emoji { font-size: 64px; margin-bottom: 16px; display: block; }
h1 { font-size: 22px; font-weight: 900; color: #FFD700; margin-bottom: 8px; }
.subtitle { font-size: 13px; color: rgba(255,255,255,0.4); margin-bottom: 24px; }
.info-box {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 16px;
  padding: 16px;
  margin-bottom: 24px;
  text-align: right;
}
.info-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
.info-row:last-child { border-bottom: none; }
.info-label { font-size: 12px; color: rgba(255,255,255,0.4); }
.info-value { font-size: 13px; color: #fff; font-weight: 700; text-align: left; direction: ltr; }
.input-section { margin-bottom: 20px; }
.input-section label { font-size: 13px; color: rgba(255,255,255,0.6); display: block; margin-bottom: 10px; }
.confirm-input {
  width: 100%;
  padding: 14px 20px;
  border-radius: 14px;
  border: 2px solid rgba(255,255,255,0.1);
  background: rgba(0,0,0,0.4);
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  text-align: center;
  direction: rtl;
  outline: none;
  transition: all 0.3s;
  font-family: inherit;
}
.confirm-input:focus { border-color: #10b981; box-shadow: 0 0 20px rgba(16,185,129,0.15); }
.confirm-input::placeholder { color: rgba(255,255,255,0.15); font-weight: 400; }
.btn-row { display: flex; gap: 10px; }
.btn {
  flex: 1;
  padding: 14px 16px;
  border-radius: 14px;
  font-size: 14px;
  font-weight: 800;
  border: none;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
}
.btn:active { transform: scale(0.97); }
.btn-approve {
  background: linear-gradient(135deg, rgba(16,185,129,0.2), rgba(16,185,129,0.1));
  color: #10b981;
  border: 1px solid rgba(16,185,129,0.3);
}
.btn-approve:hover { background: linear-gradient(135deg, rgba(16,185,129,0.3), rgba(16,185,129,0.15)); }
.btn-reject {
  background: linear-gradient(135deg, rgba(239,68,68,0.2), rgba(239,68,68,0.1));
  color: #ef4444;
  border: 1px solid rgba(239,68,68,0.3);
}
.btn-reject:hover { background: linear-gradient(135deg, rgba(239,68,68,0.3), rgba(239,68,68,0.15)); }
.hint { font-size: 11px; color: rgba(255,255,255,0.2); margin-top: 12px; }
.footer { position: fixed; bottom: 20px; left: 0; right: 0; text-align: center; font-size: 10px; color: rgba(255,255,255,0.1); }
#result { display: none; margin-top: 16px; padding: 14px; border-radius: 12px; font-size: 13px; font-weight: 600; }
#result.success { display: block; background: rgba(16,185,129,0.1); color: #10b981; border: 1px solid rgba(16,185,129,0.2); }
#result.error { display: block; background: rgba(239,68,68,0.1); color: #ef4444; border: 1px solid rgba(239,68,68,0.2); }
</style>
</head>
<body>
<div class="card">
  <span class="emoji">⏳</span>
  <h1>مراجعة طلب Prime</h1>
  <p class="subtitle">راجع الصورة المرسلة في الديسكورد ثم اكتب موافق للتأكيد</p>

  <div class="info-box">
    <div class="info-row">
      <span class="info-label">المستخدم</span>
      <span class="info-value">${safeUsername}</span>
    </div>
    <div class="info-row">
      <span class="info-label">User ID</span>
      <span class="info-value">${safeUserId}</span>
    </div>
    <div class="info-row">
      <span class="info-label">رقم الطلب</span>
      <span class="info-value">${safeRequestId}</span>
    </div>
    ${safeEmail ? '<div class="info-row"><span class="info-label">الإيميل</span><span class="info-value">' + safeEmail + '</span></div>' : ''}
    <div class="info-row">
      <span class="info-label">الحالة</span>
      <span class="info-value" style="color: #FFD700;">بانتظار المراجعة</span>
    </div>
  </div>

  <div class="input-section">
    <label>اكتب "موافق" في المكان الفارغ لتأكيد تفعيل Prime:</label>
    <input type="text" id="confirmInput" class="confirm-input" placeholder="اكتب هنا..." autocomplete="off">
  </div>

  <div class="btn-row">
    <button class="btn btn-approve" onclick="submitAction('approve')">تفعيل Prime</button>
    <button class="btn btn-reject" onclick="submitAction('reject')">رفض الطلب</button>
  </div>

  <p class="hint">للتأكيد يجب كتابة "موافق" في الخانة الفارغة أولاً</p>
  <div id="result"></div>
</div>
<div class="footer">جميع حقوق محفوظه لدى Trojan .#1888</div>

<script>
function submitAction(action) {
  var input = document.getElementById('confirmInput').value.trim();
  var resultDiv = document.getElementById('result');

  if (action === 'approve') {
    if (input !== 'موافق') {
      resultDiv.className = 'error';
      resultDiv.textContent = 'يجب كتابة "موافق" في الخانة الفارغة لتأكيد التفعيل';
      return;
    }
  }

  var url = window.location.pathname + window.location.search + '&action=' + action;
  if (action === 'reject') {
    url += '&reason=' + encodeURIComponent('تم الرفض بواسطة المالك');
  }

  resultDiv.className = '';
  resultDiv.style.display = 'block';
  resultDiv.style.background = 'rgba(255,255,255,0.05)';
  resultDiv.style.color = 'rgba(255,255,255,0.5)';
  resultDiv.style.border = '1px solid rgba(255,255,255,0.1)';
  resultDiv.textContent = 'جاري المعالجة...';

  fetch(url)
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var parser = new DOMParser();
      var doc = parser.parseFromString(html, 'text/html');
      var card = doc.querySelector('.card');
      if (card) {
        document.querySelector('.card').innerHTML = card.innerHTML;
        document.title = doc.title;
      } else {
        document.body.innerHTML = html;
      }
    })
    .catch(function() {
      resultDiv.className = 'error';
      resultDiv.textContent = 'حدث خطأ في الاتصال';
    });
}

document.getElementById('confirmInput').addEventListener('keypress', function(e) {
  if (e.key === 'Enter') submitAction('approve');
});
</script>
</body>
</html>`;
}

function renderHTML(title: string, message: string, color: string, emoji: string): string {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0a0a12; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
.card { background: rgba(255,255,255,0.03); border: 1px solid ${color}30; border-radius: 24px; padding: 48px 40px; text-align: center; max-width: 420px; width: 100%; backdrop-filter: blur(20px); box-shadow: 0 0 60px ${color}08; }
.emoji { font-size: 72px; margin-bottom: 20px; display: block; }
h1 { font-size: 28px; font-weight: 900; color: ${color}; margin-bottom: 12px; }
p { font-size: 15px; color: rgba(255,255,255,0.5); line-height: 1.8; }
.badge { display: inline-block; margin-top: 20px; padding: 8px 20px; border-radius: 12px; font-size: 12px; font-weight: 700; border: 1px solid ${color}30; color: ${color}; background: ${color}10; }
.footer { position: fixed; bottom: 20px; left: 0; right: 0; text-align: center; font-size: 10px; color: rgba(255,255,255,0.15); }
</style>
</head>
<body>
<div class="card">
<span class="emoji">${emoji}</span>
<h1>${safeTitle}</h1>
<p>${safeMessage}</p>
<div class="badge">TRJ BOT - Prime System</div>
</div>
<div class="footer">جميع حقوق محفوظه لدى Trojan .#1888</div>
</body>
</html>`;
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const requestId = url.searchParams.get('requestId') || '';
    const key = url.searchParams.get('key');

    const userId = url.searchParams.get('userId') || '';
    const username = url.searchParams.get('username') || 'مستخدم';
    const discriminator = url.searchParams.get('discriminator') || '0';
    const email = url.searchParams.get('email') || '';

    if (!userId) {
      return new Response(renderHTML('خطأ', 'معلمات غير مكتملة', '#ef4444', '❌'), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    if (key !== PRIME_KEY) {
      return new Response(renderHTML('غير مصرح', 'كود الأمان غير صحيح', '#ef4444', '🔒'), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    const fullUsername = `${username}#${discriminator}`;

    if (action === 'approve' && KEY_ACTIVATIONS.has(userId)) {
      return new Response(renderHTML(
        'مفعّل مسبقاً',
        `تم تفعيل Prime مسبقاً للمستخدم ${username}`,
        '#10b981',
        '✅'
      ), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    if (!action) {
      return new Response(renderReviewPage({ requestId, userId, username, email }), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    const webhookUrl = getLogWebhookUrl();

    if (action === 'approve') {
      KEY_ACTIVATIONS.set(userId, {
        userId: userId,
        username: fullUsername,
        activatedAt: Date.now(),
        method: 'owner-approve'
      });
      SERVER_POST_ACTIVATIONS.set(userId, {
        userId: userId,
        username: fullUsername,
        activatedAt: Date.now(),
        code: 'approved-by-owner'
      });

      if (webhookUrl) {
        try {
          await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              embeds: [{
                title: '✅ تم تفعيل Prime - تحويل كرديت',
                description: `**المستخدم:** ${fullUsername}\n**User ID:** ${userId}\n**الحالة:** تمت المراجعة والموافقة ✅`,
                color: 0x00FF00,
                fields: [
                  { name: '👤 المستخدم', value: fullUsername, inline: true },
                  { name: '🆔 ID', value: userId, inline: true },
                  { name: '🔑 رقم الطلب', value: `\`${requestId}\``, inline: true },
                ],
                footer: { text: 'TRJ BOT - Prime Approved' },
                timestamp: new Date().toISOString()
              }]
            })
          });
        } catch {}
      }

      return new Response(renderHTML(
        'تم التفعيل!',
        `تم تفعيل Prime بنجاح للمستخدم ${fullUsername}<br>الآن يمكنه استخدام جميع ميزات Prime`,
        '#10b981',
        '✅'
      ), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });

    } else if (action === 'reject') {
      const reason = url.searchParams.get('reason') || 'لم يتم تحديد سبب';

      if (webhookUrl) {
        try {
          await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              embeds: [{
                title: '❌ تم رفض طلب تحويل كرديت',
                description: `**المستخدم:** ${fullUsername}\n**User ID:** ${userId}\n**الحالة:** تم الرفض ❌\n**السبب:** ${reason}`,
                color: 0xFF0000,
                fields: [
                  { name: '👤 المستخدم', value: fullUsername, inline: true },
                  { name: '🆔 ID', value: userId, inline: true },
                  { name: '🔑 رقم الطلب', value: `\`${requestId}\``, inline: true },
                  { name: '📝 سبب الرفض', value: reason, inline: false },
                ],
                footer: { text: 'TRJ BOT - Prime Rejected' },
                timestamp: new Date().toISOString()
              }]
            })
          });
        } catch {}
      }

      return new Response(renderHTML(
        'تم الرفض',
        `تم رفض طلب المستخدم ${fullUsername}<br>السبب: ${reason}`,
        '#ef4444',
        '❌'
      ), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });

    } else {
      return new Response(renderHTML('خطأ', 'إجراء غير معروف', '#ef4444', '❌'), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

  } catch (error) {
    return new Response(renderHTML('خطأ', 'حدث خطأ في الخادم', '#ef4444', '⚠️'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { action, token } = body;

    if (!action) {
      return NextResponse.json({ success: false, error: 'إجراء غير محدد' }, { status: 400 });
    }

    // Forward prime-nuker actions to the prime handler
    // The prime-action module primarily handles the review GET page
    // POST actions for prime features are handled by the prime.ts handler
    return NextResponse.json({
      success: false,
      error: 'استخدم نقطة النهاية الصحيحة: /api/prime'
    }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || 'خطأ' }, { status: 500 });
  }
}

