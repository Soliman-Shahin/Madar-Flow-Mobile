importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js');

self.addEventListener('install', () => self.skipWaiting());

fetch('/fcm/firebase-config.json', { cache: 'no-store' })
  .then((response) => response.ok ? response.json() : null)
  .then((config) => {
    const required = ['apiKey', 'authDomain', 'projectId', 'messagingSenderId', 'appId'];
    if (!config || !required.every((key) => typeof config[key] === 'string' && config[key].trim())) return null;
    firebase.initializeApp(config);
    return firebase.messaging();
  })
  .catch(() => null);

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const notificationId = event.notification.data?.notificationId;
  if (!/^[a-f\d]{24}$/i.test(notificationId || '')) return;
  event.waitUntil(clients.openWindow(`/notifications/${encodeURIComponent(notificationId)}`));
});
