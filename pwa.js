// Resolve against this script, including on GitHub Pages project subpaths.
(() => {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  const scriptURL = document.currentScript.src;
  const base = new URL('./', scriptURL);
  navigator.serviceWorker.register(new URL('sw.js', base), {
    scope: base.pathname,
    updateViaCache: 'none'
  }).catch(error => console.warn('WHOOP app setup failed:', error));
})();
