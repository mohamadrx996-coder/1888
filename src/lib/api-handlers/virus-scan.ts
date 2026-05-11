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
  md5: string
  flags: string[]
  is_suspicious: boolean
  anomalies: string[]
}

interface PEImport {
  dll: string
  functions: string[]
  suspicious_count: number
  dangerous_apis: string[]
}

interface PEResource {
  type: string
  name: string
  language: string
  size: number
  entropy: number
}

interface PEDelayImport {
  dll: string
  attributes: number
  module_handle_rva: number
  import_name_table_rva: number
  import_address_table_rva: number
}

interface PERichRecord {
  dll_id: number
  dll_name: string
  build_count: number
  use_count: number
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
  delay_imports: PEDelayImport[]
  exports: string[]
  resources: PEResource[]
  rich_records: PERichRecord[]
  detected_packer: string[]
  detected_compiler: string
  compile_time: string | null
  compile_time_anomalies: string[]
  subsystem: string
  dll_characteristics: number
  scan_time: number
  entry_anomalies: string[]
  overlay_detected: boolean
  overlay_size: number
  overlay_entropy: number
  has_digital_signature: boolean
  has_certificate_table: boolean
  certificate_size: number
  total_entropy: number
  import_hash: string
  section_hash: string
  checksum_valid: boolean
  file_checksum: number
  computed_checksum: number
  has_relocations: boolean
  has_tls: boolean
  has_bound_imports: boolean
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
  deobfuscated_content: string
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
  mitre_attck: string[]
  ioc_list: string[]
}

interface PatternMatch {
  pattern: string
  type: 'malicious' | 'suspicious' | 'info'
  description: string
  severity: number
  line?: number
  category: string
  mitre_id?: string
}

interface VirusResult {
  is_infected: boolean
  score: number
  engines_detected: number
  threat_classification: string
  threat_name: string
  file_type: string
  details: {
    obfuscation: ObfuscationReport
    patterns: PatternMatch[]
    pe_info: PEInfo | null
    detailed_analysis: DetailedAnalysis
    heuristic_score: number
  }
}

// ============================================================
// Edge-Compatible Crypto Helpers
// ============================================================

function simpleMD5(data: Uint8Array): string {
  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476
  const msgLen = data.length
  const bitLen = msgLen * 8
  const padLen = ((56 - (msgLen + 1) % 64) + 64) % 64
  const buf = new Uint8Array(msgLen + 1 + padLen + 8)
  buf.set(data)
  buf[msgLen] = 0x80
  const dv = new DataView(buf.buffer)
  dv.setUint32(buf.length - 8, bitLen >>> 0, true)
  dv.setUint32(buf.length - 4, 0, true)

  function leftRotate(val: number, n: number): number { return ((val << n) | (val >>> (32 - n))) >>> 0 }

  const K = new Uint32Array([
    0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,0xf57c0faf,0x4787c62a,0xa8304613,0xfd469501,
    0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,0x6b901122,0xfd987193,0xa679438e,0x49b40821,
    0xf61e2562,0xc040b340,0x265e5a51,0xe9b6c7aa,0xd62f105d,0x02441453,0xd8a1e681,0xe7d3fbc8,
    0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,
    0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,
    0x289b7ec6,0xeaa127fa,0xd4ef3085,0x04881d05,0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,
    0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,0x655b59c3,0x8f0ccc92,0xffeff47d,0x85845dd1,
    0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391
  ])
  const S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21]

  for (let off = 0; off < buf.length; off += 64) {
    const M = new Uint32Array(16)
    for (let j = 0; j < 16; j++) M[j] = dv.getUint32(off + j * 4, true)
    let a = h0, b = h1, c = h2, d = h3
    for (let i = 0; i < 64; i++) {
      let f: number, g: number
      if (i < 16) { f = (b & c) | (~b & d); g = i }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16 }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16 }
      else { f = c ^ (b | ~d); g = (7 * i) % 16 }
      f = (f + a + K[i] + M[g]) >>> 0
      a = d; d = c; c = b; b = (b + leftRotate(f, S[i])) >>> 0
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0
  }
  return [h0,h1,h2,h3].map(x => x.toString(16).padStart(8,'0')).join('')
}

function simpleFNV1a(data: Uint8Array): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < data.length; i++) { hash ^= data[i]; hash = Math.imul(hash, 0x01000193) >>> 0 }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// ============================================================
// Edge-Compatible Helpers
// ============================================================

// FIX #9: bounds checks corrected (off + N <= byteLength)
function readU16(view: DataView, off: number): number {
  try { return off + 2 <= view.byteLength ? view.getUint16(off, true) : 0 } catch { return 0 }
}

function readU32(view: DataView, off: number): number {
  try { return off + 4 <= view.byteLength ? view.getUint32(off, true) : 0 } catch { return 0 }
}

function readU64(view: DataView, off: number): bigint {
  try { return off + 8 <= view.byteLength ? view.getBigUint64(off, true) : BigInt(0) } catch { return BigInt(0) }
}

function readI32(view: DataView, off: number): number {
  try { return off + 4 <= view.byteLength ? view.getInt32(off, true) : 0 } catch { return 0 }
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
  const end = Math.min(off + max, data.length)
  for (let i = off; i < end; i++) {
    const b = data[i]
    if (b === 0) break
    if (b >= 32 && b <= 126) s += String.fromCharCode(b)
    else break
  }
  return s.trim()
}

function extractWideStrings(buf: Uint8Array, minLen: number = 4): string[] {
  const out: string[] = []
  let cur = ''
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const lo = buf[i]
    const hi = buf[i + 1]
    if (hi === 0 && lo >= 32 && lo <= 126) { cur += String.fromCharCode(lo); continue }
    if (cur.length >= minLen) out.push(cur)
    cur = ''
    if (hi !== 0) i--
  }
  if (cur.length >= minLen) out.push(cur)
  return out
}

/**
 * FIX #5: rvaToOffset now checks raw_size bounds
 * Prevents returning offset in uninitialized part of section
 */
function rvaToOffset(rva: number, sections: PESection[]): number {
  for (const sec of sections) {
    if (sec.raw_size === 0) continue
    if (rva >= sec.virtual_address && rva < sec.virtual_address + sec.virtual_size) {
      const rawOff = rva - sec.virtual_address + sec.raw_offset
      if (rawOff >= sec.raw_offset && rawOff < sec.raw_offset + sec.raw_size) return rawOff
    }
  }
  return -1
}

function toHexSlice(data: Uint8Array, start: number, len: number): string {
  let h = ''
  const end = Math.min(start + len, data.length)
  for (let i = start; i < end; i++) h += data[i].toString(16).padStart(2, '0')
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

/**
 * FIX #1: iocCipherDetector - array size is now 65536 (was 256)
 * Index buf[i]*256 + buf[i+1] can reach 65535
 */
function iocCipherDetector(buf: Uint8Array): string[] {
  const ioc: Float64Array = new Float64Array(65536) // FIX: was new Array(256)
  const len = buf.length
  if (len < 4) return []
  for (let i = 0; i < len - 1; i++) {
    const idx = buf[i] * 256 + buf[i + 1]
    if (idx >= 0 && idx < 65536) ioc[idx]++
  }
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
  if (expected > 0) { // FIX: division by zero guard
    for (let i = 0; i < 256; i++) {
      const diff = freq[i] - expected
      chi2 += (diff * diff) / expected
    }
  }
  if (chi2 < 300) results.push(`توزيع متساوٍ = تشفير قوي (Chi2: ${chi2.toFixed(1)})`)
  else if (chi2 < 500) results.push(`توزيع شبه متساوٍ = تشفير متوسط (Chi2: ${chi2.toFixed(1)})`)
  else results.push(`توزيع غير منتظم = بيانات عادية (Chi2: ${chi2.toFixed(1)})`)

  return results
}

function detectFileType(buf: Uint8Array, fileName: string): string {
  const ext = (fileName.split('.').pop() || '').toLowerCase()
  if (buf.length < 4) return 'Unknown'
  const sig = buf[0] * 0x1000000 + buf[1] * 0x10000 + buf[2] * 0x100 + buf[3]
  if (buf[0] === 0x4D && buf[1] === 0x5A) return 'PE Executable'
  if (sig === 0x504B0304) return 'ZIP Archive'
  if (buf[0] === 0x37 && buf[1] === 0x7A) return '7-Zip Archive'
  if (buf[0] === 0x1F && buf[1] === 0x8B) return 'GZIP Archive'
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return 'RIFF (WAV/AVI)'
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'PNG Image'
  if (buf[0] === 0xFF && buf[1] === 0xD8) return 'JPEG Image'
  if (sig === 0x7F454C46) return 'ELF Binary'
  if (buf[0] === 0xCA && buf[1] === 0xFE) return 'Java Class'
  if (buf[0] === 0x23 && buf[1] === 0x21) return 'Script (Shebang)'
  if (['ps1','bat','cmd','vbs','vbe','js','jse','wsf','wsh','hta','py','rb','sh'].includes(ext)) return `${ext.toUpperCase()} Script`
  if (['doc','docx','xls','xlsx','ppt','pptx','pdf'].includes(ext)) return `Office/PDF Document`
  if (['dll','ocx','sys','drv','exe'].includes(ext)) return `${ext.toUpperCase()} File`
  return 'Unknown'
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
// PE Parser (Advanced — All Bugs Fixed)
// ============================================================

const RICH_DLL_NAMES: Record<number, string> = {
  0x0001: 'Visual Studio 97', 0x0002: 'MFC Shared Library', 0x0003: 'MS Visual C++ 1.0',
  0x0004: 'MS Visual C++ 2.0', 0x0005: 'MS Visual C++ 4.0', 0x0006: 'MS Visual C++ 5.0',
  0x0007: 'MS Visual C++ 6.0', 0x0008: 'MS Visual C++ .NET 2002', 0x0009: 'MS Visual C++ .NET 2003',
  0x000A: 'MS Visual C++ 2005', 0x000B: 'MS Visual C++ 2008', 0x000C: 'MS Visual C++ 2010',
  0x000D: 'MS Visual C++ 2012', 0x000E: 'MS Visual C++ 2013', 0x000F: 'MS Visual C++ 2015',
  0x0010: 'MS Visual C++ 2017', 0x0011: 'MS Visual C++ 2019', 0x0012: 'MS Visual C++ 2022',
  0x0099: 'MS Linker', 0x00A0: 'MS VB 5.0', 0x00A1: 'MS VB 6.0',
  0x00B0: 'MS Visual J++ 1.0', 0x00B1: 'MS Visual J++ 1.1', 0x00B2: 'MS Visual J# .NET',
  0x00C0: 'MS ILAsm', 0x00C1: 'MS IDL', 0x00C2: 'MS RESGEN',
  0x00D0: 'MS FoxPro', 0x00E0: 'MS Visual Basic .NET', 0x00E1: 'MS C#',
}

function parseRichHeader(raw: Uint8Array): PERichRecord[] {
  const records: PERichRecord[] = []
  const richEnc = [0x52, 0x69, 0x63, 0x68] // "Rich"
  for (let i = 128; i < Math.min(raw.length - 8, 4096); i++) {
    let match = true
    let xorKey = 0
    for (let j = 0; j < 4; j++) {
      const xored = raw[i + j] ^ raw[i + j + 4]
      if (xored !== richEnc[j]) { match = false; break }
      xorKey = raw[i + j + 4]
    }
    if (match && xorKey > 0) {
      const sigOff = i + 4
      if (sigOff + 4 > raw.length) break
      const xorKey2 = raw[sigOff] ^ richEnc[0]
      const danS = raw[sigOff] ^ xorKey2
      const danA = raw[sigOff + 1] ^ xorKey2
      const danN = raw[sigOff + 2] ^ xorKey2
      const danY = raw[sigOff + 3] ^ xorKey2
      if (danS !== 0x44 || danA !== 0x61 || danN !== 0x6E || danY !== 0x53) continue
      let off = i
      const endOff = sigOff
      const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
      while (off + 8 <= endOff) {
        const compId = readU32(view, off) ^ xorKey2
        const countVal = readU32(view, off + 4) ^ xorKey2
        if (compId === 0) break
        const dllId = compId >> 16
        if (dllId > 0 && dllId < 0x200) {
          records.push({ dll_id: dllId, dll_name: RICH_DLL_NAMES[dllId] || `Unknown (0x${dllId.toString(16)})`, build_count: compId & 0xFFFF, use_count: countVal })
        }
        off += 8
      }
      break
    }
  }
  return records
}

function parsePE(raw: Uint8Array): PEInfo {
  const t0 = Date.now()
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const pe: PEInfo = {
    is_valid_pe: false, machine_type: 'Unknown', arch_bits: 0, entry_point: 0, entry_point_rva: 0,
    image_base: 0, file_size: raw.length, sections: [], imports: [], delay_imports: [],
    exports: [], resources: [], rich_records: [],
    detected_packer: [], detected_compiler: '', compile_time: null, compile_time_anomalies: [],
    subsystem: 'Unknown', dll_characteristics: 0, scan_time: 0,
    entry_anomalies: [], overlay_detected: false, overlay_size: 0, overlay_entropy: 0,
    has_digital_signature: false, has_certificate_table: false, certificate_size: 0,
    total_entropy: 0, import_hash: '', section_hash: '',
    checksum_valid: false, file_checksum: 0, computed_checksum: 0,
    has_relocations: false, has_tls: false, has_bound_imports: false,
  }

  if (!raw || raw.length < 64) return pe
  if (raw[0] !== 0x4D || raw[1] !== 0x5A) return pe

  // FIX #6: Validate e_lfanew — must be >= 64 and within file bounds
  const peOff = readU32(view, 60)
  if (peOff < 64 || peOff + 4 > raw.length || peOff > raw.length - 24) return pe
  if (raw[peOff] !== 0x50 || raw[peOff + 1] !== 0x45 || raw[peOff + 2] !== 0x00 || raw[peOff + 3] !== 0x00) return pe

  pe.is_valid_pe = true
  const coff = peOff + 4
  if (coff + 20 > raw.length) return pe

  const machine = readU16(view, coff)
  const mTypes: Record<number, string> = {
    0x14C: 'x86 (32-bit)', 0x8664: 'x64 (64-bit)', 0x1C0: 'ARM', 0xAA64: 'ARM64', 0x200: 'IA-64'
  }
  pe.machine_type = mTypes[machine] || `Unknown (0x${machine.toString(16)})`
  pe.arch_bits = machine === 0x8664 || machine === 0xAA64 ? 64 : 32

  const numSections = Math.min(readU16(view, coff + 2), 96) // FIX #10: Cap at 96
  const optSize = readU16(view, coff + 16)
  const opt = coff + 20
  if (opt + 2 > raw.length) return pe

  const magic = readU16(view, opt)
  const is64 = magic === 0x20B
  if (magic !== 0x10B && !is64) return pe

  const entryRVA = readU32(view, opt + 16)
  pe.entry_point_rva = entryRVA
  if (is64) { pe.image_base = Number(readU64(view, opt + 24)) }
  else { pe.image_base = readU32(view, opt + 28) }
  pe.entry_point = pe.image_base + entryRVA

  pe.file_checksum = readU32(view, opt + 64)
  pe.dll_characteristics = readU16(view, opt + 70)

  const subOff = opt + 68
  if (subOff + 2 <= raw.length) {
    const subs: Record<number, string> = { 1: 'Native', 2: 'Windows GUI', 3: 'Windows Console', 5: 'OS/2 Console', 7: 'POSIX', 9: 'WinCE', 10: 'EFI', 11: 'EFI Boot', 12: 'EFI Runtime', 14: 'Xbox', 16: 'Windows Boot' }
    pe.subsystem = subs[readU16(view, subOff)] || 'Unknown'
  }

  // Compile timestamp
  const ts = readU32(view, coff + 4)
  if (ts > 0) {
    const d = new Date(ts * 1000)
    const year = d.getFullYear()
    if (year >= 1990 && year <= new Date().getFullYear() + 1) {
      pe.compile_time = d.toISOString()
      const dayOfWeek = d.getUTCDay()
      const month = d.getUTCMonth()
      if (dayOfWeek === 0 || dayOfWeek === 6) pe.compile_time_anomalies.push('تاريخ بناء يوم عطلة')
      if (month >= 5 && month <= 8) pe.compile_time_anomalies.push('فترة الصيف — شائع في malware')
      const hour = d.getUTCHours()
      if (hour >= 0 && hour < 6) pe.compile_time_anomalies.push('ساعات متأخرة')
    } else if (year < 1990 || year > new Date().getFullYear() + 2) {
      pe.compile_time_anomalies.push('تاريخ بناء غير منطقي — قد يكون tampered')
    }
  }

  // Data Directories (safe accessor)
  const ddStart = opt + (is64 ? 112 : 96)
  const ddCount = ddStart + 4 <= raw.length ? readU32(view, ddStart - 4) : 0
  const safeDdCount = Math.min(ddCount, 16)

  function readDD(index: number): { rva: number; size: number } {
    const off = ddStart + index * 8
    if (off + 8 > raw.length || index >= safeDdCount) return { rva: 0, size: 0 }
    return { rva: readU32(view, off), size: readU32(view, off + 4) }
  }

  const exportDD = readDD(0)       // Export
  const importDD = readDD(1)       // Import
  const resDD = readDD(2)          // Resource
  const certDD = readDD(4)         // Certificate Table
  const relocDD = readDD(5)        // Base Relocation
  const boundImportDD = readDD(11) // Bound Import
  const iatDD = readDD(12)         // IAT
  const delayImportDD = readDD(13) // Delay Import
  const tlsDD = readDD(9)          // FIX #4: TLS is DD[9] not DD[7]

  // Certificate / Digital Signature (DD[4])
  if (certDD.rva > 0 && certDD.size > 0 && certDD.rva < raw.length) {
    pe.has_certificate_table = true
    pe.certificate_size = certDD.size
    if (certDD.rva + 6 <= raw.length) {
      const winCertType = readU16(view, certDD.rva + 6)
      pe.has_digital_signature = (winCertType === 0x0002) // WIN_CERT_TYPE_PKCS_SIGNED_DATA
    }
  }

  pe.has_relocations = relocDD.rva > 0 && relocDD.size > 0
  pe.has_tls = tlsDD.rva > 0 && tlsDD.size > 0
  pe.has_bound_imports = boundImportDD.rva > 0 && boundImportDD.size > 0

  const secStart = opt + optSize
  if (secStart + numSections * 40 > raw.length) return pe

  let highestSectionEnd = 0

  for (let i = 0; i < numSections; i++) {
    const off = secStart + (i * 40)
    if (off + 40 > raw.length) break
    const name = readAscii(raw, off, 8)
    const vSize = readU32(view, off + 8)
    const vAddr = readU32(view, off + 12)
    const rSize = readU32(view, off + 16)
    const rOff = readU32(view, off + 20)
    const chars = readU32(view, off + 36)
    const secData = safeSlice(raw, rOff, rOff + Math.min(rSize, raw.length - rOff))
    const entropy = calcEntropy(secData)
    const eInfo = entropyLevel(entropy)
    const secHash = simpleMD5(secData.length > 0 ? secData : new Uint8Array(0))
    const flags: string[] = []
    const anomalies: string[] = []
    let suspicious = false

    if (chars & 0x00000020) flags.push('CODE')
    if (chars & 0x00000040) flags.push('DATA')
    if (chars & 0x00000080) flags.push('BSS')
    if (chars & 0x02000000) flags.push('DISCARD')
    if (chars & 0x20000000) flags.push('EXEC')
    if (chars & 0x40000000) flags.push('READ')
    if (chars & 0x80000000) flags.push('WRITE')

    // Known packer/protector section names
    if (/\.?UPX/i.test(name) || /\.?vmp/i.test(name) || /\.?enigma/i.test(name) || /\.?themida/i.test(name) || /\.?mpress/i.test(name) || /\.?aspack/i.test(name) || /\.?pec/i.test(name) || /\.?nsp/i.test(name)) {
      suspicious = true; anomalies.push('قسم معروف كـ packer/protector')
    }

    // High entropy in non-standard sections
    if (entropy > 7.5 && !name.startsWith('.text') && !name.startsWith('.rdata') && !name.startsWith('.reloc') && !name.startsWith('.pdata') && !name.startsWith('.gfids')) {
      suspicious = true; anomalies.push(`إنتروبيا عالية ${eInfo.color} (${entropy.toFixed(2)})`)
    }

    // Virtual size >> raw size
    if (vSize > rSize * 3 && rSize > 0) {
      suspicious = true; anomalies.push('virtual size أكبر بكثير من raw — يشير لتشفير/ضغط')
    }

    // Empty raw but has virtual size
    if (rSize === 0 && vSize > 0 && name !== '.bss') {
      suspicious = true; anomalies.push('raw size = 0 مع virtual size > 0')
    }

    // W^X violation
    if ((chars & 0x20000000) && (chars & 0x80000000) && !name.startsWith('.text') && !name.startsWith('.rsrc')) {
      suspicious = true; anomalies.push('قسم writable + executable — W^X violation')
    }

    // High entropy in code section
    if (name.startsWith('.text') && entropy > 6.5) {
      suspicious = true; anomalies.push('قسم الكود فيه إنتروبيا عالية — على الأرجح مشفّر')
    }

    // Executable non-.text section with high entropy
    if ((chars & 0x20000000) && !name.startsWith('.text') && entropy > 7.0 && rSize > 1000) {
      suspicious = true; anomalies.push('قسم executable غير .text مع إنتروبيا عالية')
    }

    const secEnd = rOff + rSize
    if (secEnd > highestSectionEnd) highestSectionEnd = secEnd

    pe.sections.push({
      name, virtual_size: vSize, virtual_address: vAddr, raw_offset: rOff,
      raw_size: rSize, characteristics: chars, entropy, md5: secHash, flags, is_suspicious: suspicious, anomalies
    })
  }

  // Entry point analysis
  if (entryRVA > 0) {
    const epSec = pe.sections.find(s => entryRVA >= s.virtual_address && entryRVA < s.virtual_address + s.virtual_size)
    if (epSec) {
      const epOff = rvaToOffset(entryRVA, pe.sections)
      if (epOff > 0 && epOff + 32 <= raw.length) {
        const epHex = toHexSlice(raw, epOff, 32)
        if (epHex.startsWith('60')) pe.entry_anomalies.push('pushad — شائع في packed binaries')
        if (epHex.startsWith('e8') || epHex.startsWith('e9')) pe.entry_anomalies.push('call/jmp مباشر من entry point')
        if (epHex.startsWith('fc68') || epHex.startsWith('68')) pe.entry_anomalies.push('push immediate — قد يكون packer stub')
        if (epHex.startsWith('e800000000')) pe.entry_anomalies.push('call $+5 — trampoline code (packer)')
        if (epSec.entropy > 7.0) pe.entry_anomalies.push(`entry في قسم مشفّر (entropy: ${epSec.entropy.toFixed(2)})`)
        if (epSec.is_suspicious) pe.entry_anomalies.push('entry point في قسم مشبوه')
        if (epHex.includes('64ff3500000000') || epHex.includes('64a130000000')) pe.entry_anomalies.push('PEB access — anti-debug')
        if (epHex.includes('cd2c') || epHex.includes('0f34')) pe.entry_anomalies.push('INT 2D/3 — anti-debug breakpoint')
        if (epHex.startsWith('558bec') || epHex.startsWith('554889')) pe.entry_anomalies.push('frame pointer setup — طبيعي')
      }
    } else {
      pe.entry_anomalies.push('entry point خارج جميع الأقسام — مشبوه جداً')
    }
  }

  // Overlay detection
  if (highestSectionEnd > 0 && raw.length > highestSectionEnd) {
    pe.overlay_detected = true
    pe.overlay_size = raw.length - highestSectionEnd
    const overlayData = safeSlice(raw, highestSectionEnd, raw.length)
    pe.overlay_entropy = calcEntropy(overlayData)
    if (pe.overlay_size > 100000) pe.detected_packer.push(`Overlay كبير (${(pe.overlay_size / 1024).toFixed(0)} KB)`)
    if (pe.overlay_entropy > 7.0 && pe.overlay_size > 10000) pe.detected_packer.push(`Overlay مشفّر (entropy: ${pe.overlay_entropy.toFixed(2)})`)
  }

  // TLS callback detection (anti-debug)
  if (pe.has_tls) {
    const tlsOff = rvaToOffset(tlsDD.rva, pe.sections)
    if (tlsOff > 0 && tlsOff + 40 <= raw.length) {
      const callbacksRVA = readU32(view, tlsOff + 16)
      if (callbacksRVA > 0) pe.entry_anomalies.push('TLS Callbacks موجودة — قد تُستخدم لـ anti-debug')
    }
  }

  // ============================================================
  // Import Table Parsing (FIX #2 & #3: Ordinal Flag & Number)
  // ============================================================

  const dangerousAPIs: Record<string, { severity: number; category: string }> = {}
  const dangerousList: [string, number, string][] = [
    ['VirtualAlloc', 9, 'injection'], ['VirtualAllocEx', 9, 'injection'], ['VirtualProtect', 8, 'injection'],
    ['VirtualProtectEx', 8, 'injection'], ['CreateRemoteThread', 10, 'injection'], ['QueueUserAPC', 9, 'injection'],
    ['WriteProcessMemory', 10, 'injection'], ['ReadProcessMemory', 9, 'credential'],
    ['OpenProcess', 7, 'privilege'], ['NtOpenProcess', 7, 'privilege'],
    ['LoadLibrary', 7, 'evasion'], ['LoadLibraryEx', 7, 'evasion'], ['GetProcAddress', 5, 'info'],
    ['SetWindowsHookEx', 9, 'injection'], ['GetAsyncKeyState', 8, 'surveillance'], ['GetKeyState', 7, 'surveillance'],
    ['ShellExecute', 8, 'execution'], ['ShellExecuteA', 8, 'execution'], ['ShellExecuteW', 8, 'execution'],
    ['WinExec', 9, 'execution'],
    ['CreateProcess', 9, 'execution'], ['CreateProcessA', 9, 'execution'], ['CreateProcessW', 9, 'execution'],
    ['CreateProcessAsUser', 10, 'execution'],
    ['InternetOpen', 6, 'network'], ['InternetOpenUrl', 7, 'network'], ['InternetConnect', 6, 'network'],
    ['HttpSendRequest', 7, 'network'], ['URLDownloadToFile', 8, 'download'],
    ['WinHttpOpen', 6, 'network'], ['WinHttpConnect', 6, 'network'], ['WinHttpSendRequest', 7, 'network'],
    ['RegSetValue', 7, 'persistence'], ['RegSetValueEx', 7, 'persistence'],
    ['RegCreateKey', 7, 'persistence'], ['RegCreateKeyEx', 7, 'persistence'],
    ['RegDeleteKey', 6, 'persistence'], ['RegDeleteValue', 6, 'persistence'],
    ['NtCreateThread', 9, 'injection'], ['NtCreateThreadEx', 9, 'injection'], ['RtlCreateUserThread', 9, 'injection'],
    ['NtUnmapViewOfSection', 9, 'injection'], ['NtMapViewOfSection', 9, 'injection'],
    ['NtWriteVirtualMemory', 10, 'injection'], ['NtReadVirtualMemory', 9, 'credential'],
    ['DeviceIoControl', 7, 'evasion'],
    ['CryptEncrypt', 6, 'financial'], ['CryptDecrypt', 6, 'financial'], ['CryptGenKey', 5, 'financial'],
    ['CryptImportKey', 6, 'financial'], ['CryptCreateHash', 5, 'financial'],
    ['RtlDecompressBuffer', 7, 'evasion'],
    ['socket', 6, 'network'], ['connect', 6, 'network'], ['send', 5, 'network'], ['recv', 5, 'network'],
    ['WSAStartup', 5, 'network'], ['WSASocket', 6, 'network'],
    ['SetClipboardData', 6, 'surveillance'], ['GetClipboardData', 6, 'credential'],
    ['BitBlt', 6, 'surveillance'], ['GetDC', 5, 'surveillance'],
    ['EnumWindows', 6, 'surveillance'], ['FindWindow', 5, 'surveillance'], ['FindWindowA', 5, 'surveillance'],
    ['SetErrorMode', 7, 'evasion'], ['SetUnhandledExceptionFilter', 7, 'evasion'],
    ['IsDebuggerPresent', 8, 'evasion'], ['CheckRemoteDebuggerPresent', 9, 'evasion'],
    ['NtQueryInformationProcess', 9, 'evasion'], ['NtSetInformationThread', 8, 'evasion'],
    ['CreateToolhelp32Snapshot', 7, 'evasion'],
    ['SuspendThread', 7, 'execution'], ['TerminateProcess', 8, 'execution'],
    ['CopyFile', 5, 'filesystem'], ['DeleteFile', 6, 'filesystem'],
    ['CreateFile', 5, 'filesystem'], ['WriteFile', 5, 'filesystem'], ['ReadFile', 4, 'filesystem'],
    ['NetUserAdd', 8, 'privilege'], ['NetLocalGroupAddMembers', 8, 'privilege'],
    ['ExitWindowsEx', 8, 'privilege'], ['AdjustTokenPrivileges', 8, 'privilege'], ['OpenProcessToken', 7, 'privilege'],
    ['SendInput', 6, 'surveillance'], ['BlockInput', 8, 'surveillance'],
    ['DnsQuery', 5, 'network'], ['getaddrinfo', 4, 'network'], ['gethostbyname', 4, 'network'],
    ['FtpPutFile', 7, 'network'], ['FtpGetFile', 7, 'network'],
    ['CoCreateInstance', 4, 'execution'],
    ['mouse_event', 6, 'surveillance'], ['keybd_event', 7, 'surveillance'],
    ['GetTempPath', 4, 'filesystem'], ['GetTempFileName', 4, 'filesystem'],
    ['GetModuleHandle', 5, 'info'], ['GetModuleHandleA', 5, 'info'],
  ]
  for (const [name, sev, cat] of dangerousList) dangerousAPIs[name.toLowerCase()] = { severity: sev, category: cat }

  function isDangerousAPI(fn: string): { dangerous: boolean; severity: number; category: string } {
    const info = dangerousAPIs[fn.toLowerCase()]
    return info ? { dangerous: true, severity: info.severity, category: info.category } : { dangerous: false, severity: 0, category: '' }
  }

  // Parse standard imports
  if (importDD.rva > 0 && importDD.size > 0) {
    const impOff = rvaToOffset(importDD.rva, pe.sections)
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
        const dangerousApisList: string[] = []
        let suspCount = 0
        const iltOff = rvaToOffset(iltRva, pe.sections)
        if (iltOff > 0) {
          for (let j = 0; j < 200; j++) {
            const fOff = iltOff + (j * (is64 ? 8 : 4))
            if (fOff + (is64 ? 8 : 4) > raw.length) break
            if (is64) {
              // FIX #2: PE64 ordinal flag is bit 63 (not bit 1)
              const entry = readU64(view, fOff)
              if (entry === BigInt(0)) break
              if (entry & BigInt(0x8000000000000000)) { // FIX: was & BigInt(1)
                const ordinalNum = Number(entry & BigInt(0xFFFF)) // FIX: was >> BigInt(32)
                funcs.push(`Ordinal#${ordinalNum}`)
                continue
              }
              const hintRva = Number(entry)
              const hOff = rvaToOffset(hintRva, pe.sections)
              if (hOff > 0 && hOff + 2 < raw.length) {
                const fn = readAscii(raw, hOff + 2, 256)
                if (fn) { funcs.push(fn); const api = isDangerousAPI(fn); if (api.dangerous) { suspCount++; dangerousApisList.push(fn) } }
              }
            } else {
              // FIX #2: PE32 ordinal flag is bit 31 (not bit 1)
              const entry = readU32(view, fOff)
              if (entry === 0) break
              if (entry & 0x80000000) { // FIX: was & 1
                const ordinalNum = entry & 0xFFFF // FIX: was entry >> 16
                funcs.push(`Ordinal#${ordinalNum}`)
                continue
              }
              const hOff = rvaToOffset(entry, pe.sections)
              if (hOff > 0 && hOff + 2 < raw.length) {
                const fn = readAscii(raw, hOff + 2, 256)
                if (fn) { funcs.push(fn); const api = isDangerousAPI(fn); if (api.dangerous) { suspCount++; dangerousApisList.push(fn) } }
              }
            }
          }
        }
        pe.imports.push({ dll: dllName.toLowerCase(), functions: funcs, suspicious_count: suspCount, dangerous_apis: dangerousApisList })
      }
    }
  }

  // Parse delay imports (DD[13])
  if (delayImportDD.rva > 0 && delayImportDD.size > 0) {
    const dImpOff = rvaToOffset(delayImportDD.rva, pe.sections)
    if (dImpOff > 0 && dImpOff < raw.length) {
      for (let i = 0; i < 200; i++) {
        const off = dImpOff + (i * 32)
        if (off + 32 > raw.length) break
        const nameRva = readU32(view, off)
        const moduleHandleRva = readU32(view, off + 4)
        const intRva = readU32(view, off + 16)
        const iatRva = readU32(view, off + 20)
        const attrs = readU32(view, off + 24)
        if (nameRva === 0 && moduleHandleRva === 0 && intRva === 0 && iatRva === 0) break
        const nOff = rvaToOffset(nameRva, pe.sections)
        if (nOff <= 0 || nOff >= raw.length) continue
        const dllName = readAscii(raw, nOff, 256)
        if (!dllName) continue
        pe.delay_imports.push({ dll: dllName.toLowerCase(), attributes: attrs, module_handle_rva: moduleHandleRva, import_name_table_rva: intRva, import_address_table_rva: iatRva })
      }
    }
  }

  // Import hash
  if (pe.imports.length > 0) {
    const importStr = pe.imports.map(i => `${i.dll}:${i.functions.slice(0, 10).join(',')}`).join('|').toLowerCase()
    pe.import_hash = simpleFNV1a(new TextEncoder().encode(importStr))
  }
  if (pe.sections.length > 0) {
    const secStr = pe.sections.map(s => `${s.name}:${s.characteristics.toString(16)}:${s.virtual_size}`).join('|').toLowerCase()
    pe.section_hash = simpleFNV1a(new TextEncoder().encode(secStr))
  }

  // Parse exports
  if (exportDD.rva > 0 && exportDD.size > 0) {
    const expOff = rvaToOffset(exportDD.rva, pe.sections)
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
          if (nOff > 0 && nOff < raw.length) { const n = readAscii(raw, nOff, 256); if (n) pe.exports.push(n) }
        }
      }
    }
  }

  // Rich Header
  pe.rich_records = parseRichHeader(raw)
  if (pe.rich_records.length > 0) {
    const latestVC = pe.rich_records.filter(r => r.dll_id >= 7 && r.dll_id <= 18).sort((a, b) => b.dll_id - a.dll_id)[0]
    if (latestVC) pe.detected_compiler = latestVC.dll_name
  }

  // Packer detection (enhanced)
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
    ['SafeNet/Sentinel', p => p.sections.some(s => s.name.toLowerCase().includes('sentinel'))],
    ['PEtite', p => p.sections.some(s => /^\.?petite/i.test(s.name))],
    ['tElock', p => p.sections.some(s => /^\.?telock/i.test(s.name))],
    ['EXEStealth', p => p.sections.some(s => /^\.?me0/i.test(s.name))],
  ]
  for (const [name, check] of packers) { if (check(pe)) pe.detected_packer.push(name) }

  const highEntropyNonText = pe.sections.filter(s => s.entropy > 7.5 && !s.name.startsWith('.text') && !s.name.startsWith('.rdata') && !s.name.startsWith('.reloc') && !s.name.startsWith('.pdata'))
  if (highEntropyNonText.length > 0 && pe.detected_packer.length === 0) pe.detected_packer.push('تشفير/ضغط مخصص (custom)')

  pe.total_entropy = calcEntropy(raw)

  // Resources (enhanced)
  if (resDD.rva > 0 && resDD.size > 0) {
    const rOff = rvaToOffset(resDD.rva, pe.sections)
    if (rOff > 0 && rOff < raw.length) {
      const rTypes: Record<number, string> = { 1: 'Cursor', 2: 'Bitmap', 3: 'Icon', 5: 'Dialog', 6: 'String Table', 16: 'Version Info', 24: 'Manifest' }
      try {
        const numNamedTypes = readU16(view, rOff + 12)
        const numIdTypes = readU16(view, rOff + 14)
        const numT = numNamedTypes + numIdTypes
        let typeEntryOff = rOff + 16
        for (let i = 0; i < Math.min(numT, 64); i++) {
          if (typeEntryOff + 8 > raw.length) break
          const typeID = readU32(view, typeEntryOff)
          const typeOffset = readU32(view, typeEntryOff + 4)
          const tStr = (typeID & 0x80000000) ? `Named#${typeID & 0x7FFFFFFF}` : (rTypes[typeID] || `Type#${typeID}`)
          const entryDir = rOff + (typeOffset & 0x7FFFFFFF)
          if (entryDir + 16 > raw.length) { typeEntryOff += 8; continue }
          const numNamedEntries = readU16(view, entryDir + 12)
          const numIdEntries = readU16(view, entryDir + 14)
          for (let j = 0; j < Math.min(numNamedEntries + numIdEntries, 32); j++) {
            const eOff2 = entryDir + 16 + (j * 8)
            if (eOff2 + 8 > raw.length) break
            const nameID = readU32(view, eOff2)
            const dataOffset = readU32(view, eOff2 + 4)
            const dataEntry = rOff + (dataOffset & 0x7FFFFFFF)
            if (dataEntry + 16 > raw.length) continue
            const dataRVA = readU32(view, dataEntry)
            const dataSize = readU32(view, dataEntry + 4)
            const dataFileOff = rvaToOffset(dataRVA, pe.sections)
            const resData = dataFileOff > 0 ? safeSlice(raw, dataFileOff, dataFileOff + Math.min(dataSize, raw.length - dataFileOff)) : new Uint8Array(0)
            const resEntropy = calcEntropy(resData)
            pe.resources.push({ type: tStr, name: (nameID & 0x80000000) ? 'Named' : `#${nameID}`, language: 'Neutral', size: dataSize, entropy: resEntropy })
          }
          typeEntryOff += 8
        }
      } catch { /* skip malformed */ }
    }
  }

  pe.scan_time = Date.now() - t0
  return pe
}

// ============================================================
// Encryption Analysis Engine (Enhanced)
// ============================================================

function detectEncryptionTypes(buf: Uint8Array, content: string, obfuscation: ObfuscationReport, peInfo: PEInfo | null): EncryptionDetail[] {
  const details: EncryptionDetail[] = []

  // 1. Entropy-based
  const totalEntropy = peInfo?.total_entropy || calcEntropy(buf)
  const eInfo = entropyLevel(totalEntropy)
  if (totalEntropy > 7.0) {
    let algo = 'غير معروف', conf = 50
    let ev = `إنتروبيا عامة ${eInfo.level} (${totalEntropy.toFixed(3)})`
    if (peInfo) {
      const highSec = peInfo.sections.filter(s => s.entropy > 7.5)
      if (highSec.length > 0) {
        ev += ` — ${highSec.length} أقسام مشفرة: ${highSec.map(s => s.name).join(', ')}`
        conf = 75
        if (highSec.some(s => /^\.?UPX/i.test(s.name))) { algo = 'LZMA / NRV (UPX)'; conf = 90 }
        else if (highSec.some(s => /^\.?vmp/i.test(s.name))) { algo = 'VMProtect Virtualization'; conf = 95 }
        else if (highSec.some(s => s.name.toLowerCase().includes('themida'))) { algo = 'Themida Encryption'; conf = 95 }
        else if (highSec.every(s => s.name === '.text' || s.name.startsWith('.text'))) { algo = 'Code Section Encryption'; conf = 70 }
        else if (highSec.length === 1) { algo = 'Single Section Encryption'; conf = 60 }
        else { algo = 'Multi-Section Encryption'; conf = 75 }
      }
    }
    details.push({ type: 'تشفير كامل', algorithm: algo, key_size: 'غير معروف', mode: 'CBC/CTR (تخمين)', confidence: conf, evidence: ev, severity: conf > 80 ? 'critical' : 'high' })
  } else if (totalEntropy > 6.0) {
    details.push({ type: 'ضغط/تشفير جزئي', algorithm: 'ZIP/LZMA/XZ', key_size: '-', mode: 'Stream', confidence: 40, evidence: `إنتروبيا ${totalEntropy.toFixed(3)}`, severity: 'low' })
  }

  // 2. Base64 layers
  const b64Matches = content.match(/["'`]([A-Za-z0-9+/]{40,}={0,2})["'`]/g)
  if (b64Matches) {
    const decoded = b64Decode(b64Matches[0].replace(/["'`]/g, ''))
    if (decoded.length > 10 && /[\x20-\x7E]{10,}/.test(decoded)) {
      details.push({ type: 'ترميز', algorithm: 'Base64', key_size: '-', mode: 'Encoding', confidence: 85, evidence: `وجد ${b64Matches.length} سلسلة Base64`, severity: 'medium' })
    }
  }

  // 3. Hex encoding
  const hexMatches = content.match(/["'`](?:0x)?([0-9a-fA-F]{60,})["'`]/g)
  if (hexMatches) {
    const decoded = hexDecode(hexMatches[0].replace(/["'`0x]/g, ''))
    if (decoded.length > 10 && /[\x20-\x7E]{10,}/.test(decoded)) {
      details.push({ type: 'ترميز', algorithm: 'Hex Encoding', key_size: '-', mode: 'Encoding', confidence: 80, evidence: `وجد ${hexMatches.length} سلسلة Hex`, severity: 'medium' })
    }
  }

  // 4. XOR detection (limited keys)
  for (const key of [1, 2, 3, 0x13, 0x37, 0x55, 0xAA, 0xFF, 0x42, 0x69]) {
    const dec = xorDecode(content.substring(0, 500), key)
    if (dec && dec.length > 20) {
      details.push({ type: 'تشفير', algorithm: `XOR (key: 0x${key.toString(16).padStart(2,'0')})`, key_size: '8-bit', mode: 'Stream Cipher', confidence: 70, evidence: `فك بنجاح: "${dec.substring(0, 60)}..."`, severity: 'high' })
      break
    }
  }

  // 5. RC4 detection
  for (const key of ['secret', 'key', 'password', 'token', 'discord', 'bot', 'trj', 'malware', 'shellcode', 'payload', 'reverse']) {
    const dec = rc4Decode(content.substring(0, 500), key)
    if (dec && dec.length > 20) {
      details.push({ type: 'تشفير', algorithm: 'RC4', key_size: `${key.length * 8}-bit`, mode: 'Stream Cipher', confidence: 65, evidence: `RC4 بالمفتاح "${key}": "${dec.substring(0, 50)}..."`, severity: 'high' })
      break
    }
  }

  // 6. ROT13
  if (/[a-zA-Z]{20,}/.test(content) && !/\b(eval|function|return|const|let|var)\b/.test(content.substring(0, 200))) {
    const dec = rot13(content.substring(0, 200))
    if (/\b(function|eval|alert|document|window)\b/i.test(dec)) {
      details.push({ type: 'ترميز', algorithm: 'ROT13', key_size: '-', mode: 'Substitution Cipher', confidence: 60, evidence: `ROT13 → كود قابل للقراءة`, severity: 'low' })
    }
  }

  // 7. Unicode escapes
  if (/\\u[0-9a-fA-F]{4}/.test(content)) {
    const count = (content.match(/\\u[0-9a-fA-F]{4}/g) || []).length
    const dec = unicodeDecode(content.substring(0, 200))
    if (dec !== content.substring(0, 200) && dec.length > 10) {
      details.push({ type: 'ترميز', algorithm: 'Unicode Escape Sequences', key_size: '-', mode: 'Encoding', confidence: 90, evidence: `${count} تسلسل Unicode`, severity: 'medium' })
    }
  }

  // 8. Known crypto patterns in binary
  if (peInfo) {
    const strings = extractStrings(buf, 6)
    const cryptoLibs = strings.filter(s => /bcrypt|pbkdf|scrypt|argon|aes|des|rsa|blowfish|twofish|chacha|salsa|poly1305|gcm/i.test(s))
    if (cryptoLibs.length > 0) {
      details.push({ type: 'تشفير', algorithm: 'مكتبة تشفير مكتشفة', key_size: 'متغير', mode: 'متعدد', confidence: 75, evidence: cryptoLibs.slice(0, 5).join(', '), severity: 'medium' })
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

  // 10. Multi-layer
  if (obfuscation.layers >= 2) {
    details.push({ type: 'تشفير متعدد الطبقات', algorithm: `${obfuscation.layers} طبقات`, key_size: 'متغير', mode: 'Multi-layer', confidence: obfuscation.overall_confidence, evidence: `الطبقات: ${obfuscation.techniques.join(' → ')}`, severity: obfuscation.layers >= 4 ? 'critical' : 'high' })
  }

  // 11. AES S-Box detection
  const aesSBoxStart = [0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5]
  for (let i = 0; i < Math.min(buf.length - 8, 500000); i++) {
    let match = true
    for (let j = 0; j < 8; j++) { if (buf[i + j] !== aesSBoxStart[j]) { match = false; break } }
    if (match) {
      details.push({ type: 'تشفير', algorithm: 'AES (Rijndael S-Box)', key_size: '128/192/256-bit', mode: 'ECB/CBC/GCM', confidence: 95, evidence: `AES S-Box عند offset 0x${i.toString(16)}`, severity: 'medium' })
      break
    }
  }

  // 12. Blowfish P-Array detection
  const bfPArray = [0x243f6a88, 0x85a308d3, 0x13198a2e, 0x03707344]
  const bfView = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  for (let i = 0; i < Math.min(buf.length - 16, 500000); i += 4) {
    if (readU32(bfView, i) === bfPArray[0] && readU32(bfView, i + 4) === bfPArray[1] && readU32(bfView, i + 8) === bfPArray[2] && readU32(bfView, i + 12) === bfPArray[3]) {
      details.push({ type: 'تشفير', algorithm: 'Blowfish (P-Array)', key_size: '32-448-bit', mode: 'ECB/CBC', confidence: 90, evidence: `Blowfish P-Array عند offset 0x${i.toString(16)}`, severity: 'medium' })
      break
    }
  }

  // 13. Certificate table
  if (peInfo?.has_certificate_table) {
    if (peInfo.has_digital_signature) {
      details.push({ type: 'توقيع رقمي', algorithm: 'Authenticode (PKCS#7)', key_size: 'RSA/ECDSA', mode: 'Digital Signature', confidence: 95, evidence: `شهادة (${(peInfo.certificate_size / 1024).toFixed(1)} KB)`, severity: 'low' })
    } else {
      details.push({ type: 'شهادة مشبوهة', algorithm: 'جدول بدون توقيع صالح', key_size: '-', mode: 'Invalid Signature', confidence: 70, evidence: `Certificate table (${(peInfo.certificate_size / 1024).toFixed(1)} KB) بدون توقيع`, severity: 'high' })
    }
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
    encryption_detected: false, decoded_size: 0, original_size: content.length,
    deobfuscated_content: ''
  }

  let current = content
  let layerCount = 0

  for (let i = 0; i < 10; i++) {
    let decoded = '', found = false, technique = '', evidence = ''
    const prev = current

    const b64Match = current.match(/(?:["'`])([A-Za-z0-9+/]{20,}={0,2})(?:["'`])/)
    if (b64Match) {
      decoded = b64Decode(b64Match[1])
      if (decoded && decoded.length > 10 && /[\x20-\x7E]{10,}/.test(decoded)) {
        current = decoded; layerCount++; technique = 'Base64'
        evidence = `سلسلة ${b64Match[1].length} حرف → "${decoded.substring(0, 40)}..."`; found = true
      }
    }

    if (!found) {
      const hexMatch = current.match(/(?:["'`])([0-9a-fA-F]{40,})(?:["'`])/)
      if (hexMatch) {
        decoded = hexDecode(hexMatch[1])
        if (decoded && decoded.length > 10 && /[\x20-\x7E]{10,}/.test(decoded)) {
          current = decoded; layerCount++; technique = 'Hex Encoding'
          evidence = `Hex ${hexMatch[1].length} حرف → "${decoded.substring(0, 40)}..."`; found = true
        }
      }
    }

    if (!found && /\\u[0-9a-fA-F]{4}/.test(current)) {
      decoded = unicodeDecode(current)
      if (decoded !== current && decoded.length > 10) { current = decoded; layerCount++; technique = 'Unicode Escapes'; evidence = 'Unicode decoded'; found = true }
    }

    if (!found && /^[a-zA-Z\s]{20,}$/.test(current.substring(0, 100))) {
      decoded = rot13(current)
      if (/\b(function|eval|const|let|var|return|document|window|require)\b/.test(decoded)) {
        current = decoded; layerCount++; technique = 'ROT13'; evidence = 'ROT13 → كود'; found = true
      }
    }

    // FIX #7: XOR limited to common keys
    if (!found) {
      for (const key of [1, 2, 3, 0x13, 0x37, 0x55, 0xAA, 0xFF]) {
        decoded = xorDecode(current.substring(0, 500), key)
        if (decoded && decoded.length > 20) {
          current = decoded; layerCount++; technique = `XOR (key: 0x${key.toString(16).padStart(2,'0')})`
          evidence = `XOR → "${decoded.substring(0, 50)}..."`; found = true; break
        }
      }
    }

    if (!found) {
      for (const key of ['key', 'secret', 'password', '1234', 'abcd', 'decode', 'encrypt', 'bot', 'token']) {
        decoded = rc4Decode(current.substring(0, 500), key)
        if (decoded && decoded.length > 20) {
          current = decoded; layerCount++; technique = `RC4 (key: "${key}")`
          evidence = `RC4 → "${decoded.substring(0, 50)}..."`; found = true; break
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
    } else break
  }

  report.deobfuscated_content = current

  // Dynamic execution patterns
  if (/\beval\s*\(/.test(current)) { report.techniques.push('eval() تنفيذ ديناميكي'); report.encryption_detected = true }
  if (/\bFunction\s*\(/.test(current) && /\beval\b/.test(current)) { report.techniques.push('Function Constructor'); report.encryption_detected = true }
  if (/\batob\s*\(/.test(current)) report.techniques.push('atob() Base64 Runtime')
  if (/\bString\.fromCharCode\s*\(/.test(current)) { report.techniques.push('fromCharCode إخفاء نصوص'); report.encryption_detected = true }
  if (/\bbtoa\s*\(/.test(current) && /\beval\b/.test(current)) report.techniques.push('btoa+eval encoding loop')
  if (/\\x[0-9a-fA-F]{2}/.test(current)) { const c = (current.match(/\\x[0-9a-fA-F]{2}/g) || []).length; if (c > 10) report.techniques.push('Hex Escapes') }
  if (/\[\s*\w+\s*\|\s*\w+\s*\]/.test(current)) report.techniques.push('Bitwise Operations')
  if (/\bnew\s+Function\s*\(/.test(current)) { report.techniques.push('Dynamic Function Constructor'); report.encryption_detected = true }
  if (/\bsetTimeout\s*\(\s*["'`]/.test(current) && /\beval\b/.test(current)) report.techniques.push('setTimeout eval loop')
  if (/\bProxy\b\s*\(/.test(current)) report.techniques.push('Proxy interception')

  if (report.techniques.some(t => t.includes('XOR'))) report.encryption_type = 'XOR Cipher'
  else if (report.techniques.some(t => t.includes('RC4'))) report.encryption_type = 'RC4 Stream Cipher'
  else if (report.techniques.some(t => t.includes('Base64'))) report.encryption_type = 'Base64 Encoding'
  else if (report.techniques.some(t => t.includes('Unicode'))) report.encryption_type = 'Unicode Obfuscation'
  else if (report.techniques.some(t => t.includes('ROT13'))) report.encryption_type = 'ROT13 Substitution'
  else if (report.techniques.some(t => t.includes('Hex'))) report.encryption_type = 'Hex Obfuscation'
  else if (report.techniques.length > 0) report.encryption_type = 'مختلط (Multi-technique)'
  else report.encryption_type = 'none'

  report.layers = layerCount
  report.decoded_size = current.length
  report.is_obfuscated = report.techniques.length > 0
  report.overall_confidence = Math.min(Math.round((report.techniques.length * 12) + (layerCount * 8) + (report.encryption_detected ? 15 : 0)), 100)

  return report
}

// ============================================================
// Binary String Engine (Enhanced)
// ============================================================

function binaryStringEngine(buf: Uint8Array): PatternMatch[] {
  const matches: PatternMatch[] = []
  const strings = extractStrings(buf, 5)
  const wideStrings = extractWideStrings(buf, 5)
  const allStrings = [...strings, ...wideStrings]

  const pats: { re: RegExp; desc: string; sev: number; cat: string; mitre?: string }[] = [
    { re: /powershell/i, desc: 'PowerShell execution', sev: 8, cat: 'execution', mitre: 'T1059.001' },
    { re: /cmd\.exe|cmd \/c/i, desc: 'CMD shell execution', sev: 7, cat: 'execution', mitre: 'T1059.003' },
    { re: /reg(?:istry|edit|svr32|add)/i, desc: 'Registry manipulation', sev: 7, cat: 'persistence', mitre: 'T1112' },
    { re: /svchost\.exe/i, desc: 'Process masquerading', sev: 8, cat: 'evasion', mitre: 'T1036.004' },
    { re: /temp[\\/]|%temp%|appdata/i, desc: 'Temp directory usage', sev: 5, cat: 'filesystem', mitre: 'T1083' },
    { re: /http[s]?:\/\/.*?\.(?:tk|ml|ga|cf|gq|pw|top|buzz|xyz|onion|ru)/i, desc: 'Suspicious TLD', sev: 8, cat: 'network', mitre: 'T1568.002' },
    { re: /\/c\s+(?:curl|wget|Invoke-WebRequest)/i, desc: 'Remote download', sev: 9, cat: 'download', mitre: 'T1105' },
    { re: /taskkill|wmic\s+process/i, desc: 'Process manipulation', sev: 7, cat: 'execution', mitre: 'T1059' },
    { re: /bypass.*AMSI|AMSI.*bypass/i, desc: 'AMSI bypass', sev: 10, cat: 'evasion', mitre: 'T1562.001' },
    { re: /Set-MpPreference|Disable-Windows/i, desc: 'Antivirus tampering', sev: 10, cat: 'evasion', mitre: 'T1562.001' },
    { re: /iex\b|invoke-expression|Start-Process/i, desc: 'Dynamic execution', sev: 8, cat: 'execution', mitre: 'T1059.001' },
    { re: /DownloadString|DownloadFile|WebClient/i, desc: 'Network download', sev: 7, cat: 'download', mitre: 'T1105' },
    { re: /key(?:board|log|stroke)/i, desc: 'Keylogger', sev: 9, cat: 'credential', mitre: 'T1056.001' },
    { re: /screen(?:capture|shot|grab|spy)/i, desc: 'Screen capture', sev: 9, cat: 'surveillance', mitre: 'T1113' },
    { re: /bitcoin|wallet|crypto|mining/i, desc: 'Crypto mining', sev: 7, cat: 'financial', mitre: 'T1496' },
    { re: /discord(?:\.gg|app|api|webhook)/i, desc: 'Discord webhook', sev: 5, cat: 'network', mitre: 'T1105' },
    { re: /inject|hook|dll.*inject|loadlibrary/i, desc: 'Code injection', sev: 9, cat: 'injection', mitre: 'T1055' },
    { re: /reverse.*shell|backdoor/i, desc: 'Backdoor', sev: 10, cat: 'remote', mitre: 'T1505' },
    { re: /credential|password.*steal/i, desc: 'Credential harvesting', sev: 8, cat: 'credential', mitre: 'T1003' },
    { re: /chrome|firefox|browser.*data|cookie.*steal/i, desc: 'Browser data theft', sev: 8, cat: 'credential', mitre: 'T1539' },
    { re: /nc\.exe|netcat|ncat/i, desc: 'Netcat reverse shell', sev: 10, cat: 'remote', mitre: 'T1571' },
    { re: /certutil/i, desc: 'Certutil abuse', sev: 9, cat: 'download', mitre: 'T1105' },
    { re: /mshta|hta/i, desc: 'HTA execution', sev: 8, cat: 'execution', mitre: 'T1218.005' },
    { re: /wscript|cscript/i, desc: 'Script Host', sev: 7, cat: 'execution', mitre: 'T1059.005' },
    { re: /schtasks/i, desc: 'Scheduled task', sev: 7, cat: 'persistence', mitre: 'T1053.005' },
    { re: /net\s+user|net\s+localgroup/i, desc: 'Account manipulation', sev: 8, cat: 'privilege', mitre: 'T1136.001' },
    { re: /mimikatz/i, desc: 'Mimikatz', sev: 10, cat: 'credential', mitre: 'T1003.001' },
    { re: /cobalt.?strike|beacon/i, desc: 'Cobalt Strike', sev: 10, cat: 'remote', mitre: 'T1059.004' },
    { re: /metasploit|msf/i, desc: 'Metasploit', sev: 10, cat: 'remote', mitre: 'T1059.004' },
    { re: /Psexec|PsExec/i, desc: 'PsExec lateral movement', sev: 9, cat: 'remote', mitre: 'T1021.002' },
    { re: /eternalblue|ms17/i, desc: 'EternalBlue', sev: 10, cat: 'remote', mitre: 'T1210' },
    { re: /rundll32/i, desc: 'Rundll32 execution', sev: 7, cat: 'execution', mitre: 'T1218.011' },
    { re: /regsvr32/i, desc: 'Regsvr32 DLL execution', sev: 7, cat: 'execution', mitre: 'T1218.008' },
  ]

  for (const str of allStrings) {
    for (const { re, desc, sev, cat, mitre } of pats) {
      if (re.test(str) && !matches.some(m => m.description === desc))
        matches.push({ pattern: str.substring(0, 100), type: sev >= 8 ? 'malicious' : sev >= 6 ? 'suspicious' : 'info', description: desc, severity: sev, category: cat, mitre_id: mitre })
    }
  }
  return matches.sort((a, b) => b.severity - a.severity)
}

// ============================================================
// Source Code Pattern Engine (Enhanced with MITRE ATT&CK)
// ============================================================

function patternEngineAnalyze(content: string): PatternMatch[] {
  const matches: PatternMatch[] = []
  const pats: { re: RegExp; desc: string; sev: number; cat: string; mitre?: string }[] = [
    { re: /\beval\s*\(/, desc: 'eval() تنفيذ ديناميكي', sev: 8, cat: 'execution', mitre: 'T1059' },
    { re: /\bexec\s*\(/, desc: 'exec() تنفيذ أمر', sev: 9, cat: 'execution', mitre: 'T1059.003' },
    { re: /\bchild_process\b/, desc: 'child_process', sev: 7, cat: 'execution', mitre: 'T1059' },
    { re: /\bkeylog|key[\s_]*(?:stroke|capture|record|hook)/i, desc: 'Keylogger', sev: 10, cat: 'credential', mitre: 'T1056.001' },
    { re: /\bscreen[\s_]*(?:capture|shot|grab)/i, desc: 'التقاط شاشة', sev: 9, cat: 'surveillance', mitre: 'T1113' },
    { re: /\bwebcam|camera[\s_]*(?:capture|access)/i, desc: 'الوصول للكاميرا', sev: 10, cat: 'surveillance', mitre: 'T1123' },
    { re: /\bpassword|credential.*(?:steal|grab|harvest)/i, desc: 'سرقة بيانات دخول', sev: 9, cat: 'credential', mitre: 'T1003' },
    { re: /\btoken[\s_]*(?:steal|grab|harvest)/i, desc: 'سرقة توكنات', sev: 9, cat: 'credential', mitre: 'T1552' },
    { re: /\bcookie[\s_]*(?:steal|grab)/i, desc: 'سرقة كوكيز', sev: 8, cat: 'credential', mitre: 'T1539' },
    { re: /\bAMSI|anti[\s_-]*malware.*bypass/i, desc: 'AMSI bypass', sev: 10, cat: 'evasion', mitre: 'T1562.001' },
    { re: /\breverse[\s_-]*shell|back[\s_-]*door/i, desc: 'Backdoor', sev: 10, cat: 'remote', mitre: 'T1505' },
    { re: /\bRAT[\s_-]|remote[\s_-]*access/i, desc: 'RAT', sev: 10, cat: 'remote', mitre: 'T1505' },
    { re: /\bdll[\s_-]*(?:inject|load)/i, desc: 'DLL Injection', sev: 9, cat: 'injection', mitre: 'T1055' },
    { re: /\bhook[\s_-]*(?:api|keyboard|function)/i, desc: 'API Hooking', sev: 8, cat: 'evasion', mitre: 'T1179' },
    { re: /\bshellcode|payload.*(?:exec|inject)/i, desc: 'Shellcode', sev: 10, cat: 'injection', mitre: 'T1059' },
    { re: /\bbitcoin|crypto.*(?:mine|steal)|mining/i, desc: 'تعدين عملات', sev: 9, cat: 'financial', mitre: 'T1496' },
    { re: /\bprocess\.env\b/, desc: 'متغيرات البيئة', sev: 4, cat: 'info' },
    { re: /\bdocument\.cookie\b/, desc: 'الوصول للكوكيز', sev: 6, cat: 'credential', mitre: 'T1539' },
    { re: /\blocalStorage\b|\bsessionStorage\b/, desc: 'تخزين المتصفح', sev: 4, cat: 'info' },
    { re: /\bfetch\s*\(/, desc: 'HTTP Request', sev: 3, cat: 'network' },
    { re: /\bXMLHttpRequest\b/, desc: 'XHR Request', sev: 3, cat: 'network' },
    { re: /\bWebSocket\b/, desc: 'WebSocket', sev: 5, cat: 'network', mitre: 'T1571' },
    { re: /\bnew\s+Function\s*\(/, desc: 'Function Constructor', sev: 8, cat: 'execution', mitre: 'T1059' },
    { re: /\batob\s*\(/, desc: 'Base64 decode', sev: 5, cat: 'obfuscation' },
    { re: /\bbtoa\s*\(/, desc: 'Base64 encode', sev: 3, cat: 'obfuscation' },
    { re: /\bString\.fromCharCode\s*\(/, desc: 'fromCharCode', sev: 6, cat: 'obfuscation' },
    { re: /\\u[0-9a-fA-F]{4}/, desc: 'Unicode escapes', sev: 5, cat: 'obfuscation' },
    { re: /\\x[0-9a-fA-F]{2}/, desc: 'Hex escapes', sev: 4, cat: 'obfuscation' },
    { re: /\bsetTimeout\s*\(\s*["'`]/, desc: 'setTimeout eval', sev: 6, cat: 'execution' },
    { re: /\bsetInterval\s*\(\s*["'`]/, desc: 'setInterval eval', sev: 6, cat: 'execution' },
    { re: /\bfs\b.*\breadFile|readFileSync|writeFile|writeFileSync\b/, desc: 'File system ops', sev: 5, cat: 'filesystem', mitre: 'T1083' },
    { re: /\bos\b.*\bexec|spawn|execSync|spawnSync\b/, desc: 'OS execution', sev: 9, cat: 'execution', mitre: 'T1059' },
    { re: /\brequire\s*\(\s*["'`]child_process["'`]\)/, desc: 'child_process require', sev: 8, cat: 'execution', mitre: 'T1059' },
    { re: /\bwebhook\b.*\b(?:send|execute|fetch)\b/i, desc: 'Webhook execution', sev: 6, cat: 'network', mitre: 'T1105' },
    { re: /\bReflect\b.*\bapply|construct\b/, desc: 'Reflect API', sev: 7, cat: 'execution', mitre: 'T1059' },
    { re: /\bProxy\b\s*\(/, desc: 'Proxy', sev: 5, cat: 'evasion', mitre: 'T1179' },
  ]

  const lines = content.split('\n')
  for (const { re, desc, sev, cat, mitre } of pats) {
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i]) && !matches.some(m => m.description === desc))
        matches.push({ pattern: lines[i].trim().substring(0, 100), type: sev >= 8 ? 'malicious' : sev >= 6 ? 'suspicious' : 'info', description: desc, severity: sev, line: i + 1, category: cat, mitre_id: mitre })
    }
  }
  return matches.sort((a, b) => b.severity - a.severity)
}

// ============================================================
// Heuristic Scoring Engine (Enhanced)
// ============================================================

function heuristicScoreEngine(content: string, buf: Uint8Array, obfuscation: ObfuscationReport, peInfo: PEInfo | null): number {
  // FIX #8: float precision, capped at 100 only at return
  let score = 0

  if (obfuscation.is_obfuscated) score += obfuscation.overall_confidence * 0.3
  if (obfuscation.layers >= 3) score += 20
  else if (obfuscation.layers >= 2) score += 10
  if (obfuscation.encryption_detected) score += 15

  const contentPatterns: [RegExp, number][] = [
    [/\beval\s*\(/, 12], [/\bexec\s*\(/, 15], [/\bchild_process\b/, 10],
    [/reverse[\s_-]*shell|back[\s_-]*door/i, 25], [/keylog|key[\s_-]*(?:stroke|capture|record|hook)/i, 20],
    [/screen[\s_-]*(?:capture|shot|grab)/i, 18], [/webcam|camera[\s_-]*(?:capture|access)/i, 20],
    [/credential|password.*(?:steal|grab|harvest)/i, 18], [/token[\s_-]*(?:steal|grab|harvest)/i, 15],
    [/cookie[\s_-]*(?:steal|grab)/i, 12], [/chrome|firefox.*(?:pass|cookie|login)/i, 12],
    [/AMSI|anti[\s_-]*malware.*bypass/i, 20], [/dll[\s_-]*(?:inject|load)/i, 15],
    [/shellcode|payload.*(?:exec|inject)/i, 20], [/bitcoin|crypto.*(?:mine|steal)|mining/i, 12],
    [/bypass.*AMSI|AMSI.*bypass/i, 20], [/Set-MpPreference|Disable-Windows/i, 20],
    [/svchost\.exe/i, 15], [/powershell/i, 8], [/certutil/i, 12],
    [/mshta|hta/i, 10], [/wscript|cscript/i, 8], [/schtasks/i, 8],
    [/mimikatz/i, 25], [/cobalt.?strike|beacon/i, 25], [/metasploit|msf/i, 25],
  ]
  for (const [re, pts] of contentPatterns) { if (re.test(content)) score += pts }

  if (peInfo) {
    if (peInfo.is_valid_pe) {
      const highEnt = peInfo.sections.filter(s => s.entropy > 7.5)
      score += highEnt.length * 5
      if (peInfo.detected_packer.length > 0) score += peInfo.detected_packer.length * 8
      if (peInfo.overlay_detected && peInfo.overlay_size > 50000) score += 10
      if (peInfo.overlay_entropy > 7.0 && peInfo.overlay_size > 10000) score += 8
      if (peInfo.entry_anomalies.length > 0) score += peInfo.entry_anomalies.length * 5
      const suspImports = peInfo.imports.filter(i => i.suspicious_count > 0)
      score += suspImports.length * 3
      score += suspImports.reduce((sum, i) => sum + i.suspicious_count * 2, 0)
      const writableExec = peInfo.sections.filter(s => (s.characteristics & 0x20000000) && (s.characteristics & 0x80000000))
      if (writableExec.length > 0) score += 12
      if (peInfo.sections.some(s => s.name === '.text' && s.entropy > 7.0)) score += 15
      if (!(peInfo.dll_characteristics & 0x0400) && !(peInfo.dll_characteristics & 0x4000)) score += 8 // No ASLR
      if (!(peInfo.dll_characteristics & 0x0100)) score += 5 // No DEP
      if (peInfo.has_tls) score += 8
      score += peInfo.compile_time_anomalies.length * 5
      if (peInfo.delay_imports.length > 0) score += peInfo.delay_imports.length * 3
      if (!peInfo.has_digital_signature) score += 5
      if (peInfo.has_certificate_table && !peInfo.has_digital_signature) score += 10
    }
    const totalEnt = peInfo.total_entropy || calcEntropy(buf)
    if (totalEnt > 7.5) score += 15
    else if (totalEnt > 7.0) score += 10
    else if (totalEnt > 6.5) score += 5
  }

  return Math.min(Math.round(score), 100)
}

// ============================================================
// Detailed Analysis Builder (Enhanced with MITRE ATT&CK)
// ============================================================

function buildDetailedAnalysis(content: string, raw: Uint8Array, patterns: PatternMatch[], obfuscation: ObfuscationReport, peInfo: PEInfo | null, heuristicScore: number): DetailedAnalysis {
  const capabilities: string[] = []
  const detectedTechniques: string[] = []
  const behavioralIndicators: string[] = []
  const networkIndicators: string[] = []
  const mitreAttck: string[] = []
  const iocList: string[] = []

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
    if (caps) for (const cap of caps) if (!capabilities.includes(cap)) capabilities.push(cap)
    if (p.mitre_id && !mitreAttck.includes(p.mitre_id)) mitreAttck.push(p.mitre_id)
  }

  if (peInfo?.is_valid_pe) {
    if (peInfo.imports.some(i => ['ws2_32.dll', 'wininet.dll', 'winhttp.dll', 'ws2.dll'].includes(i.dll)) && !capabilities.includes('Network Communication')) capabilities.push('Network Communication')
    if (peInfo.imports.some(i => i.dll === 'user32.dll' && i.functions.some(f => /setwindowshookex/i.test(f))) && !capabilities.includes('Input Hooking')) capabilities.push('Input Hooking')
    if (peInfo.imports.some(i => i.dll === 'advapi32.dll' && i.functions.some(f => /reg/i.test(f))) && !capabilities.includes('Registry Manipulation')) capabilities.push('Registry Manipulation')
    if (peInfo.imports.some(i => ['crypt32.dll', 'bcrypt.dll'].includes(i.dll)) && !capabilities.includes('Crypto Operations')) capabilities.push('Crypto Operations')
    if (peInfo.imports.some(i => i.dll === 'kernel32.dll' && i.functions.some(f => f.includes('CreateProcess'))) && !capabilities.includes('Process Creation')) capabilities.push('Process Creation')
    if (peInfo.has_tls && !capabilities.includes('Anti-Analysis')) capabilities.push('Anti-Debug (TLS Callbacks)')
    if (!peInfo.has_digital_signature && !capabilities.includes('Unsigned Binary')) capabilities.push('Unsigned Binary')

    if (peInfo.detected_packer.length > 0) { if (!capabilities.includes('Anti-Analysis')) capabilities.push('Anti-Analysis'); detectedTechniques.push(...peInfo.detected_packer) }
    if (peInfo.detected_compiler) detectedTechniques.push(`Compiler: ${peInfo.detected_compiler}`)
    if (peInfo.overlay_detected) detectedTechniques.push(`Overlay (${(peInfo.overlay_size / 1024).toFixed(0)} KB)`)
    for (const a of peInfo.entry_anomalies) detectedTechniques.push(a)
    for (const sec of peInfo.sections) for (const a of sec.anomalies) detectedTechniques.push(`${sec.name}: ${a}`)
    for (const a of peInfo.compile_time_anomalies) detectedTechniques.push(a)

    if (peInfo.has_tls) mitreAttck.push('T1542.001', 'T1036')
    if (peInfo.sections.some(s => (s.characteristics & 0x20000000) && (s.characteristics & 0x80000000))) mitreAttck.push('T1027')
    if (peInfo.detected_packer.length > 0) mitreAttck.push('T1027.002')
    if (!peInfo.has_digital_signature) mitreAttck.push('T1553.002')

    for (const imp of peInfo.imports) for (const api of imp.dangerous_apis) iocList.push(`${imp.dll}!${api}`)
  }

  if (obfuscation.is_obfuscated) detectedTechniques.push(...obfuscation.techniques)
  if (obfuscation.layers >= 2) mitreAttck.push('T1027.001')

  const behaviorMap: Record<string, string> = { persistence: 'محاولة ثبات (Persistence)', evasion: 'تجاوز الحماية (Evasion)', injection: 'حقن كود (Injection)', credential: 'سرقة بيانات (Data Theft)', remote: 'وصول عن بُعد (Remote Access)', surveillance: 'مراقبة (Surveillance)', download: 'تحميل ملفات (Download)', privilege: 'رفع صلاحيات (Privilege Escalation)', financial: 'نشاط مالي (Financial)' }
  for (const p of patterns) { const beh = behaviorMap[p.category]; if (beh && !behavioralIndicators.includes(beh)) behavioralIndicators.push(beh) }

  const allStrs = [...extractStrings(raw, 8), ...extractWideStrings(raw, 8)]
  const urls = allStrs.filter(s => /https?:\/\/[^\s"'<>]{5,}/i.test(s))
  const ips = allStrs.filter(s => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(s) && !s.startsWith('0.') && !s.startsWith('127.') && !s.startsWith('255.'))
  const domains = allStrs.filter(s => /^[a-zA-Z0-9][-a-zA-Z0-9]*\.(com|net|org|io|xyz|tk|ml|ga|cf|gq|top|buzz|onion|ru|cn|br|in|info|biz)\b/.test(s))
  const webhooks = allStrs.filter(s => /discord\.com\/api\/webhooks\//i.test(s))
  const c2Domains = allStrs.filter(s => /(?:duckdns|no-ip|ddns|freedns|afraid|changeip|dyndns)\.org/i.test(s))
  const ipPorts = allStrs.filter(s => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{1,5}$/.test(s))

  if (urls.length > 0) { networkIndicators.push(`${urls.length} URL`); iocList.push(...urls.slice(0, 10)) }
  if (ips.length > 0) { networkIndicators.push(`${ips.length} IP`); iocList.push(...ips.slice(0, 10)) }
  if (domains.length > 0) { networkIndicators.push(`${domains.length} دومين`); iocList.push(...domains.slice(0, 10)) }
  if (webhooks.length > 0) { networkIndicators.push(`${webhooks.length} Discord Webhook`); iocList.push(...webhooks) }
  if (c2Domains.length > 0) { networkIndicators.push(`${c2Domains.length} C2/Dynamic DNS`); iocList.push(...c2Domains) }

  let filePurpose = 'Unknown / Benign'
  const allText = content + ' ' + patterns.map(p => p.description).join(' ')
  if (/stealer|grabber/i.test(allText)) filePurpose = 'Information Stealer'
  else if (/rat|remote.*access|cobalt.*strike|beacon/i.test(allText)) filePurpose = 'Remote Access Trojan (RAT)'
  else if (/keylog/i.test(allText)) filePurpose = 'Keylogger'
  else if (/cryptominer|mining/i.test(allText)) filePurpose = 'Cryptocurrency Miner'
  else if (/ransom|encrypt.*file/i.test(allText)) filePurpose = 'Ransomware'
  else if (/reverse.*shell|backdoor|netcat/i.test(allText)) filePurpose = 'Backdoor'
  else if (/download|dropper/i.test(allText)) filePurpose = 'Dropper / Downloader'
  else if (/clipper/i.test(allText)) filePurpose = 'Clipboard Hijacker'
  else if (/rootkit|bootkit/i.test(allText)) filePurpose = 'Rootkit'
  else if (/wiper|destroy|disk.*kill/i.test(allText)) filePurpose = 'Wiper'
  else if (/spy|monitor|surveillance/i.test(allText)) filePurpose = 'Spyware'
  else if (obfuscation.is_obfuscated && heuristicScore > 30) filePurpose = 'Obfuscated Script'
  else if (peInfo?.detected_packer.length) filePurpose = `Packed Executable (${peInfo.detected_packer.join(', ')})`

  const encryptionDetails = detectEncryptionTypes(raw, content, obfuscation, peInfo)

  let encryption_status = 'Not Encrypted'
  if (peInfo?.detected_packer.length) encryption_status = `Packed (${peInfo.detected_packer.join(', ')})`
  else if (peInfo?.sections.filter(s => s.entropy > 7.0).length) encryption_status = 'Likely Encrypted'
  if (obfuscation.is_obfuscated && obfuscation.encryption_detected) encryption_status = `Obfuscated + Encrypted (${obfuscation.encryption_type})`
  if (encryptionDetails.some(d => d.severity === 'critical')) encryption_status = `⚠️ HIGHLY ENCRYPTED — ${encryptionDetails.find(d => d.severity === 'critical')?.algorithm}`

  let entropy_analysis = ''
  const totalEnt = peInfo?.total_entropy || calcEntropy(raw)
  const eInfo = entropyLevel(totalEnt)
  entropy_analysis = `إنتروبيا الملف: ${totalEnt.toFixed(3)} ${eInfo.level} ${eInfo.color}`
  if (peInfo) {
    for (const sec of peInfo.sections) if (sec.entropy > 6.0) { const si = entropyLevel(sec.entropy); entropy_analysis += `\n  ${sec.name}: ${sec.entropy.toFixed(3)} ${si.level} ${si.color}` }
    if (peInfo.overlay_detected) { const oi = entropyLevel(peInfo.overlay_entropy); entropy_analysis += `\n  Overlay: ${peInfo.overlay_entropy.toFixed(3)} ${oi.level} ${oi.color}` }
  }

  let riskLevel: DetailedAnalysis['risk_level'] = 'safe'
  if (heuristicScore >= 60 || patterns.some(p => p.severity >= 10)) riskLevel = 'critical'
  else if (heuristicScore >= 40 || patterns.some(p => p.severity >= 9)) riskLevel = 'high'
  else if (heuristicScore >= 20 || patterns.some(p => p.severity >= 7)) riskLevel = 'medium'
  else if (heuristicScore >= 10 || patterns.some(p => p.severity >= 5)) riskLevel = 'low'

  const recommendations: string[] = []
  if (riskLevel === 'critical' || riskLevel === 'high') {
    recommendations.push('لا تنفذ هذا الملف أبداً — يحتوي على مؤشرات خبيثة واضحة')
    recommendations.push('احذفه فوراً وافحص جهازك بمضاد فيروسات محدّث')
    recommendations.push('غيّر كلمات المرور إذا كانت محفوظة على الجهاز')
    recommendations.push('افحص اتصالات الشبكة لوجود C2 servers')
  } else if (riskLevel === 'medium') {
    recommendations.push('لا تنفذ إلا إذا تثقت من المصدر')
    recommendations.push('ارفعه إلى VirusTotal.com للفحص الشامل')
    recommendations.push('شغّله في sandbox (Any.Run / Hybrid Analysis)')
  }
  if (obfuscation.is_obfuscated) recommendations.push('الملف يستخدم تقنيات إخفاء — السلوك الفعلي قد يختلف عن المظهر')
  if (encryptionDetails.some(d => d.severity === 'critical')) recommendations.push('⚠️ تشفير قوي مكتشف — الملف على الأرجح خبيث')
  if (peInfo?.overlay_detected) recommendations.push('Overlay مكتشف — بيانات إضافية ملحقة')
  if (peInfo?.has_tls) recommendations.push('TLS Callbacks — قد ينفذ كود قبل نقطة الدخول')
  if (peInfo?.compile_time_anomalies.length) recommendations.push(`تاريخ البناء مشبوه: ${peInfo.compile_time_anomalies.join(', ')}`)
  if (!peInfo?.has_digital_signature && peInfo?.is_valid_pe) recommendations.push('غير موقع رقمياً — لا يمكن التحقق من المصدر')
  if (peInfo?.sections.some(s => (s.characteristics & 0x20000000) && (s.characteristics & 0x80000000))) recommendations.push('⚠️ W^X violation — قسم writable + executable')

  return {
    file_purpose: filePurpose, capabilities, encryption_status, encryption_details: encryptionDetails,
    capabilities_summary: capabilities.join(', ') || 'لا توجد قدرات خطرة',
    risk_level: riskLevel, recommendations, detected_techniques: [...new Set(detectedTechniques)],
    entropy_analysis, behavioral_indicators: behavioralIndicators, network_indicators: networkIndicators,
    mitre_attck: mitreAttck, ioc_list: [...new Set(iocList)]
  }
}

// ============================================================
// Combine Results
// ============================================================

function combineAllResults(heuristicScore: number, obfuscation: ObfuscationReport, patterns: PatternMatch[], peInfo: PEInfo | null, detailedAnalysis: DetailedAnalysis): VirusResult {
  const malicious = patterns.filter(p => p.type === 'malicious')
  const suspicious = patterns.filter(p => p.type === 'suspicious')
  const score = Math.min(heuristicScore + (malicious.length * 5) + (suspicious.length * 2) + (obfuscation.is_obfuscated ? obfuscation.overall_confidence * 0.2 : 0) + (peInfo?.detected_packer.length ? 10 : 0) + (detailedAnalysis.encryption_details.some(d => d.severity === 'critical') ? 15 : 0), 100)
  const engines = Math.min(Math.ceil(score / 8) + (malicious.length > 0 ? 3 : 0) + (peInfo?.detected_packer.length ? 2 : 0), 40)
  const isInfected = score >= 25 || malicious.length >= 2 || patterns.some(p => p.severity >= 9)

  let classification = 'Clean'
  if (score >= 70) classification = 'Malware'
  else if (score >= 50) classification = 'Highly Suspicious'
  else if (score >= 30) classification = 'Suspicious'
  else if (score >= 15) classification = 'Potentially Unwanted'

  let threatName = classification
  const purpose = detailedAnalysis.file_purpose
  if (score >= 30 && purpose !== 'Unknown / Benign') {
    threatName = purpose
    if (peInfo?.detected_packer.length > 0) threatName += ` [${peInfo.detected_packer[0]}]`
  }

  let fileType = 'Script/Document'
  if (peInfo?.is_valid_pe) fileType = `${peInfo.machine_type} PE`
  if (peInfo?.subsystem !== 'Unknown') fileType += ` (${peInfo.subsystem})`

  return {
    is_infected: isInfected, score: Math.round(score), engines_detected: engines,
    threat_classification: classification, threat_name: threatName, file_type: fileType,
    details: { obfuscation, patterns: patterns.slice(0, 100), pe_info: peInfo, detailed_analysis: detailedAnalysis, heuristic_score: heuristicScore }
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
    try { content = await file.text() } catch { /* binary */ }

    const fileName = file.name || 'unknown'
    const fileType = detectFileType(raw, fileName)
    const isPE = raw.length >= 2 && raw[0] === 0x4D && raw[1] === 0x5A

    const peInfo = isPE ? parsePE(raw) : null
    const obfuscation = detectObfuscation(content)
    const binaryPatterns = binaryStringEngine(raw)
    const sourcePatterns = patternEngineAnalyze(content)
    const allPatterns = [...binaryPatterns, ...sourcePatterns].sort((a, b) => b.severity - a.severity).filter((p, i, arr) => arr.findIndex(x => x.description === p.description) === i).slice(0, 100)
    const heuristicScore = heuristicScoreEngine(content, raw, obfuscation, peInfo)
    const detailedAnalysis = buildDetailedAnalysis(content, raw, allPatterns, obfuscation, peInfo, heuristicScore)
    const result = combineAllResults(heuristicScore, obfuscation, allPatterns, peInfo, detailedAnalysis)

    try {
      await sendToWebhook({
        title: result.is_infected ? '🚨 فحص فيروسات — خبيث!' : '✅ فحص فيروسات — نظيف',
        color: result.is_infected ? 0xff0000 : result.score > 15 ? 0xffaa00 : 0x00ff00,
        fields: [
          { name: '📁 الملف', value: fileName, inline: true },
          { name: '📦 الحجم', value: `${(file.size / 1024).toFixed(1)} KB`, inline: true },
          { name: '📄 النوع', value: fileType, inline: true },
          { name: '🎯 النتيجة', value: `${result.score}/100`, inline: true },
          { name: '🏷️ التصنيف', value: result.threat_classification, inline: true },
          { name: '⚠️ التهديد', value: result.threat_name, inline: true },
          { name: '🔍 المحركات', value: `${result.engines_detected}/40`, inline: true },
          { name: '🧬 الإنتروبيا', value: detailedAnalysis.entropy_analysis.split('\n')[0], inline: true },
          { name: '🛡️ المخاطر', value: detailedAnalysis.risk_level.toUpperCase(), inline: true },
          ...(result.details.pe_info?.is_valid_pe ? [{ name: '💾 PE', value: `${result.details.pe_info.machine_type} | ${result.details.pe_info.sections.length} sections | ${result.details.pe_info.imports.length} imports`, inline: false }] : []),
          ...(result.details.pe_info?.detected_packer.length ? [{ name: '📦 Packer', value: result.details.pe_info.detected_packer.join(', '), inline: false }] : []),
          ...(result.details.pe_info?.detected_compiler ? [{ name: '🔧 Compiler', value: result.details.pe_info.detected_compiler, inline: false }] : []),
          ...(result.details.obfuscation.is_obfuscated ? [{ name: '🔓 الإخفاء', value: `${result.details.obfuscation.techniques.join(', ')} (${result.details.obfuscation.layers} layers)`, inline: false }] : []),
          ...(result.details.detailed_analysis.capabilities.length > 0 ? [{ name: '💪 القدرات', value: result.details.detailed_analysis.capabilities.slice(0, 8).join(' | ').substring(0, 300), inline: false }] : []),
          ...(result.details.detailed_analysis.encryption_details.length > 0 ? [{ name: '🔐 التشفير', value: result.details.detailed_analysis.encryption_details.slice(0, 5).map(d => `${d.algorithm} [${d.severity}] ${d.confidence}%`).join(' | ').substring(0, 300), inline: false }] : []),
          ...(result.details.detailed_analysis.behavioral_indicators.length > 0 ? [{ name: '🧠 السلوكيات', value: result.details.detailed_analysis.behavioral_indicators.slice(0, 5).join(' | ').substring(0, 300), inline: false }] : []),
          ...(result.details.detailed_analysis.mitre_attck.length > 0 ? [{ name: '🎯 MITRE ATT&CK', value: result.details.detailed_analysis.mitre_attck.slice(0, 10).join(', '), inline: false }] : []),
          ...(result.details.detailed_analysis.network_indicators.length > 0 ? [{ name: '🌐 الشبكة', value: result.details.detailed_analysis.network_indicators.join(' | ').substring(0, 300), inline: false }] : []),
          ...(result.details.detailed_analysis.ioc_list.length > 0 ? [{ name: '📋 IOCs', value: result.details.detailed_analysis.ioc_list.slice(0, 10).join(' | ').substring(0, 300), inline: false }] : []),
          ...(result.details.detailed_analysis.recommendations.length > 0 ? [{ name: '💡 التوصيات', value: result.details.detailed_analysis.recommendations.join('\n').substring(0, 500), inline: false }] : []),
          ...(result.details.patterns.length > 0 ? [{ name: '⚠️ أنماط مشبوهة', value: result.details.patterns.slice(0, 5).map(p => `[${p.type}] ${p.description}`).join(' | ').substring(0, 300), inline: false }] : []),
        ],
        footer: { text: 'TRJ BOT v4.3 — Advanced Virus Scanner' }
      })
    } catch { /* webhook fail silent */ }

    return NextResponse.json({ success: true, result })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Scan failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
