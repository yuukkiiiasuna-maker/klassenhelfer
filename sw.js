/* 绂荤嚎澹崇紦瀛橈細鏁欏 Wi-Fi 鐑傜殑鏃跺€欒嚦灏戣兘鎶婄晫闈㈡墦寮€ */
const CACHE = "klassenhelfer-v5";
const SHELL = ["./", "./index.html", "./app.js", "./logic.js", "./asr.js", "./styles.css", "./manifest.webmanifest"];

self.addEventListener("install", (ev) => {
  ev.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // 妯″瀷鎺ュ彛姘歌繙璧扮綉缁滐紝涓嶇紦瀛?  if (url.origin !== self.location.origin) return;

  ev.respondWith(
    caches.match(req).then((hit) => {
      if (hit) {
        // 鍚庡彴椤烘墜鏇存柊
        fetch(req)
          .then((res) => {
            if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          })
          .catch(() => {});
        return hit;
      }
      return fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});


