
import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'

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
    binary_engine: { findings: number; threats: string[]; scan_time: number; is_binary: boolean; analysis: string }
    heuristic_engine: { findings: number; threats: string[]; scan_time: number }
  }
  total_engines: number
  engines_detected: number
}

// ===== BINARY FILE DETECTION ENGINE =====
function binaryEngineAnalyze(content: string, fileName: string): { findings: number; threats: string[]; scanTime: number; is_binary: boolean; analysis: string; data: any } {
  const startTime = performance.now()
  const threats: string[] = []
  const suspiciousPatterns: { pattern: string; description: string; severity: 'danger' | 'warning' | 'info' }[] = []
  const capabilities: string[] = []
  let isBinary = false
  let binaryScore = 0
  const suspiciousUrls: string[] = []

  // كشف الملفات الثنائية
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const isExe = /\.(exe|dll|scr|sys|drv|msi|bat|cmd|ps1|vbs|wsf|hta|cpl|ocx|ax)$/i.test(fileName)
  const isScript = /\.(py|rb|js|ts|lua|sh|bash|zsh|fish)$/i.test(fileName)
  const isDoc = /\.(doc|docm|xlsm|pptm|xlsb)$/i.test(fileName)

  // كشف رأس PE (Windows Executable)
  const hasMZHeader = content.startsWith('MZ') || content.substring(0, 2) === 'MZ'
  const hasPESignature = content.includes('PE\x00\x00')
  const hasElfHeader = content.substring(0, 4) === '\x7fELF'

  if (hasMZHeader || hasPESignature) {
    isBinary = true
    binaryScore += 20
    threats.push('Binary Executable')
    suspiciousPatterns.push({ pattern: 'PE_HEADER', description: 'ملف تنفيذي Windows (PE/EXE) - لا يمكن تحليل الكود المصدري', severity: 'warning' })
  }

  if (hasElfHeader) {
    isBinary = true
    binaryScore += 20
    threats.push('ELF Binary')
    suspiciousPatterns.push({ pattern: 'ELF_HEADER', description: 'ملف تنفيذي Linux (ELF) - لا يمكن تحليل الكود المصدري', severity: 'warning' })
  }

  // كشف من المحتوى (حتى بدون امتداد)
  const nullByteCount = (content.match(/\x00/g) || []).length
  const totalLen = content.length
  const nullRatio = totalLen > 0 ? nullByteCount / totalLen : 0
  if (nullRatio > 0.05 && !isScript && !isDoc) {
    isBinary = true
    binaryScore += 15
    threats.push('High Null Ratio')
    suspiciousPatterns.push({ pattern: 'NULL_BYTES', description: `ملف ثنائي (${Math.round(nullRatio * 100)}% bytes فارغة) - ليست ملف نصي`, severity: 'warning' })
  }

  // تحليل سلاسل النص في الملفات الثنائية
  if (isBinary) {
    const printableStrings = content.match(/[\x20-\x7E]{6,}/g) || []
    const stringSet = new Set(printableStrings.map(s => s.toLowerCase()))

    // === كشف سلاسل خطيرة في الملفات الثنائية ===

    // سلاسل أوامر النظام
    const cmdStrings = ['cmd.exe', '/c ', '/k ', 'powershell', 'pwsh', 'rundll32', 'regsvr32', 'mshta', 'wscript', 'cscript']
    for (const cs of cmdStrings) {
      if (stringSet.has(cs)) {
        binaryScore += 8
        threats.push('cmd_exec')
        suspiciousPatterns.push({ pattern: cs.toUpperCase(), description: `استدعاء ${cs} - تنفيذ أوامر النظام`, severity: 'danger' })
        capabilities.push('تنفيذ أوامر النظام')
        break
      }
    }

    // سلاسل شبكة (C2)
    const netStrings = ['ws2_32', 'wsock32', 'wininet', 'winhttp', 'urlmon', 'internetopen', 'internetconnect', 'httpopenrequest', 'httpsendrequest', 'wsastartup', 'socket(', 'connect(', 'send(', 'recv(']
    let netCount = 0
    for (const ns of netStrings) {
      if (stringSet.has(ns.toLowerCase())) { netCount++ }
    }
    if (netCount >= 2) {
      binaryScore += 10
      threats.push('network_activity')
      suspiciousPatterns.push({ pattern: 'NET_API', description: `${netCount} واجهات شبكة مكتشفة - قد يتصل بخادم خارجي`, severity: 'danger' })
      capabilities.push('اتصال شبكة')
    }

    // سلاسل تسجيل لوحة المفاتيح
    const keylogStrings = ['getasynckeystate', 'setwindowshookex', 'getforegroundwindow', 'keybd_event', 'getkeynametext', 'sethook', 'wh_keyboard']
    for (const kl of keylogStrings) {
      if (stringSet.has(kl)) {
        binaryScore += 12
        threats.push('keylogger')
        suspiciousPatterns.push({ pattern: kl.toUpperCase(), description: 'Keylogger - تسجيل ضغطات لوحة المفاتيح', severity: 'danger' })
        capabilities.push('تسجيل لوحة المفاتيح')
        break
      }
    }

    // سلاسل لقطات الشاشة
    const screenStrings = ['bitblt', 'getdc', 'createdc', 'gdi32', 'stretchblt', 'createdibsection', 'getdesktopwindow', 'copyfromscreen']
    for (const ss of screenStrings) {
      if (stringSet.has(ss)) {
        binaryScore += 10
        threats.push('screen_capture')
        suspiciousPatterns.push({ pattern: ss.toUpperCase(), description: 'التقاط لقطات شاشة سرية', severity: 'danger' })
        capabilities.push('التقاط لقطات الشاشة')
        break
      }
    }

    // سلاسل الريجستري
    const regStrings = ['regopenkey', 'regsetvalue', 'regcreatekey', 'hkcu\\', 'hklm\\', 'software\\microsoft\\windows\\currentversion\\run']
    for (const rs of regStrings) {
      if (stringSet.has(rs.toLowerCase())) {
        binaryScore += 7
        threats.push('registry')
        suspiciousPatterns.push({ pattern: 'REGISTRY', description: 'تعديل الريجستري - تشغيل تلقائي أو تغيير إعدادات', severity: 'danger' })
        capabilities.push('تعديل الريجستري')
        break
      }
    }

    // كشف تشغيل تلقائي
    const persistStrings = ['currentversion\\run', 'currentversion\\runonce', 'startup', 'shell:startup', 'appdata\\roaming', 'appdata\\local']
    for (const ps of persistStrings) {
      if (stringSet.has(ps.toLowerCase())) {
        binaryScore += 6
        threats.push('persistence')
        suspiciousPatterns.push({ pattern: 'PERSIST', description: 'تشغيل تلقائي عند الإقلاع - استمرار بعد إعادة التشغيل', severity: 'warning' })
        capabilities.push('تشغيل تلقائي')
        break
      }
    }

    // كشف Discord token stealing
    const discordStrings = ['discord', 'discord.com', 'webhook', 'token', 'appdata\\discord']
    let discordCount = 0
    for (const ds of discordStrings) {
      if (stringSet.has(ds.toLowerCase())) discordCount++
    }
    if (discordCount >= 2) {
      binaryScore += 10
      threats.push('discord_stealer')
      suspiciousPatterns.push({ pattern: 'DISCORD', description: `${discordCount} مؤشرات ديسكورد - قد يكون سارق توكنات`, severity: 'danger' })
      capabilities.push('سرقة توكنات ديسكورد')
    }

    // كشف anti-debug / anti-VM
    const antiStrings = ['isdebuggerpresent', 'ntqueryinformationprocess', 'outputdebugstring', 'vmware', 'virtualbox', 'vbox', 'qemu', 'sandboxie']
    for (const as of antiStrings) {
      if (stringSet.has(as.toLowerCase())) {
        binaryScore += 5
        threats.push('anti_analysis')
        suspiciousPatterns.push({ pattern: 'ANTI_ANALYSIS', description: 'تقنيات مقاومة التحليل - كشف تصحيح/افتراضي', severity: 'warning' })
        capabilities.push('مقاومة التحليل')
        break
      }
    }

    // كشف إخفاء العملية
    const hideStrings = ['showwindow', 'sw_hide', 'setwindowpos', 'transparency', 'invisible', 'hidden']
    for (const hs of hideStrings) {
      if (stringSet.has(hs.toLowerCase())) {
        binaryScore += 5
        threats.push('process_hide')
        suspiciousPatterns.push({ pattern: 'HIDE_PROCESS', description: 'إخفاء العملية أو النافذة', severity: 'warning' })
        capabilities.push('إخفاء العملية')
        break
      }
    }

    // كشف بورتات مشبوهة
    const portMatches = content.match(/[\x00-\x7F]{0,20}(?:4444|5555|6666|7777|8888|9999|31337|1337|6667)[\x00-\x7F]{0,10}/g) || []
    const knownBadPorts = [4444, 5555, 6666, 7777, 8888, 9999, 31337, 1337, 6667]
    for (const pm of portMatches) {
      for (const bp of knownBadPorts) {
        if (pm.includes(String(bp))) {
          binaryScore += 5
          threats.push('suspicious_port')
          suspiciousPatterns.push({ pattern: `PORT_${bp}`, description: `بورت ${bp} مشبوه - شائع في أدوات التحكم عن بعد`, severity: 'warning' })
          capabilities.push('اتصال عبر بورت مشبوه')
          break
        }
      }
    }

    // كشف URLs في الملف الثنائي
    const urlMatches = content.match(/https?:\/\/[^\s\x00-\x1F\x80-\xFF]{5,100}/g) || []
    for (const url of urlMatches) {
      if (!url.includes('microsoft.com') && !url.includes('windows.com') && !url.includes('github.com') && url.length > 10) {
        suspiciousUrls.push(url.substring(0, 80))
      }
    }
    if (suspiciousUrls.length > 0) {
      binaryScore += 8
      threats.push('c2_urls')
      suspiciousPatterns.push({ pattern: 'C2_URLS', description: `${suspiciousUrls.length} URLs مشبوهة مكتشفة - قد تكون خوادم C2`, severity: 'danger' })
      capabilities.push('اتصال بخوادم خارجية')
    }

    // كشف crawler/user-agent
    if (stringSet.has('user-agent') || stringSet.has('mozilla')) {
      binaryScore += 3
      suspiciousPatterns.push({ pattern: 'USER_AGENT', description: 'يحتوي على User-Agent - قد يتظاهر كمتصفح', severity: 'info' })
    }
  }

  // تصنيف خطير تلقائي للملفات التنفيذية غير المعروفة
  if (isBinary && isExe) {
    binaryScore = Math.max(binaryScore, 25) // حد أدنى للمخطورة
    if (binaryScore < 40) {
      suspiciousPatterns.push({ pattern: 'UNKNOWN_EXE', description: 'ملف تنفيذي من مصدر غير معروف - لا يمكن التأكد من سلامته بدون AI', severity: 'warning' })
    }
  }

  // تحليل مفصل للإبلاغ
  let analysis = ''
  if (isBinary) {
    analysis = ` هذا ملف تنفيذي ثنائي (.exe/.dll) - تم تحليل السلاسل النصية المضمنة فيه.\n\n`
    analysis += ` عدد السلاسل النصية المكتشفة: ${(content.match(/[\x20-\x7E]{6,}/g) || []).length}\n`
    if (capabilities.length > 0) {
      analysis += `\n القدرات المشبوهة المكتشفة:\n`
      for (const cap of capabilities) {
        analysis += `  - ${cap}\n`
      }
    }
    analysis += `\n ملاحظة: لا يمكن التأكد بنسبة 100% من سلامة ملف ثنائي بدون فحص بـ sandbox.\n`
  }

  const scanTime = Math.round(performance.now() - startTime)
  return {
    findings: suspiciousPatterns.length,
    threats: [...new Set(threats)],
    scanTime,
    is_binary: isBinary,
    analysis,
    data: {
      suspiciousPatterns,
      capabilities: [...new Set(capabilities)],
      binaryScore,
      suspiciousUrls,
    }
  }
}

// ===== PATTERN ENGINE (Source Code) =====
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
          try {
            const binary = atob(match[0])
            // Convert binary string to UTF-8 safely (Edge runtime safe)
            const bytes = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
            decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
          } catch { }
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
  if (hasCmdExec && hasNetwork) { combinations.push({ desc: 'تنفيذ أوامر + اتصال شبكة = شيل عكسي محتمل', category: 'reverse_shell' }); threatTypeSet.add('reverse_shell'); dangerCount++ }
  if (hasCmdExec && hasTokenAccess) { combinations.push({ desc: 'تنفيذ أوامر + سرقة بيانات = stealler محتمل', category: 'stealer' }); threatTypeSet.add('stealer'); dangerCount++ }
  if (hasCmdExec && hasBase64Heavy) { combinations.push({ desc: 'تنفيذ أوامر + تشفير كثيف = حمولة مشفرة', category: 'obfuscated_payload' }); threatTypeSet.add('obfuscated_payload'); dangerCount++ }
  if (hasNetwork && hasObfuscation) { combinations.push({ desc: 'اتصال شبكة + كود مشفر = C2 محتمل', category: 'c2_client' }); threatTypeSet.add('c2_client'); dangerCount++ }
  if (hasTokenAccess && hasNetwork && hasBase64Heavy) { combinations.push({ desc: 'سرقة بيانات + اتصال + تشفير = exfiltration', category: 'data_exfil' }); threatTypeSet.add('data_exfil'); dangerCount++ }

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

  for (const server of c2Servers) networkIndicators.push({ type: 'C2 Server', value: server })
  for (const port of ports) {
    const knownPorts: Record<number, string> = { 4444: 'Metasploit Default', 5555: 'Common RAT', 6666: 'Common Backdoor', 7777: 'Common C2', 8888: 'Common Proxy', 9999: 'Common RAT', 31337: 'Elite/Backdoor', 1337: 'Common RAT', 6667: 'IRC' }
    networkIndicators.push({ type: `Port ${port}`, value: knownPorts[port] || 'Unknown' })
  }

  return {
    findings: suspiciousPatterns.length,
    threats: Array.from(threatTypeSet),
    data: { suspiciousPatterns: suspiciousPatterns.slice(0, 30), capabilities, ports, c2Servers, encodedStrings, networkIndicators, dangerCount, warningCount },
    scanTime: Math.round(performance.now() - startTime),
  }
}

// ===== HEURISTIC ENGINE =====
function heuristicAnalyzeContent(content: string, fileName: string): { findings: number; threats: string[]; scan_time: number } {
  const startTime = performance.now()
  const threats: string[] = []
  const lines = content.split('\n')

  const doubleExtension = /\.(exe|scr|bat|cmd|ps1|js|vbs|wsf)\.(exe|scr|bat|cmd|ps1|js|vbs|wsf|txt|jpg|png|pdf|doc)$/i
  if (doubleExtension.test(fileName)) threats.push('امتداد ملف مزدوج - محاولة إخفاء النوع الحقيقي')

  const longLines = lines.filter(l => l.trim().length > 1000)
  if (longLines.length > 5 && lines.length < 50) threats.push(`${longLines.length} أسطر طويلة جداً في ملف صغير - كود مبهم`)

  const hasAntiDebug = /debugger|isDebuggerPresent|IsDebuggerPresent/.test(content)
  const hasAntiVM = /vmware|virtualbox|vbox|qemu/.test(content.toLowerCase())
  if (hasAntiDebug && hasAntiVM) threats.push('كشف التصحيح + كشف البيئة الافتراضية - سلوك برمجيات خبيثة')

  const dnsExfil = /(?:dns|resolve4|resolve6|lookup)\s*\(/g
  if (dnsExfil.test(content) && /password|token|credential|cookie/i.test(content)) threats.push('نمط تسريب عبر DNS محتمل')
  if (/eval\(/.test(content) && /atob\(|btoa\(|Buffer\.from/.test(content) && /child_process|subprocess|os\.system/.test(content)) threats.push('eval + base64 + تنفيذ أوامر = حقن كود خطير')

  const base64Count = (content.match(/[A-Za-z0-9+/]{30,}={0,2}/g) || []).length
  if (base64Count > 30) threats.push(`عدد كبير جداً من السلاسل المشفرة (${base64Count}) - قد يخفي حمولة كبيرة`)

  const suspiciousFuncNames = content.match(/(?:function|def)\s+(?:___[a-z]{5,}|__[a-z]{10,}__[a-z]{5,})/gi)
  if (suspiciousFuncNames && suspiciousFuncNames.length > 3) threats.push('أسماء دوال مشفرة عمداً - محاولة إخفاء الهدف')

  return { findings: threats.length, threats, scan_time: Math.round(performance.now() - startTime) }
}

// ===== COMBINE RESULTS =====
function combineResults(
  patternResult: ReturnType<typeof patternEngineAnalyze>,
  binaryResult: ReturnType<typeof binaryEngineAnalyze>,
  heuristicResult: ReturnType<typeof heuristicAnalyzeContent>,
  content: string,
  fileName: string
): VirusResult {
  const allThreatTypes = new Set<string>([...patternResult.threats, ...binaryResult.threats])
  const { suspiciousPatterns: patPatterns, capabilities: patCaps, ports, c2Servers, encodedStrings, networkIndicators, dangerCount, warningCount } = patternResult.data
  const binPatterns = binaryResult.data.suspiciousPatterns
  const binCaps = binaryResult.data.capabilities
  const binUrls = binaryResult.data.suspiciousUrls || []

  const allPatterns = [...patPatterns, ...binPatterns]
  const allCapabilities = [...new Set([...patCaps, ...binCaps])]

  // إضافة URLs المشبوهة من المحرك الثنائي
  const allC2Servers = [...c2Servers]
  for (const u of binUrls) {
    if (!allC2Servers.includes(u)) allC2Servers.push(u)
  }

  for (const t of heuristicResult.threats) {
    if (t.includes('eval') || t.includes('حقن')) allThreatTypes.add('Code Injection')
    if (t.includes('DNS') || t.includes('تسريب')) allThreatTypes.add('Data Exfiltration')
    if (t.includes('مزدوج')) allThreatTypes.add('Extension Masquerading')
    if (t.includes('مبهم')) allThreatTypes.add('Obfuscation')
    if (t.includes('anti') || t.includes('كشف')) allThreatTypes.add('Anti-Analysis')
  }

  const threatTypeArr = Array.from(allThreatTypes)
  const binaryScore = binaryResult.data.binaryScore

  let patternScore = 0
  patternScore += Math.min(dangerCount * 10, 35)
  patternScore += Math.min(warningCount * 3, 15)

  let heuristicScore = Math.min(heuristicResult.findings * 4, 15)

  // حساب النتيجة النهائية
  let score: number
  if (binaryResult.is_binary) {
    score = Math.round(binaryScore * 0.55 + patternScore * 0.25 + heuristicScore * 0.20)
  } else {
    score = Math.round(patternScore * 0.55 + heuristicScore * 0.45)
  }
  score = Math.min(score, 100)

  let threatLevel: 'clean' | 'low' | 'medium' | 'high' | 'critical'
  let isSuspicious = false
  let summary = ''
  let recommendation = ''

  if (binaryResult.is_binary && score >= 25) {
    isSuspicious = true
    if (score >= 70) {
      threatLevel = 'critical'
      summary = `ملف تنفيذي خبيث جداً!\n\n${allCapabilities.length > 0 ? 'القدرات المكتشفة: ' + allCapabilities.join(' | ') : ''}\n\nهذا الملف يحتوي على أنماط خطيرة تؤكد أنه برمجية خبيثة.`
      recommendation = `حذف الملف فوراً! لا تشغله أبداً!\n\nلو لست متأكد، افتح تكت في سيرفر TRJ Bot وقول لهم عن هذا الملف وسيتم فحصه بشكل أعمق.`
    } else if (score >= 50) {
      threatLevel = 'high'
      summary = `ملف تنفيذي خطير!\n\n${allCapabilities.length > 0 ? 'القدرات المشبوهة: ' + allCapabilities.join(' | ') : ''}\n\nالملف يحتوي على مؤشرات قوية لبرمجية خبيثة (RAT/Stealer/C2).`
      recommendation = `لا تشغل هذا الملف!\n\nلو لست متأكد، افتح تكت في سيرفر TRJ Bot وقول لهم عن هذا الملف وسيتم فحصه بشكل أعمق.`
    } else if (score >= 35) {
      threatLevel = 'medium'
      summary = `ملف تنفيذي مشبوه\n\n${allCapabilities.length > 0 ? 'المؤشرات: ' + allCapabilities.join(' | ') : 'يحتوي على سلاسل نصية مشبوهة'}\n\nلا يمكن التأكد بنسبة 100% بدون فحص في بيئة معزولة (sandbox).`
      recommendation = `يُنصح بعدم تشغيل هذا الملف.\n\nلو لست متأكد، افتح تكت في سيرفر TRJ Bot وقول لهم عن هذا الملف وسيتم فحصه بشكل أعمق.`
    } else {
      threatLevel = 'low'
      summary = `ملف تنفيذي من مصدر غير معروف\n\nلا يمكن فحص الكود المصدري لانه ملف ثنائي محول (compiled). قد يحتوي على كود خبيث مخفي لا يظهر في السلاسل النصية.`
      recommendation = `تحت الحذر! لا تشغل ملفات تنفيذية من مصادر غير موثوقة.\n\nلو لست متأكد، افتح تكت في سيرفر TRJ Bot وقول لهم عن هذا الملف.`
    }
  } else if (score === 0) {
    threatLevel = 'clean'
    summary = 'الملف نظيف - لم يتم العثور على أنماط خبيثة'
    recommendation = 'الملف آمن. يمكن استخدامه بثقة.'
  } else if (score <= 10) {
    threatLevel = 'clean'
    summary = 'الملف نظيف - أنماط طبيعية غير مؤذية'
    recommendation = 'الملف يحتوي أنماط برمجية شائعة غير خبيثة.'
  } else if (score <= 20) {
    threatLevel = 'low'
    isSuspicious = false
    summary = 'الملف نظيف مع ملاحظات طفيفة'
    recommendation = 'الملف آمن. الملاحظات الموجودة قد تكون شرعية في السياق البرمجي.'
  } else if (score <= 35) {
    threatLevel = 'low'
    isSuspicious = true
    summary = 'الملف يحتوي على أنماط تستحق الانتباه'
    recommendation = 'الملف قد يحتوي على أنماط مشبوهة. تحقق من السياق قبل التشغيل.'
  } else if (score <= 50) {
    threatLevel = 'medium'
    isSuspicious = true
    summary = 'الملف يحتوي على أنماط مشبوهة متعددة'
    recommendation = 'يُنصح بالحذر. يحتوي على أنماط قد تكون ضارة.'
  } else if (score <= 70) {
    threatLevel = 'high'
    isSuspicious = true
    summary = 'الملف يحتوي على أنماط خبيثة واضحة'
    recommendation = 'لا تشغل هذا الملف!'
  } else {
    threatLevel = 'critical'
    isSuspicious = true
    summary = 'الملف خبيث جداً - فيروس أو تروجان'
    recommendation = 'حذف الملف فوراً!'
  }

  // تحديد نوع التلغيمة
  let trojanType: string | undefined
  if (threatTypeArr.includes('reverse_shell')) trojanType = 'Reverse Shell (شيل عكسي)'
  else if (threatTypeArr.includes('rat')) trojanType = 'RAT (Remote Access Trojan)'
  else if (threatTypeArr.includes('ransomware')) trojanType = 'Ransomware (فدية)'
  else if ((threatTypeArr.includes('keylogger') || threatTypeArr.includes('keylogger')) && threatTypeArr.includes('screen_capture')) trojanType = 'Advanced Spyware (تجسس متقدم)'
  else if (threatTypeArr.includes('keylogger')) trojanType = 'Keylogger (مسجل لوحة مفاتيح)'
  else if (threatTypeArr.includes('stealer') || (threatTypeArr.includes('discord_webhook') && threatTypeArr.includes('discord_token')) || threatTypeArr.includes('discord_stealer')) trojanType = 'Discord Token Stealer (سارق توكنات)'
  else if (threatTypeArr.includes('data_exfil') || threatTypeArr.includes('c2_client') || threatTypeArr.includes('c2_urls')) trojanType = 'Info Stealer / RAT (سارق معلومات)'
  else if (threatTypeArr.includes('code_injection') || threatTypeArr.includes('obfuscated_payload')) trojanType = 'Dropper/Injector (حقن كود)'
  else if (threatTypeArr.includes('network_activity') && threatTypeArr.includes('persistence')) trojanType = 'RAT (Remote Access Trojan)'
  else if (binaryResult.is_binary && score >= 25) trojanType = 'Compiled Malware (برمجية خبيثة)'
  else if (dangerCount >= 2) trojanType = allCapabilities.slice(0, 2).join(' + ')

  let enginesDetected = 0
  if (dangerCount > 0 || binaryResult.data.binaryScore > 0) enginesDetected++
  if (binaryResult.findings > 0) enginesDetected++
  if (heuristicResult.findings > 0) enginesDetected++

  return {
    file_name: fileName,
    file_size: '',
    file_type: fileName.split('.').pop()?.toUpperCase() || 'Unknown',
    md5: '',
    is_suspicious: isSuspicious,
    threat_level: threatLevel,
    threat_type: threatTypeArr,
    ports,
    c2_servers: allC2Servers,
    suspicious_patterns: allPatterns.slice(0, 30),
    encoded_strings: encodedStrings,
    network_indicators: networkIndicators,
    capabilities: allCapabilities,
    summary,
    recommendation,
    trojan_type: trojanType,
    threat_score: score,
    engines: {
      pattern_engine: { findings: patPatterns.length, threats: patternResult.threats, scan_time: patternResult.scanTime },
      binary_engine: { findings: binPatterns.length, threats: binaryResult.threats, scan_time: binaryResult.scanTime, is_binary: binaryResult.is_binary, analysis: binaryResult.analysis },
      heuristic_engine: { findings: heuristicResult.findings, threats: heuristicResult.threats, scan_time: heuristicResult.scan_time },
    },
    total_engines: 3,
    engines_detected: enginesDetected,
  }
}

export async function POST(request: NextRequest) {
  const rlIp = getClientIp(request)
  const rl = rateLimit(`${rlIp}:virus-scan`, RATE_LIMITS.medium)
  if (rl.limited) {
    return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429 })
  }

  try {
    // تحقق من Content-Type أولاً لتجنب خطأ 500
    const contentType = request.headers.get('content-type') || ''
    if (!contentType.includes('multipart/form-data') && !contentType.includes('application/x-www-form-urlencoded')) {
      return NextResponse.json({ success: false, error: 'الرجاء رفع ملف أو لصق كود' }, { status: 400 })
    }

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

    const [patternResult, binaryResult, heuristicResult] = await Promise.all([
      Promise.resolve(patternEngineAnalyze(content, fileName)),
      Promise.resolve(binaryEngineAnalyze(content, fileName)),
      Promise.resolve(heuristicAnalyzeContent(content, fileName)),
    ])

    const result = combineResults(patternResult, binaryResult, heuristicResult, content, fileName)
    result.file_size = file ? `${(file.size / 1024).toFixed(1)} KB` : `${(content.length / 1024).toFixed(1)} KB`

    try {
      const encoder = new TextEncoder()
      const data = encoder.encode(content)
      const hashBuffer = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      result.md5 = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16)
    } catch {
      result.md5 = 'N/A'
    }

    return NextResponse.json({ success: true, result })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'حدث خطأ في التحليل'
    console.error('Virus Scan Error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
