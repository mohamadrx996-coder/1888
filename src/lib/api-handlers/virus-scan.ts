import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { sendToWebhook } from '@/lib/webhook'

// ============================================================
// Interfaces
// ============================================================

interface PESection {
  name: string
  virtual_size: number
  virtual_address: number
  raw_offset: number
  raw_size: number
  characteristics: number
  entropy: number
  flags: string[]
  is_suspicious: boolean
  anomalies: string[]
}

interface PEImport {
  dll: string
  functions: string[]
  suspicious_count: number
}

interface PEResource {
  type: string
  name: string
  language: string
  size: number
}

interface PEInfo {
  is_valid_pe: boolean
  machine_type: string
  arch_bits: number
  entry_point: number
  entry_point_rva: number
  image_base: number
  file_size: number
  sections: PESection[]
  imports: PEImport[]
  exports: string[]
  resources: PEResource[]
  detected_packer: string[]
  compile_time: string | null
  subsystem: string
  scan_time: number
  entry_anomalies: string[]
  overlay_detected: boolean
  overlay_size: number
}

interface ObfuscationLayer {
  technique: string
  confidence: number
  evidence: string
  decoded_sample: string
}

interface ObfuscationReport {
  is_obfuscated: boolean
  overall_confidence: number
  layers: number
  techniques: string[]
  layer_details: ObfuscationLayer[]
  encryption_type: string
  encryption_detected: boolean
  decoded_size: number
  original_size: number
}

interface EncryptionDetail {
  type: string
  algorithm: string
  key_size: string
  mode: string
  confidence: number
  evidence: string
  severity: 'low' | 'medium' | 'high' | 'critical'
}

interface DetailedAnalysis {
  file_purpose: string
  capabilities: string[]
  encryption_status: string
  encryption_details: EncryptionDetail[]
  capabilities_summary: string
  risk_level: 'safe' | 'low' | 'medium' | 'high' | 'critical'
  recommendations: string[]
  detected_techniques: string[]
  entropy_analysis: string
  behavioral_indicators: string[]
  network_indicators: string[]
}

interface PatternMatch {
  pattern: string
  type: 'malicious' | 'suspicious' | 'info'
  description: string
  severity: number
  line?: number
  category: string
}

interface VirusResult {
  is_infected: boolean
  score: number
  engines_detected: number
  threat_classification: string
  details: {
    obfuscation: ObfuscationReport
    patterns: PatternMatch[]
    pe_info: PEInfo | null
    detailed_analysis: DetailedAnalysis
    heuristic_score: number
  }
}

// ============================================================
// Edge-Compatible Helpers
// ============================================================

function readU16(view: DataView, off: number): number {
  try { return off + 1 < view.byteLength ? view.getUint16(off, true) : 0 } catch { return 0 }
}

function readU32(view: DataView, off: number): number {
  try { return off + 3 < view.byteLength ? view.getUint32(off, true) : 0 } catch { return 0 }
}

function readU64(view: DataView, off: number): bigint {
  try { return off + 7 < view.byteLength ? view.getBigUint64(off, true) : BigInt(0) } catch { return BigInt(0) }
}

function calcEntropy(data: Uint8Array): number {
  if (!data || data.length === 0) return 0
  const freq = new Float64Array(256)
  for (let i = 0; i < data.length; i++) freq[data[i]]++
  let ent = 0
  for (let i = 0; i < 256; i++) {
    if (freq[i] > 0) {
      const p = freq[i] / data.length
      ent -= p * Math.log2(p)
    }
  }
  return Math.round(ent * 1000) / 1000
}

function entropyLevel(e: number): { level: string; color: string } {
  if (e >= 7.8) return { level: 'شديدة التشفير', color: '🔴' }
  if (e >= 7.0) return { level: 'عالية', color: '🟠' }
  if (e >= 6.0) return { level: 'متوسطة', color: '🟡' }
  if (e >= 5.0) return { level: 'منخفضة', color: '🟢' }
  return { level: 'غير مشفرة', color: '✅' }
}

function readAscii(data: Uint8Array, off: number, max: number): string {
  let s = ''
  for (let i = 0; i < max && off + i < data.length; i++) {
    const b = data[off + i]
    if (b === 0) break
    s += String.fromCharCode(b)
  }
  return s.trim()
}

function rvaToOffset(rva: number, sections: PESection[]): number {
  for (const sec of sections) {
    if (rva >= sec.virtual_address && rva < sec.virtual_address + sec.virtual_size)
      return rva - sec.virtual_address + sec.raw_offset
  }
  return -1
}

function toHex(data: Uint8Array): string {
  let h = ''
  for (let i = 0; i < data.length; i++) h += data[i].toString(16).padStart(2, '0')
  return h
}

function safeSlice(data: Uint8Array, start: number, end: number): Uint8Array {
  const s = Math.max(0, start)
  const e = Math.min(data.length, end)
  if (s >= e || s >= data.length) return new Uint8Array(0)
  return data.slice(s, e)
}

function extractStrings(buf: Uint8Array, minLen: number = 4): string[] {
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i]
    if (b >= 32 && b <= 126) cur += String.fromCharCode(b)
    else {
      if (cur.length >= minLen) out.push(cur)
      cur = ''
    }
  }
  if (cur.length >= minLen) out.push(cur)
  return out
}

function iocCipherDetector(buf: Uint8Array): string[] {
  const ioc: number[] = new Array(256).fill(0)
  const len = buf.length
  if (len < 2) return []
  for (let i = 0; i < len - 1; i++) ioc[buf[i] * 256 + buf[i + 1]]++
  const total = (len - 1) || 1
  let sum = 0
  for (let i = 0; i < 65536; i++) {
    const c = ioc[i] / total
    sum += c * c
  }
  const iocValue = sum * 65536
  const results: string[] = []

  const normalizedIoc = iocValue / 256
  if (normalizedIoc < 1.15) results.push(`بيانات مشفرة (IOC: ${normalizedIoc.toFixed(4)})`)
  else if (normalizedIoc < 1.35) results.push(`ضغط أو تشفير جزئي (IOC: ${normalizedIoc.toFixed(4)})`)
  else if (normalizedIoc > 1.60) results.push(`نص عادي أو بيانات منظمة (IOC: ${normalizedIoc.toFixed(4)})`)

  const freq = new Float64Array(256)
  for (let i = 0; i < len; i++) freq[buf[i]]++
  let chi2 = 0
  const expected = len / 256
  for (let i = 0; i < 256; i++) {
    const diff = freq[i] - expected
    chi2 += (diff * diff) / expected
  }
  if (chi2 < 300) results.push(`توزيع متساوٍ = تشفير قوي (Chi2: ${chi2.toFixed(1)})`)
  else if (chi2 < 500) results.push(`توزيع شبه متساوٍ = تشفير متوسط (Chi2: ${chi2.toFixed(1)})`)
  else results.push(`توزيع غير منتظم = بيانات عادية (Chi2: ${chi2.toFixed(1)})`)

  return results
}

// ============================================================
// Decoders
// ============================================================

function b64Decode(s: string): string { try { return atob(s) } catch { return '' } }
function hexDecode(s: string): string {
  try {
    const c = s.replace(/[^0-9a-fA-F]/g, '')
    if (c.length % 2 !== 0) return ''
    let r = ''
    for (let i = 0; i < c.length; i += 2) r += String.fromCharCode(parseInt(c.substring(i, i + 2), 16))
    return r
  } catch { return '' }
}
function rot13(s: string): string {
  return s.replace(/[a-zA-Z]/g, c => {
    const b = c <= 'Z' ? 65 : 97
    return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b)
  })
}
function xorDecode(data: string, key: number): string {
  try {
    let r = ''
    for (let i = 0; i < data.length; i++) r += String.fromCharCode(data.charCodeAt(i) ^ key)
    if (/^[\x20-\x7E\s]+$/.test(r) && r.length > 5) return r
    return ''
  } catch { return '' }
}
function unicodeDecode(s: string): string {
  try { return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) } catch { return '' }
}
function rc4Decode(data: string, key: string): string {
  try {
    if (!key || key.length === 0) return ''
    const k = Array.from(key).map(c => c.charCodeAt(0))
    const s = Array.from({ length: 256 }, (_, i) => i)
    let j = 0
    for (let i = 0; i < 256; i++) {
      j = (j + s[i] + k[i % k.length]) % 256
      ;[s[i], s[j]] = [s[j], s[i]]
    }
    let out = ''
    let ii = 0; j = 0
    for (let n = 0; n < data.length; n++) {
      ii = (ii + 1) % 256
      j = (j + s[ii]) % 256
      ;[s[ii], s[j]] = [s[j], s[ii]]
      out += String.fromCharCode(data.charCodeAt(n) ^ s[(s[ii] + s[j]) % 256])
    }
    if (/^[\x20-\x7E\s]+$/.test(out) && out.length > 5) return out
    return ''
  } catch { return '' }
}

// ============================================================
// PE Parser (Advanced)
// ============================================================

function parsePE(raw: Uint8Array): PEInfo {
  const t0 = Date.now()
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const pe: PEInfo = {
    is_valid_pe: false, machine_type: 'Unknown', arch_bits: 0, entry_point: 0, entry_point_rva: 0,
    image_base: 0, file_size: raw.length, sections: [], imports: [], exports: [], resources: [],
    detected_packer: [], compile_time: null, subsystem: 'Unknown', scan_time: 0,
    entry_anomalies: [], overlay_detected: false, overlay_size: 0
  }

  if (!raw || raw.length < 64) return pe
  if (raw[0] !== 0x4D || raw[1] !== 0x5A) return pe

  const peOff = readU32(view, 60)
  if (peOff + 4 > raw.length) return pe
  if (raw[peOff] !== 0x50 || raw[peOff + 1] !== 0x45) return pe

  pe.is_valid_pe = true
  const coff = peOff + 4
  if (coff + 20 > raw.length) return pe

  const machine = readU16(view, coff)
  const mTypes: Record<number, string> = {
    0x14C: 'x86 (32-bit)', 0x8664: 'x64 (64-bit)', 0x1C0: 'ARM', 0xAA64: 'ARM64', 0x200: 'IA-64'
  }
  pe.machine_type = mTypes[machine] || `Unknown (0x${machine.toString(16)})`
  pe.arch_bits = machine === 0x8664 || machine === 0xAA64 ? 64 : 32

  const numSections = readU16(view, coff + 2)
  const optSize = readU16(view, coff + 16)
  const opt = coff + 20
  if (opt + 2 > raw.length) return pe

  const is64 = readU16(view, opt) === 0x20B
  const entryRVA = readU32(view, opt + 16)
  pe.entry_point_rva = entryRVA
  if (is64) { pe.image_base = Number(readU64(view, opt + 24)) }
  else { pe.image_base = readU32(view, opt + 28) }
  pe.entry_point = pe.image_base + entryRVA

  const subOff = opt + 68
  if (subOff + 2 <= raw.length) {
    const subs: Record<number, string> = { 1: 'Native', 2: 'Windows GUI', 3: 'Windows Console', 7: 'POSIX', 9: 'WinCE', 10: 'EFI', 14: 'Xbox' }
    pe.subsystem = subs[readU16(view, subOff)] || 'Unknown'
  }

  const ts = readU32(view, coff + 4)
  if (ts > 0) {
    const d = new Date(ts * 1000)
    if (d.getFullYear() >= 1990 && d.getFullYear() <= new Date().getFullYear() + 1)
      pe.compile_time = d.toISOString()
  }

  const ddStart = opt + (is64 ? 112 : 96)
  const ddCount = readU32(view, ddStart - 4)

  let importRVA = 0, exportRVA = 0, resRVA = 0, tlsRVA = 0, relocRVA = 0
  if (ddCount > 0 && ddStart + 8 <= raw.length) exportRVA = readU32(view, ddStart)
  if (ddCount > 1 && ddStart + 16 <= raw.length) importRVA = readU32(view, ddStart + 8)
  if (ddCount > 2 && ddStart + 24 <= raw.length) resRVA = readU32(view, ddStart + 16)
  if (ddCount > 7 && ddStart + 64 <= raw.length) tlsRVA = readU32(view, ddStart + 56)
  if (ddCount > 5 && ddStart + 48 <= raw.length) relocRVA = readU32(view, ddStart + 40)

  const secStart = opt + optSize
  let highestSectionEnd = 0

  for (let i = 0; i < Math.min(numSections, 96); i++) {
    const off = secStart + (i * 40)
    if (off + 40 > raw.length) break
    const name = readAscii(raw, off, 8)
    const vSize = readU32(view, off + 8)
    const vAddr = readU32(view, off + 12)
    const rSize = readU32(view, off + 16)
    const rOff = readU32(view, off + 20)
    const chars = readU32(view, off + 36)
    const entropy = calcEntropy(safeSlice(raw, rOff, rOff + Math.min(rSize, raw.length - rOff)))
    const eInfo = entropyLevel(entropy)
    const flags: string[] = []
    const anomalies: string[] = []
    let suspicious = false

    if (chars & 0x00000020) flags.push('CODE')
    if (chars & 0x00000040) flags.push('DATA')
    if (chars & 0x20000000) flags.push('EXEC')
    if (chars & 0x40000000) flags.push('READ')
    if (chars & 0x80000000) flags.push('WRITE')

    if (entropy > 7.5 && !name.startsWith('.text') && !name.startsWith('.rdata') && !name.startsWith('.reloc')) {
      suspicious = true
      anomalies.push(`إنتروبيا عالية ${eInfo.color} (${entropy.toFixed(2)})`)
    }
    if (vSize > rSize * 3 && rSize > 0) {
      suspicious = true
      anomalies.push('virtual size أكبر بكثير من raw — يشير لتشفير/ضغط')
    }
    if (rSize === 0 && vSize > 0) {
      suspicious = true
      anomalies.push('raw size = 0 مع virtual size > 0')
    }
    if (/\.?UPX/i.test(name) || /\.?vmp/i.test(name) || /\.?enigma/i.test(name) || /\.?themida/i.test(name)) {
      suspicious = true
      anomalies.push('قسم معروف كـ packer')
    }
    if ((chars & 0x20000000) && (chars & 0x80000000) && !name.startsWith('.text')) {
      suspicious = true
      anomalies.push('قسم writable + executable — غير طبيعي')
    }
    if (name.startsWith('.text') && entropy > 6.5) {
      suspicious = true
      anomalies.push('قسم الكود فيه إنتروبيا عالية — على الأرجح مشفّر')
    }

    const secEnd = rOff + rSize
    if (secEnd > highestSectionEnd) highestSectionEnd = secEnd

    pe.sections.push({
      name, virtual_size: vSize, virtual_address: vAddr, raw_offset: rOff,
      raw_size: rSize, characteristics: chars, entropy, flags, is_suspicious: suspicious, anomalies
    })
  }

  // Entry point analysis
  if (entryRVA > 0) {
    const epSec = pe.sections.find(s => entryRVA >= s.virtual_address && entryRVA < s.virtual_address + s.virtual_size)
    if (epSec) {
      const epOff = rvaToOffset(entryRVA, pe.sections)
      if (epOff > 0 && epOff < raw.length) {
        const epBytes = safeSlice(raw, epOff, Math.min(epOff + 32, raw.length))
        const epHex = toHex(epBytes)
        if (epHex.startsWith('60')) pe.entry_anomalies.push('pushad — شائع في packed binaries')
        if (epHex.startsWith('e8') || epHex.startsWith('e9')) pe.entry_anomalies.push('call/jmp مباشر من entry point')
        if (epHex.startsWith('fc68') || epHex.startsWith('68')) pe.entry_anomalies.push('push immediate — قد يكون packer stub')
        if (epHex.startsWith('b8') || epHex.startsWith('bbe8')) pe.entry_anomalies.push('mov eax / pattern entry')
        if (epSec.entropy > 7.0) pe.entry_anomalies.push(`entry في قسم مشفّر (entropy: ${epSec.entropy.toFixed(2)})`)
        if (epSec.is_suspicious) pe.entry_anomalies.push('entry point في قسم مشبوه')
      }
    }
  }

  // Overlay detection
  if (highestSectionEnd > 0 && raw.length > highestSectionEnd) {
    pe.overlay_detected = true
    pe.overlay_size = raw.length - highestSectionEnd
    if (pe.overlay_size > 100000) {
      pe.detected_packer.push(`Overlay كبير (${(pe.overlay_size / 1024).toFixed(0)} KB) — بيانات إضافية مشبوهة`)
    }
  }

  // TLS callback detection (anti-debug)
  if (tlsRVA > 0) {
    const tlsOff = rvaToOffset(tlsRVA, pe.sections)
    if (tlsOff > 0 && tlsOff + 40 <= raw.length) {
      const callbacks = readU32(view, tlsOff + 16)
      if (callbacks > 0) pe.entry_anomalies.push('TLS Callbacks موجودة — قد تُستخدم لـ anti-debug')
    }
  }

  // Parse imports
  const dangerousAPIs = [
    'VirtualAlloc', 'VirtualProtect', 'VirtualFree', 'VirtualQuery',
    'CreateRemoteThread', 'WriteProcessMemory', 'ReadProcessMemory', 'OpenProcess',
    'LoadLibrary', 'LoadLibraryEx', 'GetProcAddress',
    'SetWindowsHookEx', 'SetWindowsHookExA', 'SetWindowsHookExW',
    'GetAsyncKeyState', 'GetKeyState',
    'ShellExecute', 'ShellExecuteA', 'ShellExecuteW', 'ShellExecuteEx',
    'CreateProcess', 'CreateProcessA', 'CreateProcessW', 'CreateProcessAsUser',
    'InternetOpen', 'InternetOpenA', 'InternetOpenUrl', 'InternetOpenUrlA',
    'InternetConnect', 'InternetConnectA', 'HttpSendRequest', 'HttpSendRequestA',
    'URLDownloadToFile', 'URLDownloadToFileA',
    'WinExec', 'WinExec',
    'RegSetValue', 'RegSetValueA', 'RegSetValueEx', 'RegSetValueExA',
    'RegCreateKey', 'RegCreateKeyA', 'RegCreateKeyEx', 'RegCreateKeyExA',
    'RegDeleteKey', 'RegDeleteKeyA', 'RegDeleteValue', 'RegDeleteValueA',
    'NtCreateThread', 'NtCreateThreadEx', 'RtlCreateUserThread',
    'NtUnmapViewOfSection', 'NtMapViewOfSection',
    'DeviceIoControl',
    'CryptEncrypt', 'CryptDecrypt', 'CryptGenKey', 'CryptImportKey',
    'RtlDecompressBuffer',
    'socket', 'connect', 'send', 'recv', 'WSAStartup',
    'SetClipboardData', 'GetClipboardData',
    'BitBlt', 'GetDC', 'GetDesktopWindow',
    'EnumWindows', 'FindWindow', 'FindWindowA',
    'SetErrorMode', 'SetUnhandledExceptionFilter',
  ]

  if (importRVA > 0) {
    const impOff = rvaToOffset(importRVA, pe.sections)
    if (impOff > 0 && impOff < raw.length) {
      for (let i = 0; i < 500; i++) {
        const dOff = impOff + (i * 20)
        if (dOff + 20 > raw.length) break
        const iltRva = readU32(view, dOff)
        const nameRva = readU32(view, dOff + 12)
        if (iltRva === 0 && nameRva === 0) break
        const dllOff = rvaToOffset(nameRva, pe.sections)
        if (dllOff <= 0 || dllOff >= raw.length) continue
        const dllName = readAscii(raw, dllOff, 256)
        if (!dllName) continue
        const funcs: string[] = []
        let suspCount = 0
        const iltOff = rvaToOffset(iltRva, pe.sections)
        if (iltOff > 0) {
          for (let j = 0; j < 200; j++) {
            const fOff = iltOff + (j * (is64 ? 8 : 4))
            if (fOff + (is64 ? 8 : 4) > raw.length) break
            if (is64) {
              const entry = readU64(view, fOff)
              if (entry === BigInt(0)) break
              if (entry & BigInt(1)) { funcs.push(`Ordinal#${Number(entry >> BigInt(32))}`); continue }
              const hOff = rvaToOffset(Number(entry), pe.sections)
              if (hOff > 0 && hOff + 2 < raw.length) {
                const fn = readAscii(raw, hOff + 2, 256)
                if (fn) { funcs.push(fn); if (dangerousAPIs.some(api => fn.toLowerCase() === api.toLowerCase())) suspCount++ }
              }
            } else {
              const entry = readU32(view, fOff)
              if (entry === 0) break
              if (entry & 1) { funcs.push(`Ordinal#${entry >> 16}`); continue }
              const hOff = rvaToOffset(entry, pe.sections)
              if (hOff > 0 && hOff + 2 < raw.length) {
                const fn = readAscii(raw, hOff + 2, 256)
                if (fn) { funcs.push(fn); if (dangerousAPIs.some(api => fn.toLowerCase() === api.toLowerCase())) suspCount++ }
              }
            }
          }
        }
        pe.imports.push({ dll: dllName.toLowerCase(), functions: funcs, suspicious_count: suspCount })
      }
    }
  }

  // Parse exports
  if (exportRVA > 0) {
    const expOff = rvaToOffset(exportRVA, pe.sections)
    if (expOff > 0 && expOff + 40 <= raw.length) {
      const numNames = readU32(view, expOff + 24)
      const namesRva = readU32(view, expOff + 32)
      const namesOff = rvaToOffset(namesRva, pe.sections)
      if (namesOff > 0) {
        for (let i = 0; i < Math.min(numNames, 500); i++) {
          const pOff = namesOff + (i * 4)
          if (pOff + 4 > raw.length) break
          const nRva = readU32(view, pOff)
          const nOff = rvaToOffset(nRva, pe.sections)
          if (nOff > 0 && nOff < raw.length) {
            const n = readAscii(raw, nOff, 256)
            if (n) pe.exports.push(n)
          }
        }
      }
    }
  }

  // Packer detection
  const packers: [string, (p: PEInfo) => boolean][] = [
    ['UPX', p => p.sections.some(s => /^\.?UPX\d?$/i.test(s.name))],
    ['UPX (Modified)', p => p.sections.some(s => /^\.?UPX\d?$/i.test(s.name) && s.entropy > 7.0)],
    ['VMProtect', p => p.sections.some(s => /^\.?vmp\d?$/i.test(s.name))],
    ['Themida/WinLicense', p => p.sections.some(s => s.name.toLowerCase().includes('themida') || s.name.toLowerCase().includes('.tmd'))],
    ['ASPack', p => p.sections.some(s => s.name.toLowerCase().includes('aspack'))],
    ['PECompact', p => p.sections.some(s => /^\.?pec/i.test(s.name))],
    ['MPRESS', p => p.sections.some(s => /^\.?MPRESS/i.test(s.name))],
    ['Enigma Protector', p => p.sections.some(s => s.name.toLowerCase().includes('enigma'))],
    ['NSPack', p => p.sections.some(s => /^\.?nsp/i.test(s.name))],
    ['Code Virtualizer', p => p.sections.some(s => /^\.?cv/i.test(s.name))],
    ['Obsidium', p => p.sections.some(s => s.name.toLowerCase().includes('obsidium'))],
    ['Armadillo', p => p.sections.some(s => s.name.toLowerCase().includes('.adata'))],
    ['SafeNet/ sentinel', p => p.sections.some(s => s.name.toLowerCase().includes('sentinel'))],
  ]
  for (const [name, check] of packers) {
    if (check(pe)) pe.detected_packer.push(name)
  }

  // Custom encryption detection
  const highEntropyNonText = pe.sections.filter(s => s.entropy > 7.5 && !s.name.startsWith('.text') && !s.name.startsWith('.rdata') && !s.name.startsWith('.reloc'))
  if (highEntropyNonText.length > 0 && pe.detected_packer.length === 0)
    pe.detected_packer.push('تشفير/ضغط مخصص (custom)')

  // Resources
  if (resRVA > 0) {
    const rOff = rvaToOffset(resRVA, pe.sections)
    if (rOff > 0 && rOff < raw.length) {
      const rTypes: Record<number, string> = { 1: 'Cursor', 2: 'Bitmap', 3: 'Icon', 5: 'Dialog', 6: 'String Table', 16: 'Version Info', 24: 'Manifest' }
      try {
        const numT = readU16(view, rOff + 12) + readU16(view, rOff + 14)
        for (let i = 0; i < Math.min(numT, 32); i++) {
          const eOff = rOff + 16 + (i * 8)
          if (eOff + 8 > raw.length) break
          const tid = readU32(view, eOff)
          const tStr = rTypes[tid] || `Type#${tid}`
          if (!pe.resources.some(r => r.type === tStr))
            pe.resources.push({ type: tStr, name: 'Embedded', language: 'Neutral', size: 0 })
        }
      } catch { /* skip */ }
    }
  }

  pe.scan_time = Date.now() - t0
  return pe
}

// ============================================================
// Encryption Analysis Engine
// ============================================================

function detectEncryptionTypes(buf: Uint8Array, content: string, obfuscation: ObfuscationReport, peInfo: PEInfo | null): EncryptionDetail[] {
  const details: EncryptionDetail[] = []

  // 1. Entropy-based detection
  const totalEntropy = calcEntropy(buf)
  const eInfo = entropyLevel(totalEntropy)
  if (totalEntropy > 7.0) {
    let algo = 'غير معروف'
    let conf = 50
    let ev = `إنتروبيا عامة ${eInfo.level} (${totalEntropy.toFixed(3)})`

    if (peInfo) {
      const highSec = peInfo.sections.filter(s => s.entropy > 7.5)
      if (highSec.length > 0) {
        ev += ` — ${highSec.length} أقسام مشفرة: ${highSec.map(s => s.name).join(', ')}`
        conf = 75
        if (highSec.some(s => /^\.?UPX/i.test(s.name))) { algo = 'LZMA / NRV (UPX)'; conf = 90 }
        else if (highSec.some(s => /^\.?vmp/i.test(s.name))) { algo = 'VMProtect Virtualization'; conf = 95 }
        else if (highSec.some(s => s.name.toLowerCase().includes('themida'))) { algo = 'Themida Code Encryption'; conf = 95 }
        else if (highSec.every(s => s.name === '.text' || s.name.startsWith('.text'))) { algo = 'Code Section Encryption'; conf = 70 }
        else if (highSec.length === 1) { algo = 'Single Section Encryption'; conf = 60 }
        else { algo = 'Multi-Section Encryption'; conf = 75 }
      }
    }
    details.push({ type: 'تشفير كامل', algorithm: algo, key_size: 'غير معروف', mode: 'CBC/CTR (تخمين)', confidence: conf, evidence: ev, severity: conf > 80 ? 'critical' : 'high' })
  } else if (totalEntropy > 6.0) {
    details.push({ type: 'ضغط/تشفير جزئي', algorithm: 'ZIP/LZMA/XZ', key_size: '-', mode: 'Stream', confidence: 40, evidence: `إنتروبيا ${totalEntropy.toFixed(3)} — ضغط أو تشفير خفيف`, severity: 'low' })
  }

  // 2. Base64 layers
  const b64Matches = content.match(/["'`]([A-Za-z0-9+/]{40,}={0,2})["'`]/g)
  if (b64Matches) {
    const decoded = b64Decode(b64Matches[0].replace(/["'`]/g, ''))
    if (decoded.length > 10 && /[\x20-\x7E]{10,}/.test(decoded)) {
      details.push({ type: 'ترميز', algorithm: 'Base64', key_size: '-', mode: 'Encoding', confidence: 85, evidence: `وجد ${b64Matches.length} سلسلة Base64، عينة: "${decoded.substring(0, 50)}..."`, severity: 'medium' })
    }
  }

  // 3. Hex encoding
  const hexMatches = content.match(/["'`](?:0x)?([0-9a-fA-F]{60,})["'`]/g)
  if (hexMatches) {
    const decoded = hexDecode(hexMatches[0].replace(/["'`0x]/g, ''))
    if (decoded.length > 10 && /[\x20-\x7E]{10,}/.test(decoded)) {
      details.push({ type: 'ترميز', algorithm: 'Hex Encoding', key_size: '-', mode: 'Encoding', confidence: 80, evidence: `وجد ${hexMatches.length} سلسلة Hex مشفرة`, severity: 'medium' })
    }
  }

  // 4. XOR detection
  for (let key = 1; key <= 10; key++) {
    const dec = xorDecode(content.substring(0, 500), key)
    if (dec && dec.length > 20) {
      details.push({ type: 'تشفير', algorithm: `XOR (key: ${key})`, key_size: '8-bit (1 byte)', mode: 'Stream Cipher', confidence: 70, evidence: `فك تشفير بنجاح باستخدام XOR key=${key}: "${dec.substring(0, 60)}..."`, severity: 'high' })
      break
    }
  }

  // 5. RC4 detection
  const rc4Keys = ['secret', 'key', 'password', 'token', 'discord', 'bot', 'trj', 'malware']
  for (const key of rc4Keys) {
    const dec = rc4Decode(content.substring(0, 500), key)
    if (dec && dec.length > 20) {
      details.push({ type: 'تشفير', algorithm: 'RC4', key_size: `${key.length * 8}-bit`, mode: 'Stream Cipher', confidence: 65, evidence: `فك تشفير RC4 بالمفتاح "${key}": "${dec.substring(0, 50)}..."`, severity: 'high' })
      break
    }
  }

  // 6. ROT13
  if (/[a-zA-Z]{20,}/.test(content) && !/\b(eval|function|return|const|let|var)\b/.test(content.substring(0, 200))) {
    const dec = rot13(content.substring(0, 200))
    if (/\b(function|eval|alert|document|window)\b/i.test(dec)) {
      details.push({ type: 'ترميز', algorithm: 'ROT13', key_size: '-', mode: 'Substitution Cipher', confidence: 60, evidence: `ROT13 ينتج نص قابل للقراءة: "${dec.substring(0, 60)}..."`, severity: 'low' })
    }
  }

  // 7. Unicode escapes
  if (/\\u[0-9a-fA-F]{4}/.test(content)) {
    const count = (content.match(/\\u[0-9a-fA-F]{4}/g) || []).length
    const dec = unicodeDecode(content.substring(0, 200))
    if (dec !== content.substring(0, 200) && dec.length > 10) {
      details.push({ type: 'ترميز', algorithm: 'Unicode Escape Sequences', key_size: '-', mode: 'Encoding', confidence: 90, evidence: `${count} تسلسل Unicode مكتشف`, severity: 'medium' })
    }
  }

  // 8. Known crypto patterns in binary
  if (peInfo) {
    const strings = extractStrings(buf, 6)
    const cryptoLibs = strings.filter(s => /bcrypt|pbkdf|scrypt|argon|aes|des|rsa|blowfish|twofish|chacha|salsa|poly1305/i.test(s))
    if (cryptoLibs.length > 0) {
      details.push({ type: 'تشفير', algorithm: 'مكتبة تشفير مكتشفة', key_size: 'متغير', mode: 'متعدد', confidence: 75, evidence: `وجد مكتبات/دوال تشفير: ${cryptoLibs.slice(0, 5).join(', ')}`, severity: 'medium' })
    }
  }

  // 9. IOC cipher test
  if (peInfo && peInfo.is_valid_pe) {
    const codeSec = peInfo.sections.find(s => s.name === '.text')
    if (codeSec && codeSec.raw_size > 100) {
      const codeBytes = safeSlice(buf, codeSec.raw_offset, codeSec.raw_offset + Math.min(codeSec.raw_size, buf.length - codeSec.raw_offset))
      const iocResults = iocCipherDetector(codeBytes)
      if (iocResults.some(r => r.includes('مشفرة') || r.includes('تشفير'))) {
        details.push({ type: 'تحليل إحصائي', algorithm: 'Index of Coincidence', key_size: '-', mode: 'Statistical', confidence: 60, evidence: iocResults.join(' | '), severity: 'medium' })
      }
    }
  }

  // 10. Multi-layer obfuscation
  if (obfuscation.layers >= 2) {
    details.push({ type: 'تشفير متعدد الطبقات', algorithm: `${obfuscation.layers} طبقات تشفير/ترميز`, key_size: 'متغير لكل طبقة', mode: 'Multi-layer', confidence: obfuscation.overall_confidence, evidence: `الطبقات: ${obfuscation.techniques.join(' → ')}`, severity: obfuscation.layers >= 4 ? 'critical' : 'high' })
  }

  return details.sort((a, b) => b.confidence - a.confidence)
}

// ============================================================
// Advanced Obfuscation Detection
// ============================================================

function detectObfuscation(content: string): ObfuscationReport {
  const report: ObfuscationReport = {
    is_obfuscated: false, overall_confidence: 0, layers: 0,
    techniques: [], layer_details: [], encryption_type: 'none',
    encryption_detected: false, decoded_size: 0, original_size: content.length
  }

  let current = content
  let layerCount = 0
  const maxLayers = 10

  for (let i = 0; i < maxLayers; i++) {
    let decoded = ''
    let found = false
    let technique = ''
    let evidence = ''
    const prev = current

    // Try Base64
    const b64Match = current.match(/(?:["'`])([A-Za-z0-9+/]{20,}={0,2})(?:["'`])/)
    if (b64Match) {
      decoded = b64Decode(b64Match[1])
      if (decoded && decoded.length > 10 && /[\x20-\x7E]{10,}/.test(decoded)) {
        current = decoded; layerCount++; technique = 'Base64'
        evidence = `سلسلة ${b64Match[1].length} حرف تم فكها → "${decoded.substring(0, 40)}..."`
        found = true
      }
    }

    // Try Hex
    if (!found) {
      const hexMatch = current.match(/(?:["'`])([0-9a-fA-F]{40,})(?:["'`])/)
      if (hexMatch) {
        decoded = hexDecode(hexMatch[1])
        if (decoded && decoded.length > 10 && /[\x20-\x7E]{10,}/.test(decoded)) {
          current = decoded; layerCount++; technique = 'Hex Encoding'
          evidence = `سلسلة Hex ${hexMatch[1].length} حرف تم فكها → "${decoded.substring(0, 40)}..."`
          found = true
        }
      }
    }

    // Try Unicode
    if (!found && /\\u[0-9a-fA-F]{4}/.test(current)) {
      decoded = unicodeDecode(current)
      if (decoded !== current && decoded.length > 10) {
        current = decoded; layerCount++; technique = 'Unicode Escapes'
        evidence = `Unicode escape sequences تم فكها`
        found = true
      }
    }

    // Try ROT13
    if (!found && /^[a-zA-Z\s]{20,}$/.test(current.substring(0, 100))) {
      decoded = rot13(current)
      if (/\b(function|eval|const|let|var|return|document|window|require)\b/.test(decoded)) {
        current = decoded; layerCount++; technique = 'ROT13'
        evidence = `ROT13 فك بنجاح → كود قابل للقراءة`
        found = true
      }
    }

    // Try XOR
    if (!found) {
      for (let key = 1; key <= 255; key++) {
        decoded = xorDecode(current, key)
        if (decoded && decoded.length > 20) {
          current = decoded; layerCount++; technique = `XOR (key: ${key})`
          evidence = `XOR key=${key} → "${decoded.substring(0, 50)}..."`
          found = true; break
        }
      }
    }

    // Try RC4 with common keys
    if (!found) {
      const commonKeys = ['key', 'secret', 'password', '1234', 'abcd', 'decode', 'encrypt']
      for (const key of commonKeys) {
        decoded = rc4Decode(current, key)
        if (decoded && decoded.length > 20) {
          current = decoded; layerCount++; technique = `RC4 (key: "${key}")`
          evidence = `RC4 decryption ناجح → "${decoded.substring(0, 50)}..."`
          found = true; break
        }
      }
    }

    if (found) {
      report.encryption_detected = true
      if (!report.techniques.includes(technique)) {
        report.techniques.push(technique)
        report.layer_details.push({ technique, confidence: 75, evidence, decoded_sample: decoded.substring(0, 100) })
      }
      if (current === prev) break
    } else {
      break
    }
  }

  // Check for dynamic execution patterns
  if (/\beval\s*\(/.test(current)) {
    report.techniques.push('eval() تنفيذ ديناميكي')
    report.encryption_detected = true
  }
  if (/\bFunction\s*\(/.test(current) && /\beval\b/.test(current)) {
    report.techniques.push('Function Constructor')
    report.encryption_detected = true
  }
  if (/\batob\s*\(/.test(current)) {
    report.techniques.push('atob() Base64 Runtime')
  }
  if (/\bString\.fromCharCode\s*\(/.test(current)) {
    report.techniques.push('fromCharCode إخفاء نصوص')
    report.encryption_detected = true
  }
  if (/\bbtoa\s*\(/.test(current) && /\beval\b/.test(current)) {
    report.techniques.push('btoa+eval encoding loop')
  }
  if (/\\x[0-9a-fA-F]{2}/.test(current)) {
    const count = (current.match(/\\x[0-9a-fA-F]{2}/g) || []).length
    if (count > 10) {
      report.techniques.push('Hex Escapes في النص')
    }
  }
  if (/\[\s*\w+\s*\|\s*\w+\s*\]/.test(current)) {
    report.techniques.push('Bitwise Operations لإخفاء البيانات')
  }

  // Determine encryption type
  if (report.techniques.some(t => t.includes('XOR'))) report.encryption_type = 'XOR Cipher'
  else if (report.techniques.some(t => t.includes('RC4'))) report.encryption_type = 'RC4 Stream Cipher'
  else if (report.techniques.some(t => t.includes('Base64'))) report.encryption_type = 'Base64 Encoding'
  else if (report.techniques.some(t => t.includes('Unicode'))) report.encryption_type = 'Unicode Obfuscation'
  else if (report.techniques.some(t => t.includes('ROT13'))) report.encryption_type = 'ROT13 Substitution'
  else if (report.techniques.length > 0) report.encryption_type = 'مختلط (Multi-technique)'
  else report.encryption_type = 'none'

  report.layers = layerCount
  report.decoded_size = current.length
  report.is_obfuscated = report.techniques.length > 0
  report.overall_confidence = Math.min(Math.round((report.techniques.length * 12) + (layerCount * 8) + (report.encryption_detected ? 15 : 0)), 100)

  return report
}

// ============================================================
// Binary String Engine
// ============================================================

function binaryStringEngine(buf: Uint8Array): PatternMatch[] {
  const matches: PatternMatch[] = []
  const strings = extractStrings(buf, 5)

  const pats: { re: RegExp; desc: string; sev: number; cat: string }[] = [
    { re: /powershell/i, desc: 'PowerShell command execution', sev: 8, cat: 'execution' },
    { re: /cmd\.exe|cmd \/c/i, desc: 'CMD shell execution', sev: 7, cat: 'execution' },
    { re: /reg(?:istry|edit|svr32|add)/i, desc: 'Registry manipulation', sev: 7, cat: 'persistence' },
    { re: /svchost\.exe/i, desc: 'Process masquerading (svchost)', sev: 8, cat: 'evasion' },
    { re: /temp[\\/]|%temp%|appdata/i, desc: 'Temp/AppData directory usage', sev: 5, cat: 'filesystem' },
    { re: /http[s]?:\/\/.*?\.(?:tk|ml|ga|cf|gq|pw|top|buzz|xyz)/i, desc: 'Suspicious TLD domain', sev: 8, cat: 'network' },
    { re: /\/c\s+(?:curl|wget|Invoke-WebRequest)/i, desc: 'Remote download via CLI', sev: 9, cat: 'download' },
    { re: /taskkill|wmic\s+process/i, desc: 'Process manipulation', sev: 7, cat: 'execution' },
    { re: /bypass.*AMSI|AMSI.*bypass/i, desc: 'AMSI bypass attempt', sev: 10, cat: 'evasion' },
    { re: /Set-MpPreference|Disable-Windows/i, desc: 'Antivirus tampering', sev: 10, cat: 'evasion' },
    { re: /iex\b|invoke-expression|Start-Process/i, desc: 'Dynamic code execution', sev: 8, cat: 'execution' },
    { re: /DownloadString|DownloadFile|WebClient/i, desc: 'Network download capability', sev: 7, cat: 'download' },
    { re: /key(?:board|log|stroke)/i, desc: 'Keylogger functionality', sev: 9, cat: 'credential' },
    { re: /screen(?:capture|shot|grab|spy)/i, desc: 'Screen capture capability', sev: 9, cat: 'surveillance' },
    { re: /bitcoin|wallet|crypto|mining/i, desc: 'Cryptocurrency mining', sev: 7, cat: 'financial' },
    { re: /discord(?:\.gg|app|api|webhook)/i, desc: 'Discord API/webhook usage', sev: 5, cat: 'network' },
    { re: /inject|hook|dll.*inject|loadlibrary/i, desc: 'Code injection', sev: 9, cat: 'injection' },
    { re: /reverse.*shell|backdoor/i, desc: 'Backdoor/remote shell', sev: 10, cat: 'remote' },
    { re: /credential|password.*steal/i, desc: 'Credential harvesting', sev: 8, cat: 'credential' },
    { re: /chrome|firefox|browser.*data|cookie.*steal/i, desc: 'Browser data theft', sev: 8, cat: 'credential' },
    { re: /nc\.exe|netcat|ncat/i, desc: 'Netcat reverse shell tool', sev: 10, cat: 'remote' },
    { re: /certutil/i, desc: 'Certutil download/decode abuse', sev: 9, cat: 'download' },
    { re: /mshta|hta/i, desc: 'HTA script execution', sev: 8, cat: 'execution' },
    { re: /wscript|cscript/i, desc: 'Windows Script Host execution', sev: 7, cat: 'execution' },
    { re: /schtasks/i, desc: 'Scheduled task creation', sev: 7, cat: 'persistence' },
    { re: /net\s+user|net\s+localgroup/i, desc: 'User account manipulation', sev: 8, cat: 'privilege' },
  ]

  for (const str of strings) {
    for (const { re, desc, sev, cat } of pats) {
      if (re.test(str) && !matches.some(m => m.description === desc))
        matches.push({ pattern: str.substring(0, 100), type: sev >= 8 ? 'malicious' : sev >= 6 ? 'suspicious' : 'info', description: desc, severity: sev, category: cat })
    }
  }
  return matches.sort((a, b) => b.severity - a.severity)
}

// ============================================================
// Source Code Pattern Engine
// ============================================================

function patternEngineAnalyze(content: string): PatternMatch[] {
  const matches: PatternMatch[] = []
  const pats: { re: RegExp; desc: string; sev: number; cat: string }[] = [
    { re: /\beval\s*\(/, desc: 'eval() تنفيذ كود ديناميكي', sev: 8, cat: 'execution' },
    { re: /\bexec\s*\(/, desc: 'exec() تنفيذ أمر نظام', sev: 9, cat: 'execution' },
    { re: /\bchild_process\b/, desc: 'child_process — تنفيذ أوامر', sev: 7, cat: 'execution' },
    { re: /\bkeylog|key[\s_]*(?:stroke|capture|record|hook)/i, desc: 'Keylogger', sev: 10, cat: 'credential' },
    { re: /\bscreen[\s_]*(?:capture|shot|grab)/i, desc: 'التقاط شاشة', sev: 9, cat: 'surveillance' },
    { re: /\bwebcam|camera[\s_]*(?:capture|access)/i, desc: 'الوصول للكاميرا', sev: 10, cat: 'surveillance' },
    { re: /\bpassword|credential.*(?:steal|grab|harvest)/i, desc: 'سرقة بيانات دخول', sev: 9, cat: 'credential' },
    { re: /\btoken[\s_]*(?:steal|grab|harvest)/i, desc: 'سرقة توكنات', sev: 9, cat: 'credential' },
    { re: /\bcookie[\s_]*(?:steal|grab)/i, desc: 'سرقة كوكيز', sev: 8, cat: 'credential' },
    { re: /\bchrome|firefox.*(?:pass|cookie|login)/i, desc: 'سرقة بيانات متصفح', sev: 8, cat: 'credential' },
    { re: /\bAMSI|anti[\s_-]*malware.*bypass/i, desc: 'AMSI bypass', sev: 10, cat: 'evasion' },
    { re: /\breverse[\s_-]*shell|back[\s_-]*door/i, desc: 'Backdoor / Remote Shell', sev: 10, cat: 'remote' },
    { re: /\bRAT[\s_-]|remote[\s_-]*access/i, desc: 'Remote Access Trojan', sev: 10, cat: 'remote' },
    { re: /\bdll[\s_-]*(?:inject|load)/i, desc: 'DLL Injection', sev: 9, cat: 'injection' },
    { re: /\bhook[\s_-]*(?:api|keyboard|function)/i, desc: 'API Hooking', sev: 8, cat: 'evasion' },
    { re: /\bshellcode|payload.*(?:exec|inject)/i, desc: 'Shellcode / Payload Execution', sev: 10, cat: 'injection' },
    { re: /\bbitcoin|crypto.*(?:mine|steal)|mining/i, desc: 'تعدين/سرقة عملات', sev: 9, cat: 'financial' },
    { re: /\bprocess\.env\b/, desc: 'الوصول لمتغيرات البيئة', sev: 4, cat: 'info' },
    { re: /\bdocument\.cookie\b/, desc: 'الوصول للكوكيز', sev: 6, cat: 'credential' },
    { re: /\blocalStorage\b|\bsessionStorage\b/, desc: 'الوصول لتخزين المتصفح', sev: 4, cat: 'info' },
    { re: /\bfetch\s*\(/, desc: 'HTTP Request', sev: 3, cat: 'network' },
    { re: /\bXMLHttpRequest\b/, desc: 'XHR Request', sev: 3, cat: 'network' },
    { re: /\bWebSocket\b/, desc: 'WebSocket connection', sev: 5, cat: 'network' },
    { re: /\bnew\s+Function\s*\(/, desc: 'Function Constructor — code execution', sev: 8, cat: 'execution' },
    { re: /\batob\s*\(/, desc: 'Base64 decode at runtime', sev: 5, cat: 'obfuscation' },
    { re: /\bbtoa\s*\(/, desc: 'Base64 encode at runtime', sev: 3, cat: 'obfuscation' },
    { re: /\bString\.fromCharCode\s*\(/, desc: 'fromCharCode — hidden strings', sev: 6, cat: 'obfuscation' },
    { re: /\\u[0-9a-fA-F]{4}/, desc: 'Unicode escape sequences', sev: 5, cat: 'obfuscation' },
    { re: /\\x[0-9a-fA-F]{2}/, desc: 'Hex escape sequences', sev: 4, cat: 'obfuscation' },
    { re: /\bsetTimeout\s*\(\s*["'`]/, desc: 'setTimeout with string — potential eval', sev: 6, cat: 'execution' },
    { re: /\bsetInterval\s*\(\s*["'`]/, desc: 'setInterval with string — potential eval', sev: 6, cat: 'execution' },
    { re: /\bfs\b.*\breadFile|readFileSync|writeFile|writeFileSync\b/, desc: 'File system operations', sev: 5, cat: 'filesystem' },
    { re: /\bos\b.*\bexec|spawn|execSync|spawnSync\b/, desc: 'OS command execution', sev: 9, cat: 'execution' },
    { re: /\brequire\s*\(\s*["'`]child_process["'`]\)/, desc: 'Requiring child_process', sev: 8, cat: 'execution' },
    { re: /\bnet\b.*\bconnect|createServer|listen\b/, desc: 'Network socket creation', sev: 5, cat: 'network' },
    { re: /\bhttp[s]?\b.*\brequest\b/, desc: 'HTTP request module', sev: 4, cat: 'network' },
    { re: /\bdiscord\.(js|py)|discord\.Client\b/i, desc: 'Discord library usage', sev: 3, cat: 'info' },
    { re: /\bwebhook\b.*\b(?:send|execute|fetch)\b/i, desc: 'Webhook execution', sev: 6, cat: 'network' },
    { re: /\bBuffer\b.*\bfrom\b/, desc: 'Buffer construction', sev: 4, cat: 'info' },
    { re: /\bprocess\b.*\b(?:exit|kill|pid|mainModule)\b/, desc: 'Process manipulation', sev: 6, cat: 'execution' },
    { re: /\bglobal\b|\bglobalThis\b/, desc: 'Global object access', sev: 4, cat: 'info' },
    { re: /\bReflect\b.*\bapply|construct\b/, desc: 'Reflect API — indirect execution', sev: 7, cat: 'execution' },
    { re: /\bProxy\b\s*\(/, desc: 'Proxy — behavior interception', sev: 5, cat: 'evasion' },
  ]

  const lines = content.split('\n')
  for (const { re, desc, sev, cat } of pats) {
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i]) && !matches.some(m => m.description === desc))
        matches.push({ pattern: lines[i].trim().substring(0, 100), type: sev >= 8 ? 'malicious' : sev >= 6 ? 'suspicious' : 'info', description: desc, severity: sev, line: i + 1, category: cat })
    }
  }
  return matches.sort((a, b) => b.severity - a.severity)
}

// ============================================================
// Heuristic Scoring Engine
// ============================================================

function heuristicScoreEngine(content: string, buf: Uint8Array, obfuscation: ObfuscationReport, peInfo: PEInfo | null): number {
  let score = 0

  // Obfuscation scoring
  if (obfuscation.is_obfuscated) score += obfuscation.overall_confidence * 0.3
  if (obfuscation.layers >= 3) score += 20
  else if (obfuscation.layers >= 2) score += 10
  if (obfuscation.encryption_detected) score += 15

  // Content-based scoring
  if (/\beval\s*\(/.test(content)) score += 12
  if (/\bexec\s*\(/.test(content)) score += 15
  if (/\bchild_process\b/.test(content)) score += 10
  if (/\bFunction\s*\(/.test(content) && /\beval\b/.test(content)) score += 15
  if (/reverse[\s_-]*shell|back[\s_-]*door/i.test(content)) score += 25
  if (/keylog|key[\s_-]*(?:stroke|capture|record|hook)/i.test(content)) score += 20
  if (/screen[\s_-]*(?:capture|shot|grab)/i.test(content)) score += 18
  if (/webcam|camera[\s_-]*(?:capture|access)/i.test(content)) score += 20
  if (/credential|password.*(?:steal|grab|harvest)/i.test(content)) score += 18
  if (/token[\s_-]*(?:steal|grab|harvest)/i.test(content)) score += 15
  if (/cookie[\s_-]*(?:steal|grab)/i.test(content)) score += 12
  if (/chrome|firefox.*(?:pass|cookie|login)/i.test(content)) score += 12
  if (/AMSI|anti[\s_-]*malware.*bypass/i.test(content)) score += 20
  if (/dll[\s_-]*(?:inject|load)/i.test(content)) score += 15
  if (/shellcode|payload.*(?:exec|inject)/i.test(content)) score += 20
  if (/bitcoin|crypto.*(?:mine|steal)|mining/i.test(content)) score += 12
  if (/bypass.*AMSI|AMSI.*bypass/i.test(content)) score += 20
  if (/Set-MpPreference|Disable-Windows/i.test(content)) score += 20
  if (/svchost\.exe/i.test(content)) score += 15
  if (/powershell/i.test(content)) score += 8
  if (/certutil/i.test(content)) score += 12
  if (/mshta|hta/i.test(content)) score += 10
  if (/wscript|cscript/i.test(content)) score += 8
  if (/schtasks/i.test(content)) score += 8

  // Binary scoring
  if (peInfo) {
    if (peInfo.is_valid_pe) {
      const highEnt = peInfo.sections.filter(s => s.entropy > 7.5)
      score += highEnt.length * 5
      if (peInfo.detected_packer.length > 0) score += peInfo.detected_packer.length * 8
      if (peInfo.overlay_detected && peInfo.overlay_size > 50000) score += 10
      if (peInfo.entry_anomalies.length > 0) score += peInfo.entry_anomalies.length * 5
      const suspImports = peInfo.imports.filter(i => i.suspicious_count > 0)
      score += suspImports.length * 3
      score += suspImports.reduce((sum, i) => sum + i.suspicious_count * 2, 0)
      const writableExec = peInfo.sections.filter(s => (s.characteristics & 0x20000000) && (s.characteristics & 0x80000000))
      if (writableExec.length > 0) score += 12
      if (peInfo.sections.some(s => s.name === '.text' && s.entropy > 7.0)) score += 15
    }
    const totalEnt = calcEntropy(buf)
    if (totalEnt > 7.5) score += 15
    else if (totalEnt > 7.0) score += 10
    else if (totalEnt > 6.5) score += 5
  }

  return Math.min(Math.round(score), 100)
}

// ============================================================
// Detailed Analysis Builder
// ============================================================

function buildDetailedAnalysis(content: string, raw: Uint8Array, patterns: PatternMatch[], obfuscation: ObfuscationReport, peInfo: PEInfo | null, heuristicScore: number): DetailedAnalysis {
  const capabilities: string[] = []
  const detectedTechniques: string[] = []
  const behavioralIndicators: string[] = []
  const networkIndicators: string[] = []

  // Capabilities from patterns
  const capabilityMap: Record<string, string[]> = {
    execution: ['Command Execution', 'Process Manipulation', 'Code Execution'],
    credential: ['Credential Harvesting', 'Data Exfiltration', 'Identity Theft'],
    evasion: ['Anti-Analysis', 'Security Bypass', 'Stealth'],
    injection: ['Code Injection', 'Memory Manipulation', 'Process Hijacking'],
    remote: ['Remote Access', 'Backdoor', 'C2 Communication'],
    surveillance: ['Screen Capture', 'Keylogging', 'Spying'],
    download: ['Remote Payload Download', 'Dropper Capability'],
    persistence: ['Persistence Mechanism', 'Auto-Start'],
    privilege: ['Privilege Escalation', 'User Account Manipulation'],
    financial: ['Cryptocurrency Mining', 'Financial Theft'],
    filesystem: ['File System Access'],
    network: ['Network Communication'],
    obfuscation: ['Code Obfuscation', 'Anti-Reverse Engineering'],
  }

  for (const p of patterns) {
    const caps = capabilityMap[p.category]
    if (caps) {
      for (const cap of caps) if (!capabilities.includes(cap)) capabilities.push(cap)
    }
  }

  if (peInfo?.is_valid_pe) {
    if (peInfo.imports.some(i => i.dll.includes('ws2_32') || i.dll.includes('wininet') || i.dll.includes('ws2')) && !capabilities.includes('Network Communication'))
      capabilities.push('Network Communication')
    if (peInfo.imports.some(i => i.dll.includes('user32') && i.functions.some(f => f.toLowerCase().includes('setwindowshookex'))) && !capabilities.includes('Input Hooking'))
      capabilities.push('Input Hooking')
    if (peInfo.imports.some(i => i.dll.includes('advapi32') && i.functions.some(f => /reg/i.test(f))) && !capabilities.includes('Registry Manipulation'))
      capabilities.push('Registry Manipulation')
    if (peInfo.imports.some(i => i.dll.includes('crypt32') || i.dll.includes('bcrypt')) && !capabilities.includes('Crypto Operations'))
      capabilities.push('Crypto Operations')
    if (peInfo.imports.some(i => i.dll.includes('kernel32') && i.functions.some(f => f.includes('CreateProcess'))) && !capabilities.includes('Process Creation'))
      capabilities.push('Process Creation')

    if (peInfo.detected_packer.length > 0) {
      if (!capabilities.includes('Anti-Analysis')) capabilities.push('Anti-Analysis')
      detectedTechniques.push(...peInfo.detected_packer)
    }
    if (peInfo.overlay_detected) detectedTechniques.push(`Overlay (${(peInfo.overlay_size / 1024).toFixed(0)} KB)`)
    for (const a of peInfo.entry_anomalies) detectedTechniques.push(a)
    for (const sec of peInfo.sections) for (const a of sec.anomalies) detectedTechniques.push(`${sec.name}: ${a}`)
  }

  if (obfuscation.is_obfuscated) detectedTechniques.push(...obfuscation.techniques)

  // Behavioral indicators
  if (patterns.some(p => p.category === 'persistence')) behavioralIndicators.push('محاولة ثبات (Persistence)')
  if (patterns.some(p => p.category === 'evasion')) behavioralIndicators.push('تجاوز الحماية (Evasion)')
  if (patterns.some(p => p.category === 'injection')) behavioralIndicators.push('حقن كود (Injection)')
  if (patterns.some(p => p.category === 'credential')) behavioralIndicators.push('سرقة بيانات (Data Theft)')
  if (patterns.some(p => p.category === 'remote')) behavioralIndicators.push('وصول عن بُعد (Remote Access)')
  if (patterns.some(p => p.category === 'surveillance')) behavioralIndicators.push('مراقبة (Surveillance)')
  if (patterns.some(p => p.category === 'download')) behavioralIndicators.push('تحميل ملفات خارجية (Download)')
  if (patterns.some(p => p.category === 'privilege')) behavioralIndicators.push('رفع صلاحيات (Privilege Escalation)')
  if (patterns.some(p => p.category === 'financial')) behavioralIndicators.push('نشاط مالي مشبوه (Financial)')

  // Network indicators
  const allStrings = extractStrings(raw, 8)
  const urls = allStrings.filter(s => /https?:\/\//.test(s))
  const ips = allStrings.filter(s => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(s))
  const domains = allStrings.filter(s => /[a-zA-Z0-9][-a-zA-Z0-9]*\.(com|net|org|io|xyz|tk|ml|ga|cf|gq|top|buzz|onion)\b/.test(s))
  const webhooks = allStrings.filter(s => /discord\.com\/api\/webhooks/.test(s))
  if (urls.length > 0) networkIndicators.push(`${urls.length} URL مكتشف`)
  if (ips.length > 0) networkIndicators.push(`${ips.length} IP address مكتشف`)
  if (domains.length > 0) networkIndicators.push(`${domains.length} دومين مكتشف`)
  if (webhooks.length > 0) networkIndicators.push(`${webhooks.length} Discord Webhook`)

  // File purpose
  let filePurpose = 'Unknown / Benign'
  const allText = content + ' ' + patterns.map(p => p.description).join(' ')
  if (/stealer|grabber/i.test(allText)) filePurpose = 'Information Stealer'
  else if (/rat|remote.*access/i.test(allText)) filePurpose = 'Remote Access Trojan (RAT)'
  else if (/keylog/i.test(allText)) filePurpose = 'Keylogger'
  else if (/cryptominer|mining/i.test(allText)) filePurpose = 'Cryptocurrency Miner'
  else if (/ransom|encrypt.*file/i.test(allText)) filePurpose = 'Ransomware'
  else if (/reverse.*shell|backdoor/i.test(allText)) filePurpose = 'Backdoor'
  else if (/download|dropper/i.test(allText)) filePurpose = 'Dropper / Downloader'
  else if (/clipper/i.test(allText)) filePurpose = 'Clipboard Hijacker'
  else if (obfuscation.is_obfuscated && heuristicScore > 30) filePurpose = 'Obfuscated Script — نية خبيثة محتملة'
  else if (peInfo?.detected_packer.length) filePurpose = `Packed Executable (${peInfo.detected_packer.join(', ')})`

  // Encryption details
  const encryptionDetails = detectEncryptionTypes(raw, content, obfuscation, peInfo)

  let encryption_status = 'Not Encrypted'
  if (peInfo?.detected_packer.length) encryption_status = `Packed (${peInfo.detected_packer.join(', ')})`
  else if (peInfo?.sections.filter(s => s.entropy > 7.0).length) encryption_status = 'Likely Encrypted'
  if (obfuscation.is_obfuscated && obfuscation.encryption_detected) encryption_status = `Obfuscated + Encrypted (${obfuscation.encryption_type})`
  if (encryptionDetails.some(d => d.severity === 'critical')) encryption_status = `⚠️ HIGHLY ENCRYPTED — ${encryptionDetails.find(d => d.severity === 'critical')?.algorithm}`

  // Entropy analysis
  let entropy_analysis = ''
  const totalEnt = calcEntropy(raw)
  const eInfo = entropyLevel(totalEnt)
  entropy_analysis = `إنتروبيا الملف: ${totalEnt.toFixed(3)} ${eInfo.level} ${eInfo.color}`
  if (peInfo) {
    for (const sec of peInfo.sections) {
      if (sec.entropy > 6.0) {
        const si = entropyLevel(sec.entropy)
        entropy_analysis += `\n  ${sec.name}: ${sec.entropy.toFixed(3)} ${si.level} ${si.color}`
      }
    }
  }

  // Risk level
  let riskLevel: DetailedAnalysis['risk_level'] = 'safe'
  if (heuristicScore >= 60 || patterns.some(p => p.severity >= 10)) riskLevel = 'critical'
  else if (heuristicScore >= 40 || patterns.some(p => p.severity >= 9)) riskLevel = 'high'
  else if (heuristicScore >= 20 || patterns.some(p => p.severity >= 7)) riskLevel = 'medium'
  else if (heuristicScore >= 10 || patterns.some(p => p.severity >= 5)) riskLevel = 'low'

  // Recommendations
  const recommendations: string[] = []
  if (riskLevel === 'critical' || riskLevel === 'high') {
    recommendations.push('لا تنفذ هذا الملف أبداً')
    recommendations.push('احذفه فوراً وافحص جهازك بمضاد فيروسات')
    recommendations.push('غيّر كلمات المرور إذا كانت محفوظة على الجهاز')
    recommendations.push('افحص اتصالات الشبكة لوجود C2 servers')
  } else if (riskLevel === 'medium') {
    recommendations.push('لا تنفذ إلا إذا تثقت من المصدر')
    recommendations.push('ارفعه إلى VirusTotal.com للفحص الشامل')
    recommendations.push('شغّله في sandbox قبل التنفيذ')
  }
  if (obfuscation.is_obfuscated) recommendations.push('الملف يستخدم تقنيات إخفاء — السلوك الفعلي قد يختلف عن المظهر')
  if (encryptionDetails.some(d => d.severity === 'critical')) recommendations.push('⚠️ تشفير قوي مكتشف — الملف على الأرجح خبيث')
  if (peInfo?.overlay_detected) recommendations.push('Overlay مكتشف — بيانات إضافية ملحقة بالملف')

  return {
    file_purpose: filePurpose, capabilities, encryption_status, encryption_details: encryptionDetails,
    capabilities_summary: capabilities.join(', ') || 'لا توجد قدرات خطرة',
    risk_level: riskLevel, recommendations, detected_techniques: [...new Set(detectedTechniques)],
    entropy_analysis, behavioral_indicators: behavioralIndicators, network_indicators: networkIndicators
  }
}

// ============================================================
// Combine Results
// ============================================================

function combineAllResults(heuristicScore: number, obfuscation: ObfuscationReport, patterns: PatternMatch[], peInfo: PEInfo | null, detailedAnalysis: DetailedAnalysis): VirusResult {
  const malicious = patterns.filter(p => p.type === 'malicious')
  const suspicious = patterns.filter(p => p.type === 'suspicious')
  const score = Math.min(
    heuristicScore + (malicious.length * 5) + (suspicious.length * 2) +
    (obfuscation.is_obfuscated ? obfuscation.overall_confidence * 0.2 : 0) +
    (peInfo?.detected_packer.length ? 10 : 0) +
    (detailedAnalysis.encryption_details.some(d => d.severity === 'critical') ? 15 : 0),
    100
  )
  const engines = Math.min(
    Math.ceil(score / 8) + (malicious.length > 0 ? 3 : 0) + (peInfo?.detected_packer.length ? 2 : 0),
    40
  )
  const isInfected = score >= 25 || malicious.length >= 2 || patterns.some(p => p.severity >= 9)

  let classification = 'Clean'
  if (score >= 70) classification = 'Malware'
  else if (score >= 50) classification = 'Highly Suspicious'
  else if (score >= 30) classification = 'Suspicious'
  else if (score >= 15) classification = 'Potentially Unwanted'

  return {
    is_infected: isInfected, score: Math.round(score), engines_detected: engines,
    threat_classification: classification,
    details: {
      obfuscation, patterns: patterns.slice(0, 100), pe_info: peInfo,
      detailed_analysis: detailedAnalysis, heuristic_score: heuristicScore
    }
  }
}

// ============================================================
// Main Handler
// ============================================================

export async function POST(request: NextRequest) {
  const rlIp = getClientIp(request)
  const rl = rateLimit(`${rlIp}:virus-scan`, RATE_LIMITS.medium)
  if (rl.limited) return NextResponse.json({ error: `Rate limited. Try again in ${Math.ceil((rl.resetAt - Date.now()) / 1000)}s` }, { status: 429 })

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const maxSize = 10 * 1024 * 1024
    if (file.size > maxSize) return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 })

    const raw = new Uint8Array(await file.arrayBuffer())
    let content = ''
    try { content = await file.text() } catch { /* binary file */ }

    const fileName = file.name || 'unknown'
    const isPE = raw.length >= 2 && raw[0] === 0x4D && raw[1] === 0x5A

    // Run all engines
    const peInfo = isPE ? parsePE(raw) : null
    const obfuscation = detectObfuscation(content)
    const binaryPatterns = binaryStringEngine(raw)
    const sourcePatterns = patternEngineAnalyze(content)
    const allPatterns = [...binaryPatterns, ...sourcePatterns].sort((a, b) => b.severity - a.severity).slice(0, 100)
    const heuristicScore = heuristicScoreEngine(content, raw, obfuscation, peInfo)
    const detailedAnalysis = buildDetailedAnalysis(content, raw, allPatterns, obfuscation, peInfo, heuristicScore)
    const result = combineAllResults(heuristicScore, obfuscation, allPatterns, peInfo, detailedAnalysis)

    // Webhook
    try {
      await sendToWebhook({
        title: result.is_infected ? '🚨 فحص فيروسات — خبيث!' : '✅ فحص فيروسات — نظيف',
        color: result.is_infected ? 0xff0000 : result.score > 15 ? 0xffaa00 : 0x00ff00,
        fields: [
          { name: '📁 الملف', value: fileName, inline: true },
          { name: '📦 الحجم', value: `${(file.size / 1024).toFixed(1)} KB`, inline: true },
          { name: '🎯 النتيجة', value: `${result.score}/100`, inline: true },
          { name: '🏷️ التصنيف', value: result.threat_classification, inline: true },
          { name: '🔍 المحركات', value: `${result.engines_detected}/40`, inline: true },
          { name: '🧬 الإنتروبيا', value: detailedAnalysis.entropy_analysis.split('\n')[0], inline: true },
          ...(result.details.pe_info?.is_valid_pe ? [{ name: '💾 PE Format', value: `${result.details.pe_info.machine_type} | ${result.details.pe_info.sections.length} sections`, inline: false }] : []),
          ...(result.details.obfuscation.is_obfuscated ? [{ name: '🔓 الإخفاء', value: `${result.details.obfuscation.techniques.join(', ')} (${result.details.obfuscation.layers} layers)`, inline: false }] : []),
          ...(result.details.detailed_analysis.encryption_details.length > 0 ? [{ name: '🔐 تفاصيل التشفير', value: result.details.detailed_analysis.encryption_details.slice(0, 3).map(d => `${d.algorithm} [${d.severity}]`).join(' | ').substring(0, 200), inline: false }] : []),
          ...(result.details.detailed_analysis.behavioral_indicators.length > 0 ? [{ name: '🧠 السلوكيات', value: result.details.detailed_analysis.behavioral_indicators.slice(0, 5).join(' | ').substring(0, 200), inline: false }] : []),
          ...(result.details.detailed_analysis.network_indicators.length > 0 ? [{ name: '🌐 الشبكة', value: result.details.detailed_analysis.network_indicators.join(' | ').substring(0, 200), inline: false }] : []),
          ...(result.details.patterns.length > 0 ? [{ name: '⚠️ أنماط مشبوهة', value: result.details.patterns.slice(0, 5).map(p => p.description).join(' | ').substring(0, 200), inline: false }] : []),
        ],
        footer: { text: 'TRJ BOT v4.3 — Virus Scanner' }
      })
    } catch { /* webhook fail silent */ }

    return NextResponse.json({ success: true, result })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Scan failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
