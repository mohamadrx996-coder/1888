
import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

interface VirusResult {
  file_name: string
  file_size: string
  file_type: string
  md5: string
  is_suspicious: boolean
  threat_level: 'clean' | 'low' | 'medium' | 'high' | 'critical'
  threat_type: string[]
  ports: number[]
  c2_servers: string[]
  suspicious_patterns: { pattern: string; description: string; line?: number; severity: 'info' | 'warning' | 'danger' }[]
  encoded_strings: { type: string; value: string; decoded?: string }[]
  network_indicators: { type: string; value: string }[]
  capabilities: string[]
  summary: string
  recommendation: string
  trojan_type?: string
  threat_score: number
  engines: {
    pattern_engine: { findings: number; threats: string[]; scan_time: number }
    ai_engine: { findings: string[]; threat_assessment: string; scan_time: number; confidence: string }
    heuristic_engine: { findings: number; threats: string[]; scan_time: number }
  }
  total_engines: number
  engines_detected: number
}

const DANGEROUS_PATTERNS = [
  { pattern: /child_process\.(exec|spawn|execSync|spawnSync)/, desc: 'تنفيذ أوامر النظام عبر child_process', severity: 'danger' as const, category: 'cmd_exec' },
  { pattern: /os\.system\s*\(|subprocess\.(call|run|Popen|check_output)/, desc: 'تنفيذ أوامر النظام', severity: 'danger' as const, category: 'cmd_exec' },
  { pattern: /powershell|cmd\.exe|\/bin\/sh|\/bin\/bash/i, desc: 'استدعاء shell مباشر', severity: 'danger' as const, category: 'cmd_exec' },
  { pattern: /Process\[(?:"hidden")|app\.hide\(\)|window\.minimize/i, desc: 'إخفاء العملية', severity: 'danger' as const, category: 'process_hide' },
  { pattern: /GetAsyncKeyState|SetWindowsHookEx|keyboard.*hook/i, desc: 'Keylogger - تسجيل لوحة المفاتيح', severity: 'danger' as const, category: 'keylogger' },
  { pattern: /GetDesktopWindow|BitBlt|copyFromScreen/i, desc: 'لقطة شاشة سرية', severity: 'danger' as const, category: 'screen_capture' },
  { pattern: /reverse.*shell|backdoor|rat.*remote|C2\s*server/i, desc: 'باك دور أو Remote Access Trojan', severity: 'danger' as const, category: 'rat' },
  { pattern: /self\.delete|RemoveSelf|QProcess.*kill/i, desc: 'حذف نفسه بعد التنفيذ', severity: 'danger' as const, category: 'self_delete' },
  { pattern: /\.encrypt\s*\(|ransomware|\.encrypted\s*:/i, desc: 'تشفير ملفات - فدية', severity: 'danger' as const, category: 'ransomware' },
  { pattern: /eval\s*\(\s*(atob|btoa|Buffer\.from|base64)/i, desc: 'تنفيذ كود مشفر (eval + base64)', severity: 'danger' as const, category: 'code_injection' },
  { pattern: /new\s+Function\s*\(\s*(atob|btoa|Buffer\.from)/i, desc: 'تنفيذ كود مشفر (Function constructor)', severity: 'danger' as const, category: 'code_injection' },
  { pattern: /webhook.*discord\.com\/api\/webhooks\/[0-9]+\/[^\s'"]+['"]\)/i, desc: 'إرسال بيانات عبر ويب هوك ديسكورد', severity: 'danger' as const, category: 'discord_webhook' },
  { pattern: /HKLM|HKCU|reg\s+add|regedit|Registry\./i, desc: 'تعديل الريجستري', severity: 'danger' as const, category: 'registry' },
  { pattern: /taskmgr|TerminateProcess|Process\.kill/i, desc: 'قتل عمليات النظام', severity: 'danger' as const, category: 'process_kill' },
  { pattern: /startup|autorun|runonce|shell:startup/i, desc: 'تشغيل تلقائي عند الإقلاع', severity: 'warning' as const, category: 'persistence' },
  { pattern: /isDebuggerPresent|IsDebuggerPresent|debugger/i, desc: 'كشف التصحيح (anti-debug)', severity: 'warning' as const, category: 'anti_debug' },
  { pattern: /vmware|virtualbox|vbox|qemu/i, desc: 'كشف البيئة الافتراضية (anti-VM)', severity: 'warning' as const, category: 'anti_vm' },
  { pattern: /navigator\.clipboard.*read|Clipboard.*GetData/i, desc: 'الوصول للحافظة لقراءة البيانات', severity: 'warning' as const, category: 'clipboard' },
  { pattern: /dns.*exfil|pastebin\.com\/raw|api\.telegram\.org\/bot/i, desc: 'تسريب بيانات عبر خدمات خارجية', severity: 'danger' as const, category: 'data_exfil' },
  { pattern: /discord\.com\/api\/v\d+\/users\/@me/i, desc: 'استخراج بيانات حساب ديسكورد', severity: 'warning' as const, category: 'discord_token' },
  { pattern: /localStorage\.getItem\(.*token/i, desc: 'سرقة توكن من localStorage', severity: 'danger' as const, category: 'discord_token' },
  { pattern: /document\.cookie.*token|cookie.*discord/i, desc: 'سرقة توكن من الكوكيز', severity: 'danger' as const, category: 'discord_token' },
  { pattern: /Invoke-Expression|IEX\s*\(|Start-Process\s*-WindowStyle\s*Hidden/i, desc: 'PowerShell تنفيذ أوامر مخفية', severity: 'danger' as const, category: 'cmd_exec' },
  { pattern: /exec\s*\(\s*compile|exec\s*\(\s*__import__|__builtins__\.__import__|getattr\s*\(\s*__builtins__/i, desc: 'Python تنفيذ ديناميكي مشبوه', severity: 'danger' as const, category: 'code_injection' },
  { pattern: /chr\s*\(\s*\d+\s*\)\s*.*chr\s*\(\s*\d+/i, desc: 'بناء أوامر من chr() - تشفير', severity: 'warning' as const, category: 'obfuscation' },
  { pattern: /\\\\x[0-9a-f]{2}.*\\\\x[0-9a-f]{2}.*\\\\x[0-9a-f]{2}/i, desc: 'سلاسل hex مشفرة متعددة', severity: 'warning' as const, category: 'obfuscation' },
  { pattern: /websocket\.send|ws\.send|socket\.emit.*token|io\.emit/i, desc: 'إرسال بيانات عبر WebSocket', severity: 'warning' as const, category: 'data_exfil' },
  { pattern: /fs\.readFileSync|readFile.*cookie|readFile.*token|readdir.*discord/i, desc: 'قراءة ملفات حساسة من النظام', severity: 'danger' as const, category: 'data_exfil' },
  { pattern: /os\.homedir|os\.tmpdir|process\.env\.APPDATA|process\.env\.HOME/i, desc: 'الوصول لمسارات النظام الحساسة', severity: 'warning' as const, category: 'data_exfil' },
]

const COMMON_PATTERNS = [
  'fetch(', 'http.get', 'https.get', 'axios.', 'request(', 'requests.',
  'base64', 'atob(', 'btoa(', 'Buffer.from',
  'token', 'authorization', 'Bearer ',
  'cookie', 'document.cookie',
  'eval(', 'Function(',
  'socket.connect', 'new Socket',
  'setTimeout(', 'setInterval(',
  'discord.com', 'discord.gg',
  'navigator.mediaDevices', 'getUserMedia',
  'password', 'credential',
  'process.env', '.env',
]

const PORT_PATTERNS = [
  /(?:connect|bind|listen|port|PORT)\s*[:=]\s*(\d{1,5})/g,
  /(?:0\.0\.0\.0|127\.0\.0\.1|localhost)\s*:\s*(\d{1,5})/g,
  /(?:socket|Socket)\s*\(\s*['"](?:tcp|udp)['"]\s*,\s*(\d{1,5})/g,
  /new\s+Server\s*\(\s*\{\s*port\s*:\s*(\d{1,5})/g,
]

const C2_PATTERNS = [
  /https?:\/\/[^\s'"]+/g,
  /(?:host|HOST|server|SERVER|url|URL)\s*[:=]\s*['"]([^'"]+)['"]/g,
  /(?:api|API|endpoint|ENDPOINT)\s*[:=]\s*['"]([^'"]+)['"]/g,
]

const ENCODED_PATTERNS = [
  { regex: /[A-Za-z0-9+/]{20,}={0,2}/g, type: 'Base64' },
  { regex: /\\x[0-9a-fA-F]{2}/g, type: 'Hex Escape' },
  { regex: /\\u[0-9a-fA-F]{4}/g, type: 'Unicode Escape' },
]

function extractPorts(content: string): number[] {
  const ports = new Set<number>()
  for (const pattern of PORT_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags)
    let match
    while ((match = regex.exec(content)) !== null) {
      const port = parseInt(match[1])
      if (port > 0 && port <= 65535 && port !== 80 && port !== 443 && port !== 3000 && port !== 8080 && port !== 4443 && port !== 8443) {
        ports.add(port)
      }
    }
  }
  return Array.from(ports)
}

function extractC2Servers(content: string): string[] {
  const servers = new Set<string>()
  const excludeDomains = ['localhost', '127.0.0.1', 'example.com', 'github.com', 'npmjs.com', 'pypi.org', 'crates.io', 'docs.microsoft.com', 'developer.mozilla.org', 'stackoverflow.com', 'discord.com/discord-api-docs']
  for (const pattern of C2_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags)
    let match
    while ((match = regex.exec(content)) !== null) {
      const url = match[1] || match[0]
      const shouldExclude = excludeDomains.some(d => url.includes(d))
      if (url && !shouldExclude) {
        servers.add(url.replace(/['"]/g, '').trim().substring(0, 200))
      }
    }
  }
  return Array.from(servers).slice(0, 10)
}

function extractEncodedStrings(content: string): { type: string; value: string; decoded?: string }[] {
  const results: { type: string; value: string; decoded?: string }[] = []
  for (const ep of ENCODED_PATTERNS) {
    const regex = new RegExp(ep.regex.source, ep.regex.flags)
    let match
    while ((match = regex.exec(content)) !== null) {
      if (match[0].length >= 20) {
        let decoded: string | undefined
        if (ep.type === 'Base64') {
          try { decoded = atob(match[0]).toString('utf-8') } catch { /* skip */ }
        }
        results.push({ type: ep.type, value: match[0].substring(0, 60), decoded })
      }
    }
  }
  return results.slice(0, 15)
}

function patternEngineAnalyze(content: string, fileName: string): { findings: number; threats: string[]; data: any; scanTime: number } {
  const startTime = performance.now()
  const lines = content.split('\n')
  const suspiciousPatterns: { pattern: string; description: string; line?: number; severity: 'info' | 'warning' | 'danger' }[] = []
  const threatTypeSet = new Set<string>()
  let dangerCount = 0
  let warningCount = 0

  for (const dp of DANGEROUS_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      if (dp.pattern.test(lines[i])) {
        suspiciousPatterns.push({ pattern: dp.pattern.source.substring(0, 50), description: dp.desc, line: i + 1, severity: dp.severity })
        dp.pattern.lastIndex = 0

        threatTypeSet.add(dp.category)
        if (dp.severity === 'danger') dangerCount++
        else warningCount++
        break
      }
    }
    dp.pattern.lastIndex = 0
  }

  const hasCmdExec = threatTypeSet.has('cmd_exec')
  const hasNetwork = /fetch\(|http\.get|https\.get|axios\.|requests\.|socket\.connect|new\s+Socket/i.test(content)
  const hasObfuscation = /eval\s*\(\s*(atob|btoa|Buffer\.from)|new\s+Function\s*\(/i.test(content)
  const hasTokenAccess = /localStorage|document\.cookie|navigator\.credentials/i.test(content)
  const hasBase64Heavy = (content.match(/[A-Za-z0-9+/]{40,}={0,2}/g) || []).length > 5

  const combinations: { desc: string; category: string }[] = []

  if (hasCmdExec && hasNetwork) {
    combinations.push({ desc: 'تنفيذ أوامر + اتصال شبكة = شيل عكسي محتمل', category: 'reverse_shell' })
    threatTypeSet.add('reverse_shell')
    dangerCount++
  }

  if (hasCmdExec && hasTokenAccess) {
    combinations.push({ desc: 'تنفيذ أوامر + سرقة بيانات = stealler محتمل', category: 'stealer' })
    threatTypeSet.add('stealer')
    dangerCount++
  }

  if (hasCmdExec && hasBase64Heavy) {
    combinations.push({ desc: 'تنفيذ أوامر + تشفير كثيف = حمولة مشفرة', category: 'obfuscated_payload' })
    threatTypeSet.add('obfuscated_payload')
    dangerCount++
  }

  if (hasNetwork && hasObfuscation) {
    combinations.push({ desc: 'اتصال شبكة + كود مشفر = C2 محتمل', category: 'c2_client' })
    threatTypeSet.add('c2_client')
    dangerCount++
  }

  if (hasTokenAccess && hasNetwork && hasBase64Heavy) {
    combinations.push({ desc: 'سرقة بيانات + اتصال + تشفير = exfiltration', category: 'data_exfil' })
    threatTypeSet.add('data_exfil')
    dangerCount++
  }

  for (const combo of combinations) {
    suspiciousPatterns.push({ pattern: 'COMBINATION', description: combo.desc, severity: 'danger' })
  }

  const capabilities: string[] = []
  if (threatTypeSet.has('keylogger')) capabilities.push('تسجيل لوحة المفاتيح')
  if (threatTypeSet.has('screen_capture')) capabilities.push('التقاط لقطات الشاشة')
  if (threatTypeSet.has('clipboard')) capabilities.push('سرقة الحافظة')
  if (threatTypeSet.has('ransomware')) capabilities.push('تشفير الملفات')
  if (threatTypeSet.has('data_exfil')) capabilities.push('تسريب بيانات')
  if (threatTypeSet.has('discord_webhook')) capabilities.push('إرسال عبر ويب هوك')
  if (threatTypeSet.has('reverse_shell')) capabilities.push('شيل عكسي')
  if (threatTypeSet.has('stealer')) capabilities.push('سرقة بيانات')
  if (threatTypeSet.has('rat')) capabilities.push('تحكم عن بعد')
  if (threatTypeSet.has('registry')) capabilities.push('تعديل الريجستري')
  if (threatTypeSet.has('code_injection')) capabilities.push('حقن كود')
  if (threatTypeSet.has('self_delete')) capabilities.push('حذف نفسه')
  if (threatTypeSet.has('c2_client')) capabilities.push('اتصال بخادم C2')
  if (threatTypeSet.has('obfuscated_payload')) capabilities.push('حمولة مشفرة')
  if (threatTypeSet.has('anti_debug')) capabilities.push('مقاومة التصحيح')
  if (threatTypeSet.has('anti_vm')) capabilities.push('مقاومة الافتراضي')
  if (threatTypeSet.has('persistence')) capabilities.push('تشغيل تلقائي')
  if (threatTypeSet.has('process_kill')) capabilities.push('قتل عمليات')
  if (threatTypeSet.has('process_hide')) capabilities.push('إخفاء العملية')
  if (threatTypeSet.has('discord_token')) capabilities.push('استخراج توكنات')

  const ports = extractPorts(content)
  const c2Servers = extractC2Servers(content)
  const encodedStrings = extractEncodedStrings(content)
  const networkIndicators: { type: string; value: string }[] = []

  for (const server of c2Servers) {
    networkIndicators.push({ type: 'C2 Server', value: server })
  }
  for (const port of ports) {
    const knownPorts: Record<number, string> = {
      4444: 'Metasploit Default', 5555: 'Common RAT', 6666: 'Common Backdoor',
      7777: 'Common C2', 8888: 'Common Proxy', 9999: 'Common RAT',
      31337: 'Elite/Backdoor', 1337: 'Common RAT', 6667: 'IRC',
    }
    const desc = knownPorts[port] || 'Unknown'
    networkIndicators.push({ type: `Port ${port}`, value: desc })
  }

  const scanTime = Math.round(performance.now() - startTime)

  return {
    findings: suspiciousPatterns.length,
    threats: Array.from(threatTypeSet),
    data: {
      suspiciousPatterns: suspiciousPatterns.slice(0, 30),
      capabilities,
      ports,
      c2Servers,
      encodedStrings,
      networkIndicators,
      dangerCount,
      warningCount,
    },
    scanTime,
  }
}

async function aiAnalyzeContent(content: string, fileName: string, deepScan: boolean = false): Promise<{ findings: string[]; threat_assessment: string; scan_time: number; confidence: string; reasoning: string }> {
  const startTime = performance.now()
  try {
    const zai = await ZAI.create()
    const maxTokens = deepScan ? 25000 : 20000
    const truncatedContent = content.substring(0, maxTokens)

    const systemPrompt = deepScan
      ? `أنت محلل فيروسات خبير متقدم (Deep Scan Mode). مهمتك تحليل كل سطر وكل دالة في الكود التالي بشكل مفصل جداً.

تحليل عميق مطلوب:
1. تحليل كل دالة/وظيفة على حدة - ماذا تفعل؟ هل تصلح؟
2. كشف طبقات التشفير المتعددة (multi-layer obfuscation) - eval داخل eval, atob داخل atob, إلخ
3. تحديد أنظمة الترميز المستخدمة (encoding schemes) - base64, hex, unicode, rot13, xor, custom
4. تحليل السلوك البرمجي: هل الكود يتصل بالشبكة؟ يقرأ ملفات؟ يكتب في الريجستري؟ ينفذ أوامر؟
5. كشف الشبكات C2 (Command and Control) - URLs, IPs, DNS domains المشبوهة
6. فحص حقن التبعيات (supply chain) - هل يحمل حزم مشفرة؟
7. تحليل سلوك ما بعد التنفيذ: هل يحمل ملفات؟ يعدل البيئة؟ يشغل عمليات خلفية؟
8. كشف تقنيات الإخفاء: anti-debug, anti-VM, process hollowing, DLL injection
9. تحليل تدفق البيانات: أين تذهب البيانات المسروقة؟ عبر أي قنوات؟

قواعد مهمة:
- كود طبيعي يحتوي fetch/base64/token ليس خبيثاً بحد ذاته
- الكود الخبيث يحتوي تركيبات خطيرة محددة
- وضح لماذا كل عنصر مشبوه مع تحديد السطر أو الدالة

رد بتنسيق JSON فقط:
{
  "findings": ["وصف تفصيلي لكل نمط خبيث وجدته مع ذكر الدالة/السطر - أو مصفوفة فارغة إذا نظيف"],
  "threat_assessment": "clean أو low أو medium أو high أو critical",
  "confidence": "high أو medium أو low",
  "reasoning": "شرح مفصل يتضمن: لغة البرمجة، سياق الكود، كل وظيفة تم تحليلها، ولماذا الحكم النهائي"
}`
      : `أنت محلل فيروسات محترف جداً. مهمتك تحليل الكود التالي وتحديد إذا كان يحتوي على برمجيات خبيثة.

قواعد مهمة جداً:
1. كود طبيعي يحتوي fetch() أو base64 أو token أو cookie أو eval() ليس خبيثاً بحد ذاته - هذه أنماط شائعة جداً في كل البرامج
2. الكود الخبيث يجب أن يحتوي تركيبات خطيرة مثل: child_process + fetch + base64 معاً، أو keylogger، أو screencapture، أو reverse shell
3. لا تحكم على كود بأنه خبيث لمجرد وجود أنماط شائعة - يجب أن يكون هناك دليل قوي
4. إذا كان الكود مجرد سكربت عادي (web scraper, bot, API client, etc.) حكم عليه نظيف
5. خمن نوع لغة البرمجة وسياق الكود قبل الحكم

رد بتنسيق JSON فقط:
{
  "findings": ["وصف أي نمط خبيث حقيقي وجدته - أو مصفوفة فارغة إذا نظيف"],
  "threat_assessment": "clean أو low أو medium أو high أو critical",
  "confidence": "high أو medium أو low",
  "reasoning": "شرح مختصر لسبب الحكم - لماذا نظيف أو لماذا خبيث"
}`

    const result = await zai.chat.completions.create({
      messages: [{
        role: 'system',
        content: systemPrompt
      }, {
        role: 'user',
        content: `filename: ${fileName}\n\`\`\`\n${truncatedContent}\n\`\`\``
      }],
      temperature: 0.1,
      max_tokens: deepScan ? 2048 : 1024
    })
    const text = result.choices?.[0]?.message?.content || ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    const scanTime = Math.round(performance.now() - startTime)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        findings: Array.isArray(parsed.findings) ? parsed.findings.filter((f: string) => f && f.length > 0).slice(0, 10) : [],
        threat_assessment: ['clean', 'low', 'medium', 'high', 'critical'].includes(parsed.threat_assessment) ? parsed.threat_assessment : 'low',
        scan_time: scanTime,
        confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'medium',
        reasoning: String(parsed.reasoning || ''),
      }
    }
    return { findings: [], threat_assessment: 'clean', scan_time: scanTime, confidence: 'low', reasoning: 'لم يتمكن من التحليل بشكل كامل' }
  } catch {
    return { findings: ['فشل الاتصال بمحرك AI - لا يمكن التأكد من سلامة الملف'], threat_assessment: 'low', scan_time: Math.round(performance.now() - startTime), confidence: 'none', reasoning: 'فشل الاتصال بمحرك AI' }
  }
}

function heuristicAnalyzeContent(content: string, fileName: string): { findings: number; threats: string[]; scan_time: number } {
  const startTime = performance.now()
  const threats: string[] = []
  const lines = content.split('\n')

  const doubleExtension = /\.(exe|scr|bat|cmd|ps1|js|vbs|wsf)\.(exe|scr|bat|cmd|ps1|js|vbs|wsf|txt|jpg|png|pdf|doc)$/i
  if (doubleExtension.test(fileName)) {
    threats.push('امتداد ملف مزدوج - محاولة إخفاء النوع الحقيقي')
  }

  const longLines = lines.filter(l => l.trim().length > 1000)
  if (longLines.length > 5 && lines.length < 50) {
    threats.push(`${longLines.length} أسطر طويلة جداً في ملف صغير - كود مبهم`)
  }

  const hasAntiDebug = /debugger|isDebuggerPresent|IsDebuggerPresent/.test(content)
  const hasAntiVM = /vmware|virtualbox|vbox|qemu/.test(content.toLowerCase())
  if (hasAntiDebug && hasAntiVM) {
    threats.push('كشف التصحيح + كشف البيئة الافتراضية - سلوك برمجيات خبيثة')
  }

  const dnsExfil = /(?:dns|resolve4|resolve6|lookup)\s*\(/g
  if (dnsExfil.test(content) && /password|token|credential|cookie/i.test(content)) {
    threats.push('نمط تسريب عبر DNS محتمل')
  }

  if (/eval\(/.test(content) && /atob\(|btoa\(|Buffer\.from/.test(content) && /child_process|subprocess|os\.system/.test(content)) {
    threats.push('eval + base64 + تنفيذ أوامر = حقن كود خطير')
  }

  const base64Count = (content.match(/[A-Za-z0-9+/]{30,}={0,2}/g) || []).length
  if (base64Count > 30) {
    threats.push(`عدد كبير جداً من السلاسل المشفرة (${base64Count}) - قد يخفي حمولة كبيرة`)
  }

  const suspiciousFuncNames = content.match(/(?:function|def)\s+(?:___[a-z]{5,}|__[a-z]{10,}__[a-z]{5,})/gi)
  if (suspiciousFuncNames && suspiciousFuncNames.length > 3) {
    threats.push('أسماء دوال مشفرة عمداً - محاولة إخفاء الهدف')
  }

  const scanTime = Math.round(performance.now() - startTime)
  return { findings: threats.length, threats, scan_time: scanTime }
}

function combineResults(
  patternResult: ReturnType<typeof patternEngineAnalyze>,
  aiResult: Awaited<ReturnType<typeof aiAnalyzeContent>>,
  heuristicResult: ReturnType<typeof heuristicAnalyzeContent>,
  content: string,
  fileName: string
): VirusResult {
  const allThreatTypes = new Set<string>(patternResult.threats)
  const { capabilities, suspiciousPatterns, ports, c2Servers, encodedStrings, networkIndicators, dangerCount, warningCount } = patternResult.data

  for (const t of heuristicResult.threats) {
    if (t.includes('eval') || t.includes('حقن')) allThreatTypes.add('Code Injection')
    if (t.includes('DNS') || t.includes('تسريب')) allThreatTypes.add('Data Exfiltration')
    if (t.includes('مزدوج')) allThreatTypes.add('Extension Masquerading')
    if (t.includes('مبهم')) allThreatTypes.add('Obfuscation')
    if (t.includes('anti') || t.includes('كشف')) allThreatTypes.add('Anti-Analysis')
  }

  const threatTypeArr = Array.from(allThreatTypes)

  let aiScore = 0
  const aiScoreMap: Record<string, number> = { critical: 65, high: 50, medium: 30, low: 15, clean: 0, unknown: 35 }
  aiScore = aiScoreMap[aiResult.threat_assessment] || 0

  if (aiResult.threat_assessment === 'clean' && aiResult.confidence === 'high') {
    aiScore = 0
  }

  let patternScore = 0
  patternScore += Math.min(dangerCount * 10, 35)  // أنماط خطيرة - وزن أكبر
  patternScore += Math.min(warningCount * 3, 15) // تحذيرات خفيفة - وزن أكبر

  let heuristicScore = Math.min(heuristicResult.findings * 4, 15)

  // إذا فشل محرك AI، نعتمد أكثر على Pattern + Heuristic
  let score: number
  if (aiResult.confidence === 'none') {
    score = Math.round(patternScore * 0.6 + heuristicScore * 0.4)
  } else {
    score = Math.round(aiScore * 0.45 + patternScore * 0.35 + heuristicScore * 0.2)
  }
  score = Math.min(score, 100)

  let threatLevel: 'clean' | 'low' | 'medium' | 'high' | 'critical'
  let isSuspicious = false
  let summary = ''
  let recommendation = ''

  if (score === 0) {
    threatLevel = 'clean'
    summary = 'الملف نظيف - لم يتم العثور على أنماط خبيثة'
    recommendation = 'الملف آمن. يمكن استخدامه بثقة.'
  } else if (score <= 10) {
    threatLevel = 'clean'
    summary = 'الملف نظيف - أنماط طبيعية غير مؤذية'
    recommendation = 'الملف يحتوي أنماط برمجية شائعة غير خبيثة.'
  } else if (score <= 20) {
    threatLevel = 'low'
    isSuspicious = false // لا يزال نظيف عملياً
    summary = 'الملف نظيف مع ملاحظات طفيفة'
    recommendation = 'الملف آمن. الملاحظات الموجودة قد تكون شرعية في السياق البرمجي.'
  } else if (score <= 35) {
    threatLevel = 'low'
    isSuspicious = true
    summary = 'الملف يحتوي على أنماط تستحق الانتباه'
    recommendation = 'الملف قد يحتوي أنماط مشبوهة. تحقق من السياق قبل التشغيل.'
  } else if (score <= 50) {
    threatLevel = 'medium'
    isSuspicious = true
    summary = 'الملف يحتوي على أنماط مشبوهة متعددة'
    recommendation = 'يُنصح بالحذر. يحتوي على أنماط قد تكون ضارة.'
  } else if (score <= 70) {
    threatLevel = 'high'
    isSuspicious = true
    summary = 'الملف يحتوي على أنماط خبيثة واضحة'
    recommendation = 'لا تشغل هذا الملف! يحتوي على أنماط تشير إلى برمجية ضارة.'
  } else {
    threatLevel = 'critical'
    isSuspicious = true
    summary = 'الملف خبيث جداً - فيروس أو تروجان'
    recommendation = 'حذف الملف فوراً! يحتوي على برمجية ضارة خطيرة.'
  }

  let trojanType: string | undefined
  if (threatTypeArr.includes('reverse_shell')) trojanType = 'Reverse Shell (شيل عكسي)'
  else if (threatTypeArr.includes('rat')) trojanType = 'RAT (Remote Access Trojan)'
  else if (threatTypeArr.includes('ransomware')) trojanType = 'Ransomware (فدية)'
  else if (threatTypeArr.includes('keylogger') && threatTypeArr.includes('screen_capture')) trojanType = 'Advanced Spyware (تجسس متقدم)'
  else if (threatTypeArr.includes('keylogger')) trojanType = 'Keylogger (مسجل لوحة مفاتيح)'
  else if (threatTypeArr.includes('stealer') || (threatTypeArr.includes('discord_webhook') && threatTypeArr.includes('discord_token'))) trojanType = 'Discord Token Stealer (سارق توكنات)'
  else if (threatTypeArr.includes('data_exfil') || threatTypeArr.includes('c2_client')) trojanType = 'Info Stealer (سارق معلومات)'
  else if (threatTypeArr.includes('code_injection') || threatTypeArr.includes('obfuscated_payload')) trojanType = 'Dropper/Injector (حقن كود)'
  else if (dangerCount >= 2) trojanType = capabilities.slice(0, 2).join(' + ')

  let enginesDetected = 0
  if (dangerCount > 0) enginesDetected++
  if (aiResult.threat_assessment === 'high' || aiResult.threat_assessment === 'critical') enginesDetected++
  if (heuristicResult.findings > 0) enginesDetected++

  const confidenceMap: Record<string, string> = { high: 'عالية', medium: 'متوسطة', low: 'منخفضة', none: 'غير متاح' }

  return {
    file_name: fileName,
    file_size: '',
    file_type: fileName.split('.').pop()?.toUpperCase() || 'Unknown',
    md5: '',
    is_suspicious: isSuspicious,
    threat_level: threatLevel,
    threat_type: threatTypeArr,
    ports,
    c2_servers: c2Servers,
    suspicious_patterns: suspiciousPatterns,
    encoded_strings: encodedStrings,
    network_indicators: networkIndicators,
    capabilities,
    summary,
    recommendation,
    trojan_type: trojanType,
    threat_score: score,
    engines: {
      pattern_engine: { findings: suspiciousPatterns.length, threats: patternResult.threats, scan_time: patternResult.scanTime },
      ai_engine: { findings: aiResult.findings, threat_assessment: aiResult.threat_assessment, scan_time: aiResult.scan_time, confidence: confidenceMap[aiResult.confidence] || aiResult.confidence },
      heuristic_engine: { findings: heuristicResult.findings, threats: heuristicResult.threats, scan_time: heuristicResult.scan_time },
    },
    total_engines: 3,
    engines_detected: enginesDetected,
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const fileContent = formData.get('content') as string | null
    const deepScan = formData.get('deep') === 'true'

    let content = ''
    let fileName = 'unknown'

    if (file) {
      if (file.size > 50 * 1024 * 1024) {
        return NextResponse.json({ success: false, error: 'حجم الملف كبير جداً (الحد 50MB)' }, { status: 400 })
      }
      fileName = file.name
      const bytes = await file.arrayBuffer()
      content = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    } else if (fileContent) {
      content = fileContent
      fileName = 'pasted_code.txt'
    } else {
      return NextResponse.json({ success: false, error: 'الرجاء رفع ملف أو لصق كود' }, { status: 400 })
    }

    const [patternResult, aiResult, heuristicResult] = await Promise.all([
      Promise.resolve(patternEngineAnalyze(content, fileName)),
      aiAnalyzeContent(content, fileName, deepScan),
      Promise.resolve(heuristicAnalyzeContent(content, fileName)),
    ])

    const result = combineResults(patternResult, aiResult, heuristicResult, content, fileName)
    result.file_size = file ? `${(file.size / 1024).toFixed(1)} KB` : `${(content.length / 1024).toFixed(1)} KB`

    try {
      const encoder = new TextEncoder()
      const data = encoder.encode(content)
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      result.md5 = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16)
    } catch {
      result.md5 = 'N/A'
    }

    return NextResponse.json({ success: true, result })
  } catch (error: any) {
    console.error('Virus Scan Error:', error)
    return NextResponse.json({ success: false, error: error.message || 'حدث خطأ في التحليل' }, { status: 500 })
  }
}

