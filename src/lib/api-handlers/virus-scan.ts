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
}

interface PEImport {
  dll: string
  functions: string[]
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
  entry_point: number
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
}

interface ObfuscationReport {
  is_obfuscated: boolean
  confidence: number
  layers: number
  techniques: string[]
  decoded_size: number
  original_size: number
}

interface DetailedAnalysis {
  file_purpose: string
  capabilities: string[]
  encryption_status: string
  capabilities_summary: string
  risk_level: 'safe' | 'low' | 'medium' | 'high' | 'critical'
  recommendations: string[]
  detected_techniques: string[]
}

interface PatternMatch {
  pattern: string
  type: 'malicious' | 'suspicious' | 'info'
  description: string
  severity: number
  line?: number
}

interface VirusResult {
  is_infected: boolean
  score: number
  engines_detected: number
  details: {
    obfuscation: ObfuscationReport
    patterns: PatternMatch[]
    pe_info: PEInfo | null
    detailed_analysis: DetailedAnalysis
    heuristic_score: number
  }
}

// ============================================================
// Edge-Compatible Helper Functions
// ============================================================

function readU16LE(view: DataView, offset: number): number {
  try { if (offset + 1 < view.byteLength) return view.getUint16(offset, true); return 0 } catch { return 0 }
}

function readU32LE(view: DataView, offset: number): number {
  try { if (offset + 3 < view.byteLength) return view.getUint32(offset, true); return 0 } catch { return 0 }
}

function readU64LE(view: DataView, offset: number): bigint {
  try { if (offset + 7 < view.byteLength) return view.getBigUint64(offset, true); return BigInt(0) } catch { return BigInt(0) }
}

function calculateEntropy(data: Uint8Array): number {
  if (!data || data.length === 0) return 0
  const freq = new Array(256).fill(0)
  for (let i = 0; i < data.length; i++) freq[data[i]]++
  let entropy = 0
  for (let i = 0; i < 256; i++) { if (freq[i] > 0) { const p = freq[i] / data.length; entropy -= p * Math.log2(p) } }
  return Math.round(entropy * 100) / 100
}

function readAsciiString(data: Uint8Array, offset: number, maxLen: number): string {
  let str = ''
  for (let i = 0; i < maxLen && offset + i < data.length; i++) { const byte = data[offset + i]; if (byte === 0) break; str += String.fromCharCode(byte) }
  return str.trim()
}

function rvaToOffset(rva: number, sections: PESection[]): number {
  for (const sec of sections) { if (rva >= sec.virtual_address && rva < sec.virtual_address + sec.virtual_size) return rva - sec.virtual_address + sec.raw_offset }
  return -1
}

function uint8ToHex(data: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < data.length; i++) hex += data[i].toString(16).padStart(2, '0')
  return hex
}

function decodeBase64(str: string): string { try { return atob(str) } catch { return '' } }
function decodeHex(str: string): string { try { const clean = str.replace(/[^0-9a-fA-F]/g, ''); if (clean.length % 2 !== 0) return ''; let result = ''; for (let i = 0; i < clean.length; i += 2) result += String.fromCharCode(parseInt(clean.substring(i, i + 2), 16)); return result } catch { return '' } }
function decodeROT13(str: string): string { return str.replace(/[a-zA-Z]/g, (c) => { const base = c <= 'Z' ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base) }) }
function tryXORDecode(data: string, key: number): string { try { let result = ''; for (let i = 0; i < data.length; i++) result += String.fromCharCode(data.charCodeAt(i) ^ key); if (/^[\x20-\x7E\s]+$/.test(result) && result.length > 5) return result; return '' } catch { return '' } }
function decodeUnicodeEscapes(str: string): string { try { return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))) } catch { return '' } }

function extractStringsFromBuffer(buf: Uint8Array, minLen: number = 4): string[] {
  const strings: string[] = []; let current = ''
  for (let i = 0; i < buf.length; i++) { const byte = buf[i]; if (byte >= 32 && byte <= 126) current += String.fromCharCode(byte); else { if (current.length >= minLen) strings.push(current); current = '' } }
  if (current.length >= minLen) strings.push(current)
  return strings
}

function safeSlice(data: Uint8Array, start: number, end: number): Uint8Array {
  const s = Math.max(0, start); const e = Math.min(data.length, end)
  if (s >= e || s >= data.length) return new Uint8Array(0)
  return data.slice(s, e)
}

// ============================================================
// PE Parser
// ============================================================

function parsePE(raw: Uint8Array): PEInfo {
  const startTime = Date.now()
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const pe: PEInfo = { is_valid_pe: false, machine_type: 'Unknown', entry_point: 0, image_base: 0, file_size: raw.length, sections: [], imports: [], exports: [], resources: [], detected_packer: [], compile_time: null, subsystem: 'Unknown', scan_time: 0 }

  if (!raw || raw.length < 64) return pe
  if (raw[0] !== 0x4D || raw[1] !== 0x5A) return pe

  const peOffset = readU32LE(view, 60)
  if (peOffset + 4 > raw.length) return pe
  if (raw[peOffset] !== 0x50 || raw[peOffset + 1] !== 0x45) return pe

  pe.is_valid_pe = true
  const coffHeader = peOffset + 4
  if (coffHeader + 20 > raw.length) return pe

  const machine = readU16LE(view, coffHeader)
  const machineTypes: Record<number, string> = { 0x0: 'Unknown', 0x14C: 'x86 (32-bit)', 0x8664: 'x64 (64-bit)', 0x1C0: 'ARM', 0xAA64: 'ARM64' }
  pe.machine_type = machineTypes[machine] || `Unknown (0x${machine.toString(16)})`

  const numberOfSections = readU16LE(view, coffHeader + 2)
  const sizeOfOptionalHeader = readU16LE(view, coffHeader + 16)
  const optHeader = coffHeader + 20
  if (optHeader + 2 > raw.length) return pe

  const is64 = readU16LE(view, optHeader) === 0x20B
  if (is64) { pe.entry_point = readU32LE(view, optHeader + 16); pe.image_base = Number(readU64LE(view, optHeader + 24)) }
  else { pe.entry_point = readU32LE(view, optHeader + 16); pe.image_base = readU32LE(view, optHeader + 28) }

  const subsystemOffset = optHeader + 68
  if (subsystemOffset + 2 <= raw.length) {
    const subsystems: Record<number, string> = { 1: 'Native', 2: 'Windows GUI', 3: 'Windows Console (CLI)', 7: 'POSIX Console', 9: 'Windows CE GUI', 10: 'EFI Application', 14: 'Xbox' }
    pe.subsystem = subsystems[readU16LE(view, subsystemOffset)] || 'Unknown'
  }

  const timeDateStamp = readU32LE(view, coffHeader + 4)
  if (timeDateStamp > 0) { const date = new Date(timeDateStamp * 1000); if (date.getFullYear() >= 1990 && date.getFullYear() <= new Date().getFullYear() + 1) pe.compile_time = date.toISOString() }

  const dataDirStart = optHeader + (is64 ? 112 : 96)
  const numberOfRvaAndSizes = readU32LE(view, dataDirStart - 4)

  let importRva = 0, exportRva = 0, resourceRva = 0
  if (numberOfRvaAndSizes > 1 && dataDirStart + 16 <= raw.length) { importRva = readU32LE(view, dataDirStart + 8) }
  if (numberOfRvaAndSizes > 0 && dataDirStart + 8 <= raw.length) { exportRva = readU32LE(view, dataDirStart) }
  if (numberOfRvaAndSizes > 2 && dataDirStart + 24 <= raw.length) { resourceRva = readU32LE(view, dataDirStart + 16) }

  const sectionTableStart = optHeader + sizeOfOptionalHeader
  for (let i = 0; i < Math.min(numberOfSections, 96); i++) {
    const secOff = sectionTableStart + (i * 40)
    if (secOff + 40 > raw.length) break
    const name = readAsciiString(raw, secOff, 8)
    const virtualSize = readU32LE(view, secOff + 8); const virtualAddress = readU32LE(view, secOff + 12)
    const rawSize = readU32LE(view, secOff + 16); const rawOffset = readU32LE(view, secOff + 20)
    const characteristics = readU32LE(view, secOff + 36)
    const entropy = calculateEntropy(safeSlice(raw, rawOffset, rawOffset + Math.min(rawSize, raw.length - rawOffset)))
    const flags: string[] = []
    if (characteristics & 0x00000020) flags.push('CODE'); if (characteristics & 0x00000040) flags.push('INITIALIZED_DATA')
    if (characteristics & 0x20000000) flags.push('EXECUTE'); if (characteristics & 0x40000000) flags.push('READ'); if (characteristics & 0x80000000) flags.push('WRITE')
    pe.sections.push({ name, virtual_size: virtualSize, virtual_address: virtualAddress, raw_offset: rawOffset, raw_size: rawSize, characteristics, entropy, flags })
  }

  // Entry point anomaly check
  const entrySection = pe.sections.find((sec) => pe.entry_point >= sec.virtual_address && pe.entry_point < sec.virtual_address + sec.virtual_size)
  if (entrySection) {
    const entryOffset = rvaToOffset(pe.entry_point, pe.sections)
    if (entryOffset > 0 && entryOffset < raw.length) {
      const entryHex = uint8ToHex(safeSlice(raw, entryOffset, Math.min(entryOffset + 16, raw.length)))
      if ((entryHex.startsWith('60') || entryHex.startsWith('fc68') || entryHex.startsWith('e8') || entryHex.startsWith('bbe8')) && entrySection.entropy > 7.0) pe.detected_packer.push('Possible entry point obfuscation')
    }
  }

  // Parse imports
  if (importRva > 0) {
    const importOffset = rvaToOffset(importRva, pe.sections)
    if (importOffset > 0 && importOffset < raw.length) {
      for (let i = 0; i < 500; i++) {
        const descOff = importOffset + (i * 20); if (descOff + 20 > raw.length) break
        const iltRva = readU32LE(view, descOff); const nameRva = readU32LE(view, descOff + 12)
        if (iltRva === 0 && nameRva === 0) break
        const dllOffset = rvaToOffset(nameRva, pe.sections)
        if (dllOffset <= 0 || dllOffset >= raw.length) continue
        const dllName = readAsciiString(raw, dllOffset, 256)
        if (!dllName) continue
        const functions: string[] = []
        const iltOffset = rvaToOffset(iltRva, pe.sections)
        if (iltOffset > 0) {
          for (let j = 0; j < 200; j++) {
            const funcEntryOff = iltOffset + (j * (is64 ? 8 : 4)); if (funcEntryOff + (is64 ? 8 : 4) > raw.length) break
            if (is64) {
              const entry = readU64LE(view, funcEntryOff); if (entry === BigInt(0)) break
              if (entry & BigInt(1)) { functions.push(`Ordinal#${Number(entry >> BigInt(32))}`) }
              else { const hintOffset = rvaToOffset(Number(entry), pe.sections); if (hintOffset > 0 && hintOffset + 2 < raw.length) { const fn = readAsciiString(raw, hintOffset + 2, 256); if (fn) functions.push(fn) } }
            } else {
              const entry = readU32LE(view, funcEntryOff); if (entry === 0) break
              if (entry & 1) { functions.push(`Ordinal#${entry >> 16}`) }
              else { const hintOffset = rvaToOffset(entry, pe.sections); if (hintOffset > 0 && hintOffset + 2 < raw.length) { const fn = readAsciiString(raw, hintOffset + 2, 256); if (fn) functions.push(fn) } }
            }
          }
        }
        pe.imports.push({ dll: dllName.toLowerCase(), functions })
      }
    }
  }

  // Parse exports
  if (exportRva > 0) {
    const exportOffset = rvaToOffset(exportRva, pe.sections)
    if (exportOffset > 0 && exportOffset + 40 <= raw.length) {
      const numNames = readU32LE(view, exportOffset + 24); const namesRva = readU32LE(view, exportOffset + 32)
      const namesOffset = rvaToOffset(namesRva, pe.sections)
      if (namesOffset > 0) { for (let i = 0; i < Math.min(numNames, 500); i++) { const namePtrOff = namesOffset + (i * 4); if (namePtrOff + 4 > raw.length) break; const nameRva = readU32LE(view, namePtrOff); const nameOffset = rvaToOffset(nameRva, pe.sections); if (nameOffset > 0 && nameOffset < raw.length) { const name = readAsciiString(raw, nameOffset, 256); if (name) pe.exports.push(name) } } }
    }
  }

  // Detect packers
  const packerChecks: [string, (p: PEInfo) => boolean][] = [
    ['UPX', (p) => p.sections.some((s) => s.name.startsWith('UPX'))],
    ['VMProtect', (p) => p.sections.some((s) => s.name.startsWith('.vmp'))],
    ['Themida/WinLicense', (p) => p.sections.some((s) => s.name.includes('themida'))],
    ['ASPack', (p) => p.sections.some((s) => s.name.includes('aspack'))],
    ['PECompact', (p) => p.sections.some((s) => s.name.startsWith('.pec'))],
    ['MPRESS', (p) => p.sections.some((s) => s.name.startsWith('.MPRESS'))],
    ['Enigma Protector', (p) => p.sections.some((s) => s.name.startsWith('.enigma'))],
    ['NSPack', (p) => p.sections.some((s) => s.name.startsWith('.nsp'))],
  ]
  for (const [name, check] of packerChecks) { if (check(pe)) pe.detected_packer.push(name) }
  if (pe.sections.filter((s) => s.entropy > 7.5 && !s.name.startsWith('.text')).length > 0 && pe.detected_packer.length === 0) pe.detected_packer.push('Possible custom encryption/packing')

  // Basic resources
  if (resourceRva > 0) {
    const resOffset = rvaToOffset(resourceRva, pe.sections)
    if (resOffset > 0 && resOffset < raw.length) {
      const resourceTypes: Record<number, string> = { 1: 'Cursor', 2: 'Bitmap', 3: 'Icon', 5: 'Dialog', 6: 'String Table', 16: 'Version Info', 24: 'Manifest' }
      try {
        const numTypes = readU16LE(view, resOffset + 12) + readU16LE(view, resOffset + 14)
        for (let i = 0; i < Math.min(numTypes, 32); i++) { const entryOff = resOffset + 16 + (i * 8); if (entryOff + 8 > raw.length) break; const typeID = readU32LE(view, entryOff); const typeStr = resourceTypes[typeID] || `Type#${typeID}`; if (!pe.resources.some((r) => r.type === typeStr)) pe.resources.push({ type: typeStr, name: 'Embedded', language: 'Neutral', size: 0 }) }
      } catch {}
    }
  }

  pe.scan_time = Date.now() - startTime
  return pe
}

// ============================================================
// Binary String Engine
// ============================================================

function binaryStringEngine(buf: Uint8Array): PatternMatch[] {
  const matches: PatternMatch[] = []
  const strings = extractStringsFromBuffer(buf, 5)
  const suspiciousPatterns: { pattern: RegExp; desc: string; severity: number }[] = [
    { pattern: /powershell/i, desc: 'PowerShell command execution', severity: 8 },
    { pattern: /cmd\.exe|cmd \/c/i, desc: 'CMD shell execution', severity: 7 },
    { pattern: /reg(?:istry|edit|svr32|add)/i, desc: 'Registry manipulation', severity: 7 },
    { pattern: /svchost\.exe/i, desc: 'May masquerade as svchost.exe', severity: 6 },
    { pattern: /temp[\\/]|%temp%|appdata/i, desc: 'Uses temp/AppData directories', severity: 5 },
    { pattern: /http[s]?:\/\/.*?\.(?:tk|ml|ga|cf|gq|pw|top)/i, desc: 'Suspicious TLD domain', severity: 8 },
    { pattern: /\/c\s+(?:curl|wget|Invoke-WebRequest)/i, desc: 'Downloads via command line', severity: 9 },
    { pattern: /taskkill|wmic\s+process/i, desc: 'Process manipulation', severity: 7 },
    { pattern: /bypass.*AMSI|AMSI.*bypass/i, desc: 'AMSI bypass attempt', severity: 9 },
    { pattern: /Set-MpPreference|Disable-Windows/i, desc: 'Antivirus tampering', severity: 10 },
    { pattern: /iex\b|invoke-expression|Start-Process/i, desc: 'Dynamic code execution', severity: 8 },
    { pattern: /DownloadString|DownloadFile|WebClient/i, desc: 'Network download capability', severity: 7 },
    { pattern: /key(?:board|log|stroke)/i, desc: 'Possible keylogger', severity: 9 },
    { pattern: /screen(?:capture|shot|grab|spy)/i, desc: 'Screen capture capability', severity: 9 },
    { pattern: /bitcoin|wallet|crypto|mining/i, desc: 'Cryptocurrency activity', severity: 7 },
    { pattern: /discord(?:\.gg|app|api|webhook)/i, desc: 'Discord API/webhook usage', severity: 5 },
    { pattern: /inject|hook|dll.*inject|loadlibrary/i, desc: 'Code injection', severity: 9 },
    { pattern: /reverse.*shell|backdoor/i, desc: 'Backdoor/remote shell', severity: 10 },
    { pattern: /credential|password.*steal/i, desc: 'Credential harvesting', severity: 8 },
    { pattern: /chrome|firefox|browser.*data|cookie.*steal/i, desc: 'Browser data theft', severity: 8 },
  ]
  for (const str of strings) {
    for (const { pattern, desc, severity } of suspiciousPatterns) {
      if (pattern.test(str) && !matches.some((m) => m.description === desc))
        matches.push({ pattern: str.substring(0, 100), type: severity >= 8 ? 'malicious' : severity >= 6 ? 'suspicious' : 'info', description: desc, severity })
    }
  }
  return matches.sort((a, b) => b.severity - a.severity)
}

// ============================================================
// Obfuscation Detection
// ============================================================

function detectObfuscation(content: string): ObfuscationReport {
  const report: ObfuscationReport = { is_obfuscated: false, confidence: 0, layers: 0, techniques: [], decoded_size: 0, original_size: content.length }
  let current = content; let layerCount = 0

  for (let i = 0; i < 8; i++) {
    let decoded = ''; let found = false
    const base64Match = current.match(/(?:["'`])([A-Za-z0-9+/]{20,}={0,2})(?:["'`])/)
    if (base64Match) { decoded = decodeBase64(base64Match[1]); if (decoded && decoded.length > 10 && /[\x20-\x7E]{10,}/.test(decoded)) { current = decoded; layerCount++; if (!report.techniques.includes('Base64')) report.techniques.push('Base64'); found = true; continue } }
    const hexMatch = current.match(/(?:["'`])([0-9a-fA-F]{40,})(?:["'`])/)
    if (hexMatch) { decoded = decodeHex(hexMatch[1]); if (decoded && decoded.length > 10 && /[\x20-\x7E]{10,}/.test(decoded)) { current = decoded; layerCount++; if (!report.techniques.includes('Hex')) report.techniques.push('Hex'); found = true; continue } }
    if (/\\u[0-9a-fA-F]{4}/.test(current)) { decoded = decodeUnicodeEscapes(current); if (decoded !== current && decoded.length > 10) { current = decoded; layerCount++; if (!report.techniques.includes('Unicode')) report.techniques.push('Unicode'); found = true; continue } }
    if (!found) { for (let key = 1; key <= 255; key++) { decoded = tryXORDecode(current, key); if (decoded && decoded.length > 10) { current = decoded; layerCount++; if (!report.techniques.includes('XOR')) report.techniques.push('XOR'); found = true; break } } }
    if (!found) break
  }

  if (/\beval\s*\(/.test(current)) report.techniques.push('eval() Dynamic Execution')
  if (/\bFunction\s*\(/.test(current)) report.techniques.push('Function Constructor')
  if (/\batob\s*\(/.test(current)) report.techniques.push('Base64 Functions')

  report.layers = layerCount; report.decoded_size = current.length
  report.is_obfuscated = report.techniques.length > 0
  report.confidence = Math.min(Math.round((report.techniques.length * 15) + (layerCount * 10)), 100)
  return report
}

// ============================================================
// Pattern Engine (Source Code)
// ============================================================

function patternEngineAnalyze(content: string, obfuscation: ObfuscationReport): PatternMatch[] {
  const matches: PatternMatch[] = []
  const patterns: { pattern: RegExp; desc: string; severity: number }[] = [
    { pattern: /\beval\s*\(/, desc: 'Dynamic code execution via eval()', severity: 8 },
    { pattern: /\bexec\s*\(/, desc: 'System command execution', severity: 9 },
    { pattern: /\bchild_process\b/, desc: 'Child process module', severity: 7 },
    { pattern: /\bkeylog|key[\s_]*(?:stroke|capture|record|hook)/i, desc: 'Keylogger functionality', severity: 10 },
    { pattern: /\bscreen[\s_]*(?:capture|shot|grab)/i, desc: 'Screen capture', severity: 9 },
    { pattern: /\bwebcam|camera[\s_]*(?:capture|access)/i, desc: 'Webcam access', severity: 10 },
    { pattern: /\bpassword|credential.*(?:steal|grab|harvest)/i, desc: 'Credential theft', severity: 9 },
    { pattern: /\btoken[\s_]*(?:steal|grab|harvest)/i, desc: 'Token theft', severity: 9 },
    { pattern: /\bcookie[\s_]*(?:steal|grab)/i, desc: 'Cookie theft', severity: 8 },
    { pattern: /\bchrome|firefox.*(?:pass|cookie|login)/i, desc: 'Browser data theft', severity: 8 },
    { pattern: /\bAMSI|anti[\s_-]*malware.*bypass/i, desc: 'AMSI bypass', severity: 10 },
    { pattern: /\breverse[\s_-]*shell|back[\s_-]*door/i, desc: 'Backdoor/remote shell', severity: 10 },
    { pattern: /\bRAT[\s_-]|remote[\s_-]*access/i, desc: 'Remote Access Trojan', severity: 10 },
    { pattern: /\bdll[\s_-]*(?:inject|load)/i, desc: 'DLL injection', severity: 9 },
    { pattern: /\bhook[\s_-]*(?:api|keyboard|function)/i, desc: 'API hooking', severity: 8 },
    { pattern: /\bshellcode|payload.*(?:exec|inject)/i, desc: 'Shellcode/payload execution', severity: 10 },
    { pattern: /\bbitcoin|crypto.*(?:mine|steal)|mining/i, desc: 'Cryptocurrency theft/mining', severity: 9 },
    { pattern: /\bprocess\.env\b/, desc: 'Environment variable access', severity: 4 },
    { pattern: /\bWebSocket\b/, desc: 'WebSocket connection', severity: 5 },
    { pattern: /\bdocument\.cookie\b/, desc: 'Cookie access', severity: 6 },
    { pattern: /\blocalStorage\b|\bsessionStorage\b/, desc: 'Browser storage access', severity: 4 },
  ]
  const lines = content.split('\n')
  for (const { pattern, desc, severity } of patterns) {
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i]) && !matches.some((m) => m.description === desc)) {
        matches.push({ pattern: lines[i].substring(0, 100).trim(), type: severity >= 8 ? 'malicious' : severity >= 6 ? 'suspicious' : 'info', description: desc, severity, line: i + 1 })
        break
      }
    }
  }
  return matches.sort((a, b) => b.severity - a.severity)
}

// ============================================================
// Heuristic Engine
// ============================================================

function heuristicAnalyze(content: string, obfuscation: ObfuscationReport, patterns: PatternMatch[], peInfo: PEInfo | null): number {
  let score = 0
  if (obfuscation.is_obfuscated) score += Math.min(obfuscation.confidence * 0.3, 30)
  if (obfuscation.layers > 2) score += 10
  for (const p of patterns) score += p.severity * 1.5
  if (peInfo && peInfo.is_valid_pe) {
    if (peInfo.detected_packer.length > 0) score += 15
    for (const sec of peInfo.sections) { if (sec.entropy > 7.5 && !sec.name.startsWith('.text') && !sec.name.startsWith('.rdata')) score += 5 }
    const suspiciousFuncs = ['VirtualAlloc', 'VirtualProtect', 'CreateRemoteThread', 'WriteProcessMemory', 'OpenProcess', 'LoadLibrary', 'SetWindowsHookEx', 'GetAsyncKeyState', 'ShellExecute', 'CreateProcess', 'InternetOpen', 'InternetConnect', 'HttpSendRequest', 'RegSetValue', 'RegCreateKey']
    for (const imp of peInfo.imports) { score += imp.functions.filter((fn) => suspiciousFuncs.some((sf) => fn.toLowerCase().includes(sf.toLowerCase()))).length * 3 }
    const epSection = peInfo.sections.find((sec) => peInfo.entry_point >= sec.virtual_address && peInfo.entry_point < sec.virtual_address + sec.virtual_size)
    if (epSection && epSection.entropy > 7.0) score += 10
  }
  return Math.min(Math.round(score), 100)
}

// ============================================================
// Detailed Analysis
// ============================================================

function buildDetailedAnalysis(filename: string, content: string, obfuscation: ObfuscationReport, patterns: PatternMatch[], peInfo: PEInfo | null, heuristicScore: number): DetailedAnalysis {
  const capabilities: string[] = []; const detectedTechniques: string[] = []
  const capMap: Record<string, string[]> = { 'keylog': ['Keylogging'], 'screen': ['Screen Capture'], 'webcam': ['Webcam Access'], 'credential|password': ['Credential Theft'], 'token': ['Token Theft'], 'cookie': ['Cookie Theft'], 'bitcoin|crypto|mining': ['Crypto Mining/Theft'], 'browser|chrome|firefox': ['Browser Data Theft'], 'reverse.*shell|backdoor': ['Remote Shell'], 'dll.*inject|inject': ['Code Injection'], 'AMSI|defender': ['Security Evasion'], 'hook': ['API Hooking'] }
  for (const match of patterns) { for (const [keyword, caps] of Object.entries(capMap)) { if (new RegExp(keyword, 'i').test(match.description)) { for (const cap of caps) { if (!capabilities.includes(cap)) capabilities.push(cap) } } } }

  if (peInfo?.is_valid_pe) {
    if (peInfo.imports.some((i) => i.dll.includes('ws2_32') || i.dll.includes('wininet'))) { if (!capabilities.includes('Network Communication')) capabilities.push('Network Communication') }
    if (peInfo.imports.some((i) => i.dll.includes('user32') && i.functions.some((f) => f.toLowerCase().includes('setwindowshookex')))) { if (!capabilities.includes('Input Hooking')) capabilities.push('Input Hooking') }
    if (peInfo.detected_packer.length > 0) { if (!capabilities.includes('Anti-Analysis')) capabilities.push('Anti-Analysis'); detectedTechniques.push(...peInfo.detected_packer) }
  }
  if (obfuscation.is_obfuscated) detectedTechniques.push(...obfuscation.techniques)

  let filePurpose = 'Unknown / Benign'
  const allText = content + ' ' + patterns.map((p) => p.description).join(' ')
  if (/stealer|grabber/i.test(allText)) filePurpose = 'Information Stealer'
  else if (/rat|remote.*access/i.test(allText)) filePurpose = 'Remote Access Trojan (RAT)'
  else if (/keylog/i.test(allText)) filePurpose = 'Keylogger'
  else if (/cryptominer|mining/i.test(allText)) filePurpose = 'Cryptocurrency Miner'
  else if (/ransom|encrypt.*file/i.test(allText)) filePurpose = 'Ransomware'
  else if (/reverse.*shell|backdoor/i.test(allText)) filePurpose = 'Backdoor'
  else if (obfuscation.is_obfuscated && heuristicScore > 30) filePurpose = 'Obfuscated Script with potentially malicious intent'
  else if (peInfo?.detected_packer.length) filePurpose = `Packed Executable (${peInfo.detected_packer.join(', ')})`

  let encryption_status = 'Not Encrypted'
  if (peInfo?.detected_packer.length) encryption_status = `Packed (${peInfo.detected_packer.join(', ')})`
  else if (peInfo?.sections.filter((s) => s.entropy > 7.0).length) encryption_status = 'Likely Encrypted'
  if (obfuscation.is_obfuscated) encryption_status = `Obfuscated (${obfuscation.techniques.join(', ')})`

  let riskLevel: DetailedAnalysis['risk_level'] = 'safe'
  if (heuristicScore >= 60 || patterns.some((p) => p.severity >= 10)) riskLevel = 'critical'
  else if (heuristicScore >= 40 || patterns.some((p) => p.severity >= 9)) riskLevel = 'high'
  else if (heuristicScore >= 20 || patterns.some((p) => p.severity >= 7)) riskLevel = 'medium'
  else if (heuristicScore >= 10 || patterns.some((p) => p.severity >= 5)) riskLevel = 'low'

  const recommendations: string[] = []
  if (riskLevel === 'critical' || riskLevel === 'high') { recommendations.push('Do not execute this file'); recommendations.push('Delete and scan your system'); recommendations.push('Change exposed credentials') }
  else if (riskLevel === 'medium') { recommendations.push('Do not execute unless you trust the source'); recommendations.push('Upload to VirusTotal.com') }
  if (obfuscation.is_obfuscated) recommendations.push('File uses obfuscation - behavior may differ from appearance')

  return { file_purpose: filePurpose, capabilities, encryption_status, capabilities_summary: capabilities.join(', ') || 'No significant capabilities', risk_level, recommendations, detected_techniques: [...new Set(detectedTechniques)] }
}

// ============================================================
// Combine Results
// ============================================================

function combineAllResults(filename: string, content: string, obfuscation: ObfuscationReport, patterns: PatternMatch[], peInfo: PEInfo | null, heuristicScore: number, detailedAnalysis: DetailedAnalysis): VirusResult {
  const maliciousPatterns = patterns.filter((p) => p.type === 'malicious')
  const suspiciousPatterns = patterns.filter((p) => p.type === 'suspicious')
  const score = Math.min(heuristicScore + (maliciousPatterns.length * 5) + (suspiciousPatterns.length * 2) + (obfuscation.is_obfuscated ? obfuscation.confidence * 0.2 : 0) + (peInfo?.detected_packer.length ? 10 : 0), 100)
  const enginesDetected = Math.min(Math.ceil(score / 10) + (maliciousPatterns.length > 0 ? 2 : 0) + (peInfo?.detected_packer.length ? 1 : 0), 30)
  const isInfected = score >= 30 || maliciousPatterns.length >= 2 || patterns.some((p) => p.severity >= 9)
  return { is_infected: isInfected, score: Math.round(score), engines_detected: enginesDetected, details: { obfuscation, patterns: patterns.slice(0, 50), pe_info: peInfo, detailed_analysis: detailedAnalysis, heuristic_score: heuristicScore } }
}

// ============================================================
// Main Handler
// ============================================================

export async function POST(request: NextRequest) {
  const rlIp = getClientIp(request)
  const rl = rateLimit(`${rlIp}:virus-scan`, RATE_LIMITS.medium)
  if (rl.limited) {
    return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح - حاول لاحقاً' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } })
  }

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const fileContent = formData.get('content') as string | null

    if (!file && !fileContent) {
      return NextResponse.json({ success: false, error: 'الرجاء رفع ملف أو لصق كود' }, { status: 400 })
    }

    if (file && file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ success: false, error: 'حجم الملف كبير جداً (الحد 50MB)' }, { status: 400 })
    }

    const filename = file?.name || 'pasted_code.txt'
    const rawBytes = file ? new Uint8Array(await file.arrayBuffer()) : new TextEncoder().encode(fileContent || '')
    const isEXE = file ? (/\.exe$/i.test(filename) || (rawBytes.length > 2 && rawBytes[0] === 0x4D && rawBytes[1] === 0x5A)) : false
    const content = fileContent || new TextDecoder('utf-8', { fatal: false }).decode(rawBytes)

    let result: VirusResult

    if (isEXE) {
      const peInfo = parsePE(rawBytes)
      const patterns = binaryStringEngine(rawBytes)
      const obfuscation: ObfuscationReport = { is_obfuscated: peInfo.detected_packer.length > 0, confidence: peInfo.detected_packer.length > 0 ? 80 : 0, layers: peInfo.detected_packer.length, techniques: [...peInfo.detected_packer], decoded_size: rawBytes.length, original_size: rawBytes.length }
      const heuristicScore = heuristicAnalyze('', obfuscation, patterns, peInfo)
      const detailedAnalysis = buildDetailedAnalysis(filename, '', obfuscation, patterns, peInfo, heuristicScore)
      result = combineAllResults(filename, '', obfuscation, patterns, peInfo, heuristicScore, detailedAnalysis)
    } else {
      const obfuscation = detectObfuscation(content)
      const patterns = patternEngineAnalyze(content, obfuscation)
      const heuristicScore = heuristicAnalyze(content, obfuscation, patterns, null)
      const detailedAnalysis = buildDetailedAnalysis(filename, content, obfuscation, patterns, null, heuristicScore)
      result = combineAllResults(filename, content, obfuscation, patterns, null, heuristicScore, detailedAnalysis)
    }

    // إرسال تنبيه ويب هوك (نتيجة كاملة)
    sendToWebhook({
      username: 'TRJ Virus Scan',
      embeds: [{
        title: '🔍 فحص ملف جديد',
        color: result.is_infected ? (result.details.detailed_analysis.risk_level === 'critical' || result.details.detailed_analysis.risk_level === 'high' ? 0xFF0000 : 0xFFAA00) : 0x00FF41,
        fields: [
          { name: '📄 الملف', value: String(filename).substring(0, 256), inline: true },
          { name: '📏 الحجم', value: file ? `${(file.size / 1024).toFixed(1)} KB` : `${(content.length / 1024).toFixed(1)} KB`, inline: true },
          { name: '🛡️ النتيجة', value: result.details.detailed_analysis.risk_level === 'safe' ? '✅ آمن' : result.details.detailed_analysis.risk_level === 'low' ? '🟡 منخفض' : result.details.detailed_analysis.risk_level === 'medium' ? '🟠 متوسط' : result.details.detailed_analysis.risk_level === 'high' ? '🔴 خطير' : '💀 حرج', inline: true },
          { name: '📊 النقاط', value: String(result.score) + '/100', inline: true },
          { name: '🌐 IP', value: String(rlIp).substring(0, 50), inline: true },
          { name: '🎯 الغرض', value: result.details.detailed_analysis.file_purpose.substring(0, 200), inline: false },
          { name: '🤖 المحركات', value: `${result.engines_detected}/30`, inline: true },
          { name: '🧬 نوع الملف', value: isEXE ? 'PE Executable' : 'Source Code', inline: true },
          ...(result.details.obfuscation.is_obfuscated ? [{ name: '🔒 التشفير', value: result.details.obfuscation.techniques.join(' | ').substring(0, 200), inline: false }] : []),
          ...(result.details.pe_info?.detected_packer.length ? [{ name: '📦 Packer', value: result.details.pe_info.detected_packer.join(' | '), inline: false }] : []),
          ...(result.details.detailed_analysis.capabilities.length > 0 ? [{ name: '⚡ القدرات', value: result.details.detailed_analysis.capabilities.slice(0, 5).join(' | ').substring(0, 200), inline: false }] : []),
        ],
        timestamp: new Date().toISOString()
      }]
    }).catch(() => {})

    return NextResponse.json({ success: true, file: filename, size: rawBytes.length, result })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'حدث خطأ في التحليل'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
