importScripts('probe.js');
onconnect = (e) => collect().then((r) => e.ports[0].postMessage(r));
