import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit'
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
// Edge-Compatible Helper Functions (Uint8Array + DataView)
// ============================================================

function readU16LE(view: DataView, offset: number): number {
  try {
    if (offset + 1 < view.byteLength) return view.getUint16(offset, true)
    return 0
  } catch {
    return 0
  }
}

function readU32LE(view: DataView, offset: number): number {
  try {
    if (offset + 3 < view.byteLength) return view.getUint32(offset, true)
    return 0
  } catch {
    return 0
  }
}

function readU64LE(view: DataView, offset: number): bigint {
  try {
    if (offset + 7 < view.byteLength) return view.getBigUint64(offset, true)
    return BigInt(0)
  } catch {
    return BigInt(0)
  }
}

function createDataView(arr: Uint8Array): DataView {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength)
}

function calculateEntropy(data: Uint8Array): number {
  if (!data || data.length === 0) return 0
  const freq = new Array(256).fill(0)
  for (let i = 0; i < data.length; i++) {
    freq[data[i]]++
  }
  let entropy = 0
  for (let i = 0; i < 256; i++) {
    if (freq[i] > 0) {
      const p = freq[i] / data.length
      entropy -= p * Math.log2(p)
    }
  }
  return Math.round(entropy * 100) / 100
}

function readAsciiString(data: Uint8Array, offset: number, maxLen: number): string {
  let str = ''
  for (let i = 0; i < maxLen && offset + i < data.length; i++) {
    const byte = data[offset + i]
    if (byte === 0) break
    str += String.fromCharCode(byte)
  }
  return str.trim()
}

function rvaToOffset(rva: number, sections: PESection[]): number {
  for (const sec of sections) {
    if (rva >= sec.virtual_address && rva < sec.virtual_address + sec.virtual_size) {
      return rva - sec.virtual_address + sec.raw_offset
    }
  }
  return -1
}

function uint8ToHex(data: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < data.length; i++) {
    hex += data[i].toString(16).padStart(2, '0')
  }
  return hex
}

function decodeBase64(str: string): string {
  try {
    return atob(str)
  } catch {
    return ''
  }
}

function decodeHex(str: string): string {
  try {
    const clean = str.replace(/[^0-9a-fA-F]/g, '')
    if (clean.length % 2 !== 0) return ''
    let result = ''
    for (let i = 0; i < clean.length; i += 2) {
      result += String.fromCharCode(parseInt(clean.substring(i, i + 2), 16))
    }
    return result
  } catch {
    return ''
  }
}

function decodeROT13(str: string): string {
  return str.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base)
  })
}

function tryXORDecode(data: string, key: number): string {
  try {
    let result = ''
    for (let i = 0; i < data.length; i++) {
      result += String.fromCharCode(data.charCodeAt(i) ^ key)
    }
    if (/^[\x20-\x7E\s]+$/.test(result) && result.length > 5) {
      return result
    }
    return ''
  } catch {
    return ''
  }
}

function decodeUnicodeEscapes(str: string): string {
  try {
    return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => {
      return String.fromCharCode(parseInt(hex, 16))
    })
  } catch {
    return ''
  }
}

function extractStringsFromBuffer(buf: Uint8Array, minLen: number = 4): string[] {
  const strings: string[] = []
  let current = ''
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i]
    if (byte >= 32 && byte <= 126) {
      current += String.fromCharCode(byte)
    } else {
      if (current.length >= minLen) {
        strings.push(current)
      }
      current = ''
    }
  }
  if (current.length >= minLen) {
    strings.push(current)
  }
  return strings
}

function safeSlice(data: Uint8Array, start: number, end: number): Uint8Array {
  const s = Math.max(0, start)
  const e = Math.min(data.length, end)
  if (s >= e || s >= data.length) return new Uint8Array(0)
  return data.slice(s, e)
}

// ============================================================
// PE Parser (Edge-Compatible)
// ============================================================

function parsePE(raw: Uint8Array): PEInfo {
  const startTime = Date.now()
  const view = createDataView(raw)
  const pe: PEInfo = {
    is_valid_pe: false,
    machine_type: 'Unknown',
    entry_point: 0,
    image_base: 0,
    file_size: raw.length,
    sections: [],
    imports: [],
    exports: [],
    resources: [],
    detected_packer: [],
    compile_time: null,
    subsystem: 'Unknown',
    scan_time: 0,
  }

  if (!raw || raw.length < 64) return pe

  // DOS Header check
  if (raw[0] !== 0x4D || raw[1] !== 0x5A) {
    return pe
  }

  const peOffset = readU32LE(view, 60)
  if (peOffset + 4 > raw.length) return pe

  // PE Signature check
  if (raw[peOffset] !== 0x50 || raw[peOffset + 1] !== 0x45) {
    return pe
  }

  pe.is_valid_pe = true

  const coffHeader = peOffset + 4
  if (coffHeader + 20 > raw.length) return pe

  const machine = readU16LE(view, coffHeader)
  const machineTypes: Record<number, string> = {
    0x0: 'Unknown',
    0x14C: 'x86 (32-bit)',
    0x8664: 'x64 (64-bit)',
    0x1C0: 'ARM',
    0xAA64: 'ARM64',
  }
  pe.machine_type = machineTypes[machine] || `Unknown (0x${machine.toString(16)})`

  const numberOfSections = readU16LE(view, coffHeader + 2)
  const sizeOfOptionalHeader = readU16LE(view, coffHeader + 16)

  // Optional Header
  const optHeader = coffHeader + 20
  if (optHeader + 2 > raw.length) return pe

  const magic = readU16LE(view, optHeader)
  const is64 = magic === 0x20B

  if (is64) {
    pe.entry_point = readU32LE(view, optHeader + 16)
    pe.image_base = Number(readU64LE(view, optHeader + 24))
  } else {
    pe.entry_point = readU32LE(view, optHeader + 16)
    pe.image_base = readU32LE(view, optHeader + 28)
  }

  // Subsystem
  const subsystemOffset = optHeader + 68
  if (subsystemOffset + 2 <= raw.length) {
    const subsystem = readU16LE(view, subsystemOffset)
    const subsystems: Record<number, string> = {
      1: 'Native',
      2: 'Windows GUI',
      3: 'Windows Console (CLI)',
      5: 'OS/2 Console',
      7: 'POSIX Console',
      9: 'Windows CE GUI',
      10: 'EFI Application',
      14: 'Xbox',
    }
    pe.subsystem = subsystems[subsystem] || `Unknown (${subsystem})`
  }

  // Compile timestamp
  const timeDateStamp = readU32LE(view, coffHeader + 4)
  if (timeDateStamp > 0) {
    const date = new Date(timeDateStamp * 1000)
    if (date.getFullYear() >= 1990 && date.getFullYear() <= new Date().getFullYear() + 1) {
      pe.compile_time = date.toISOString()
    }
  }

  // Data directories start offset
  const dataDirStart = optHeader + (is64 ? 112 : 96)

  // Number of RVA and sizes
  const numberOfRvaAndSizes = readU32LE(view, dataDirStart - 4)

  // Import directory RVA (index 1)
  let importRva = 0
  let importSize = 0
  if (numberOfRvaAndSizes > 1 && dataDirStart + 16 <= raw.length) {
    importRva = readU32LE(view, dataDirStart + 8)
    importSize = readU32LE(view, dataDirStart + 12)
  }

  // Export directory RVA (index 0)
  let exportRva = 0
  let exportSize = 0
  if (numberOfRvaAndSizes > 0 && dataDirStart + 8 <= raw.length) {
    exportRva = readU32LE(view, dataDirStart)
    exportSize = readU32LE(view, dataDirStart + 4)
  }

  // Resource directory RVA (index 2)
  let resourceRva = 0
  let resourceSize = 0
  if (numberOfRvaAndSizes > 2 && dataDirStart + 24 <= raw.length) {
    resourceRva = readU32LE(view, dataDirStart + 16)
    resourceSize = readU32LE(view, dataDirStart + 20)
  }

  // Sections
  const sectionTableStart = optHeader + sizeOfOptionalHeader
  const MAX_SECTIONS = Math.min(numberOfSections, 96)

  for (let i = 0; i < MAX_SECTIONS; i++) {
    const secOff = sectionTableStart + (i * 40)
    if (secOff + 40 > raw.length) break

    const name = readAsciiString(raw, secOff, 8)
    const virtualSize = readU32LE(view, secOff + 8)
    const virtualAddress = readU32LE(view, secOff + 12)
    const rawSize = readU32LE(view, secOff + 16)
    const rawOffset = readU32LE(view, secOff + 20)
    const characteristics = readU32LE(view, secOff + 36)

    // Calculate entropy for this section
    const secData = safeSlice(raw, rawOffset, rawOffset + Math.min(rawSize, raw.length - rawOffset))
    const entropy = calculateEntropy(secData)

    const flags: string[] = []
    if (characteristics & 0x00000020) flags.push('CODE')
    if (characteristics & 0x00000040) flags.push('INITIALIZED_DATA')
    if (characteristics & 0x00000080) flags.push('UNINITIALIZED_DATA')
    if (characteristics & 0x20000000) flags.push('EXECUTE')
    if (characteristics & 0x40000000) flags.push('READ')
    if (characteristics & 0x80000000) flags.push('WRITE')

    pe.sections.push({
      name,
      virtual_size: virtualSize,
      virtual_address: virtualAddress,
      raw_offset: rawOffset,
      raw_size: rawSize,
      characteristics,
      entropy,
      flags,
    })
  }

  // Check entry point location
  const entrySection = pe.sections.find(
    (sec) => pe.entry_point >= sec.virtual_address && pe.entry_point < sec.virtual_address + sec.virtual_size
  )
  if (entrySection) {
    const entryOffset = rvaToOffset(pe.entry_point, pe.sections)
    if (entryOffset > 0 && entryOffset < raw.length) {
      const entryBytes = safeSlice(raw, entryOffset, Math.min(entryOffset + 16, raw.length))
      const entryHex = uint8ToHex(entryBytes)
      // Common pushad/mov patterns (packer signatures)
      if (entryHex.startsWith('60') || entryHex.startsWith('fc68') || entryHex.startsWith('e8') || entryHex.startsWith('bbe8')) {
        if (entrySection.entropy > 7.0) {
          pe.detected_packer.push('Possible entry point obfuscation')
        }
      }
    }
  }

  // Parse imports
  if (importRva > 0 && importSize > 0) {
    const importOffset = rvaToOffset(importRva, pe.sections)
    if (importOffset > 0 && importOffset < raw.length) {
      for (let i = 0; i < 500; i++) {
        const descOff = importOffset + (i * 20)
        if (descOff + 20 > raw.length) break

        const iltRva = readU32LE(view, descOff)
        const nameRva = readU32LE(view, descOff + 12)

        if (iltRva === 0 && nameRva === 0) break

        const dllOffset = rvaToOffset(nameRva, pe.sections)
        if (dllOffset > 0 && dllOffset < raw.length) {
          const dllName = readAsciiString(raw, dllOffset, 256)
          if (!dllName) continue

          const functions: string[] = []
          const iltOffset = rvaToOffset(iltRva, pe.sections)
          if (iltOffset > 0) {
            for (let j = 0; j < 200; j++) {
              const funcEntryOff = iltOffset + (j * (is64 ? 8 : 4))
              if (funcEntryOff + (is64 ? 8 : 4) > raw.length) break

              if (is64) {
                const entry = readU64LE(view, funcEntryOff)
                if (entry === BigInt(0)) break
                if (entry & BigInt(1)) {
                  const ordinal = Number(entry >> BigInt(32))
                  functions.push(`Ordinal#${ordinal}`)
                } else {
                  const hintRva = Number(entry)
                  const hintOffset = rvaToOffset(hintRva, pe.sections)
                  if (hintOffset > 0 && hintOffset + 2 < raw.length) {
                    const funcName = readAsciiString(raw, hintOffset + 2, 256)
                    if (funcName) functions.push(funcName)
                  }
                }
              } else {
                const entry = readU32LE(view, funcEntryOff)
                if (entry === 0) break
                if (entry & 1) {
                  functions.push(`Ordinal#${entry >> 16}`)
                } else {
                  const hintOffset = rvaToOffset(entry, pe.sections)
                  if (hintOffset > 0 && hintOffset + 2 < raw.length) {
                    const funcName = readAsciiString(raw, hintOffset + 2, 256)
                    if (funcName) functions.push(funcName)
                  }
                }
              }
            }
          }

          pe.imports.push({ dll: dllName.toLowerCase(), functions })
        }
      }
    }
  }

  // Parse exports
  if (exportRva > 0 && exportSize > 0) {
    const exportOffset = rvaToOffset(exportRva, pe.sections)
    if (exportOffset > 0 && exportOffset + 40 <= raw.length) {
      const numFunctions = readU32LE(view, exportOffset + 20)
      const numNames = readU32LE(view, exportOffset + 24)
      const namesRva = readU32LE(view, exportOffset + 32)

      const namesOffset = rvaToOffset(namesRva, pe.sections)
      if (namesOffset > 0) {
        const maxNames = Math.min(numNames, 500)
        for (let i = 0; i < maxNames; i++) {
          const namePtrOff = namesOffset + (i * 4)
          if (namePtrOff + 4 > raw.length) break
          const nameRva = readU32LE(view, namePtrOff)
          const nameOffset = rvaToOffset(nameRva, pe.sections)
          if (nameOffset > 0 && nameOffset < raw.length) {
            const name = readAsciiString(raw, nameOffset, 256)
            if (name) pe.exports.push(name)
          }
        }
      }
    }
  }

  // Detect packers
  const packerSignatures: Record<string, { check: (p: PEInfo) => boolean }> = {
    'UPX': {
      check: (p) => p.sections.some((s) => s.name.startsWith('UPX')),
    },
    'Themida/WinLicense': {
      check: (p) => p.sections.some((s) => s.name.includes('themida') || s.name.includes('.vmp')),
    },
    'VMProtect': {
      check: (p) => p.sections.some((s) => s.name.startsWith('.vmp')),
    },
    'ASPack': {
      check: (p) => p.sections.some((s) => s.name.includes('aspack')),
    },
    'PECompact': {
      check: (p) => p.sections.some((s) => s.name.startsWith('.pec')),
    },
    'MPRESS': {
      check: (p) => p.sections.some((s) => s.name.startsWith('.MPRESS')),
    },
    'Armadillo': {
      check: (p) => p.imports.some((imp) => imp.dll.includes('arm')),
    },
    'Enigma Protector': {
      check: (p) => p.sections.some((s) => s.name.startsWith('.enigma')),
    },
    'Obsidium': {
      check: (p) => p.sections.some((s) => s.name.includes('obsidium')),
    },
    'PEtite': {
      check: (p) => p.sections.some((s) => s.name.includes('petite')),
    },
    'NSPack': {
      check: (p) => p.sections.some((s) => s.name.startsWith('.nsp')),
    },
  }

  for (const [packerName, sig] of Object.entries(packerSignatures)) {
    if (sig.check(pe)) {
      pe.detected_packer.push(packerName)
    }
  }

  // High entropy sections without packer name -> possible custom packer
  const highEntropySections = pe.sections.filter((s) => s.entropy > 7.5 && !s.name.startsWith('.text'))
  if (highEntropySections.length > 0 && pe.detected_packer.length === 0) {
    pe.detected_packer.push('Possible custom encryption/packing')
  }

  // Parse resources (basic)
  if (resourceRva > 0 && resourceSize > 0) {
    const resOffset = rvaToOffset(resourceRva, pe.sections)
    if (resOffset > 0 && resOffset < raw.length) {
      const resourceTypes: Record<number, string> = {
        1: 'Cursor',
        2: 'Bitmap',
        3: 'Icon',
        4: 'Menu',
        5: 'Dialog',
        6: 'String Table',
        7: 'Font Directory',
        8: 'Font',
        9: 'Accelerator',
        10: 'RC Data',
        11: 'Message Table',
        12: 'Group Cursor',
        14: 'Group Icon',
        16: 'Version Info',
        24: 'Manifest',
      }

      try {
        const numNamedTypes = readU16LE(view, resOffset + 12)
        const numIdTypes = readU16LE(view, resOffset + 14)
        const totalTypes = numNamedTypes + numIdTypes

        for (let i = 0; i < Math.min(totalTypes, 32); i++) {
          const entryOff = resOffset + 16 + (i * 8)
          if (entryOff + 8 > raw.length) break

          const typeID = readU32LE(view, entryOff)
          const typeStr = resourceTypes[typeID] || `Type#${typeID}`

          if (!pe.resources.some((r) => r.type === typeStr)) {
            pe.resources.push({ type: typeStr, name: 'Embedded', language: 'Neutral', size: 0 })
          }
        }
      } catch {
        // Resource parsing is best-effort
      }
    }
  }

  pe.scan_time = Date.now() - startTime
  return pe
}

// ============================================================
// Binary String Engine (for EXE files)
// ============================================================

function binaryStringEngine(buf: Uint8Array): PatternMatch[] {
  const matches: PatternMatch[] = []
  const strings = extractStringsFromBuffer(buf, 5)

  const suspiciousPatterns: { pattern: RegExp; desc: string; severity: number }[] = [
    { pattern: /powershell/i, desc: 'PowerShell command execution detected', severity: 8 },
    { pattern: /cmd\.exe|cmd \/c/i, desc: 'CMD shell execution detected', severity: 7 },
    { pattern: /reg(?:istry|edit|svr32|add)/i, desc: 'Registry manipulation detected', severity: 7 },
    { pattern: /svchost\.exe/i, desc: 'May masquerade as svchost.exe', severity: 6 },
    { pattern: /temp[\\/]|%temp%|appdata/i, desc: 'Uses temporary or AppData directories', severity: 5 },
    { pattern: /http[s]?:\/\/.*?\.(?:tk|ml|ga|cf|gq|pw|top)/i, desc: 'Connects to suspicious TLD domain', severity: 8 },
    { pattern: /\/c\s+(?:curl|wget|Invoke-WebRequest|Start-BitsTransfer)/i, desc: 'Downloads files via command line', severity: 9 },
    { pattern: /net\s+(?:user|localgroup|share|start|stop)/i, desc: 'Network/user configuration commands', severity: 6 },
    { pattern: /taskkill|tasklist|wmic\s+process/i, desc: 'Process manipulation detected', severity: 7 },
    { pattern: /bypass|block| AMSI/i, desc: 'AMSI bypass attempt detected', severity: 9 },
    { pattern: /Set-MpPreference|Add-MpPreference|Disable-Windows/i, desc: 'Antivirus tampering detected', severity: 10 },
    { pattern: /iex\b|invoke-expression|Start-Process/i, desc: 'Dynamic code execution detected', severity: 8 },
    { pattern: /DownloadString|DownloadFile|WebClient/i, desc: 'Network download capability detected', severity: 7 },
    { pattern: /crypt(?:protect|unprotect|32)/i, desc: 'Cryptographic API usage detected', severity: 6 },
    { pattern: /key(?:board|log|stroke)/i, desc: 'Possible keylogger functionality', severity: 9 },
    { pattern: /screen(?:capture|shot|grab|spy)/i, desc: 'Screen capture capability detected', severity: 9 },
    { pattern: /bitcoin|wallet|crypto|mining/i, desc: 'Cryptocurrency-related activity detected', severity: 7 },
    { pattern: /token|authorization|bearer/i, desc: 'Token/auth interception possible', severity: 6 },
    { pattern: /discord(?:\.gg|app|api|webhook)/i, desc: 'Discord API/webhook usage detected', severity: 5 },
    { pattern: /inject|hook|dll.*inject|loadlibrary/i, desc: 'Code injection capability detected', severity: 9 },
    { pattern: /reverse.*shell|bind.*shell|backdoor/i, desc: 'Backdoor/remote shell detected', severity: 10 },
    { pattern: /rat\.|remote.*access|teamviewer|anydesk/i, desc: 'Remote Access Trojan indicators detected', severity: 8 },
    { pattern: /base64.*decode|frombase64|atob\b/i, desc: 'Base64 decoding detected', severity: 4 },
    { pattern: /\\\\[?\\].*pipe/i, desc: 'Named pipe communication detected', severity: 6 },
    { pattern: /screenshot|webcam|microphone|camera/i, desc: 'Spying capability detected', severity: 9 },
    { pattern: /credential|password|login|passwd/i, desc: 'Credential harvesting indicators detected', severity: 8 },
    { pattern: /chrome|firefox|browser.*data|cookie.*steal/i, desc: 'Browser data theft indicators', severity: 8 },
  ]

  for (const str of strings) {
    for (const { pattern, desc, severity } of suspiciousPatterns) {
      if (pattern.test(str)) {
        if (!matches.some((m) => m.description === desc)) {
          matches.push({
            pattern: str.substring(0, 100),
            type: severity >= 8 ? 'malicious' : severity >= 6 ? 'suspicious' : 'info',
            description: desc,
            severity,
          })
        }
      }
    }
  }

  return matches.sort((a, b) => b.severity - a.severity)
}

// ============================================================
// Obfuscation Detection Engine
// ============================================================

function detectObfuscation(content: string): ObfuscationReport {
  const report: ObfuscationReport = {
    is_obfuscated: false,
    confidence: 0,
    layers: 0,
    techniques: [],
    decoded_size: 0,
    original_size: content.length,
  }

  let current = content
  let layerCount = 0
  const MAX_LAYERS = 8

  for (let i = 0; i < MAX_LAYERS; i++) {
    let decoded = ''
    let found = false

    // Base64 layer
    const base64Match = current.match(/(?:["'`])([A-Za-z0-9+/]{20,}={0,2})(?:["'`])/)
    if (base64Match) {
      decoded = decodeBase64(base64Match[1])
      if (decoded && decoded.length > 10 && /[\x20-\x7E]{10,}/.test(decoded)) {
        current = decoded
        layerCount++
        if (!report.techniques.includes('Base64 Encoding')) {
          report.techniques.push('Base64 Encoding')
        }
        found = true
        continue
      }
    }

    // Hex layer
    const hexMatch = current.match(/(?:["'`])([0-9a-fA-F]{40,})(?:["'`])/)
    if (hexMatch) {
      decoded = decodeHex(hexMatch[1])
      if (decoded && decoded.length > 10 && /[\x20-\x7E]{10,}/.test(decoded)) {
        current = decoded
        layerCount++
        if (!report.techniques.includes('Hex Encoding')) {
          report.techniques.push('Hex Encoding')
        }
        found = true
        continue
      }
    }

    // Unicode escape layer
    if (/\\u[0-9a-fA-F]{4}/.test(current)) {
      decoded = decodeUnicodeEscapes(current)
      if (decoded !== current && decoded.length > 10) {
        current = decoded
        layerCount++
        if (!report.techniques.includes('Unicode Escaping')) {
          report.techniques.push('Unicode Escaping')
        }
        found = true
        continue
      }
    }

    // ROT13 layer
    if (/[a-zA-Z]/.test(current)) {
      decoded = decodeROT13(current)
      if (decoded !== current) {
        const rot13Sensitivity = (decoded.match(/eval|exec|function|var |let |const |import |require|fetch|http|\.exe/i) || []).length
        const origSensitivity = (current.match(/eval|exec|function|var |let |const |import |require|fetch|http|\.exe/i) || []).length
        if (rot13Sensitivity > origSensitivity) {
          current = decoded
          layerCount++
          if (!report.techniques.includes('ROT13 Cipher')) {
            report.techniques.push('ROT13 Cipher')
          }
          found = true
          continue
        }
      }
    }

    // XOR layer (common single-byte keys)
    if (!found) {
      for (let key = 1; key <= 255; key++) {
        decoded = tryXORDecode(current, key)
        if (decoded && decoded.length > 10) {
          current = decoded
          layerCount++
          if (!report.techniques.includes('XOR Encryption')) {
            report.techniques.push('XOR Encryption')
          }
          found = true
          break
        }
      }
    }

    if (!found) break
  }

  // Additional obfuscation indicators
  const encodedCharRatio = (current.match(/\\x[0-9a-fA-F]{2}/g) || []).length / Math.max(current.length, 1)
  if (encodedCharRatio > 0.3 && !report.techniques.includes('Hex Character Encoding')) {
    report.techniques.push('Hex Character Encoding')
  }

  const unicodeEscapeRatio = (current.match(/\\u[0-9a-fA-F]{4}/g) || []).length / Math.max(current.length, 1)
  if (unicodeEscapeRatio > 0.3 && !report.techniques.includes('Heavy Unicode Escaping')) {
    report.techniques.push('Heavy Unicode Escaping')
  }

  // Check for common obfuscation patterns
  if (/\beval\s*\(/.test(current)) report.techniques.push('eval() Dynamic Execution')
  if (/\bFunction\s*\(/.test(current)) report.techniques.push('Function Constructor')
  if (/atob\s*\(/.test(current) || /btoa\s*\(/.test(current)) report.techniques.push('Base64 Functions (atob/btoa)')
  if (/\\x[0-9a-fA-F]{2}.+\\x[0-9a-fA-F]{2}.+\\x[0-9a-fA-F]{2}/.test(current)) {
    if (!report.techniques.includes('Hex Character Encoding')) report.techniques.push('Hex Character Encoding')
  }
  if (/(?:\.\s*){3,}/.test(current)) report.techniques.push('String Concatenation Obfuscation')
  if (/\[\s*['"][a-zA-Z]['"]\s*\]/.test(current)) report.techniques.push('Bracket Notation Obfuscation')

  report.layers = layerCount
  report.decoded_size = current.length
  report.is_obfuscated = report.techniques.length > 0
  report.confidence = Math.min(Math.round((report.techniques.length * 15) + (layerCount * 10)), 100)

  return report
}

// ============================================================
// Pattern Engine (for source code / text files)
// ============================================================

function patternEngineAnalyze(content: string, obfuscation: ObfuscationReport): PatternMatch[] {
  const matches: PatternMatch[] = []

  const maliciousPatterns: { pattern: RegExp; desc: string; severity: number }[] = [
    { pattern: /\beval\s*\(/, desc: 'Dynamic code execution via eval()', severity: 8 },
    { pattern: /\bFunction\s*\(\s*['"`]/, desc: 'Function constructor abuse', severity: 8 },
    { pattern: /\bexec\s*\(/, desc: 'System command execution', severity: 9 },
    { pattern: /\bspawn\s*\(/, desc: 'Process spawning detected', severity: 7 },
    { pattern: /\bchild_process\b/, desc: 'Child process module usage', severity: 7 },
    { pattern: /\bfs\b\.\s*(?:read|write|unlink)/, desc: 'File system manipulation', severity: 6 },
    { pattern: /\brequire\s*\(\s*['"`]child_process['"`]\s*\)/, desc: 'Requires child_process module', severity: 7 },
    { pattern: /https?:\/\/.*?(?:discord\.gg|discord\.com\/api|discordapp\.com)/, desc: 'Discord webhook/API interaction', severity: 5 },
    { pattern: /\bfetch\s*\(\s*['"`]https?:\/\//, desc: 'Outbound network request via fetch', severity: 5 },
    { pattern: /\bXMLHttpRequest\b/, desc: 'XMLHttpRequest (network activity)', severity: 5 },
    { pattern: /\bWebSocket\b/, desc: 'WebSocket connection detected', severity: 5 },
    { pattern: /\blocalStorage\b|\bsessionStorage\b/, desc: 'Browser storage access', severity: 4 },
    { pattern: /\bdocument\.cookie\b/, desc: 'Cookie access detected', severity: 6 },
    { pattern: /\bnavigator\.clipboard\b|\bdocument\.execCommand\s*\(\s*['"`]copy['"`]\s*\)/, desc: 'Clipboard access', severity: 5 },
    { pattern: /new\s+Image\(\)\.src\s*=|Image\s*\(\s*\)\s*\.\s*src/, desc: 'Image-based tracking/ping', severity: 5 },
    { pattern: /\bwindow\.location\b\s*=|\blocation\.href\b\s*=|\blocation\.replace\b/, desc: 'URL redirection detected', severity: 6 },
    { pattern: /\bwindow\.open\b/, desc: 'Popup window creation', severity: 4 },
    { pattern: /\bself\.(?:remove|delete|destroy)/, desc: 'Self-destructive behavior', severity: 9 },
    { pattern: /\bros[\\/](?:boot|startup|init|rc\.local)/, desc: 'Persistence mechanism (boot scripts)', severity: 9 },
    { pattern: /\bcrontab|\bschtasks\b|\bat\s+\d{1,2}:\d{2}/, desc: 'Scheduled task/cron job', severity: 8 },
    { pattern: /\bkeylog|key[\s_]*(?:stroke|capture|press|record|hook)/i, desc: 'Keylogger functionality', severity: 10 },
    { pattern: /\bscreen[\s_]*(?:capture|shot|grab|record|spy|watch)/i, desc: 'Screen capture/spying', severity: 9 },
    { pattern: /\bwebcam|camera[\s_]*(?:capture|access|record|spy)/i, desc: 'Webcam access/capture', severity: 10 },
    { pattern: /\bpassword|credential|passwd|login[\s_]*(?:steal|grab|capture|harvest|log)/i, desc: 'Credential theft', severity: 9 },
    { pattern: /\btoken[\s_]*(?:steal|grab|capture|harvest|log)/i, desc: 'Token theft attempt', severity: 9 },
    { pattern: /\bcookie[\s_]*(?:steal|grab|capture|harvest)/i, desc: 'Cookie theft attempt', severity: 8 },
    { pattern: /\bbrowser[\s_]*(?:data|info|history|steal|grab)/i, desc: 'Browser data theft', severity: 8 },
    { pattern: /\bchrome|firefox|brave.*(?:pass|cookie|login|data|history)/i, desc: 'Targeting specific browser data', severity: 8 },
    { pattern: /\bbit(?:coin|coin|cash)|wallet[\s_]*(?:steal|drain|grab)|crypto[\s_]*(?:mine|steal)/i, desc: 'Cryptocurrency theft/mining', severity: 9 },
    { pattern: /\bmining|pool.*(?:stratum|mining)|worker.*(?:nonce|hash)/i, desc: 'Crypto mining indicators', severity: 8 },
    { pattern: /\bAMSI|amsi|anti[\s_-]*malware.*(?:bypass|disable|patch)/i, desc: 'AMSI bypass attempt', severity: 10 },
    { pattern: /\bSet-MpPreference|Add-MpPreference|Disable-Windows/i, desc: 'Windows Defender tampering', severity: 10 },
    { pattern: /\btaskkill|process.*(?:kill|terminate|stop)/i, desc: 'Process termination', severity: 7 },
    { pattern: /\breverse[\s_-]*shell|bind[\s_-]*shell|back[\s_-]*door/i, desc: 'Backdoor/remote shell', severity: 10 },
    { pattern: /\bRAT[\s_-]|remote[\s_-]*access[\s_-]*trojan|trojan[\s_-]*rat/i, desc: 'Remote Access Trojan (RAT)', severity: 10 },
    { pattern: /\bdownload[\s_-]*(?:string|file|data|payload)/i, desc: 'Remote payload download', severity: 8 },
    { pattern: /\bshellcode|payload.*(?:exec|run|inject|load)/i, desc: 'Shellcode/payload execution', severity: 10 },
    { pattern: /\bdll[\s_-]*(?:inject|load|hook|plant)/i, desc: 'DLL injection', severity: 9 },
    { pattern: /\breflective[\s_-]*(?:dll|load|inject|pe)/i, desc: 'Reflective DLL loading', severity: 9 },
    { pattern: /\bhook[\s_-]*(?:api|keyboard|mouse|function|procedure)/i, desc: 'API/function hooking', severity: 8 },
    { pattern: /\bpipe[\s_-]*(?:create|connect|named)/i, desc: 'Named pipe communication', severity: 6 },
    { pattern: /\bsocket[\s_-]*(?:connect|bind|listen|send|recv)/i, desc: 'Socket communication', severity: 6 },
    { pattern: /\bprocess\.env\b/, desc: 'Environment variable access', severity: 4 },
    { pattern: /\bos\.\s*(?:platform|type|hostname|networkInterfaces|userInfo)/, desc: 'System information gathering', severity: 5 },
    { pattern: /\bBuffer\.allocUnsafe\s*\(/, desc: 'Unsafe buffer allocation', severity: 6 },
    { pattern: /\bnew\s+Function\s*\(/, desc: 'Dynamic function creation', severity: 8 },
    { pattern: /\batob\s*\(/, desc: 'Base64 decoding function', severity: 3 },
    { pattern: /\bString\.fromCharCode\s*\(/, desc: 'Character code conversion', severity: 3 },
    { pattern: /\bparseInt\s*\(\s*['"`][0-9a-fA-F]/, desc: 'Hex string parsing', severity: 3 },
    { pattern: /\bsetTimeout\s*\(\s*['"`]/, desc: 'String-based setTimeout (potential obfuscation)', severity: 4 },
    { pattern: /\bsetInterval\s*\(\s*['"`]/, desc: 'String-based setInterval (potential obfuscation)', severity: 4 },
  ]

  // Scan original content
  const lines = content.split('\n')
  for (const { pattern, desc, severity } of maliciousPatterns) {
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        if (!matches.some((m) => m.description === desc)) {
          matches.push({
            pattern: lines[i].substring(0, 100).trim(),
            type: severity >= 8 ? 'malicious' : severity >= 6 ? 'suspicious' : 'info',
            description: desc,
            severity,
            line: i + 1,
          })
        }
        break
      }
    }
  }

  // Also scan decoded content from obfuscation
  if (obfuscation.is_obfuscated && obfuscation.decoded_size > 0) {
    const decodedContent = content.substring(0, obfuscation.decoded_size)
    for (const { pattern, desc, severity } of maliciousPatterns) {
      if (pattern.test(decodedContent)) {
        if (!matches.some((m) => m.description === desc)) {
          matches.push({
            pattern: decodedContent.substring(0, 100).trim(),
            type: severity >= 8 ? 'malicious' : severity >= 6 ? 'suspicious' : 'info',
            description: `${desc} (found in decoded layer)`,
            severity,
          })
        }
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

  // Obfuscation score
  if (obfuscation.is_obfuscated) {
    score += Math.min(obfuscation.confidence * 0.3, 30)
  }
  if (obfuscation.layers > 2) {
    score += 10
  }

  // Pattern severity score
  for (const p of patterns) {
    score += p.severity * 1.5
  }

  // PE-specific scoring
  if (peInfo && peInfo.is_valid_pe) {
    // Packer detection
    if (peInfo.detected_packer.length > 0) {
      score += 15
    }

    // High entropy sections
    for (const sec of peInfo.sections) {
      if (sec.entropy > 7.5 && !sec.name.startsWith('.text') && !sec.name.startsWith('.rdata')) {
        score += 5
      }
    }

    // Suspicious imports
    const suspiciousDlls = ['kernel32.dll', 'ntdll.dll', 'user32.dll', 'ws2_32.dll', 'wininet.dll', 'urlmon.dll', 'shell32.dll']
    const suspiciousFuncs = [
      'VirtualAlloc', 'VirtualAllocEx', 'VirtualProtect', 'VirtualProtectEx',
      'CreateRemoteThread', 'WriteProcessMemory', 'ReadProcessMemory',
      'OpenProcess', 'GetProcAddress', 'LoadLibrary',
      'SetWindowsHookEx', 'GetAsyncKeyState', 'GetForegroundWindow',
      'ShellExecute', 'WinExec', 'CreateProcess',
      'InternetOpen', 'InternetConnect', 'HttpOpenRequest', 'HttpSendRequest',
      'URLDownloadToFile', 'WinHttpConnect',
      'CryptEncrypt', 'CryptDecrypt', 'CryptGenKey',
      'RegSetValue', 'RegCreateKey', 'RegDeleteKey',
      'SetErrorMode', 'SetUnhandledExceptionFilter',
    ]

    for (const imp of peInfo.imports) {
      if (suspiciousDlls.some((dll) => imp.dll.includes(dll))) {
        const dangerousFuncs = imp.functions.filter((fn) =>
          suspiciousFuncs.some((sf) => fn.toLowerCase().includes(sf.toLowerCase()))
        )
        score += dangerousFuncs.length * 3
      }
    }

    // Entry point anomalies
    const epSection = peInfo.sections.find(
      (sec) => peInfo.entry_point >= sec.virtual_address && peInfo.entry_point < sec.virtual_address + sec.virtual_size
    )
    if (epSection && epSection.entropy > 7.0) {
      score += 10
    }

    // Console subsystem + suspicious imports = likely CLI malware
    if (peInfo.subsystem.includes('Console') && peInfo.imports.some((i) => i.dll.includes('ws2_32') || i.dll.includes('wininet'))) {
      score += 5
    }
  }

  return Math.min(Math.round(score), 100)
}

// ============================================================
// Detailed Analysis Builder
// ============================================================

function buildDetailedAnalysis(
  filename: string,
  content: string,
  obfuscation: ObfuscationReport,
  patterns: PatternMatch[],
  peInfo: PEInfo | null,
  heuristicScore: number
): DetailedAnalysis {
  const capabilities: string[] = []
  const detectedTechniques: string[] = []

  // Determine capabilities from patterns
  const capMap: Record<string, string[]> = {
    'keylog': ['Keylogging', 'Input Monitoring'],
    'screen': ['Screen Capture', 'Desktop Monitoring'],
    'webcam': ['Webcam Access', 'Video Surveillance'],
    'credential': ['Credential Theft', 'Authentication Hijacking'],
    'password': ['Password Harvesting', 'Authentication Bypass'],
    'token': ['Token Theft', 'Session Hijacking'],
    'cookie': ['Cookie Theft', 'Session Hijacking'],
    'bitcoin|crypto|mining': ['Cryptocurrency Mining', 'Financial Theft'],
    'browser|chrome|firefox': ['Browser Data Theft', 'Saved Data Extraction'],
    'reverse.*shell|backdoor': ['Remote Shell', 'Backdoor Access'],
    'dll.*inject|inject': ['Code Injection', 'Process Manipulation'],
    'download|payload': ['Payload Download', 'Remote Code Execution'],
    'registry|reg': ['Registry Modification', 'System Configuration'],
    'AMSI|defender|antivirus': ['Security Evasion', 'Antivirus Bypass'],
    'hook|api.*hook': ['API Hooking', 'Function Interception'],
  }

  for (const match of patterns) {
    for (const [keyword, caps] of Object.entries(capMap)) {
      if (new RegExp(keyword, 'i').test(match.description)) {
        for (const cap of caps) {
          if (!capabilities.includes(cap)) capabilities.push(cap)
        }
      }
    }
  }

  // PE-specific capabilities
  if (peInfo && peInfo.is_valid_pe) {
    if (peInfo.imports.some((i) => i.dll.includes('ws2_32') || i.dll.includes('wininet') || i.dll.includes('urlmon'))) {
      if (!capabilities.includes('Network Communication')) capabilities.push('Network Communication')
    }
    if (peInfo.imports.some((i) => i.dll.includes('kernel32') && i.functions.some((f) => f.toLowerCase().includes('virtualalloc')))) {
      if (!capabilities.includes('Memory Manipulation')) capabilities.push('Memory Manipulation')
    }
    if (peInfo.imports.some((i) => i.dll.includes('user32') && i.functions.some((f) => f.toLowerCase().includes('setwindowshookex')))) {
      if (!capabilities.includes('Input Hooking')) capabilities.push('Input Hooking')
    }
    if (peInfo.detected_packer.length > 0) {
      if (!capabilities.includes('Anti-Analysis')) capabilities.push('Anti-Analysis')
      detectedTechniques.push(...peInfo.detected_packer)
    }
  }

  // Obfuscation techniques
  if (obfuscation.is_obfuscated) {
    detectedTechniques.push(...obfuscation.techniques)
  }

  // Determine file purpose
  let filePurpose = 'Unknown / Benign'
  const allText = content + ' ' + patterns.map((p) => p.description).join(' ')

  if (/stealer|grabber|info.*steal/i.test(allText)) {
    filePurpose = 'Information Stealer - Designed to collect and exfiltrate sensitive data such as credentials, browser data, and cryptocurrency wallets'
  } else if (/rat|remote.*access|trojan/i.test(allText)) {
    filePurpose = 'Remote Access Trojan (RAT) - Allows unauthorized remote control of the infected system'
  } else if (/keylog/i.test(allText)) {
    filePurpose = 'Keylogger - Records keystrokes to capture passwords, messages, and other sensitive input'
  } else if (/cryptominer|mining|pool.*stratum/i.test(allText)) {
    filePurpose = 'Cryptocurrency Miner - Uses system resources to mine cryptocurrency without user consent'
  } else if (/download|payload|dropper/i.test(allText)) {
    filePurpose = 'Dropper/Downloader - Downloads and installs additional malicious payloads'
  } else if (/ransom|encrypt.*file|decrypt.*pay/i.test(allText)) {
    filePurpose = 'Ransomware - Encrypts files and demands payment for decryption'
  } else if (/reverse.*shell|backdoor|bind.*shell/i.test(allText)) {
    filePurpose = 'Backdoor - Provides unauthorized remote access to the system'
  } else if (/ddos|flood|stress.*test/i.test(allText)) {
    filePurpose = 'DDoS Tool - Used for distributed denial-of-service attacks'
  } else if (/clipper|clipboard.*replace|clipboard.*swap/i.test(allText)) {
    filePurpose = 'Crypto Clipper - Replaces cryptocurrency wallet addresses in clipboard'
  } else if (/bot|zombie|c2|command.*control/i.test(allText)) {
    filePurpose = 'Botnet Client - Part of a network of compromised machines under central control'
  } else if (obfuscation.is_obfuscated && heuristicScore > 30) {
    filePurpose = 'Obfuscated Script - Heavily obfuscated code with potentially malicious intent (hidden functionality detected)'
  } else if (peInfo?.is_valid_pe && peInfo.detected_packer.length > 0) {
    filePurpose = `Packed Executable - Packed with ${peInfo.detected_packer.join(', ')} to evade detection`
  } else if (capabilities.length > 0) {
    filePurpose = `Suspicious File with detected capabilities: ${capabilities.slice(0, 3).join(', ')}`
  }

  // Encryption status
  let encryptionStatus = 'Not Encrypted'
  if (peInfo) {
    const highEntropySections = peInfo.sections.filter((s) => s.entropy > 7.0)
    if (peInfo.detected_packer.length > 0) {
      encryptionStatus = `Encrypted/Packed (${peInfo.detected_packer.join(', ')})`
    } else if (highEntropySections.length > 0) {
      encryptionStatus = `Likely Encrypted (${highEntropySections.length} high-entropy section(s) detected)`
    } else if (highEntropySections.length === 0 && peInfo.sections.some((s) => s.entropy > 5.5)) {
      encryptionStatus = 'Possibly Encrypted (moderate entropy in some sections)'
    }
  }
  if (obfuscation.is_obfuscated) {
    encryptionStatus = `Obfuscated (${obfuscation.techniques.join(', ')})`
  }

  // Risk level
  let riskLevel: DetailedAnalysis['risk_level'] = 'safe'
  if (heuristicScore >= 60 || patterns.some((p) => p.severity >= 10)) {
    riskLevel = 'critical'
  } else if (heuristicScore >= 40 || patterns.some((p) => p.severity >= 9)) {
    riskLevel = 'high'
  } else if (heuristicScore >= 20 || patterns.some((p) => p.severity >= 7)) {
    riskLevel = 'medium'
  } else if (heuristicScore >= 10 || patterns.some((p) => p.severity >= 5)) {
    riskLevel = 'low'
  }

  // Recommendations
  const recommendations: string[] = []
  if (riskLevel === 'critical' || riskLevel === 'high') {
    recommendations.push('Do not execute this file under any circumstances')
    recommendations.push('Delete the file immediately and scan your system')
    recommendations.push('Change any passwords or credentials that may have been exposed')
    recommendations.push('Run a full antivirus scan on your system')
  } else if (riskLevel === 'medium') {
    recommendations.push('Do not execute this file unless you fully trust the source')
    recommendations.push('Upload to VirusTotal.com for additional scanning')
    recommendations.push('Run in an isolated sandbox environment if analysis is needed')
  } else if (riskLevel === 'low') {
    recommendations.push('Exercise caution - file contains suspicious patterns')
    recommendations.push('Verify the source and purpose of this file')
  }

  if (obfuscation.is_obfuscated) {
    recommendations.push('File uses obfuscation techniques - code behavior may differ from appearance')
  }
  if (peInfo?.detected_packer.length) {
    recommendations.push('File is packed which is commonly used to evade antivirus detection')
  }

  return {
    file_purpose: filePurpose,
    capabilities,
    encryption_status: encryptionStatus,
    capabilities_summary: capabilities.length > 0 ? capabilities.join(', ') : 'No significant capabilities detected',
    risk_level: riskLevel,
    recommendations,
    detected_techniques: [...new Set(detectedTechniques)],
  }
}

// ============================================================
// Combine All Results
// ============================================================

function combineAllResults(
  filename: string,
  content: string,
  obfuscation: ObfuscationReport,
  patterns: PatternMatch[],
  peInfo: PEInfo | null,
  heuristicScore: number,
  detailedAnalysis: DetailedAnalysis
): VirusResult {
  const maliciousPatterns = patterns.filter((p) => p.type === 'malicious')
  const suspiciousPatterns = patterns.filter((p) => p.type === 'suspicious')

  const score = Math.min(
    heuristicScore +
    (maliciousPatterns.length * 5) +
    (suspiciousPatterns.length * 2) +
    (obfuscation.is_obfuscated ? obfuscation.confidence * 0.2 : 0) +
    (peInfo?.detected_packer.length ? 10 : 0),
    100
  )

  const enginesDetected = Math.min(
    Math.ceil(score / 10) +
    (maliciousPatterns.length > 0 ? 2 : 0) +
    (peInfo?.detected_packer.length ? 1 : 0),
    30
  )

  const isInfected = score >= 30 || maliciousPatterns.length >= 2 || patterns.some((p) => p.severity >= 9)

  return {
    is_infected: isInfected,
    score: Math.round(score),
    engines_detected: enginesDetected,
    details: {
      obfuscation,
      patterns: patterns.slice(0, 50),
      pe_info: peInfo,
      detailed_analysis: detailedAnalysis,
      heuristic_score: heuristicScore,
    },
  }
}

// ============================================================
// Main Handler
// ============================================================

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const rateLimitResult = rateLimit(req, RATE_LIMITS.virusScan)
    if (rateLimitResult) return rateLimitResult

    if (req.method !== 'POST') {
      return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // File size limit (50MB)
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: 'File size exceeds 50MB limit' }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const rawBytes = new Uint8Array(arrayBuffer)
    const filename = file.name || 'unknown'

    const isEXE = /\.exe$/i.test(filename) ||
      (rawBytes.length > 2 && rawBytes[0] === 0x4D && rawBytes[1] === 0x5A)

    // Send webhook notification (filename only)
    try {
      await sendToWebhook({
        embeds: [{
          title: 'File Scan',
          description: `A user scanned a file: \`${filename}\``,
          color: 0x2b2d31,
          timestamp: new Date().toISOString(),
        }],
      })
    } catch {
      // Webhook failure should not block the scan
    }

    let result: VirusResult

    if (isEXE) {
      // === EXE File Path (Edge-Compatible) ===
      const peInfo = parsePE(rawBytes)
      const patterns = binaryStringEngine(rawBytes)
      const obfuscation: ObfuscationReport = {
        is_obfuscated: peInfo.detected_packer.length > 0,
        confidence: peInfo.detected_packer.length > 0 ? 80 : 0,
        layers: peInfo.detected_packer.length,
        techniques: [...peInfo.detected_packer],
        decoded_size: rawBytes.length,
        original_size: rawBytes.length,
      }
      const heuristicScore = heuristicAnalyze('', obfuscation, patterns, peInfo)
      const detailedAnalysis = buildDetailedAnalysis(filename, '', obfuscation, patterns, peInfo, heuristicScore)

      result = combineAllResults(filename, '', obfuscation, patterns, peInfo, heuristicScore, detailedAnalysis)
    } else {
      // === Source Code / Text File Path ===
      const decoder = new TextDecoder('utf-8')
      const content = decoder.decode(rawBytes)
      const obfuscation = detectObfuscation(content)
      const patterns = patternEngineAnalyze(content, obfuscation)
      const heuristicScore = heuristicAnalyze(content, obfuscation, patterns, null)
      const detailedAnalysis = buildDetailedAnalysis(filename, content, obfuscation, patterns, null, heuristicScore)

      result = combineAllResults(filename, content, obfuscation, patterns, null, heuristicScore, detailedAnalysis)
    }

    return NextResponse.json({
      success: true,
      file: filename,
      size: file.size,
      result,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error during virus scan'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
