// KSC Wiedikon — Service Worker for Web Push Notifications
// This SW only handles push events. No caching/offline support.

self.addEventListener('push', function(event) {
  if (!event.data) return

  var data
  try {
    data = event.data.json()
  } catch (e) {
    data = { title: 'KSC Wiedikon', body: event.data.text() }
  }

  var options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: data.tag || 'wiedisync-notification',
    renotify: true,
    data: {
      url: data.url || 'https://wiedisync.kscw.ch',
    },
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'KSC Wiedikon', options)
  )
})

self.addEventListener('notificationclick', function(event) {
  event.notification.close()

  // Pin notification URLs to our origin — defense in depth in case the push
  // pipeline (CF worker / backend) ever ships a URL it shouldn't.
  var rawUrl = (event.notification.data && event.notification.data.url) || self.location.origin
  var url = self.location.origin
  try {
    var parsed = new URL(rawUrl, self.location.origin)
    if (parsed.origin === self.location.origin && (parsed.protocol === 'https:' || parsed.protocol === 'http:')) {
      url = parsed.href
    }
  } catch (_) { /* keep origin fallback */ }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      // Focus existing tab/window if already open (works for both prod and dev URLs)
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i]
        if (client.url.indexOf(self.location.origin) !== -1 && 'focus' in client) {
          client.focus()
          if (url !== self.location.origin) {
            client.navigate(url)
          }
          return
        }
      }
      // Otherwise open new window/tab
      return clients.openWindow(url)
    })
  )
})
