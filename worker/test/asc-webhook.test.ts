import { describe, it, expect } from 'vitest'
import { verifyAscSignature } from '../src/routes/webhook'
import { describeState } from '../src/lib/build-status'

// Apple 官方文档给出的测试向量（configuring-webhook-notifications）：
// secret "This is my secret" + body "Hello, World!" 应得出这个 HMAC。
// 用它锁死实现细节 —— 曾经的坑：把 secret 与 body 当成 HMAC 的 key/message 反了，
// 或误以为要把 timestamp 拼进签名输入，两种写法都能自洽但对不上 Apple。
const APPLE_SECRET = 'This is my secret'
const APPLE_BODY = 'Hello, World!'
const APPLE_SIG = '7f062172b01cb00b53ca068614674a3d982a34062a0f5d37687d5e3377e54657'

describe('verifyAscSignature', () => {
  it('通过 Apple 官方测试向量', async () => {
    expect(await verifyAscSignature(APPLE_SECRET, APPLE_BODY, `hmacsha256=${APPLE_SIG}`)).toBe(true)
  })

  it('大写 hex 也接受', async () => {
    expect(await verifyAscSignature(APPLE_SECRET, APPLE_BODY, `hmacsha256=${APPLE_SIG.toUpperCase()}`)).toBe(true)
  })

  it('body 被篡改则失败', async () => {
    expect(await verifyAscSignature(APPLE_SECRET, 'Hello, World?', `hmacsha256=${APPLE_SIG}`)).toBe(false)
  })

  it('secret 不对则失败', async () => {
    expect(await verifyAscSignature('wrong secret', APPLE_BODY, `hmacsha256=${APPLE_SIG}`)).toBe(false)
  })

  it('缺少 hmacsha256= 前缀则失败（不能把裸 hex 当合法签名）', async () => {
    expect(await verifyAscSignature(APPLE_SECRET, APPLE_BODY, APPLE_SIG)).toBe(false)
  })

  it('header 缺失、空值、非 hex 都失败而不是抛错', async () => {
    expect(await verifyAscSignature(APPLE_SECRET, APPLE_BODY, undefined)).toBe(false)
    expect(await verifyAscSignature(APPLE_SECRET, APPLE_BODY, 'hmacsha256=')).toBe(false)
    expect(await verifyAscSignature(APPLE_SECRET, APPLE_BODY, 'hmacsha256=zzzz')).toBe(false)
    expect(await verifyAscSignature(APPLE_SECRET, APPLE_BODY, 'hmacsha256=abc')).toBe(false) // 奇数长度
  })
})

describe('describeState', () => {
  it('三类 scope 的关键状态都有中文语义', () => {
    expect(describeState('upload', 'FAILED').tone).toBe('danger')
    expect(describeState('testflight', 'BETA_APPROVED').label).toBe('Beta 审核通过')
    expect(describeState('appstore', 'PENDING_DEVELOPER_RELEASE').label).toBe('等待你发布')
    expect(describeState('appstore', 'READY_FOR_DISTRIBUTION').label).toBe('已上架')
  })

  it('上传状态与构建状态是两套枚举，同名值语义不同', () => {
    // BuildUploadState.PROCESSING 说的是上传处理；Build.processingState.PROCESSING 说的是构建处理
    expect(describeState('upload', 'PROCESSING').label).toBe('上传处理中')
    expect(describeState('build', 'PROCESSING').label).toBe('构建处理中')
    // COMPLETE 只存在于上传侧，VALID 只存在于构建侧
    expect(describeState('upload', 'COMPLETE').label).toBe('上传处理完成')
    expect(describeState('build', 'VALID').label).toBe('构建处理完成')
  })

  it('未知枚举降级为原值而不是丢事件（Apple 加新状态时不能静默吞掉）', () => {
    expect(describeState('appstore', 'SOME_FUTURE_STATE').label).toBe('SOME_FUTURE_STATE')
    expect(describeState('appstore', 'SOME_FUTURE_STATE').tone).toBe('neutral')
  })
})
