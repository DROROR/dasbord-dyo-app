const CACHE_NAME = 'dyo-work-shell-v2'
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/dyo-favicon.png', '/pwa-192.png', '/pwa-512.png']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone()
          void caches.open(CACHE_NAME).then(cache => cache.put('/', copy))
          return response
        })
        .catch(() => caches.match('/').then(response => response || caches.match('/index.html'))),
    )
    return
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const fresh = fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone()
          void caches.open(CACHE_NAME).then(cache => cache.put(request, copy))
        }
        return response
      })
      return cached || fresh
    }),
  )
})
