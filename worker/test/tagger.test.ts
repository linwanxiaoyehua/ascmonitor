import { describe, it, expect } from 'vitest'
import { matchTags } from '../src/lib/tagger'

const RULES = [
  { tag: '崩溃', pattern: 'crash|closes|freez|闪退|崩溃|卡死|打不开' },
  { tag: '价格', pattern: 'price|expensive|too much|太贵|价格|订阅费' },
  { tag: '功能请求', pattern: 'please add|would be great|wish|希望|建议' },
]

describe('matchTags', () => {
  it('匹配英文崩溃关键词', () => {
    expect(matchTags('The app crashes on launch', RULES)).toEqual(['崩溃'])
  })

  it('匹配中文关键词', () => {
    expect(matchTags('更新后一直闪退，太贵了还这样', RULES)).toEqual(['崩溃', '价格'])
  })

  it('大小写不敏感', () => {
    expect(matchTags('CRASH every time', RULES)).toEqual(['崩溃'])
  })

  it('无匹配返回空数组', () => {
    expect(matchTags('Great app, love it!', RULES)).toEqual([])
  })

  it('无效正则不炸', () => {
    expect(matchTags('anything', [{ tag: 'bad', pattern: '([' }])).toEqual([])
  })
})
