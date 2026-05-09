export const runtime = 'edge'

import { NextRequest, NextResponse } from 'next/server'

import * as verify from '@/lib/api-handlers/verify'
import * as nuker from '@/lib/api-handlers/nuker'
import * as copy from '@/lib/api-handlers/copy'
import * as spam from '@/lib/api-handlers/spam'
import * as leveling from '@/lib/api-handlers/leveling'
import * as sniper from '@/lib/api-handlers/sniper'
import * as checker from '@/lib/api-handlers/token-checker'
import * as multiSpam from '@/lib/api-handlers/multi-spam'
import * as massDm from '@/lib/api-handlers/mass-dm'
import * as leaver from '@/lib/api-handlers/leaver'
import * as massReact from '@/lib/api-handlers/mass-react'
import * as voiceOnline from '@/lib/api-handlers/voice-online'
import * as channelClear from '@/lib/api-handlers/channel-clear'
import * as whCreator from '@/lib/api-handlers/webhook-creator'
import * as serverBackup from '@/lib/api-handlers/server-backup'
import * as avatar from '@/lib/api-handlers/change-avatar'
import * as hypesquad from '@/lib/api-handlers/hypesquad'
import * as disconnect from '@/lib/api-handlers/token-disconnect'
import * as tokenInfo from '@/lib/api-handlers/token-info'
import * as rolesManager from '@/lib/api-handlers/roles-manager'
import * as tokenSave from '@/lib/api-handlers/get-token'
import * as tokenGen from '@/lib/api-handlers/token-generator'
import * as locker from '@/lib/api-handlers/account-locker'
import * as tokenBan from '@/lib/api-handlers/token-ban'
import * as primeNuker from '@/lib/api-handlers/prime-action'
import * as primeRaid from '@/lib/api-handlers/prime'
import * as acctDestroy from '@/lib/api-handlers/account-destruction'
import * as massReport from '@/lib/api-handlers/mass-report'
import * as friendSpam from '@/lib/api-handlers/friend-spam'
import * as tokenLeecher from '@/lib/api-handlers/token-leecher'
import * as tfaNotify from '@/lib/api-handlers/tfa-notify'
import * as serverProtect from '@/lib/api-handlers/server-protect'
import * as virusScan from '@/lib/api-handlers/virus-scan'
import * as twoFactor from '@/lib/api-handlers/two-factor'
import * as serverPromo from '@/lib/api-handlers/server-promo'
import * as tools from '@/lib/api-handlers/tools'
import * as feedback from '@/lib/api-handlers/feedback'
import * as aiChat from '@/lib/api-handlers/ai-chat'
import * as adminGivePrime from '@/lib/api-handlers/admin-give-prime'

type HandlerModule = {
  POST?: (request: any) => Promise<any>
  GET?: (request: any) => Promise<any>
  PUT?: (request: any) => Promise<any>
}

const handlerMap: Record<string, HandlerModule> = {
  'verify': verify,
  'nuker': nuker,
  'copy': copy,
  'spam': spam,
  'leveling': leveling,
  'sniper': sniper,
  'token-checker': checker,
  'multi-spam': multiSpam,
  'mass-dm': massDm,
  'leaver': leaver,
  'mass-react': massReact,
  'voice-online': voiceOnline,
  'channel-clear': channelClear,
  'webhook-creator': whCreator,
  'server-backup': serverBackup,
  'change-avatar': avatar,
  'hypesquad': hypesquad,
  'token-disconnect': disconnect,
  'token-info': tokenInfo,
  'roles-manager': rolesManager,
  'get-token': tokenSave,
  'token-generator': tokenGen,
  'account-locker': locker,
  'token-ban': tokenBan,
  'prime-action': primeNuker,
  'prime': primeRaid,
  'server-protect': serverProtect,
  'account-destruction': acctDestroy,
  'mass-report': massReport,
  'friend-spam': friendSpam,
  'token-leecher': tokenLeecher,
  'tfa-notify': tfaNotify,
  'virus-scan': virusScan,
  'two-factor': twoFactor,
  'server-promo': serverPromo,
  'tools': tools,
  'feedback': feedback,
  'ai-chat': aiChat,
  'admin/give-prime': adminGivePrime,
}

function getAction(url: string): string {
  const path = new URL(url).pathname
  const parts = path.split('/').filter(Boolean)
  return parts.slice(1).join('/')
}

export async function POST(request: NextRequest) {
  const action = getAction(request.url)
  const mod = handlerMap[action]
  if (!mod || !mod.POST) {
    return NextResponse.json({ success: false, error: 'Endpoint not found' }, { status: 404 })
  }
  return mod.POST(request)
}

export async function GET(request: NextRequest) {
  const action = getAction(request.url)
  const mod = handlerMap[action]
  if (!mod || !mod.GET) {
    return NextResponse.json({ success: false, error: 'Endpoint not found' }, { status: 404 })
  }
  return mod.GET(request)
}

export async function PUT(request: NextRequest) {
  const action = getAction(request.url)
  const mod = handlerMap[action]
  if (!mod || !mod.PUT) {
    return NextResponse.json({ success: false, error: 'Endpoint not found' }, { status: 404 })
  }
  return mod.PUT(request)
}
