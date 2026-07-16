import { describe, it, expect } from 'vitest'
import { verifyAppleJws, parseCertificate } from '../src/lib/assn'
import { makeCert, makeJws } from './helpers/mini-ca'

describe('parseCertificate', () => {
  it('解析自签证书的 SPKI 与有效期', async () => {
    const cert = await makeCert()
    const parsed = parseCertificate(cert.der)
    expect(parsed.curve).toBe('P-256')
    expect(parsed.notBefore.getUTCFullYear()).toBe(2020)
    expect(parsed.notAfter.getUTCFullYear()).toBe(2040)
  })
})

describe('verifyAppleJws', () => {
  it('验证由完整证书链签发的 JWS 并返回 payload', async () => {
    const root = await makeCert()
    const intermediate = await makeCert(root)
    const leaf = await makeCert(intermediate)
    const payload = { notificationType: 'SUBSCRIBED', notificationUUID: 'test-uuid' }
    const jws = await makeJws(payload, [leaf, intermediate, root])
    const result = await verifyAppleJws<typeof payload>(jws, { allowTestRoot: true })
    expect(result.notificationType).toBe('SUBSCRIBED')
    expect(result.notificationUUID).toBe('test-uuid')
  })

  it('拒绝断裂的证书链（叶证书不是由链上证书签发）', async () => {
    const root = await makeCert()
    const otherRoot = await makeCert()
    const leaf = await makeCert(otherRoot) // 由链外 CA 签发
    const jws = await makeJws({ a: 1 }, [leaf, root])
    await expect(verifyAppleJws(jws, { allowTestRoot: true })).rejects.toThrow(/chain broken/)
  })

  it('拒绝被篡改的 payload', async () => {
    const root = await makeCert()
    const leaf = await makeCert(root)
    const jws = await makeJws({ amount: 1 }, [leaf, root])
    const [h, , s] = jws.split('.')
    const tampered = btoa(JSON.stringify({ amount: 9999 })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    await expect(verifyAppleJws(`${h}.${tampered}.${s}`, { allowTestRoot: true })).rejects.toThrow(/signature/)
  })

  it('拒绝过期的叶证书', async () => {
    const root = await makeCert()
    const leaf = await makeCert(root, { notBefore: '200101000000Z', notAfter: '210101000000Z' })
    const jws = await makeJws({ a: 1 }, [leaf, root])
    await expect(verifyAppleJws(jws, { allowTestRoot: true })).rejects.toThrow(/expired/)
  })

  it('拒绝非 Apple 根证书（生产模式）', async () => {
    const root = await makeCert()
    const intermediate = await makeCert(root)
    const leaf = await makeCert(intermediate)
    const jws = await makeJws({ a: 1 }, [leaf, intermediate, root])
    await expect(verifyAppleJws(jws)).rejects.toThrow(/Apple Root/)
  })

  it('拒绝错误密钥的签名（内层 payload 完整性）', async () => {
    const root = await makeCert()
    const leaf = await makeCert(root)
    const impostor = await makeCert(root)
    // 用 impostor 的私钥签名，但 x5c 声明 leaf 证书
    const jws = await makeJws({ a: 1 }, [{ der: leaf.der, keyPair: impostor.keyPair }, root])
    await expect(verifyAppleJws(jws, { allowTestRoot: true })).rejects.toThrow(/signature/)
  })
})
