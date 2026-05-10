
import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

const SYSTEM_PROMPT = `أنت TRJ AI Agent v4 - مساعد ذكي ومبرمج محترف خبير في Discord API v10 و Python و JavaScript و لغات البرمجة المتعددة.

## قواعد مهمة
1. أجب بالعربية دائماً
2. اكتب كود كامل - لا تختصر أو تكتب "..."
3. استخدم code blocks مع تحديد اللغة
4. أجب بشكل مباشر وواضح ومفصل
5. اشرح الكود الذي تكتبه
6. إذا سُئلت عن شيء غير برمجي، أجب بذكاء ومفصلة

## قدراتك
- كتابة أكواد بأي لغة (Python, JavaScript, TypeScript, Java, C++, etc.)
- إصلاح الأخطاء البرمجية
- شرح الأكواد والخوارزميات
- إنشاء سكربتات Discord bot
- تحليل ملفات البايثون
- تقديم نصائح برمجية

## Discord API v10
User: GET/PATCH /users/@me, PUT/DELETE /users/@me/relationships/{id}
Guilds: GET/PATCH/DELETE /guilds/{id}, GET /guilds/{id}/members?limit=1000
Channels: GET/POST /guilds/{id}/channels, PATCH/DELETE /channels/{id}
Messages: GET/POST/DELETE /channels/{id}/messages, BULK DELETE
Webhooks: POST /channels/{id}/webhooks, POST /webhooks/{id}/{token}
Rate Limits: 5/s → sleep(0.25), on 429 use retry_after

## أسلوب الكود
aiohttp+asyncio, class-based, CONFIG dict, ANSI ألوان, error handling كامل`

// timeout 25 ثانية لكل طلب
const AI_TIMEOUT_MS = 25000

async function tryAI(messages: Array<{role: string; content: string}>, timeoutMs: number): Promise<{content: string | null; error: string}> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    const zai = await ZAI.create()
    const result = await zai.chat.completions.create({
      messages,
      temperature: 0.6,
      max_tokens: 2048,
    })

    clearTimeout(timer)
    const content = result?.choices?.[0]?.message?.content
    if (content && content.trim().length > 0) return { content: content.trim(), error: '' }
    return { content: null, error: 'empty_response' }
  } catch (err: any) {
    const msg = err?.message || err?.toString() || 'unknown'
    if (msg.includes('abort') || msg.includes('timeout') || msg.includes('Timeout')) {
      return { content: null, error: 'timeout' }
    }
    console.error('[AI Chat] Error:', msg)
    return { content: null, error: msg }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const messages = body.messages

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ success: false, error: 'الرجاء إرسال رسالة' }, { status: 400 })
    }

    const recent = messages.slice(-10)
    const chatMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...recent.map((m: { role: string; content: string }) => ({ role: m.role, content: m.content }))
    ]

    // محاولة واحدة مع timeout مناسب
    let result = await tryAI(chatMessages, AI_TIMEOUT_MS)
    if (result.content) {
      return NextResponse.json({ success: true, message: result.content })
    }

    // إذا كان الخطأ timeout أو empty فقط، أعد المحاولة مرة واحدة بدون انتظار
    if (result.error === 'timeout' || result.error === 'empty_response') {
      result = await tryAI(chatMessages, AI_TIMEOUT_MS)
      if (result.content) {
        return NextResponse.json({ success: true, message: result.content })
      }
    }

    // فشلت المحاولات
    console.error('[AI Chat] Failed:', result.error)
    return NextResponse.json(
      { success: false, error: 'المساعد الذكي مشغول حالياً - حاول مرة أخرى' },
      { status: 503 }
    )
  } catch (error: any) {
    console.error('[AI Chat] Route error:', error?.message || error)
    return NextResponse.json(
      { success: false, error: 'حدث خطأ في الخادم - حاول مرة أخرى' },
      { status: 500 }
    )
  }
}
