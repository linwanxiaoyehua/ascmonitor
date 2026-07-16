// 最小 DER/ASN.1 解析器 —— 仅为解析 X.509 证书所需（TLV + 定长）

export interface DerNode {
  tag: number
  /** TLV 起始（含 tag/length 头） */
  start: number
  /** TLV 结束（不含） */
  end: number
  contentStart: number
  contentEnd: number
}

export function parseDer(bytes: Uint8Array, offset: number): DerNode {
  const tag = bytes[offset]
  let cursor = offset + 1
  let length = bytes[cursor++]
  if (length & 0x80) {
    const numBytes = length & 0x7f
    if (numBytes > 4) throw new Error('DER: length too large')
    length = 0
    for (let i = 0; i < numBytes; i++) length = (length << 8) | bytes[cursor++]
  }
  return { tag, start: offset, end: cursor + length, contentStart: cursor, contentEnd: cursor + length }
}

/** 解析 constructed 节点的直接子节点 */
export function parseChildren(bytes: Uint8Array, node: DerNode): DerNode[] {
  const children: DerNode[] = []
  let cursor = node.contentStart
  while (cursor < node.contentEnd) {
    const child = parseDer(bytes, cursor)
    children.push(child)
    cursor = child.end
  }
  return children
}

export function slice(bytes: Uint8Array, node: DerNode): Uint8Array {
  return bytes.slice(node.start, node.end)
}

export function content(bytes: Uint8Array, node: DerNode): Uint8Array {
  return bytes.slice(node.contentStart, node.contentEnd)
}

export function oidToString(bytes: Uint8Array): string {
  const parts: number[] = []
  parts.push(Math.floor(bytes[0] / 40), bytes[0] % 40)
  let value = 0
  for (let i = 1; i < bytes.length; i++) {
    value = value * 128 + (bytes[i] & 0x7f)
    if (!(bytes[i] & 0x80)) {
      parts.push(value)
      value = 0
    }
  }
  return parts.join('.')
}

/** DER 编码的 ECDSA 签名 (SEQUENCE{r,s}) → WebCrypto 需要的 raw r||s */
export function ecdsaDerToRaw(der: Uint8Array, size: number): Uint8Array {
  const seq = parseDer(der, 0)
  const [r, s] = parseChildren(der, seq)
  const pad = (n: DerNode) => {
    let c = content(der, n)
    while (c.length > size && c[0] === 0) c = c.slice(1) // 去掉符号前导 0
    if (c.length > size) throw new Error('DER: integer too large')
    const out = new Uint8Array(size)
    out.set(c, size - c.length)
    return out
  }
  const raw = new Uint8Array(size * 2)
  raw.set(pad(r), 0)
  raw.set(pad(s), size)
  return raw
}
