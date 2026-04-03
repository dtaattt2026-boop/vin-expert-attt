// ===== VIN EXPERT ATTT — Service Worker =====
const CACHE_NAME = 'vin-expert-v2.1.0';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Install — mise en cache des ressources essentielles
self.addEventListener('install', e => {
  console.log('[SW-INSTALL] En cours...');
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW-INSTALL] Cache', CACHE_NAME, 'créé');
      return Promise.allSettled(ASSETS.map(url => cache.add(url).catch((err) => {
        console.warn('[SW-INSTALL] Erreur cache asset:', url, err.message);
      })));
    }).then(() => {
      console.log('[SW-INSTALL] skipWaiting() appelé');
      self.skipWaiting();
    })
  );
});

// Activate — nettoyer anciens caches
self.addEventListener('activate', e => {
  console.log('[SW-ACTIVATE] En cours...');
  e.waitUntil(
    caches.keys().then(keys => {
      console.log('[SW-ACTIVATE] Caches existants:', keys);
      const toDelete = keys.filter(k => k !== CACHE_NAME);
      if (toDelete.length > 0) console.log('[SW-ACTIVATE] À supprimer:', toDelete);
      return Promise.all(toDelete.map(k => {
        caches.delete(k).then(() => console.log('[SW-ACTIVATE] Cache supprimé:', k));
      }));
    }).then(() => {
      console.log('[SW-ACTIVATE] clients.claim() appelé');
      return self.clients.claim();
    })
  );
});

// Fetch — Network First pour documents (mises à jour auto), Cache First pour assets
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // ?force-update → TOUJOURS réseau, jamais le cache (lien envoyé par email aux utilisateurs)
  if (url.includes('force-update')) {
    console.log('[SW-FETCH] Force-update détecté, réseau direct');
    return;
  }

  // Firebase / API calls → toujours réseau (pas de cache, pas d'interception)
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

  // Documents / navigation → Network First pour récupérer les mises à jour.
  if (e.request.mode === 'navigate' || e.request.destination === 'document') {
    console.log('[SW-FETCH] Network First (document):', url.substring(0, 50));
    e.respondWith(
      fetch(e.request).then(response => {
        console.log('[SW-FETCH] Réseau OK:', response.status);
        if (response && response.status === 200 && response.type !== 'opaque') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(e.request, copy);
            console.log('[SW-FETCH] Mis en cache:', url.substring(0, 50));
          });
        }
        return response;
      }).catch((err) => {
        console.log('[SW-FETCH] Réseau erreur, cache fallback:', err.message);
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

  // Assets statiques → Cache First avec fallback réseau
  console.log('[SW-FETCH] Cache First (asset):', url.substring(0, 50));
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) {
        console.log('[SW-FETCH] Asset du cache:', url.substring(0, 50));
        return cached;
      }
      console.log('[SW-FETCH] Asset pas en cache, réseau...');
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

// Message pour forcer la mise à jour
self.addEventListener('message', e => {
  const message = e.data;
  if (message === 'SKIP_WAITING' || (typeof message === 'object' && message.type === 'SKIP_WAITING')) {
    console.log('[SW-MESSAGE] SKIP_WAITING reçu, activation forcée');
    self.skipWaiting();
  }
});

