// ===== Enregistrement du service worker (mode hors-ligne + installation) =====
// Ne fait rien en Electron (file://) — l'enregistrement échoue alors en silence.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker non enregistré :', e));
  });
}
