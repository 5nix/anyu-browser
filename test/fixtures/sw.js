importScripts('probe.js');
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('message', (e) => collect().then((r) => e.source.postMessage({ sw: r })));
