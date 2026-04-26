/* Service Worker für Web-Push-Notifications.
 * BEWUSST OHNE CACHE — kein fetch-Handler, sodass jede Anfrage normal
 * durchs Netz läuft. Damit gibt es keine veralteten Assets nach Updates.
 *
 * Aufgabe ausschließlich: Push-Events empfangen + Notification anzeigen +
 * Klick-Behandlung.
 */

self.addEventListener('install', () => {
  // sofort aktiv werden, alte Worker ersetzen
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Kontrolle über alle bestehenden Tabs übernehmen
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = { title: 'Zeiterfassung', body: '', url: '/', tag: 'default' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (e) {
    payload.body = event.data ? event.data.text() : '';
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon-192.svg',
      badge: '/icon-192.svg',
      tag: payload.tag,
      data: { url: payload.url || '/' },
      renotify: false,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Wenn schon ein Tab offen ist: dorthin navigieren + fokussieren
    for (const client of allClients) {
      if ('focus' in client) {
        try {
          if ('navigate' in client) await client.navigate(targetUrl);
          return client.focus();
        } catch (e) { /* fallthrough */ }
      }
    }
    // Sonst neuen Tab öffnen
    if (self.clients.openWindow) {
      return self.clients.openWindow(targetUrl);
    }
  })());
});
