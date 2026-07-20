// 货币格式化唯一入口。分工规则：
// - fmtUsd(milli)：聚合指标（今日收入 / MRR / 30 天合计等），后端已折算 USD，恒以美元展示
// - fmtMoney(milli, currency)：单笔交易，保留原币种（Intl 本地化符号）
// 不要在页面里再自建金额格式化。

/** 聚合指标（已折算 USD 毫单位）→ "$1,234.56" */
export function fmtUsd(milli: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(milli / 1000)
}

/** 紧凑金额（图表 Y 轴刻度用）→ "$1.2K" / "$980" */
export function fmtUsdCompact(milli: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1,
  }).format(milli / 1000)
}

/** 单笔交易（原币种毫单位）→ "¥68.00" / "US$9.99"；缺参返回空串 */
export function fmtMoney(milli?: number | null, currency?: string | null): string {
  if (milli == null || !currency) return ''
  try {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(milli / 1000)
  } catch {
    return `${(milli / 1000).toFixed(2)} ${currency}`
  }
}
