importScripts('probe.js');
collect().then((r) => postMessage(r));
