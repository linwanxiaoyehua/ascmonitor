// App Store Server Notifications V2 —— JWS x5c 证书链验签 + payload 解码
// 全部基于 WebCrypto，零依赖。验证链条：
//   1. JWS 签名由 x5c[0]（叶证书）公钥验证
//   2. x5c[i] 由 x5c[i+1] 签发（逐级验证证书签名）
//   3. 链末证书的 SHA-256 指纹 == Apple Root CA - G3（防伪造）
//   4. 叶证书在有效期内

import { parseDer, parseChildren, slice, content, oidToString, ecdsaDerToRaw, type DerNode } from './der'

// Apple Root CA - G3 证书 SHA-256 指纹
// https://www.apple.com/certificateauthority/ → Apple Root CA - G3
const APPLE_ROOT_CA_G3_SHA256 = '63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179'

const SIG_ALG_OIDS: Record<string, 'SHA-256' | 'SHA-384'> = {
  '1.2.840.10045.4.3.2': 'SHA-256', // ecdsa-with-SHA256
  '1.2.840.10045.4.3.3': 'SHA-384', // ecdsa-with-SHA384
}

const CURVE_OIDS: Record<string, { curve: string; size: number }> = {
  '1.2.840.10045.3.1.7': { curve: 'P-256', size: 32 },
  '1.3.132.0.34': { curve: 'P-384', size: 48 },
}

export function b64urlDecode(input: string): Uint8Array {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export function b64Decode(input: string): Uint8Array {
  const bin = atob(input)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

interface ParsedCert {
  der: Uint8Array
  tbs: Uint8Array
  sigHash: 'SHA-256' | 'SHA-384'
  sigRaw: (size: number) => Uint8Array
  spki: Uint8Array
  curve: string
  curveSize: number
  notBefore: Date
  notAfter: Date
}

function parseTime(bytes: Uint8Array, node: DerNode): Date {
  const s = new TextDecoder().decode(content(bytes, node))
  // UTCTime: YYMMDDHHMMSSZ / GeneralizedTime: YYYYMMDDHHMMSSZ
  const full = node.tag === 0x17 ? (parseInt(s.slice(0, 2)) >= 50 ? '19' + s : '20' + s) : s
  return new Date(
    Date.UTC(
      parseInt(full.slice(0, 4)),
      parseInt(full.slice(4, 6)) - 1,
      parseInt(full.slice(6, 8)),
      parseInt(full.slice(8, 10)),
      parseInt(full.slice(10, 12)),
      parseInt(full.slice(12, 14))
    )
  )
}

export function parseCertificate(der: Uint8Array): ParsedCert {
  const cert = parseDer(der, 0)
  const [tbsNode, sigAlgNode, sigValueNode] = parseChildren(der, cert)

  // 签名算法
  const sigAlgOid = oidToString(content(der, parseChildren(der, sigAlgNode)[0]))
  const sigHash = SIG_ALG_OIDS[sigAlgOid]
  if (!sigHash) throw new Error(`Unsupported cert signature algorithm: ${sigAlgOid}`)

  // 签名值：BIT STRING，首字节为 unused bits
  const sigDer = content(der, sigValueNode).slice(1)

  // tbsCertificate 子节点：[0]version? serial sigAlg issuer validity subject spki ...
  const tbsChildren = parseChildren(der, tbsNode)
  const hasVersion = tbsChildren[0].tag === 0xa0
  const base = hasVersion ? 1 : 0
  const validityNode = tbsChildren[base + 3]
  const spkiNode = tbsChildren[base + 5]

  const [notBeforeNode, notAfterNode] = parseChildren(der, validityNode)

  // SPKI 中的曲线 OID
  const spkiChildren = parseChildren(der, spkiNode)
  const algParams = parseChildren(der, spkiChildren[0])
  const curveOid = oidToString(content(der, algParams[1]))
  const curveInfo = CURVE_OIDS[curveOid]
  if (!curveInfo) throw new Error(`Unsupported curve: ${curveOid}`)

  return {
    der,
    tbs: slice(der, tbsNode),
    sigHash,
    sigRaw: (size: number) => ecdsaDerToRaw(sigDer, size),
    spki: slice(der, spkiNode),
    curve: curveInfo.curve,
    curveSize: curveInfo.size,
    notBefore: parseTime(der, notBeforeNode),
    notAfter: parseTime(der, notAfterNode),
  }
}

async function importCertKey(cert: ParsedCert): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', cert.spki as BufferSource, { name: 'ECDSA', namedCurve: cert.curve }, false, ['verify'])
}

/** 验证 child 证书由 issuer 签发 */
async function verifyIssued(child: ParsedCert, issuer: ParsedCert): Promise<boolean> {
  const key = await importCertKey(issuer)
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: child.sigHash },
    key,
    child.sigRaw(issuer.curveSize) as BufferSource,
    child.tbs as BufferSource
  )
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface VerifyOptions {
  /** 测试用：跳过 Apple Root 指纹校验（自签链），生产必须为 false */
  allowTestRoot?: boolean
  now?: Date
}

/**
 * 验证 ASSN V2 / signedTransactionInfo 等 Apple JWS，返回解码后的 payload。
 * 验证失败抛出异常。
 */
export async function verifyAppleJws<T = unknown>(jws: string, options: VerifyOptions = {}): Promise<T> {
  const [headerB64, payloadB64, sigB64] = jws.split('.')
  if (!headerB64 || !payloadB64 || !sigB64) throw new Error('Malformed JWS')

  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(headerB64)))
  if (header.alg !== 'ES256') throw new Error(`Unsupported JWS alg: ${header.alg}`)
  const x5c: string[] = header.x5c
  if (!x5c?.length) throw new Error('JWS missing x5c chain')

  const chain = x5c.map((c) => parseCertificate(b64Decode(c)))
  const now = options.now ?? new Date()

  // 1. 证书链逐级验证
  for (let i = 0; i < chain.length - 1; i++) {
    if (!(await verifyIssued(chain[i], chain[i + 1]))) throw new Error(`Certificate chain broken at ${i}`)
  }

  // 2. 根证书指纹校验
  if (!options.allowTestRoot) {
    const rootFingerprint = await sha256Hex(chain[chain.length - 1].der)
    if (rootFingerprint !== APPLE_ROOT_CA_G3_SHA256) throw new Error('Root certificate is not Apple Root CA - G3')
    if (chain.length < 3) throw new Error('Certificate chain too short')
  }

  // 3. 叶证书有效期
  const leaf = chain[0]
  if (now < leaf.notBefore || now > leaf.notAfter) throw new Error('Leaf certificate expired or not yet valid')

  // 4. JWS 签名验证（ES256 签名本身就是 raw r||s）
  const leafKey = await importCertKey(leaf)
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    leafKey,
    b64urlDecode(sigB64) as BufferSource,
    data as BufferSource
  )
  if (!ok) throw new Error('JWS signature verification failed')

  return JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64))) as T
}

// ---- ASSN V2 payload 类型 ----

export interface NotificationPayload {
  notificationType: string
  subtype?: string
  notificationUUID: string
  version: string
  signedDate: number
  data?: {
    appAppleId?: number
    bundleId?: string
    environment?: 'Sandbox' | 'Production'
    signedTransactionInfo?: string
    signedRenewalInfo?: string
    status?: number
  }
}

export interface TransactionInfo {
  transactionId: string
  originalTransactionId: string
  bundleId: string
  productId: string
  purchaseDate: number
  originalPurchaseDate: number
  expiresDate?: number
  type: string
  inAppOwnershipType: string
  environment: string
  storefront?: string
  storefrontId?: string
  price?: number // milli-units
  currency?: string
  offerType?: number
  offerDiscountType?: string
  revocationDate?: number
  revocationReason?: number
}

export interface RenewalInfo {
  originalTransactionId: string
  autoRenewProductId?: string
  productId: string
  autoRenewStatus: number
  expirationIntent?: number
  gracePeriodExpiresDate?: number
  isInBillingRetryPeriod?: boolean
  renewalDate?: number
}
