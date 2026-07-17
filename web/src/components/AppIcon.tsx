// App 图标：有 URL 显示真实图标（iOS 圆角），没有则用首字符占位

import { useState } from 'react'

export function AppIcon({ url, name, size = 36 }: { url?: string | null; name?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false)
  if (url && !failed) {
    return (
      <img
        className="app-icon"
        src={url}
        alt={name ? `${name} 图标` : 'App 图标'}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    )
  }
  const letter = (name?.trim()[0] ?? '?').toUpperCase()
  return (
    <span className="app-icon app-icon-fallback" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">
      {letter}
    </span>
  )
}
