// Service worker : uniquement pour recevoir les notifications (aucune mise en cache, l'app reste toujours à jour)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data.json(); } catch { d = {title: 'PrintCost 3D', body: e.data ? e.data.text() : ''}; }
  e.waitUntil(self.registration.showNotification(d.title || 'PrintCost 3D', {
    body: d.body || '', tag: d.tag, icon: 'icon-192.png', badge: 'icon-192.png', data: {url: d.url || './'},
  }));
});

// Toucher la notification ouvre l'app (ou la ramène au premier plan)
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => {
    const w = list.find(c => c.url.startsWith(self.registration.scope));
    return w ? w.focus() : self.clients.openWindow(url);
  }));
});
