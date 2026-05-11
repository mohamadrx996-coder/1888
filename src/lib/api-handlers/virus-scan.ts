import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { sendToWebhook, getLogWebhookUrl } from '@/lib/webhook'

export const runtime = 'nodejs'
export const maxDuration = 60

// ===================================================================
// INTERFACES
// ===================================================================

interface PESection {
  name: string
  virtual_address: number
  raw_offset: number
  virtual_size: number
  raw_size: number
  entropy: number
  characteristics: number
  is_executable: boolean
  is_readable: boolean
  is_writable: boolean
  entropy_flag: 'normal' | 'packed' | 'encrypted'
}

interface PEImport {
  dll: string
  functions: string[]
}

interface PEResource {
  type: string
  name: string
  size: number
  language?: string
}

interface PEInfo {
  is_pe: boolean
  is_64bit: boolean
  is_dll: boolean
  is_gui: boolean
  machine_type: string
  subsystem: string
  compilation_time: string
  entry_point: number
  image_base: string
  file_size: number
  sections: PESection[]
  imports: PEImport[]
  exports: string[]
  resources: PEResource[]
  packer_detected: string[]
  high_entropy_sections: string[]
  suspicious_section_names: string[]
  has_debug_info: boolean
  has_manifest: boolean
  manifest_content: string
  version_info: Record<string, string>
  linker_version: string
  section_entropy_avg: number
  overlay_size: number
  overlay_flag: boolean
  indicators: string[]
  scan_time: number
}

interface DecodedLayer {
  layer: number
  method: string
  preview: string
  fullContent: string
  patternsFound: number
}

interface ObfuscationReport {
  is_obfuscated: boolean
  confidence: number
  methods: string[]
  layers: DecodedLayer[]
  total_layers_decoded: number
  entropy_score: number
}

interface DetailedAnalysis {
  file_purpose: string
  language_detected: string
  is_encrypted: boolean
  encryption_method: string
  is_packed: boolean
  packer_detected: string
  obfuscation_level: 'none' | 'light' | 'medium' | 'heavy' | 'extreme'
  behavioral_analysis: string[]
  data_targets: string[]
  network_targets: string[]
  persistence_methods: string[]
  anti_analysis: string[]
  deobfuscation_result: string
  risk_explanation: string
}

interface VirusResult {
  file_name: string
  file_size: string
  file_type: string
  md5: string
  sha256: string
  is_suspicious: boolean
  threat_level: 'clean' | 'low' | 'medium' | 'high' | 'critical'
  threat_type: string[]
  threat_score: number
  ports: number[]
  c2_servers: string[]
  suspicious_patterns: { pattern: string; description: string; line?: number; severity: 'info' | 'warning' | 'danger' }[]
  encoded_strings: { type: string; value: string; decoded?: string }[]
  network_indicators: { type: string; value: string }[]
  capabilities: string[]
  summary: string
  recommendation: string
  trojan_type?: string
  engines: {
    pattern_engine: { findings: number; threats: string[]; scan_time: number }
    binary_engine: { findings: number; threats: string[]; scan_time: number; is_binary: boolean; analysis: string }
    heuristic_engine: { findings: number; threats: string[]; scan_time: number }
    pe_engine?: { findings: number; threats: string[]; scan_time: number; pe_info: PEInfo }
  }
  obfuscation: ObfuscationReport
  detailed: DetailedAnalysis
}

// ===================================================================
// أدوات قراءة Buffer
// ===================================================================

function readU16LE(buf: Buffer, offset: number): number {
  return buf.readUInt16LE(offset)
}

function readU32LE(buf: Buffer, offset: number): number {
  return buf.readUInt32LE(offset)
}

function readAscii(buf: Buffer, offset: number, length: number): string {
  let end = offset + length
  for (let i = offset; i < end; i++) {
    if (buf[i] === 0) { end = i; break }
  }
  return buf.slice(offset, end).toString('ascii')
}

function readBigUInt64LE(buf: Buffer, offset: number): bigint {
  if (offset + 8 > buf.length) return 0n
  const low = buf.readUInt32LE(offset)
  const high = buf.readUInt32LE(offset + 4)
  return (BigInt(high) << 32n) | BigInt(low)
}

// ===================================================================
// أدوات حسابية
// ===================================================================

function calculateBufferEntropy(buf: Buffer): number {
  if (buf.length === 0) return 0
  const freq: number[] = new Array(256).fill(0)
  for (let i = 0; i < buf.length; i++) freq[buf[i]]++
  let entropy = 0
  for (let i = 0; i < 256; i++) {
    if (freq[i] > 0) {
      const p = freq[i] / buf.length
      entropy -= p * Math.log2(p)
    }
  }
  return entropy
}

function calculateStringEntropy(content: string): number {
  const freq: Record<string, number> = {}
  const len = content.length
  if (len === 0) return 0
  for (const ch of content) freq[ch] = (freq[ch] || 0) + 1
  let entropy = 0
  for (const count of Object.values(freq)) {
    const p = count / len
    if (p > 0) entropy -= p * Math.log2(p)
  }
  return entropy
}

function extractBinaryStrings(buf: Buffer): string[] {
  const strings: string[] = []
  let current = ''
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i]
    if (byte >= 0x20 && byte <= 0x7E) {
      current += String.fromCharCode(byte)
    } else {
      if (current.length >= 6) strings.push(current)
      current = ''
    }
  }
  if (current.length >= 6) strings.push(current)
  return strings
}

// ===================================================================
// محرك تحليل PE (PE PARSER ENGINE)
// ===================================================================

function parsePE(raw: Buffer): PEInfo {
  const startTime = performance.now()

  const pe: PEInfo = {
    is_pe: false, is_64bit: false, is_dll: false, is_gui: false,
    machine_type: '', subsystem: '', compilation_time: '', entry_point: 0,
    image_base: '', file_size: raw.length, sections: [], imports: [],
    exports: [], resources: [], packer_detected: [], high_entropy_sections: [],
    suspicious_section_names: [], has_debug_info: false, has_manifest: false,
    manifest_content: '', version_info: {}, linker_version: '',
    section_entropy_avg: 0, overlay_size: 0, overlay_flag: false, indicators: [],
    scan_time: 0,
  }

  if (raw.length < 64) return pe
  if (raw.readUInt16LE(0) !== 0x5A4D) return pe

  const peOffset = readU32LE(raw, 0x3C)
  if (peOffset > raw.length - 4) return pe
  if (readU32LE(raw, peOffset) !== 0x00004550) return pe

  pe.is_pe = true

  // === COFF Header (20 bytes) ===
  const coffStart = peOffset + 4
  if (coffStart + 20 > raw.length) return pe

  const machine = readU16LE(raw, coffStart)
  const numberOfSections = readU16LE(raw, coffStart + 2)
  const timeDateStamp = readU32LE(raw, coffStart + 4)
  const sizeOfOptionalHeader = readU16LE(raw, coffStart + 16)
  const characteristics = readU16LE(raw, coffStart + 18)

  pe.is_dll = !!(characteristics & 0x2000)

  const machineTypes: Record<number, string> = {
    0x0: 'Unknown', 0x14C: 'x86 (32-bit)', 0x8664: 'x64 (64-bit)',
    0x1C0: 'ARM', 0xAA64: 'ARM64', 0x200: 'IA-64',
  }
  pe.machine_type = machineTypes[machine] || `0x${machine.toString(16)}`
  pe.is_64bit = machine === 0x8664 || machine === 0xAA64

  if (timeDateStamp > 0) {
    try {
      pe.compilation_time = new Date(timeDateStamp * 1000).toISOString()
    } catch {
      pe.compilation_time = 'Unknown'
    }
  }

  // === Optional Header ===
  const optStart = coffStart + 20
  if (optStart + 2 > raw.length) return pe

  const optMagic = readU16LE(raw, optStart)
  pe.is_64bit = optMagic === 0x20B

  const subsystems: Record<number, string> = {
    1: 'Native', 2: 'Windows GUI', 3: 'Windows Console',
    5: 'OS/2 CUI', 7: 'POSIX CUI', 9: 'Windows CE GUI',
    10: 'EFI Application', 14: 'Xbox', 16: 'Windows Boot',
  }

  let entryPoint = 0
  let imageBase = ''
  let numberOfRvaAndSizes = 0
  let dataDirectoryOffset = 0

  if (pe.is_64bit) {
    if (optStart + 112 > raw.length) return pe
    pe.subsystem = subsystems[readU16LE(raw, optStart + 68)] || 'Unknown'
    entryPoint = readU32LE(raw, optStart + 16)
    imageBase = `0x${readBigUInt64LE(raw, optStart + 24).toString(16)}`
    numberOfRvaAndSizes = readU32LE(raw, optStart + 108)
    dataDirectoryOffset = optStart + 112
  } else {
    if (optStart + 96 > raw.length) return pe
    pe.subsystem = subsystems[readU16LE(raw, optStart + 68)] || 'Unknown'
    entryPoint = readU32LE(raw, optStart + 16)
    imageBase = `0x${readU32LE(raw, optStart + 28).toString(16)}`
    numberOfRvaAndSizes = readU32LE(raw, optStart + 92)
    dataDirectoryOffset = optStart + 96
  }

  pe.entry_point = entryPoint
  pe.image_base = imageBase
  pe.is_gui = pe.subsystem.includes('GUI')

  // Linker version
  if (optStart + 3 <= raw.length) {
    pe.linker_version = `${raw[optStart + 2]}.${raw[optStart + 3]}`
  }

  // === Data Directories ===
  const dataDirs: { rva: number; size: number }[] = []
  for (let i = 0; i < Math.min(numberOfRvaAndSizes, 16); i++) {
    const off = dataDirectoryOffset + i * 8
    if (off + 8 <= raw.length) {
      dataDirs.push({ rva: readU32LE(raw, off), size: readU32LE(raw, off + 4) })
    } else {
      dataDirs.push({ rva: 0, size: 0 })
    }
  }

  pe.has_debug_info = dataDirs[6].rva > 0 && dataDirs[6].size > 0

  // === RVA to File Offset helper ===
  function rvaToOffset(rva: number): number {
    for (const sec of pe.sections) {
      if (rva >= sec.virtual_address && rva < sec.virtual_address + sec.virtual_size) {
        return sec.raw_offset + (rva - sec.virtual_address)
      }
    }
    return -1
  }

  // === Parse Sections ===
  const sectionTableStart = optStart + sizeOfOptionalHeader

  const suspiciousSectionNames = [
    '.UPX0', '.UPX1', '.UPX2', '.aspack', '.adata', '.enigma1', '.enigma2',
    '.vmp0', '.vmp1', '.vmp2', '.themida', '.mpress1', '.mpress2',
    '.perplex', '.shrink1', '.shrink2', '.petite', '.nsp0', '.nsp1', '.nsp2',
    '.yp', '.DAV', '.PELOCK', '.PESpin',
  ]

  const packerSectionSignatures: Record<string, string> = {
    '.upx0': 'UPX Packer', '.upx1': 'UPX Packer', '.upx2': 'UPX Packer',
    '.aspack': 'ASPack Packer', '.adata': 'Advanced Packer (Enigma/Themida)',
    '.enigma1': 'Enigma Protector', '.enigma2': 'Enigma Protector',
    '.vmp0': 'VMProtect', '.vmp1': 'VMProtect', '.vmp2': 'VMProtect',
    '.themida': 'Themida', '.mpress1': 'MPRESS', '.mpress2': 'MPRESS',
    '.perplex': 'Perplex PE-Protector', '.petite': 'Petite Packer',
    '.nsp0': 'NsPack', '.nsp1': 'NsPack', '.nsp2': 'NsPack',
    '.pelsp1': 'PELock', '.pespin': 'PESpin',
  }

  for (let i = 0; i < numberOfSections; i++) {
    const secOff = sectionTableStart + i * 40
    if (secOff + 40 > raw.length) break

    const name = readAscii(raw, secOff, 8)
    const virtualSize = readU32LE(raw, secOff + 8)
    const virtualAddress = readU32LE(raw, secOff + 12)
    const rawSize = readU32LE(raw, secOff + 16)
    const rawOffset = readU32LE(raw, secOff + 20)
    const secChars = readU32LE(raw, secOff + 36)

    const isExecutable = !!(secChars & 0x20000000)
    const isReadable = !!(secChars & 0x40000000)
    const isWritable = !!(secChars & 0x80000000)

    let entropy = 0
    const actualRaw = Math.min(rawSize, raw.length - rawOffset)
    if (actualRaw > 0 && rawOffset < raw.length) {
      entropy = calculateBufferEntropy(raw.slice(rawOffset, rawOffset + actualRaw))
    }

    let entropyFlag: 'normal' | 'packed' | 'encrypted' = 'normal'
    if (entropy > 7.0) entropyFlag = 'encrypted'
    else if (entropy > 6.5) entropyFlag = 'packed'

    if (entropyFlag !== 'normal') {
      pe.high_entropy_sections.push(name)
    }

    const lowerName = name.toLowerCase()
    if (suspiciousSectionNames.includes(lowerName)) {
      pe.suspicious_section_names.push(name)
      const packer = packerSectionSignatures[lowerName]
      if (packer && !pe.packer_detected.includes(packer)) {
        pe.packer_detected.push(packer)
      }
    }

    if (isWritable && isExecutable) {
      pe.indicators.push(`Section "${name}" قابل للكتابة والتنفيذ (W^X violation)`)
    }

    pe.sections.push({
      name,
      virtual_address: virtualAddress,
      raw_offset: rawOffset,
      virtual_size: virtualSize,
      raw_size: rawSize,
      entropy: Math.round(entropy * 100) / 100,
      characteristics: secChars,
      is_executable: isExecutable,
      is_readable: isReadable,
      is_writable: isWritable,
      entropy_flag: entropyFlag,
    })
  }

  if (pe.sections.length > 0) {
    pe.section_entropy_avg = Math.round(
      (pe.sections.reduce((s, sec) => s + sec.entropy, 0) / pe.sections.length) * 100
    ) / 100
  }

  // === Overlay ===
  if (pe.sections.length > 0) {
    const lastSection = pe.sections[pe.sections.length - 1]
    const overlayStart = lastSection.raw_offset + lastSection.raw_size
    if (overlayStart < raw.length) {
      pe.overlay_size = raw.length - overlayStart
      pe.overlay_flag = true
      if (pe.overlay_size > 100 * 1024) {
        pe.indicators.push(`Overlay كبير (${(pe.overlay_size / 1024).toFixed(0)} KB) - قد يحتوي حمولة`)
      }
    }
  }

  // === Imports ===
  if (dataDirs[1].rva > 0 && dataDirs[1].size > 0) {
    const importOffset = rvaToOffset(dataDirs[1].rva)
    if (importOffset > 0 && importOffset + 20 <= raw.length) {
      let descOff = importOffset
      let count = 0

      while (descOff + 20 <= raw.length && count < 200) {
        const iltRVA = readU32LE(raw, descOff)
        const nameRVA = readU32LE(raw, descOff + 12)
        const iatRVA = readU32LE(raw, descOff + 16)

        if (nameRVA === 0 && iltRVA === 0 && iatRVA === 0) break

        const nameOffset = rvaToOffset(nameRVA)
        if (nameOffset > 0 && nameOffset < raw.length) {
          const dllName = readAscii(raw, nameOffset, 256)
          const functions: string[] = []

          const thunkRVA = iltRVA > 0 ? iltRVA : iatRVA
          let thunkOff = rvaToOffset(thunkRVA)

          if (thunkOff > 0) {
            let funcCount = 0
            while (thunkOff + (pe.is_64bit ? 8 : 4) <= raw.length && funcCount < 500) {
              if (pe.is_64bit) {
                const thunk = readBigUInt64LE(raw, thunkOff)
                if (thunk === 0n) break
                if (thunk & 0x8000000000000000n) {
                  functions.push(`Ordinal #${Number(thunk & 0xFFFFn)}`)
                } else {
                  const hintOff = rvaToOffset(Number(thunk))
                  if (hintOff > 0 && hintOff + 2 < raw.length) {
                    const funcName = readAscii(raw, hintOff + 2, 256)
                    if (funcName) functions.push(funcName)
                  }
                }
                thunkOff += 8
              } else {
                const thunk = readU32LE(raw, thunkOff)
                if (thunk === 0) break
                if (thunk & 0x80000000) {
                  functions.push(`Ordinal #${thunk & 0xFFFF}`)
                } else {
                  const hintOff = rvaToOffset(thunk)
                  if (hintOff > 0 && hintOff + 2 < raw.length) {
                    const funcName = readAscii(raw, hintOff + 2, 256)
                    if (funcName) functions.push(funcName)
                  }
                }
                thunkOff += 4
              }
              funcCount++
            }
          }

          pe.imports.push({ dll: dllName.toLowerCase(), functions })
        }

        descOff += 20
        count++
      }
    }
  }

  // === Resources ===
  if (dataDirs[2].rva > 0 && dataDirs[2].size > 0) {
    const resOffset = rvaToOffset(dataDirs[2].rva)
    if (resOffset > 0 && resOffset + 16 <= raw.length) {
      try {
        const resData = parseResourceDirectory(raw, resOffset, rvaToOffset)
        pe.resources = resData

        const manifestRes = resData.find(r => r.type === 'RT_MANIFEST')
        if (manifestRes) {
          pe.has_manifest = true
          const manifestOff = rvaToOffset(parseInt(manifestRes.name.split(' ').pop() || '0', 16) || 0)
          if (manifestOff > 0 && manifestOff < raw.length) {
            const size = Math.min(manifestRes.size || 4096, raw.length - manifestOff, 65536)
            pe.manifest_content = raw.slice(manifestOff, manifestOff + size).toString('utf-8').replace(/\x00/g, '').trim()
          }
        }
      } catch {
        // ignore resource parse errors
      }
    }
  }

  // === Exports ===
  if (dataDirs[0].rva > 0 && dataDirs[0].size > 0) {
    const exportOffset = rvaToOffset(dataDirs[0].rva)
    if (exportOffset > 0 && exportOffset + 40 <= raw.length) {
      const numberOfNames = readU32LE(raw, exportOffset + 24)
      const addressOfNames = readU32LE(raw, exportOffset + 32)
      const namesOff = rvaToOffset(addressOfNames)
      if (namesOff > 0) {
        for (let i = 0; i < Math.min(numberOfNames, 100); i++) {
          const namePtr = readU32LE(raw, namesOff + i * 4)
          const nameOff = rvaToOffset(namePtr)
          if (nameOff > 0 && nameOff < raw.length) {
            const name = readAscii(raw, nameOff, 256)
            if (name) pe.exports.push(name)
          }
        }
      }
    }
  }

  // === كشف Packers من السلاسل النصية ===
  const allStrings = extractBinaryStrings(raw)
  const stringSet = new Set(allStrings.map(s => s.toLowerCase()))

  const packerStringSignatures: Record<string, string> = {
    'upx!': 'UPX Packer', 'upx0': 'UPX Packer', 'upx1': 'UPX Packer',
    'themida': 'Themida Protector', 'winlicense': 'Themida/WinLicense',
    'vmprotect': 'VMProtect', 'vmp0': 'VMProtect',
    'aspack': 'ASPack', 'pec2': 'PECompact2',
    'nsp0': 'NsPack', 'mpress': 'MPRESS',
    'obsidium': 'Obsidium', 'enigma': 'Enigma Protector',
    'petite': 'Petite', 'shrinker': 'Shrinker',
    'pelock': 'PELock', 'pespin': 'PESpin',
    'code virtualizer': 'Code Virtualizer',
    'smart assembly': 'SmartAssembly',
    '.net reactor': '.NET Reactor',
    'dotfuscator': 'Dotfuscator',
    'confuserex': 'ConfuserEx',
  }

  for (const [key, packer] of Object.entries(packerStringSignatures)) {
    if (stringSet.has(key) && !pe.packer_detected.includes(packer)) {
      pe.packer_detected.push(packer)
    }
  }

  // لا يوجد imports = مشبوه
  let totalImports = 0
  for (const imp of pe.imports) totalImports += imp.functions.length
  if (pe.is_pe && totalImports === 0) {
    pe.indicators.push('لا يوجد استيرادات - قد يكون ملفوف أو يحلل APIs ديناميكياً')
  }

  // Entry Point في section غير .text
  if (pe.sections.length > 0 && entryPoint > 0) {
    for (const sec of pe.sections) {
      const secEnd = sec.virtual_address + sec.virtual_size
      if (entryPoint >= sec.virtual_address && entryPoint < secEnd) {
        if (!sec.name.startsWith('.text') && sec.name !== '.textbss') {
          pe.indicators.push(`Entry Point في section "${sec.name}" بدل .text - قد يكون ملفوف`)
        }
        break
      }
    }
  }

  // .NET
  if (dataDirs[14] && dataDirs[14].rva > 0 && dataDirs[14].size > 0) {
    pe.indicators.push('.NET Assembly')
  }

  pe.scan_time = Math.round(performance.now() - startTime)
  return pe
}

// ===================================================================
// Resource Directory Parser
// ===================================================================

function parseResourceDirectory(raw: Buffer, offset: number, rvaToOffset: (rva: number) => number): PEResource[] {
  const resources: PEResource[] = []
  if (offset + 16 > raw.length) return resources

  const numberOfNamedEntries = readU16LE(raw, offset + 12)
  const numberOfIdEntries = readU16LE(raw, offset + 14)
  const totalEntries = numberOfNamedEntries + numberOfIdEntries

  const typeNames: Record<number, string> = {
    1: 'RT_CURSOR', 2: 'RT_BITMAP', 3: 'RT_ICON', 4: 'RT_MENU',
    5: 'RT_DIALOG', 6: 'RT_STRING', 7: 'RT_FONTDIR', 8: 'RT_FONT',
    9: 'RT_ACCELERATOR', 10: 'RT_RCDATA', 11: 'RT_MESSAGETABLE',
    12: 'RT_GROUP_CURSOR', 14: 'RT_GROUP_ICON', 16: 'RT_VERSION',
    24: 'RT_MANIFEST',
  }

  for (let i = 0; i < Math.min(totalEntries, 100); i++) {
    const entryOff = offset + 16 + i * 8
    if (entryOff + 8 > raw.length) break

    const nameOrId = readU32LE(raw, entryOff)
    const dataOrSubdir = readU32LE(raw, entryOff + 4)

    const isDir = !!(dataOrSubdir & 0x80000000)
    const isNamed = !!(nameOrId & 0x80000000)

    let entryName = ''
    if (!isNamed) {
      const id = nameOrId & 0xFFFF
      entryName = typeNames[id] || `ID_${id}`
    } else {
      entryName = `Named_${i}`
    }

    if (isDir) {
      const subDirOffset = dataOrSubdir & 0x7FFFFFFF
      try {
        const subResources = parseResourceDirectory(raw, subDirOffset, rvaToOffset)
        for (const sub of subResources) {
          if (sub.type.startsWith('ID_') || sub.type.startsWith('Named_')) {
            resources.push({ ...sub, type: entryName })
          } else {
            resources.push({ ...sub, type: `${entryName} / ${sub.type}` })
          }
        }
      } catch {
        // skip
      }
    } else {
      if (dataOrSubdir + 16 <= raw.length) {
        const resRVA = readU32LE(raw, dataOrSubdir)
        const resSize = readU32LE(raw, dataOrSubdir + 4)
        resources.push({
          type: entryName,
          name: `RVA: 0x${resRVA.toString(16)}`,
          size: resSize,
        })
      }
    }
  }

  return resources
}

// ===================================================================
// محرك تحليل السلاسل الثنائية
// ===================================================================

function binaryStringEngine(raw: Buffer): {
  threats: string[]
  capabilities: string[]
  patterns: { pattern: string; description: string; severity: 'danger' | 'warning' | 'info' }[]
  urls: string[]
  ports: number[]
} {
  const strings = extractBinaryStrings(raw)
  const stringSet = new Set(strings.map(s => s.toLowerCase()))
  const threats: string[] = []
  const capabilities: string[] = []
  const patterns: { pattern: string; description: string; severity: 'danger' | 'warning' | 'info' }[] = []
  const urls: string[] = []
  const foundPorts = new Set<number>()

  const rules: { keywords: string[]; threat: string; severity: 'danger' | 'warning'; desc: string; cap: string }[] = [
    { keywords: ['cmd.exe', '/c ', '/k ', 'powershell', 'rundll32', 'regsvr32', 'mshta', 'wscript'], threat: 'cmd_exec', severity: 'danger', desc: 'استدعاء أوامر النظام', cap: 'تنفيذ أوامر النظام' },
    { keywords: ['ws2_32', 'wsock32', 'wininet', 'winhttp', 'urlmon', 'internetopen', 'internetconnect', 'wsastartup'], threat: 'network_activity', severity: 'danger', desc: 'واجهات شبكة', cap: 'اتصال شبكة' },
    { keywords: ['getasynckeystate', 'setwindowshookex', 'getforegroundwindow', 'keybd_event', 'wh_keyboard'], threat: 'keylogger', severity: 'danger', desc: 'Keylogger', cap: 'تسجيل لوحة المفاتيح' },
    { keywords: ['bitblt', 'getdc', 'createdc', 'gdi32', 'stretchblt', 'getdesktopwindow'], threat: 'screen_capture', severity: 'danger', desc: 'لقطة شاشة', cap: 'التقاط لقطات الشاشة' },
    { keywords: ['regopenkey', 'regsetvalue', 'regcreatekey', 'hkcu\\', 'hklm\\', 'currentversion\\run'], threat: 'registry', severity: 'danger', desc: 'تعديل الريجستري', cap: 'تعديل الريجستري' },
    { keywords: ['startup', 'shell:startup', 'appdata\\roaming', 'appdata\\local'], threat: 'persistence', severity: 'warning', desc: 'تشغيل تلقائي', cap: 'تشغيل تلقائي' },
    { keywords: ['discord', 'discord.com', 'webhook', 'appdata\\discord', 'discord_canary'], threat: 'discord_stealer', severity: 'danger', desc: 'مؤشرات ديسكورد', cap: 'سرقة توكنات ديسكورد' },
    { keywords: ['chrome', 'firefox', 'brave', 'opera', 'login?data', 'cookies', 'sqlite'], threat: 'browser_steal', severity: 'danger', desc: 'سرقة بيانات المتصفح', cap: 'سرقة بيانات المتصفح' },
    { keywords: ['isdebuggerpresent', 'ntqueryinformationprocess', 'outputdebugstring'], threat: 'anti_debug', severity: 'warning', desc: 'anti-debug', cap: 'مقاومة التصحيح' },
    { keywords: ['vmware', 'virtualbox', 'vbox', 'qemu', 'sandboxie'], threat: 'anti_vm', severity: 'warning', desc: 'anti-VM', cap: 'مقاومة الافترائي' },
    { keywords: ['telegram', 'tdata', 'tdesktop'], threat: 'telegram_steal', severity: 'danger', desc: 'سرقة تيليجرام', cap: 'سرقة تيليجرام' },
    { keywords: ['crypto', 'wallet', 'bitcoin', 'ethereum', 'metamask'], threat: 'crypto_steal', severity: 'danger', desc: 'سرقة محافظ كريبتو', cap: 'سرقة محافظ رقمية' },
    { keywords: ['steam', 'epic games', 'uplay', 'riot client'], threat: 'game_steal', severity: 'warning', desc: 'سرقة حسابات ألعاب', cap: 'سرقة حسابات الألعاب' },
    { keywords: ['filezilla', 'winscp', 'ssh', 'sftp', 'ftp'], threat: 'ftp_steal', severity: 'warning', desc: 'سرقة بيانات FTP', cap: 'سرقة بيانات FTP/SSH' },
    { keywords: ['showwindow', 'sw_hide', 'setwindowpos'], threat: 'process_hide', severity: 'warning', desc: 'إخفاء العملية', cap: 'إخفاء العملية' },
    { keywords: ['taskmgr', 'terminateprocess'], threat: 'process_kill', severity: 'danger', desc: 'قتل عمليات', cap: 'قتل عمليات النظام' },
    { keywords: ['inject', 'writeprocessmemory', 'virtualallocex', 'createremotethread'], threat: 'process_injection', severity: 'danger', desc: 'حقن في عمليات', cap: 'حقن عمليات' },
  ]

  for (const rule of rules) {
    for (const kw of rule.keywords) {
      if (stringSet.has(kw)) {
        threats.push(rule.threat)
        patterns.push({ pattern: kw.toUpperCase(), description: rule.desc, severity: rule.severity })
        capabilities.push(rule.cap)
        break
      }
    }
  }

  // URLs
  const urlMatches = raw.toString('binary').match(/https?:\/\/[^\s\x00-\x1F\x80-\xFF]{5,150}/g) || []
  const excludeDomains = ['microsoft.com', 'windows.com', 'github.com', 'mozilla.org', 'w3.org', 'google.com']
  for (const url of urlMatches) {
    if (!excludeDomains.some(d => url.toLowerCase().includes(d)) && url.length > 15) {
      urls.push(url.substring(0, 100))
    }
  }
  if (urls.length > 0) {
    threats.push('c2_urls')
    patterns.push({ pattern: 'C2_URLS', description: `${urls.length} URLs مشبوهة`, severity: 'danger' })
  }

  // Ports
  const knownBad = [4444, 5555, 6666, 7777, 8888, 9999, 31337, 1337, 6667]
  for (const p of knownBad) {
    if (stringSet.has(String(p))) foundPorts.add(p)
  }

  return {
    threats: [...new Set(threats)],
    capabilities: [...new Set(capabilities)],
    patterns,
    urls,
    ports: Array.from(foundPorts),
  }
}

// ===================================================================
// محرك كشف التشفير والإبهام
// ===================================================================

function tryDecodeBase64(str: string): string | null {
  try {
    const cleaned = str.replace(/\s/g, '')
    if (cleaned.length < 16 || cleaned.length % 4 !== 0) return null
    if (!/^[A-Za-z0-9+/]+=*$/.test(cleaned)) return null
    const decoded = Buffer.from(cleaned, 'base64').toString('utf-8')
    if (decoded.length < 4) return null
    const printableRatio = (decoded.match(/[\x20-\x7E\x0A\x0D\x09]/g) || []).length / decoded.length
    if (printableRatio > 0.7) return decoded
    return null
  } catch {
    return null
  }
}

function tryDecodeHex(str: string): string | null {
  try {
    const cleaned = str.replace(/[^0-9a-fA-F]/g, '')
    if (cleaned.length < 10 || cleaned.length % 2 !== 0) return null
    const decoded = Buffer.from(cleaned, 'hex').toString('utf-8')
    if (decoded.length < 3) return null
    const printableRatio = (decoded.match(/[\x20-\x7E]/g) || []).length / decoded.length
    if (printableRatio > 0.65) return decoded
    return null
  } catch {
    return null
  }
}

function detectObfuscation(content: string, _fileName: string): ObfuscationReport {
  const methods: string[] = []
  const layers: DecodedLayer[] = []
  let currentContent = content

  const base64Blocks = content.match(/[A-Za-z0-9+/]{40,}={0,2}/g) || []
  const hexBlocks = content.match(/(?:\\x[0-9a-fA-F]{2}){10,}/g) || []
  const unicodeBlocks = content.match(/(?:\\u[0-9a-fA-F]{4}){5,}/g) || []

  if (base64Blocks.length >= 2) methods.push('Base64 Encoding')
  if (hexBlocks.length >= 1) methods.push('Hex Encoding')
  if (unicodeBlocks.length >= 1) methods.push('Unicode Encoding')
  if (/eval\s*\(/.test(content) && base64Blocks.length > 0) methods.push('eval() Dynamic Execution')
  if (/fromCharCode|charCodeAt/.test(content)) methods.push('CharCode Construction')
  if (/String\.fromCharCode\s*\(\s*\d+\s*(?:,\s*\d+\s*){5,}/.test(content)) methods.push('String.fromCharCode Obfuscation')
  if (/(?:Proxy|Reflect|atob|btoa)\s*\(/.test(content) && /constructor|prototype/.test(content)) methods.push('Prototype Chain Abuse')
  if (/JSON\.parse\s*\(\s*(?:atob|btoa|Buffer\.from)/.test(content)) methods.push('JSON.parse + Encoding')
  if (/UPX|packed|compress|decompress/i.test(content)) methods.push('Packed/Compressed Code')

  const entropy = calculateStringEntropy(content)
  if (entropy > 5.5) methods.push('High Entropy')

  for (let layerNum = 1; layerNum <= 6; layerNum++) {
    let decoded: string | null = null
    let method = ''
    decoded = tryDecodeBase64(currentContent)
    if (decoded) { method = 'Base64' }
    if (!decoded) { decoded = tryDecodeHex(currentContent); if (decoded) method = 'Hex' }
    if (!decoded) break

    layers.push({
      layer: layerNum,
      method,
      preview: decoded.substring(0, 300),
      fullContent: decoded,
      patternsFound: (decoded.match(/eval|exec|spawn|function|require|import|fetch|http|socket|child_process/i) || []).length,
    })
    currentContent = decoded
    if (decoded.length < 20) break
  }

  const isObfuscated = methods.length > 0 || layers.length > 0
  let confidence = 0
  if (layers.length >= 3) confidence = 95
  else if (layers.length >= 2) confidence = 80
  else if (layers.length === 1) confidence = 60
  if (entropy > 5.5) confidence = Math.max(confidence, 70)
  if (methods.length >= 3) confidence = Math.max(confidence, 75)
  if (methods.length === 0) confidence = 0

  return {
    is_obfuscated: isObfuscated,
    confidence,
    methods,
    layers,
    total_layers_decoded: layers.length,
    entropy_score: Math.round(entropy * 100) / 100,
  }
}

// ===================================================================
// محرك الأنماط (للكود المصدر)
// ===================================================================

const DANGEROUS_PATTERNS = [
  { pattern: /child_process\.(exec|spawn|execSync|spawnSync)/, desc: 'تنفيذ أوامر النظام', severity: 'danger' as const, category: 'cmd_exec' },
  { pattern: /powershell|cmd\.exe|\/bin\/sh|\/bin\/bash/i, desc: 'استدعاء shell', severity: 'danger' as const, category: 'cmd_exec' },
  { pattern: /GetAsyncKeyState|SetWindowsHookEx|keyboard.*hook/i, desc: 'Keylogger', severity: 'danger' as const, category: 'keylogger' },
  { pattern: /GetDesktopWindow|BitBlt|copyFromScreen/i, desc: 'لقطة شاشة', severity: 'danger' as const, category: 'screen_capture' },
  { pattern: /reverse.*shell|backdoor|rat.*remote|C2\s*server/i, desc: 'باك دور', severity: 'danger' as const, category: 'rat' },
  { pattern: /\.encrypt\s*\(|ransomware/i, desc: 'تشفير ملفات', severity: 'danger' as const, category: 'ransomware' },
  { pattern: /eval\s*\(\s*(atob|btoa|Buffer\.from)/i, desc: 'eval + base64', severity: 'danger' as const, category: 'code_injection' },
  { pattern: /HKLM|HKCU|reg\s+add/i, desc: 'تعديل الريجستري', severity: 'danger' as const, category: 'registry' },
  { pattern: /TerminateProcess|Process\.kill/i, desc: 'قتل عمليات', severity: 'danger' as const, category: 'process_kill' },
  { pattern: /startup|autorun|runonce|shell:startup/i, desc: 'تشغيل تلقائي', severity: 'warning' as const, category: 'persistence' },
  { pattern: /isDebuggerPresent|debugger/i, desc: 'anti-debug', severity: 'warning' as const, category: 'anti_debug' },
  { pattern: /vmware|virtualbox|vbox|qemu/i, desc: 'anti-VM', severity: 'warning' as const, category: 'anti_vm' },
  { pattern: /clipboard.*read|Clipboard.*GetData/i, desc: 'سرقة الحافظة', severity: 'warning' as const, category: 'clipboard' },
  { pattern: /pastebin\.com\/raw|api\.telegram\.org\/bot/i, desc: 'تسريب بيانات', severity: 'danger' as const, category: 'data_exfil' },
  { pattern: /discord\.com\/api\/v\d+\/users\/@me/i, desc: 'استخراج بيانات ديسكورد', severity: 'warning' as const, category: 'discord_token' },
  { pattern: /localStorage\.getItem\(.*token/i, desc: 'سرقة توكن', severity: 'danger' as const, category: 'discord_token' },
  { pattern: /document\.cookie.*token/i, desc: 'سرقة توكن من الكوكيز', severity: 'danger' as const, category: 'discord_token' },
  { pattern: /fs\.readFileSync|readFile.*cookie|readdir.*discord/i, desc: 'قراءة ملفات حساسة', severity: 'danger' as const, category: 'data_exfil' },
  { pattern: /os\.homedir|os\.tmpdir|APPDATA/i, desc: 'مسارات حساسة', severity: 'warning' as const, category: 'data_exfil' },
]

const PORT_PATTERNS = [
  /(?:connect|bind|listen|port|PORT)\s*[:=]\s*(\d{1,5})/g,
  /(?:0\.0\.0\.0|127\.0\.0\.1|localhost)\s*:\s*(\d{1,5})/g,
]

const C2_PATTERNS = [
  /https?:\/\/[^\s'"]+/g,
  /(?:host|HOST|server|SERVER|url|URL)\s*[:=]\s*['"]([^'"]+)['"]/g,
]

function extractPorts(content: string): number[] {
  const ports = new Set<number>()
  const skip = new Set([80, 443, 3000, 8080, 4443, 8443, 53, 22])
  for (const pattern of PORT_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags)
    let match
    while ((match = regex.exec(content)) !== null) {
      const port = parseInt(match[1])
      if (port > 0 && port <= 65535 && !skip.has(port)) ports.add(port)
    }
  }
  return Array.from(ports)
}

function extractC2Servers(content: string): string[] {
  const servers = new Set<string>()
  const exclude = ['localhost', '127.0.0.1', 'example.com', 'github.com', 'npmjs.com', 'pypi.org', 'microsoft.com', 'windows.com', 'vercel.com']
  for (const pattern of C2_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags)
    let match
    while ((match = regex.exec(content)) !== null) {
      const url = (match[1] || match[0]).replace(/['"]/g, '').trim().substring(0, 200)
      if (url && !exclude.some(d => url.includes(d))) servers.add(url)
    }
  }
  return Array.from(servers).slice(0, 15)
}

function patternEngineAnalyze(content: string, _fileName: string) {
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

  const ports = extractPorts(content)
  const c2Servers = extractC2Servers(content)
  const networkIndicators: { type: string; value: string }[] = []
  for (const server of c2Servers) networkIndicators.push({ type: 'C2 Server', value: server })
  for (const port of ports) networkIndicators.push({ type: `Port ${port}`, value: 'Unknown' })

  const capabilityMap: Record<string, string> = {
    keylogger: 'تسجيل لوحة المفاتيح', screen_capture: 'التقاط لقطات الشاشة', clipboard: 'سرقة الحافظة',
    ransomware: 'تشفير الملفات', data_exfil: 'تسريب بيانات', cmd_exec: 'تنفيذ أوامر النظام',
    reverse_shell: 'شيل عكسي', stealer: 'سرقة بيانات', rat: 'تحكم عن بعد', registry: 'تعديل الريجستري',
    code_injection: 'حقن كود', persistence: 'تشغيل تلقائي', process_kill: 'قتل عمليات',
    discord_token: 'استخراج توكنات', process_hide: 'إخفاء العملية',
  }
  const capabilities: string[] = []
  for (const [key, label] of Object.entries(capabilityMap)) {
    if (threatTypeSet.has(key)) capabilities.push(label)
  }

  const encodedStrings: { type: string; value: string; decoded?: string }[] = []
  const b64matches = content.match(/[A-Za-z0-9+/]{20,}={0,2}/g) || []
  for (const m of b64matches.slice(0, 10)) {
    try {
      const d = Buffer.from(m, 'base64').toString('utf-8')
      if (/[\x20-\x7E]{5,}/.test(d)) {
        encodedStrings.push({ type: 'Base64', value: m.substring(0, 40), decoded: d.substring(0, 100) })
      }
    } catch {
      // ignore
    }
  }

  return {
    findings: suspiciousPatterns.length,
    threats: Array.from(threatTypeSet),
    data: { suspiciousPatterns, capabilities, ports, c2Servers, encodedStrings, networkIndicators, dangerCount, warningCount },
    scanTime: Math.round(performance.now() - startTime),
  }
}

// ===================================================================
// محرك التحليل الذكي
// ===================================================================

function heuristicAnalyze(pe: PEInfo, binResult: { threats: string[]; capabilities: string[] }): {
  findings: number; threats: string[]; scan_time: number
} {
  const startTime = performance.now()
  const threats: string[] = []

  if (pe.packer_detected.length > 0) threats.push(`ملفوف بـ ${pe.packer_detected.join(', ')}`)
  if (pe.high_entropy_sections.length > 0) threats.push(`أقسام عالية العشوائية: ${pe.high_entropy_sections.join(', ')}`)
  if (pe.overlay_flag && pe.overlay_size > 100 * 1024) threats.push('Overlay كبير')
  if (pe.suspicious_section_names.length > 0) threats.push(`أقسام مشبوهة: ${pe.suspicious_section_names.join(', ')}`)
  if (pe.sections.some(s => s.is_writable && s.is_executable)) threats.push('قسم W+X (W^X violation)')
  if (pe.is_pe && pe.imports.length === 0) threats.push('لا يوجد imports - ملفوف أو dynamic API resolution')
  if (pe.section_entropy_avg > 7.0) threats.push('متوسط Entropy عالي جداً')
  if (pe.compilation_time) {
    const compDate = new Date(pe.compilation_time)
    const age = Date.now() - compDate.getTime()
    if (age > 10 * 365.25 * 24 * 60 * 60 * 1000) threats.push('ملف قديم جداً (أكثر من 10 سنوات)')
    if (age < 24 * 60 * 60 * 1000 && age > 0) threats.push('ملف جديد جداً (أقل من 24 ساعة)')
  }
  if (binResult.threats.includes('process_injection')) threats.push('يستخدم حقن العمليات')

  return { findings: threats.length, threats, scan_time: Math.round(performance.now() - startTime) }
}

// ===================================================================
// التحليل التفصيلي
// ===================================================================

function buildDetailedAnalysis(pe: PEInfo, threatTypes: string[], capabilities: string[], obfReport: ObfuscationReport): DetailedAnalysis {
  const behavioral: string[] = []
  const dataTargets: string[] = []
  const persistence: string[] = []
  const anti: string[] = []

  const behaviorMap: Record<string, string> = {
    cmd_exec: 'يستطيع تنفيذ أوامر النظام',
    keylogger: 'يسجل ضغطات لوحة المفاتيح',
    screen_capture: 'يلتقط لقطات شاشة',
    clipboard: 'يراقب الحافظة ويسرق المحتوى',
    data_exfil: 'يجمع البيانات ويرسلها لخوادم خارجية',
    registry: 'يعدل الريجستري',
    persistence: 'يثبت نفسه للتشغيل التلقائي',
    process_kill: 'يقتل عمليات النظام',
    process_hide: 'يخفي نفسه',
    process_injection: 'يحقن كود في عمليات أخرى',
    anti_debug: 'يكشف أدوات التصحيح',
    anti_vm: 'يكشف البيئات الافتراضية',
    discord_stealer: 'يسرق توكنات ديسكورد',
    browser_steal: 'يسرق بيانات المتصفحات',
    telegram_steal: 'يسرق جلسات تيليجرام',
    crypto_steal: 'يسرق محافظ العملات الرقمية',
    c2_urls: 'يتصل بخوادم خارجية (C2)',
    network_activity: 'يستخدم اتصال شبكة',
  }
  for (const [key, desc] of Object.entries(behaviorMap)) {
    if (threatTypes.includes(key)) behavioral.push(desc)
  }

  const targetDlls = pe.imports.map(i => i.dll)
  if (targetDlls.some(d => d.includes('wininet') || d.includes('winhttp'))) dataTargets.push('اتصال شبكة / HTTP')
  if (targetDlls.some(d => d.includes('crypt32') || d.includes('bcrypt'))) dataTargets.push('تشفير / فك تشفير')
  if (targetDlls.some(d => d.includes('shell32'))) dataTargets.push('عمليات النظام')
  if (targetDlls.some(d => d.includes('advapi32'))) { dataTargets.push('الريجستري / Security'); persistence.push('ريجستري التشغيل التلقائي') }
  if (targetDlls.some(d => d.includes('ws2_32'))) dataTargets.push('Sockets / اتصال شبكة')

  if (capabilities.includes('سرقة بيانات المتصفح')) dataTargets.push('كوكيز وكلمات مرور المتصفح')
  if (capabilities.includes('سرقة توكنات ديسكورد')) dataTargets.push('توكنات ديسكورد')
  if (capabilities.includes('سرقة تيليجرام')) dataTargets.push('جلسات تيليجرام')
  if (capabilities.includes('سرقة محافظ رقمية')) dataTargets.push('محافظ كريبتو')
  if (capabilities.includes('سرقة بيانات FTP/SSH')) dataTargets.push('بيانات FTP/SSH')
  if (capabilities.includes('سرقة حسابات الألعاب')) dataTargets.push('حسابات Steam/Epic/Riot')

  if (threatTypes.includes('anti_debug')) anti.push('كشف مصحح الأكواد (Anti-Debug)')
  if (threatTypes.includes('anti_vm')) anti.push('كشف البيئة الافتراضية (Anti-VM)')
  if (pe.packer_detected.length > 0) anti.push(`ملفوف بـ ${pe.packer_detected.join(', ')} - يمنع التحليل الثابت`)
  if (!pe.has_debug_info && pe.is_pe) anti.push('لا يوجد معلومات Debug')

  let filePurpose = ''
  if (pe.packer_detected.length > 0) {
    filePurpose = `ملف تنفيذي ملفوف بـ ${pe.packer_detected.join(' + ')}.\n\nلم نتمكن من تحليل الكود الداخلي لأنه مضغوط/مشفر. الملفات الملفوفة شائعة جداً في البرمجيات الخبيثة.\n\nالتحليل يعتمد على السلاسل النصية والـ Imports والـ Sections.`
  } else if (capabilities.length === 0 && threatTypes.length === 0) {
    filePurpose = 'ملف تنفيذي نظيف - لم يتم اكتشاف أنماط خبيثة.'
  } else {
    filePurpose = `ملف تنفيذي يحتوي أنماط مشبوهة.\n\nالقدرات: ${capabilities.join('، ')}\n\n`
    if (dataTargets.length > 0) filePurpose += `يستهدف: ${dataTargets.join('، ')}\n\n`
    if (pe.high_entropy_sections.length > 0) filePurpose += `تحذير: أقسام مشفرة (${pe.high_entropy_sections.join('، ')})`
  }

  let deobfuscationResult = ''
  if (pe.packer_detected.length > 0) {
    deobfuscationResult = `الملف ملفوف بـ ${pe.packer_detected.join(', ')}. يجب فك الـ packing أولاً باستخدام أداة مناسبة أو فحصه في sandbox مثل Cuckoo أو ANY.RUN`
  } else if (obfReport.total_layers_decoded > 0) {
    deobfuscationResult = `تم فك ${obfReport.total_layers_decoded} طبقة. آخر طبقة:\n${obfReport.layers[obfReport.layers.length - 1].preview.substring(0, 300)}`
  } else {
    deobfuscationResult = pe.is_pe ? 'ملف تنفيذي - تحليل مباشر' : 'غير مشفر'
  }

  let encryptionMethod = pe.packer_detected.length > 0 ? pe.packer_detected.join(' + ') : 'غير مشفر'

  let riskExplanation = ''
  if (pe.packer_detected.length > 0 && (threatTypes.length > 3 || capabilities.length > 3)) {
    riskExplanation = `ملف خطير! ملفوف بـ ${pe.packer_detected.join(', ')} ويحتوي ${capabilities.length} قدرة خبيثة: ${capabilities.join('، ')}`
    if (dataTargets.length > 0) riskExplanation += `\n\nيستهدف: ${dataTargets.join('، ')}`
  } else if (pe.packer_detected.length > 0) {
    riskExplanation = `الملف ملفوف بـ ${pe.packer_detected.join(', ')}. لا يمكن التأكد من سلامته بدون فك الـ packing.`
  } else if (capabilities.length > 0) {
    riskExplanation = `يحتوي أنماط مشبوهة: ${capabilities.join('، ')}`
  } else {
    riskExplanation = 'لم يتم اكتشاف أنماط خبيثة.'
  }

  let obfuscationLevel: 'none' | 'light' | 'medium' | 'heavy' | 'extreme' = 'none'
  if (pe.packer_detected.length >= 2 || (pe.packer_detected.length > 0 && threatTypes.length > 5)) obfuscationLevel = 'extreme'
  else if (pe.packer_detected.length > 0 || pe.section_entropy_avg > 7.0) obfuscationLevel = 'heavy'
  else if (pe.high_entropy_sections.length > 0 || obfReport.total_layers_decoded > 0) obfuscationLevel = 'medium'
  else if (obfReport.is_obfuscated) obfuscationLevel = 'light'

  return {
    file_purpose: filePurpose,
    language_detected: pe.is_pe ? `PE Executable (${pe.machine_type})` : 'Unknown',
    is_encrypted: pe.packer_detected.length > 0 || obfReport.is_obfuscated,
    encryption_method: encryptionMethod,
    is_packed: pe.packer_detected.length > 0,
    packer_detected: pe.packer_detected.join(', ') || 'None',
    obfuscation_level: obfuscationLevel,
    behavioral_analysis: behavioral,
    data_targets: dataTargets,
    network_targets: [],
    persistence_methods: persistence,
    anti_analysis: anti,
    deobfuscation_result: deobfuscationResult,
    risk_explanation: riskExplanation,
  }
}

// ===================================================================
// جمع كل النتائج
// ===================================================================

function combineAllResults(
  pe: PEInfo,
  binResult: { threats: string[]; capabilities: string[]; patterns: { pattern: string; description: string; severity: string }[]; urls: string[]; ports: number[] },
  heuristicResult: { findings: number; threats: string[] },
  obfReport: ObfuscationReport,
  fileName: string,
): VirusResult {
  const allThreatTypes = new Set<string>([...binResult.threats, ...heuristicResult.threats])

  let score = 0

  if (pe.packer_detected.length > 0) score += Math.min(pe.packer_detected.length * 10, 25)
  if (pe.high_entropy_sections.length > 0) score += Math.min(pe.high_entropy_sections.length * 5, 15)
  if (pe.suspicious_section_names.length > 0) score += 5
  if (pe.overlay_flag && pe.overlay_size > 100 * 1024) score += 5
  if (pe.sections.some(s => s.is_writable && s.is_executable)) score += 8
  if (pe.imports.length === 0 && pe.is_pe) score += 5
  if (pe.section_entropy_avg > 7.0) score += 10

  const dangerThreats = ['keylogger', 'screen_capture', 'discord_stealer', 'browser_steal', 'telegram_steal', 'crypto_steal', 'process_injection', 'rat', 'ransomware']
  for (const t of dangerThreats) {
    if (allThreatTypes.has(t)) score += 8
  }
  const warnThreats = ['cmd_exec', 'registry', 'persistence', 'process_hide', 'process_kill', 'anti_debug', 'anti_vm']
  for (const t of warnThreats) {
    if (allThreatTypes.has(t)) score += 4
  }
  if (allThreatTypes.has('c2_urls')) score += 10
  if (pe.packer_detected.length > 0 && binResult.capabilities.length > 2) score += 15

  score = Math.min(score, 100)

  let threatLevel: VirusResult['threat_level']
  let isSuspicious = false
  let summary = ''
  let recommendation = ''

  if (pe.packer_detected.length > 0 && score >= 50) {
    isSuspicious = true
    threatLevel = 'critical'
    summary = `ملف تنفيذي خطير ومشفر! ملفوف بـ ${pe.packer_detected.join(', ')} مع ${binResult.capabilities.length} قدرة خبيثة.\n\nالقدرات: ${binResult.capabilities.slice(0, 8).join(' | ')}`
    recommendation = 'حذف فوراً! لا تشغله أبداً!'
  } else if (pe.packer_detected.length > 0) {
    isSuspicious = true
    threatLevel = 'high'
    summary = `ملف تنفيذي ملفوف بـ ${pe.packer_detected.join(', ')}. لا يمكن التأكد من سلامته بدون فك الـ packing.`
    recommendation = 'لا تشغل هذا الملف! فك الـ packing أولاً أو فحصه في sandbox.'
  } else if (score >= 70) {
    isSuspicious = true; threatLevel = 'critical'; summary = 'ملف تنفيذي خبيث جداً!'; recommendation = 'حذف فوراً!'
  } else if (score >= 50) {
    isSuspicious = true; threatLevel = 'high'; summary = 'ملف تنفيذي خطير!'; recommendation = 'لا تشغله!'
  } else if (score >= 30) {
    isSuspicious = true; threatLevel = 'medium'; summary = 'ملف مشبوه'; recommendation = 'احذر - فحص في sandbox'
  } else if (score >= 10) {
    isSuspicious = true; threatLevel = 'low'; summary = 'أنماط تستحق الانتباه'; recommendation = 'تحقق من المصدر'
  } else {
    threatLevel = 'clean'; summary = 'ملف نظيف'; recommendation = 'آمن'
  }

  let trojanType: string | undefined
  if (allThreatTypes.has('keylogger') && allThreatTypes.has('screen_capture')) trojanType = 'Advanced Spyware'
  else if (allThreatTypes.has('discord_stealer') || allThreatTypes.has('browser_steal')) trojanType = 'Info Stealer'
  else if (allThreatTypes.has('telegram_steal')) trojanType = 'Telegram Stealer'
  else if (allThreatTypes.has('crypto_steal')) trojanType = 'Crypto Stealer'
  else if (allThreatTypes.has('rat')) trojanType = 'RAT'
  else if (allThreatTypes.has('ransomware')) trojanType = 'Ransomware'
  else if (allThreatTypes.has('process_injection')) trojanType = 'Injector/Dropper'
  else if (pe.packer_detected.length > 0 && score >= 30) trojanType = 'Packed Malware'

  const detailed = buildDetailedAnalysis(pe, Array.from(allThreatTypes), binResult.capabilities, obfReport)

  const allPorts = [...new Set([...extractPorts(binResult.urls.join('\n')), ...binResult.ports])]
  const allC2 = extractC2Servers(binResult.urls.join('\n'))

  const suspiciousPatterns = binResult.patterns.map(p => ({
    pattern: p.pattern, description: p.description, severity: p.severity as 'info' | 'warning' | 'danger',
  }))

  const networkIndicators: { type: string; value: string }[] = []
  for (const u of allC2) networkIndicators.push({ type: 'URL', value: u })
  for (const p of allPorts) networkIndicators.push({ type: 'Port', value: String(p) })

  return {
    file_name: fileName,
    file_size: `${(pe.file_size / 1024).toFixed(1)} KB`,
    file_type: pe.is_pe ? (pe.is_dll ? 'DLL' : 'EXE') : fileName.split('.').pop()?.toUpperCase() || 'Unknown',
    md5: '', sha256: '',
    is_suspicious: isSuspicious,
    threat_level: threatLevel,
    threat_type: Array.from(allThreatTypes),
    threat_score: score,
    ports: allPorts,
    c2_servers: allC2,
    suspicious_patterns: suspiciousPatterns.slice(0, 50),
    encoded_strings: [],
    network_indicators: networkIndicators,
    capabilities: binResult.capabilities,
    summary,
    recommendation,
    trojan_type: trojanType,
    engines: {
      pattern_engine: { findings: 0, threats: [], scan_time: 0 },
      binary_engine: {
        findings: binResult.patterns.length,
        threats: binResult.threats,
        scan_time: 0,
        is_binary: pe.is_pe,
        analysis: `${binResult.capabilities.length} قدرات، ${binResult.patterns.length} أنماط`,
      },
      heuristic_engine: heuristicResult,
      pe_engine: {
        findings: pe.indicators.length + pe.packer_detected.length,
        threats: [...pe.indicators, ...pe.packer_detected.map(p => `Packed: ${p}`)],
        scan_time: pe.scan_time,
        pe_info: pe,
      },
    },
    obfuscation: obfReport,
    detailed: detailed,
  }
}

// ===================================================================
// MAIN
// ===================================================================

export async function POST(request: NextRequest) {
  const rlIp = getClientIp(request)
  const rl = rateLimit(`${rlIp}:virus-scan`, RATE_LIMITS.medium)
  if (rl.limited) {
    return NextResponse.json({ success: false, error: 'تم تجاوز الحد المسموح' }, { status: 429 })
  }

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const fileContent = formData.get('content') as string | null

    let raw: Buffer
    let fileName = 'unknown'

    if (file) {
      if (file.size > 50 * 1024 * 1024) {
        return NextResponse.json({ success: false, error: 'حجم الملف كبير جداً (الحد 50MB)' }, { status: 400 })
      }
      fileName = file.name
      raw = Buffer.from(await file.arrayBuffer())
    } else if (fileContent) {
      raw = Buffer.from(fileContent, 'utf-8')
      fileName = 'pasted_code.txt'
    } else {
      return NextResponse.json({ success: false, error: 'الرجاء رفع ملف أو لصق كود' }, { status: 400 })
    }

    const isExe = raw.length > 2 && raw.readUInt16LE(0) === 0x5A4D

    let result: VirusResult

    if (isExe) {
      // === مسار EXE: تحليل PE كامل ===
      const pe = parsePE(raw)
      const binResult = binaryStringEngine(raw)
      const obfReport = detectObfuscation(raw.toString('binary'), fileName)
      const heuristicResult = heuristicAnalyze(pe, binResult)
      result = combineAllResults(pe, binResult, heuristicResult, obfReport, fileName)

      // Hashes
      try {
        const md5Hash = await crypto.subtle.digest('MD5', raw)
        result.md5 = Array.from(new Uint8Array(md5Hash)).map(b => b.toString(16).padStart(2, '0')).join('')
      } catch { result.md5 = 'N/A' }
      try {
        const shaHash = await crypto.subtle.digest('SHA-256', raw)
        result.sha256 = Array.from(new Uint8Array(shaHash)).map(b => b.toString(16).padStart(2, '0')).join('')
      } catch { result.sha256 = 'N/A' }

      result.file_size = `${(raw.length / 1024).toFixed(1)} KB`

      sendToWebhook({
        username: 'TRJ Virus Scan',
        embeds: [{
          title: '🔍 فحص ملف EXE',
          color: result.is_suspicious ? (result.threat_level === 'critical' || result.threat_level === 'high' ? 0xFF0000 : 0xFFAA00) : 0x00FF41,
          description: `📄 **${fileName}**`,
          fields: [
            { name: '🛡️ النتيجة', value: result.threat_level === 'clean' ? '✅ نظيف' : result.threat_level === 'low' ? '🟡 منخفض' : result.threat_level === 'medium' ? '🟠 متوسط' : result.threat_level === 'high' ? '🔴 خطير' : '💀 حرج', inline: true },
            { name: '📊 النقاط', value: `${result.threat_score}/100`, inline: true },
            { name: '🔧 نوع', value: `${pe.machine_type} ${pe.is_dll ? '(DLL)' : '(EXE)'}`, inline: true },
            { name: '📦 ملفوف', value: pe.packer_detected.length > 0 ? `✅ ${pe.packer_detected.join(', ')}` : '❌', inline: true },
            ...(result.trojan_type ? [{ name: '⚠️ النوع', value: result.trojan_type, inline: true }] : []),
          ],
          timestamp: new Date().toISOString(),
        }],
      }, getLogWebhookUrl()).catch(() => {})

    } else {
      // === مسار الكود: تحليل نصي ===
      const content = raw.toString('utf-8')
      const patternResult = patternEngineAnalyze(content, fileName)
      const obfReport = detectObfuscation(content, fileName)

      const fakePe: PEInfo = {
        is_pe: false, is_64bit: false, is_dll: false, is_gui: false,
        machine_type: '', subsystem: '', compilation_time: '', entry_point: 0,
        image_base: '', file_size: raw.length, sections: [], imports: [],
        exports: [], resources: [], packer_detected: [], high_entropy_sections: [],
        suspicious_section_names: [], has_debug_info: false, has_manifest: false,
        manifest_content: '', version_info: {}, linker_version: '',
        section_entropy_avg: 0, overlay_size: 0, overlay_flag: false,
        indicators: [], scan_time: 0,
      }

      let threatScore = 0
      threatScore += Math.min(patternResult.data.dangerCount * 10, 35)
      threatScore += Math.min(patternResult.data.warningCount * 3, 15)
      threatScore += obfReport.is_obfuscated ? Math.min(obfReport.total_layers_decoded * 5, 20) : 0
      threatScore = Math.min(threatScore, 100)

      let threatLevel: VirusResult['threat_level']
      let isSuspicious = false

      if (threatScore === 0) threatLevel = 'clean'
      else if (threatScore <= 10) threatLevel = 'clean'
      else if (threatScore <= 20) threatLevel = 'low'
      else if (threatScore <= 35) { isSuspicious = true; threatLevel = 'low' }
      else if (threatScore <= 50) { isSuspicious = true; threatLevel = 'medium' }
      else if (threatScore <= 70) { isSuspicious = true; threatLevel = 'high' }
      else { isSuspicious = true; threatLevel = 'critical' }

      const detailed = buildDetailedAnalysis(fakePe, patternResult.threats, patternResult.data.capabilities, obfReport)

      result = {
        file_name: fileName,
        file_size: `${(raw.length / 1024).toFixed(1)} KB`,
        file_type: fileName.split('.').pop()?.toUpperCase() || 'Unknown',
        md5: '', sha256: '',
        is_suspicious: isSuspicious,
        threat_level: threatLevel,
        threat_type: patternResult.threats,
        threat_score: threatScore,
        ports: patternResult.data.ports,
        c2_servers: patternResult.data.c2Servers,
        suspicious_patterns: patternResult.data.suspiciousPatterns,
        encoded_strings: patternResult.data.encodedStrings,
        network_indicators: patternResult.data.networkIndicators,
        capabilities: patternResult.data.capabilities,
        summary: isSuspicious ? `${patternResult.data.dangerCount} أنماط خطيرة و ${patternResult.data.warningCount} تحذيرات` : 'لم يتم اكتشاف أنماط خبيثة',
        recommendation: isSuspicious ? 'احذر - يحتوي أنماط مشبوهة' : 'آمن',
        engines: {
          pattern_engine: { findings: patternResult.findings, threats: patternResult.threats, scan_time: patternResult.scanTime },
          binary_engine: { findings: 0, threats: [], scan_time: 0, is_binary: false, analysis: '' },
          heuristic_engine: { findings: obfReport.is_obfuscated ? 1 : 0, threats: obfReport.is_obfuscated ? ['مشفر'] : [], scan_time: 0 },
        },
        obfuscation: obfReport,
        detailed: detailed,
      }

      try {
        const md5Hash = await crypto.subtle.digest('MD5', raw)
        result.md5 = Array.from(new Uint8Array(md5Hash)).map(b => b.toString(16).padStart(2, '0')).join('')
      } catch { result.md5 = 'N/A' }

      sendToWebhook({
        username: 'TRJ Virus Scan',
        embeds: [{
          title: '🔍 فحص ملف',
          color: result.is_suspicious ? (result.threat_level === 'critical' || result.threat_level === 'high' ? 0xFF0000 : 0xFFAA00) : 0x00FF41,
          description: `📄 **${fileName}**`,
          fields: [
            { name: '🛡️ النتيجة', value: result.threat_level === 'clean' ? '✅ نظيف' : result.threat_level === 'low' ? '🟡 منخفض' : result.threat_level === 'medium' ? '🟠 متوسط' : result.threat_level === 'high' ? '🔴 خطير' : '💀 حرج', inline: true },
            { name: '📊 النقاط', value: `${result.threat_score}/100`, inline: true },
            { name: '🔒 مشفر', value: obfReport.is_obfuscated ? '✅' : '❌', inline: true },
          ],
          timestamp: new Date().toISOString(),
        }],
      }, getLogWebhookUrl()).catch(() => {})
    }

    return NextResponse.json({ success: true, result })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'حدث خطأ في التحليل'
    console.error('Virus Scan Error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
