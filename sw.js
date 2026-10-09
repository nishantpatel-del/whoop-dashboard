// No dashboard or API caching: health data continues to come from the network.
// Leave updates waiting until existing app windows close.
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || event.request.mode !== 'navigate' ||
      !url.href.startsWith(self.registration.scope)) return;

  event.respondWith(fetch(event.request).catch(() => new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="theme-color" content="#101820"><title>WHOOP Dashboard — Offline</title>' +
    '<body style="margin:0;background:#101820;color:#fff;font:18px system-ui;padding:40px 24px">' +
    '<h1>You’re offline</h1><p>Reconnect to load your WHOOP dashboard.</p>' +
    '<p><a href="" style="color:#66e5b5">Try again</a></p></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  )));
});
