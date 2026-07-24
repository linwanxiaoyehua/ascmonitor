/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope

import { precacheAndRoute } from 'workbox-precaching'

precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? { title: 'Vantage', body: '' }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      // 有 App 图标就用真实图标，通知一眼认出是哪个 App
      icon: data.icon || '/icon-192.png',
      badge: '/icon-192.png',
      body: data.body,
      data,
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      const existing = clients.find((c) => 'focus' in c)
      if (existing) return (existing as WindowClient).focus()
      return self.clients.openWindow('/')
    })
  )
})
