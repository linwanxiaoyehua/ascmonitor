// 主题偏好：自动（跟随系统）/ 浅色 / 深色，存 localStorage
// token 全部用 light-dark() 声明（tokens.css），这里只负责：
// 1. :root[data-theme] 切 color-scheme（驱动 light-dark() 解析）
// 2. 同步状态栏 theme-color meta

export type Theme = 'auto' | 'light' | 'dark'

const KEY = 'ascmonitor_theme'
const BG = { light: '#f4f5f8', dark: '#0b0e14' }

export function getTheme(): Theme {
  const v = localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' ? v : 'auto'
}

export function setTheme(theme: Theme): void {
  if (theme === 'auto') localStorage.removeItem(KEY)
  else localStorage.setItem(KEY, theme)
  applyTheme()
}

/** 应用当前偏好：设置 data-theme 并同步状态栏 theme-color */
export function applyTheme(): void {
  const theme = getTheme()
  const root = document.documentElement
  if (theme === 'auto') delete root.dataset.theme
  else root.dataset.theme = theme

  // 手动模式下两个 media meta 都指向同一颜色；自动模式恢复各自默认
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    if (theme === 'auto') {
      meta.content = meta.media?.includes('light') ? BG.light : BG.dark
    } else {
      meta.content = BG[theme]
    }
  })
}
