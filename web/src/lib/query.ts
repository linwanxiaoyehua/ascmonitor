// TanStack Query 全局配置：
// - staleTime 60s / gcTime 30min / focus refetch（PWA 从后台唤醒自动刷新）
// - QueryCache onError 统一 Toast（根治页面各自吞错）；401 广播登出事件
// - 空态只在真正 2xx 空数据时出现，错误一律走 ErrorState/Toast

import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { ApiError } from './api'
import { toast } from './toast'

export const UNAUTHORIZED_EVENT = 'ascmonitor:unauthorized'

function handleError(err: unknown) {
  if (err instanceof ApiError && err.status === 401) {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
    return
  }
  toast.error('数据加载失败，请检查网络')
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleError }),
  mutationCache: new MutationCache({
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) {
        window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
        return
      }
      toast.error('操作失败，请重试')
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 30 * 60_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
})
