
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

interface ToolEntry {
  id: string
  name: string
  description: string
  fileName: string
  fileSize: string
  fileData: string
  fileType: string
  category: string
  author: string
  authorId: string
  downloads: number
  createdAt: string
}

const getStore = (): ToolEntry[] => {
  if (!(globalThis as any).__trj_tools) {
    (globalThis as any).__trj_tools = [] as ToolEntry[]
  }
  return (globalThis as any).__trj_tools as ToolEntry[]
}

export async function GET() {
  const tools = getStore()
  return NextResponse.json({ success: true, tools })
}

export async function POST(request: NextRequest) {
  try {
    const rlIp = getClientIp(request);
    const rl = rateLimit(`${rlIp}:tools`, RATE_LIMITS.medium);
    if (rl.limited) {
      return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
    }

    const body = await request.json()
    const { action, tool, toolId } = body

    const store = getStore()

    if (action === 'upload' && tool) {
      if (store.length >= 50) {
        return NextResponse.json({ success: false, error: 'تم بلوغ الحد الأقصى للأدوات (50)' })
      }
      const newTool: ToolEntry = {
        id: tool.id || Date.now().toString(36) + Math.random().toString(36).substring(2),
        name: String(tool.name || 'بدون اسم').substring(0, 100),
        description: String(tool.description || 'بدون وصف').substring(0, 500),
        fileName: String(tool.fileName || 'file').substring(0, 200),
        fileSize: String(tool.fileSize || '0 KB'),
        fileData: String(tool.fileData || ''),
        fileType: String(tool.fileType || 'FILE'),
        category: String(tool.category || 'أدوات'),
        author: String(tool.author || 'مجهول').substring(0, 50),
        authorId: String(tool.authorId || 'unknown'),
        downloads: 0,
        createdAt: tool.createdAt || new Date().toLocaleDateString('ar-SA')
      }
      store.unshift(newTool)
      return NextResponse.json({ success: true, tool: newTool })
    }

    if (action === 'delete' && toolId) {
      const idx = store.findIndex((t: ToolEntry) => t.id === toolId)
      if (idx !== -1) {
        store.splice(idx, 1)
        return NextResponse.json({ success: true })
      }
      return NextResponse.json({ success: false, error: 'الأداة غير موجودة' })
    }

    if (action === 'increment_download' && toolId) {
      const t = store.find((t: ToolEntry) => t.id === toolId)
      if (t) {
        t.downloads = (t.downloads || 0) + 1
        return NextResponse.json({ success: true })
      }
      return NextResponse.json({ success: false, error: 'الأداة غير موجودة' })
    }

    return NextResponse.json({ success: false, error: 'إجراء غير معروف' })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: 'خطأ: ' + (e.message || 'خطأ في الطلب') })
  }
}

