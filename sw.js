/* 学习节奏 · Service Worker
   1) 离线缓存：装到主屏后没网也能开、也能录
   2) 后台每日检查：系统唤醒时看看今天有没有该回顾的，有就发通知
      （精确定时通知由页面用 Notification Triggers 排程，这里是兜底通道） */
var CACHE = 'rhythm-v3';
var ASSETS = ['./', './index.html', './manifest.json',
  './icon.png', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* 网络优先，失败回落缓存 */
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) { return hit || caches.match('./index.html'); });
    })
  );
});

/* ---------- IndexedDB：读页面写入的当日快照 ---------- */
function idb() {
  return new Promise(function (res, rej) {
    var r = indexedDB.open('rhythm', 1);
    r.onupgradeneeded = function () {
      if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv');
    };
    r.onsuccess = function () { res(r.result); };
    r.onerror = function () { rej(r.error); };
  });
}
function getSnap() {
  return idb().then(function (d) {
    return new Promise(function (res) {
      var tx = d.transaction('kv', 'readonly');
      var g = tx.objectStore('kv').get('daily');
      g.onsuccess = function () { d.close(); res(g.result || null); };
      g.onerror = function () { d.close(); res(null); };
    });
  }).catch(function () { return null; });
}
function putSnap(snap) {
  return idb().then(function (d) {
    return new Promise(function (res) {
      var tx = d.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(snap, 'daily');
      tx.oncomplete = function () { d.close(); res(); };
      tx.onerror = function () { d.close(); res(); };
    });
  }).catch(function () { });
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/* 今天该回顾的 = 快照里今天及更早那些还没做的 */
function dueList(snap, t) {
  var out = [];
  Object.keys(snap.days || {}).forEach(function (d) {
    if (d <= t) out = out.concat(snap.days[d]);
  });
  return out;
}

function dailyCheck() {
  return getSnap().then(function (snap) {
    if (!snap || !snap.on) return;
    var t = todayStr();
    if (snap.lastNotified === t) return;            // 今天已经提醒过
    var now = new Date();
    var want = (snap.time || '08:00').split(':');
    var mins = now.getHours() * 60 + now.getMinutes();
    if (mins < (+want[0]) * 60 + (+want[1])) return; // 还没到点
    var list = dueList(snap, t);
    if (!list.length) return;                        // 没有要回顾的就不打扰
    var names = list.slice(0, 3).map(function (x) { return x.c; }).join('、');
    return self.registration.showNotification('今天要回顾 ' + list.length + ' 条', {
      body: names + (list.length > 3 ? ' 等 ' + list.length + ' 条' : ''),
      icon: 'icon-192.png', badge: 'icon-192.png',
      tag: 'daily-' + t, data: { url: './index.html' }
    }).then(function () {
      snap.lastNotified = t;
      return putSnap(snap);
    });
  });
}

self.addEventListener('periodicsync', function (e) {
  if (e.tag === 'daily-review') e.waitUntil(dailyCheck());
});
self.addEventListener('sync', function (e) {
  if (e.tag === 'daily-review') e.waitUntil(dailyCheck());
});

/* 点通知就打开应用 */
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});
