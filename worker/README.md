# 🔒 1888 Token Guard — دليل النشر الكامل

ميزة **Token Guard** تراقب حسابك 24/7 وترسل إشعارات فورية للويب هوك عند:
- ⚠️ تسجيل دخول جديد من جهاز/IP جديد
- 🚨 تعطّل التوكن أو تغيير الباسوورد
- 📝 تغيير الاسم أو الأفتار أو البنر أو البايو

## ⚡ تحديث: المراقبة كل دقيقة (شبه فورية)

الـ Worker يفحص كل **1 دقيقة** بدلاً من 5 دقايق = أسرع 5 مرات!

### 💡 لماذا polling وليس event-based؟
ديسكورد **لا يدعم** إرسال إشعارات تلقائية عند:
- تغيير الأفتار/الاسم
- تسجيل دخول جديد
- تعطيل التوكن

السبب: ديسكورد يوفر Gateway (WebSocket) للبوتات فقط، ويحتاج اتصال دائم. الحل الوحيد للحسابات هو **polling**، وقد جعلناه كل دقيقة ليكون شبه فوري.

---

## 🚀 خطوات النشر

### 1️⃣ تثبيت Wrangler

```bash
npm install -g wrangler
wrangler login
```

### 2️⃣ إنشاء KV Namespace

```bash
cd worker
wrangler kv:namespace create TOKEN_GUARD_KV
```

سيعطيك نتيجة مثل:
```json
{ "id": "abc123def456..." }
```

انسخ الـ `id` وضعه في `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "TOKEN_GUARD_KV"
id = "abc123def456..."  # ← ضع الـ id هنا
```

### 3️⃣ نشر الـ Worker

```bash
wrangler deploy
```

ستحصل على رابط مثل:
```
https://1888-token-guard.<your-subdomain>.workers.dev
```

احفظ هذا الرابط — ستحتاجه في الخطوة التالية.

### 4️⃣ ربط الموقع بالـ Worker

في Cloudflare Pages → مشروع 1888 → Settings → Environment Variables:

| Variable Name | Value |
|--------------|-------|
| `TOKEN_GUARD_WORKER_URL` | `https://1888-token-guard.<your-subdomain>.workers.dev` |

أو لو على Vercel:
```bash
vercel env add TOKEN_GUARD_WORKER_URL
```

### 5️⃣ إعادة نشر الموقع

بعد إضافة متغير البيئة، أعد نشر الموقع.

---

## ✅ التحقق من العمل

1. افتح موقع 1888 → اذهب لقسم "حارسة التوكن"
2. أدخل توكنك + رابط ويب هوك
3. اضغط "🛡️ تفعيل المراقبة"
4. يجب أن ترى:
   - ✅ "Worker متصل - 24/7 مفعّل" في السجلات
   - إشعار على الويب هوك يأكد التفعيل

---

## 🧪 اختبار الإشعارات

### اختبار 1: تسجيل دخول جديد
- افتح حسابك على ديسكورد من جهاز/متصفح جديد
- خلال 5 دقائق، يصلك إشعار على الويب هوك

### اختبار 2: تعطيل التوكن
- غيّر باسوورد حسابك
- خلال 5 دقائق، يصلك تنبيه حرج

---

## 📊 مراقبة الـ Worker

### عرض السجلات (live logs):
```bash
wrangler tail
```

### فحص صحة الـ Worker:
```bash
curl https://1888-token-guard.<your-subdomain>.workers.dev/
# {"success":true,"service":"1888 Token Guard Worker","activeGuards":3,"uptime":"24/7"}
```

---

## 💰 التكلفة

### Cloudflare Workers (الخطة المجانية):
- **100,000 requests/يوم** مجاناً
- **Cron triggers**: مجاناً
- **KV reads**: 100,000/يوم مجاناً
- **KV writes**: 1,000/يوم مجاناً

#### الاستهلاك المتوقع:
- 1 توكن × 12 فحص/ساعة × 24 ساعة = 288 request/يوم
- 10 توكنات = 2,880 request/يوم (3% من الحد المجاني)

**النتيجة: مجاني بالكامل لعدد معقول من المستخدمين** ✅

---

## 🛠️ استكشاف الأخطاء

### المشكلة: الإشعارات لا تصل
**الحل**:
1. تأكد من رابط الويب هوك صحيح
2. اختبر الويب هوك يدوياً:
   ```bash
   curl -X POST -H "Content-Type: application/json" \
     -d '{"content":"test"}' \
     https://discord.com/api/webhooks/...
   ```
3. راجع سجلات الـ Worker: `wrangler tail`

### المشكلة: الـ Worker لا يعمل
**الحل**:
1. تحقق من `wrangler.toml` — تأكد من `id` صحيح لـ KV
2. تحقق من نشر الـ Worker: `wrangler deployments list`
3. اختبر الـ endpoint يدوياً:
   ```bash
   curl https://1888-token-guard.<your-subdomain>.workers.dev/
   ```

### المشكلة: الموقع لا يتصل بالـ Worker
**الحل**:
1. تحقق من متغير البيئة `TOKEN_GUARD_WORKER_URL` في Cloudflare Pages
2. تأكد أن الموقع أُعيد نشره بعد إضافة المتغير
3. تحقق من رابط الـ Worker (لا يوجد `/` في النهاية)

---

## 🔐 الأمان

- ✅ التوكنات تُحفظ في KV مشفرة (Cloudflare KV at-rest encryption)
- ✅ الـ Worker معزول تماماً عن الموقع
- ✅ لا أحد يستطيع الوصول لـ KV بدون حساب Cloudflare الخاص بك
- ⚠️ **تنبيه**: لا تشارك رابط الـ Worker公开 — يمكن لأي شخص يعرفه تفعيل/إيقاف مراقبة

### حماية إضافية (اختياري):
أضف للـ Worker:

```typescript
// في بداية fetch handler:
const allowedOrigin = 'https://your-1888-site.pages.dev'
if (request.headers.get('Origin') !== allowedOrigin) {
  return new Response('Forbidden', { status: 403 })
}
```

---

## 📞 الدعم

لو واجهت مشاكل:
1. راجع `wrangler tail` للأسlogs المباشرة
2. تأكد من أن Cron يعمل: `wrangler triggers list`
3. راجع KV: `wrangler kv:key list --binding=TOKEN_GUARD_KV`

---

**ملاحظة**: المراقبة تعمل حتى لو:
- ❌ الموقع مطفي
- ❌ المتصفح مغلق
- ❌ الجوال بدون إنترنت
- ✅ الـ Worker على Cloudflare يعمل 24/7
