// ===== VIN EXPERT ATTT â Service Worker =====
const CACHE_NAME = 'vin-expert-v2.1.4';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Install â mise en cache des ressources essentielles
self.addEventListener('install', e => {
  console.log('[SW-INSTALL] En cours...');
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW-INSTALL] Cache', CACHE_NAME, 'crÃ©Ã©');
      return Promise.allSettled(ASSETS.map(url => cache.add(url).catch((err) => {
        console.warn('[SW-INSTALL] Erreur cache asset:', url, err.message);
      })));
    }).then(() => {
      console.log('[SW-INSTALL] skipWaiting() appelÃ©');
      self.skipWaiting();
    })
  );
});

// Activate â nettoyer anciens caches
self.addEventListener('activate', e => {
  console.log('[SW-ACTIVATE] En cours...');
  e.waitUntil(
    caches.keys().then(keys => {
      console.log('[SW-ACTIVATE] Caches existants:', keys);
      const toDelete = keys.filter(k => k !== CACHE_NAME);
      if (toDelete.length > 0) console.log('[SW-ACTIVATE] Ã supprimer:', toDelete);
      return Promise.all(toDelete.map(k => {
        caches.delete(k).then(() => console.log('[SW-ACTIVATE] Cache supprimÃ©:', k));
      }));
    }).then(() => {
      console.log('[SW-ACTIVATE] clients.claim() appelÃ©');
      return self.clients.claim();
    })
  );
});

// Fetch â Network First pour documents (mises Ã  jour auto), Cache First pour assets
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // ?force-update â TOUJOURS rÃ©seau, jamais le cache (lien envoyÃ© par email aux utilisateurs)
  if (url.includes('force-update')) {
    console.log('[SW-FETCH] Force-update dÃ©tectÃ©, rÃ©seau direct');
    return;
  }

  // Firebase / API calls â toujours rÃ©seau (pas de cache, pas d'interception)
  if (url.includes('firestore.googleapis.com') ||
      url.includes('identitytoolkit.googleapis.com') ||
      url.includes('securetoken.googleapis.com') ||
      url.includes('vpic.nhtsa.dot.gov') ||
      url.includes('script.google.com') ||
      url.includes('cdn.jsdelivr.net') ||
      url.includes('tessdata') ||
      !url.startsWith(self.location.origin)) {
    console.log('[SW-FETCH] Passthrough (externe/API):', url.substring(0, 50));
    return;
  }

  // Documents / navigation â Network First pour rÃ©cupÃ©rer les mises Ã  jour.
  if (e.request.mode === 'navigate' || e.request.destination === 'document') {
    console.log('[SW-FETCH] Network First (document):', url.substring(0, 50));
    e.respondWith(
      fetch(e.request).then(response => {
        console.log('[SW-FETCH] RÃ©seau OK:', response.status);
        if (response && response.status === 200 && response.type !== 'opaque') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(e.request, copy);
            console.log('[SW-FETCH] Mis en cache:', url.substring(0, 50));
          });
        }
        return response;
      }).catch((err) => {
        console.log('[SW-FETCH] RÃ©seau erreur, cache fallback:', err.message);
        return caches.match(e.request).then(cached => {
          if (cached) {
            console.log('[SW-FETCH] Servi du cache:', url.substring(0, 50));
            return cached;
          }
          console.log('[SW-FETCH] Pas de cache, fallback index.html');
          return caches.match('./index.html');
        });
      })
    );
    return;
  }

  // Assets statiques â Cache First avec fallback rÃ©seau
  console.log('[SW-FETCH] Cache First (asset):', url.substring(0, 50));
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) {
        console.log('[SW-FETCH] Asset du cache:', url.substring(0, 50));
        return cached;
      }
      console.log('[SW-FETCH] Asset pas en cache, rÃ©seau...');
      return fetch(e.request).then(response => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy));
        }
        return response;
      }).catch(() => {
        // Offline fallback
        if (e.request.destination === 'document') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// Message pour forcer la mise Ã  jour
self.addEventListener('message', e => {
  const message = e.data;
  if (message === 'SKIP_WAITING' || (typeof message === 'object' && message.type === 'SKIP_WAITING')) {
    console.log('[SW-MESSAGE] SKIP_WAITING reÃ§u, activation forcÃ©e');
    self.skipWaiting();
  }
});

