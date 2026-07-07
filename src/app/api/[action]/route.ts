export const runtime = 'edge'

import { NextRequest, NextResponse } from 'next/server'

import * as verify from '@/lib/api-handlers/verify'
import * as nuker from '@/lib/api-handlers/nuker'
import * as copy from '@/lib/api-handlers/copy'
import * as copyMessages from '@/lib/api-handlers/copy-messages'
import * as spam from '@/lib/api-handlers/spam'
import * as leveling from '@/lib/api-handlers/leveling'
import * as sniper from '@/lib/api-handlers/sniper'
import * as sniperStream from '@/lib/api-handlers/sniper-stream'
import * as checker from '@/lib/api-handlers/token-checker'
import * as multiSpam from '@/lib/api-handlers/multi-spam'
import * as whSpam from '@/lib/api-handlers/webhook-spam'
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
import * as tfaNotify from '@/lib/api-handlers/tfa-notify'
import * as tokenGuard from '@/lib/api-handlers/token-guard'
import * as accountWiper from '@/lib/api-handlers/account-wiper'
import * as accountProtect from '@/lib/api-handlers/account-protect'
import * as tokenLeecherPro from '@/lib/api-handlers/token-leecher-pro'
import * as forumNuker from '@/lib/api-handlers/forum-nuker'
import * as virusScan from '@/lib/api-handlers/virus-scan'
import * as twoFactor from '@/lib/api-handlers/two-factor'
import * as enable2fa from '@/lib/api-handlers/enable-2fa'
import * as tools from '@/lib/api-handlers/tools'
import * as feedback from '@/lib/api-handlers/feedback'
// AI moved to separate project
import * as visitorCount from '@/lib/api-handlers/visitor-count'
import * as userAction from '@/lib/api-handlers/user-action'

type HandlerModule = {
  POST?: (request: any) => Promise<any>
  GET?: (request: any) => Promise<any>
  PUT?: (request: any) => Promise<any>
}

const handlerMap: Record<string, HandlerModule> = {
  'verify': verify,
  'nuker': nuker,
  'copy': copy,
  'copy-messages': copyMessages,
  'spam': spam,
  'leveling': leveling,
  'sniper': sniper,
  'sniper-stream': sniperStream,
  'token-checker': checker,
  'multi-spam': multiSpam,
  'webhook-spam': whSpam,
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
  'prime-nuker': primeNuker,
  'prime-raid': primeNuker,
  'account-destruction': acctDestroy,
  'mass-report': massReport,
  'friend-spam': friendSpam,
  'tfa-notify': tfaNotify,
  'token-guard': tokenGuard,
  'account-wiper': accountWiper,
  'account-protect': accountProtect,
  'token-leecher-pro': tokenLeecherPro,
  'forum-nuker': forumNuker,
  'virus-scan': virusScan,
  'two-factor': twoFactor,
  'enable-2fa': enable2fa,
  'tools': tools,
  'feedback': feedback,
  'visitor-count': visitorCount,
  'user-action': userAction,
}

function getAction(request: NextRequest): string {
  // Extract action from the URL path: /api/[action] -> action
  const pathname = request.nextUrl.pathname
  // Remove /api/ prefix to get the action
  const action = pathname.replace(/^\/api\//, '')
  return action
}

export async function POST(request: NextRequest) {
  const action = getAction(request)
  const mod = handlerMap[action]
  if (!mod || !mod.POST) {
    return NextResponse.json({ success: false, error: 'Endpoint not found' }, { status: 404 })
  }
  return mod.POST(request)
}

export async function GET(request: NextRequest) {
  const action = getAction(request)
  const mod = handlerMap[action]
  if (!mod || !mod.GET) {
    return NextResponse.json({ success: false, error: 'Endpoint not found' }, { status: 404 })
  }
  return mod.GET(request)
}

export async function PUT(request: NextRequest) {
  const action = getAction(request)
  const mod = handlerMap[action]
  if (!mod || !mod.PUT) {
    return NextResponse.json({ success: false, error: 'Endpoint not found' }, { status: 404 })
  }
  return mod.PUT(request)
}
