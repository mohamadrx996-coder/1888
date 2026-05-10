
import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

const SYSTEM_PROMPT = `أنت TRJ AI Agent v4 - مبرمج بايثون محترف خبير في Discord API v10.

## قواعد
1. اكتب كود بايثون كامل - لا تختصر
2. استخدم \`\`\`python code blocks
3. الرد بالعربية
4. أجب بشكل مباشر وواضح

## Discord API v10
User: GET/PATCH /users/@me, PUT/DELETE /users/@me/relationships/{id}
Guilds: GET/PATCH/DELETE /guilds/{id}, GET /guilds/{id}/members?limit=1000
Channels: GET/POST /guilds/{id}/channels, PATCH/DELETE /channels/{id}
Messages: GET/POST/DELETE /channels/{id}/messages, BULK DELETE
Webhooks: POST /channels/{id}/webhooks, POST /webhooks/{id}/{token}
Rate Limits: 5/s→sleep(0.25), on 429 use retry_after

## أسلوب الكود
aiohttp+asyncio, class-based, CONFIG dict, ANSI ألوان, error handling`

async function tryAI(messages: Array<{role: string; content: string}>): Promise<{content: string | null; error: string}> {
  try {
    const zai = await ZAI.create()
    const result = await zai.chat.completions.create({
      messages,
      temperature: 0.35,
      max_tokens: 4096,
    })
    const content = result?.choices?.[0]?.message?.content
    if (content) return { content, error: '' }
    return { content: null, error: 'empty_response' }
  } catch (err: any) {
    const msg = err?.message || err?.toString() || 'unknown'
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

    // المحاولة الأولى
    let result = await tryAI(chatMessages)
    if (result.content) {
      return NextResponse.json({ success: true, message: result.content })
    }

    // إعادة المحاولة مرة واحدة
    result = await tryAI(chatMessages)
    if (result.content) {
      return NextResponse.json({ success: true, message: result.content })
    }

    // فشلت كل المحاولات
    const errorDetail = result.error || 'busy'
    console.error('[AI Chat] All retries failed:', errorDetail)
    return NextResponse.json({ success: false, error: 'busy' }, { status: 503 })
  } catch (error: any) {
    console.error('[AI Chat] Route error:', error?.message || error)
    return NextResponse.json({ success: false, error: 'busy' }, { status: 503 })
  }
}
