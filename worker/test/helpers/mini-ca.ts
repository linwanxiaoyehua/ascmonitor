// 测试辅助：用 WebCrypto 构造最小自签 X.509 证书链与 Apple 风格 JWS
// 仅用于验证 assn.ts 的解析与验签逻辑

function encodeLength(len: number): Uint8Array {
  if (len < 0x80) return new Uint8Array([len])
  const bytes: number[] = []
  let v = len
  while (v > 0) {
    bytes.unshift(v & 0xff)
    v >>= 8
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes])
}

function tlv(tag: number, content: Uint8Array): Uint8Array {
  const len = encodeLength(content.length)
  const out = new Uint8Array(1 + len.length + content.length)
  out[0] = tag
  out.set(len, 1)
  out.set(content, 1 + len.length)
  return out
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    out.set(a, offset)
    offset += a.length
  }
  return out
}

const SEQ = (...items: Uint8Array[]) => tlv(0x30, concat(...items))
const INT = (v: number) => tlv(0x02, new Uint8Array([v]))
// ecdsa-with-SHA256
const SIG_ALG = SEQ(tlv(0x06, new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02])))
const EMPTY_NAME = SEQ()
const utcTime = (s: string) => tlv(0x17, new TextEncoder().encode(s))

/** raw r||s → DER SEQUENCE{INTEGER r, INTEGER s} */
function rawSigToDer(raw: Uint8Array): Uint8Array {
  const toInt = (bytes: Uint8Array) => {
    let start = 0
    while (start < bytes.length - 1 && bytes[start] === 0) start++
    let c: Uint8Array = bytes.slice(start)
    if (c[0] & 0x80) c = concat(new Uint8Array([0]), c)
    return tlv(0x02, c)
  }
  const half = raw.length / 2
  return SEQ(toInt(raw.slice(0, half)), toInt(raw.slice(half)))
}

export interface TestCert {
  der: Uint8Array
  keyPair: CryptoKeyPair
}

/** 生成由 issuer 签发（或自签）的最小 P-256 证书 */
export async function makeCert(issuer?: TestCert, validity?: { notBefore: string; notAfter: string }): Promise<TestCert> {
  const keyPair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const spki = new Uint8Array((await crypto.subtle.exportKey('spki', keyPair.publicKey)) as ArrayBuffer)

  const tbs = SEQ(
    tlv(0xa0, INT(2)), // [0] version v3
    INT(1), // serial
    SIG_ALG,
    EMPTY_NAME, // issuer
    SEQ(utcTime(validity?.notBefore ?? '200101000000Z'), utcTime(validity?.notAfter ?? '400101000000Z')),
    EMPTY_NAME, // subject
    spki
  )

  const signingKey = (issuer ?? { keyPair }).keyPair.privateKey
  const rawSig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, tbs))
  const der = SEQ(tbs, SIG_ALG, tlv(0x03, concat(new Uint8Array([0]), rawSigToDer(rawSig))))
  return { der, keyPair }
}

function b64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function b64url(bytes: Uint8Array): string {
  return b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 用测试证书链签发一条 Apple 风格 JWS */
export async function makeJws(payload: object, chain: TestCert[]): Promise<string> {
  const header = { alg: 'ES256', x5c: chain.map((c) => b64(c.der)) }
  const te = new TextEncoder()
  const headerB64 = b64url(te.encode(JSON.stringify(header)))
  const payloadB64 = b64url(te.encode(JSON.stringify(payload)))
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      chain[0].keyPair.privateKey,
      te.encode(`${headerB64}.${payloadB64}`)
    )
  )
  return `${headerB64}.${payloadB64}.${b64url(sig)}`
}
