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

// The push service replaced or dropped this browser's subscription (Firefox
// rotates them; any browser may after a key change). Make a new one with the
// same key so the device keeps a working endpoint. The worker has no login, so
// the server learns the new endpoint when the app is next opened (the push sync
// in Layout re-registers whatever subscription the browser holds).
self.addEventListener('pushsubscriptionchange', function(event) {
  if (event.newSubscription) return
  var old = event.oldSubscription
  var key = old && old.options && old.options.applicationServerKey
  if (!key) return
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
      .catch(function(err) { console.warn('[SW] Re-subscribe failed:', err) })
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
