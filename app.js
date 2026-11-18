/* Klassenhelfer 界面与管道
 * ---------------------------------------------------------------
 * 麦克风 → Chrome 语音识别 → DeepSeek 流式 → 分段上屏
 * 没有后端，API 直连（已确认 DeepSeek 支持浏览器 CORS）
 */
(function () {
  "use strict";

  var KH = window.KH;
  if (!KH) {
    alert("logic.js 没有加载成功，页面不完整。");
    return;
  }

  var LS_KEY = "kh.settings.v1";
  var DEFAULTS = {
    apiKey: "",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    lang: "de-DE",
    course: "",
    myName: "",
    autoAnswer: true,
    vibrate: true,
    tts: false,
    discreet: false,
    asrMode: "browser",
    asrProvider: "groq",
    asrKey: "",
    asrBaseUrl: "",
    asrModel: ""
  };

  /* ---------------- 设置读写 ---------------- */

  function loadSettings() {
    try {
      var raw = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
      var out = {};
      for (var k in DEFAULTS) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) {
        out[k] = raw[k] === undefined ? DEFAULTS[k] : raw[k];
      }
      return out;
    } catch (e) {
      var copy = {};
      for (var j in DEFAULTS) copy[j] = DEFAULTS[j];
      return copy;
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(S));
    } catch (e) {
      /* 隐私模式下可能写不进去，忽略 */
    }
  }

  var S = loadSettings();

  /* ---------------- DOM ---------------- */

  function $(id) { return document.getElementById(id); }

  var feed = $("feed");
  var dot = $("dot");
  var btnMic = $("btnMic");
  var btnAnswer = $("btnAnswer");
  var btnSettings = $("btnSettings");
  var btnDiscreet = $("btnDiscreet");
  var sheet = $("sheet");
  var emptyBox = $("empty");
  var toastEl = $("toast");
  var langLabel = $("langLabel");

  var LANG_NAMES = {
    "de-DE": "DE", "en-US": "EN", "fr-FR": "FR", "es-ES": "ES",
    "ja-JP": "JA", "ko-KR": "KO", "zh-CN": "中"
  };

  /* 实时字幕条 */
  var liveEl = document.createElement("div");
  liveEl.className = "live idle";
  liveEl.innerHTML =
    '<span class="wave"><i></i><i></i><i></i><i></i></span>' +
    '<span class="txt">还没开始听</span>';
  feed.prepend(liveEl);
  liveEl.style.display = "none";
  var liveTxt = liveEl.querySelector(".txt");

  /* ---------------- 小工具 ---------------- */

  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2600);
  }

  function setDot(state) {
    dot.className = "dot" + (state ? " " + state : "");
  }

  /* 常驻错误横幅：识别失败时一直挂着，避免 2 秒的提示条被错过 */
  var banner = document.createElement("div");
  banner.className = "banner";
  banner.innerHTML = '<span class="banner-txt"></span><button class="banner-x">×</button>';
  banner.querySelector(".banner-x").addEventListener("click", function () {
    banner.classList.remove("show");
  });
  document.body.appendChild(banner);

  function showBanner(text) {
    banner.querySelector(".banner-txt").textContent = text;
    banner.classList.add("show");
  }

  function hideBanner() {
    banner.classList.remove("show");
  }


  function nearBottom() {
    return feed.scrollHeight - feed.scrollTop - feed.clientHeight < 140;
  }

  function scrollBottom() {
    feed.scrollTop = feed.scrollHeight;
  }

  function friendlyError(e) {
    var msg = (e && e.message) || String(e);
    if (/\b401\b/.test(msg)) return "API Key 不对（401）。去设置里检查一下 Key。";
    if (/\b402\b/.test(msg)) return "账户余额不足（402），去 platform.deepseek.com 充值。";
    if (/\b429\b/.test(msg)) return "请求太频繁（429），等一下再听。";
    if (/\b4\d\d\b/.test(msg)) return "接口报错：" + msg;
    if (/abort/i.test(msg)) return "请求超时，网络可能不好。";
    if (/Failed to fetch|NetworkError|load failed/i.test(msg)) {
      return "连不上接口。检查网络，或设置里的接口地址。";
    }
    return msg;
  }

  /* ---------------- 卡片渲染 ---------------- */

  var renderQueue = [];
  var rafId = 0;

  function makeCard(srcText) {
    var card = document.createElement("article");
    card.className = "card pending";
    card.innerHTML =
      '<div class="card-head">' +
        '<span class="badge">提问</span>' +
        '<span class="src"></span>' +
      "</div>" +
      '<div class="row zh"><span class="lab">中文</span><p class="zh-text">翻译中…</p></div>' +
      '<div class="row ans" hidden><span class="lab">德语</span><p class="ans-text"></p></div>' +
      '<div class="row hint" hidden><span class="lab">提示</span><p class="hint-text"></p></div>' +
      '<div class="card-tools" hidden>' +
        '<button class="mini act-speak">🔊 朗读</button>' +
        '<button class="mini act-copy">复制</button>' +
      "</div>";
    card.querySelector(".src").textContent = srcText;
    return card;
  }

  function renderCard(card, data) {
    var zh = card.querySelector(".zh-text");
    var ansRow = card.querySelector(".row.ans");
    var ans = card.querySelector(".ans-text");
    var hintRow = card.querySelector(".row.hint");
    var hint = card.querySelector(".hint-text");
    var tools = card.querySelector(".card-tools");

    if (data.Q && KH.isQuestionAnswer(data.Q)) card.classList.add("isq");

    if (data.T) {
      zh.textContent = data.T;
      zh.classList.toggle("cursor", !data.A);
    }
    if (data.A) {
      zh.classList.remove("cursor");
      ansRow.hidden = false;
      ans.textContent = data.A;
      ans.classList.add("cursor");
    }
    if (data.H) {
      ans.classList.remove("cursor");
      hintRow.hidden = false;
      hint.textContent = data.H;
    }
    if (data.A) tools.hidden = false;
  }

  function flushRender() {
    rafId = 0;
    for (var i = 0; i < renderQueue.length; i++) {
      renderCard(renderQueue[i].card, renderQueue[i].data);
    }
    renderQueue.length = 0;
    if (nearBottom()) scrollBottom();
  }

  function scheduleRender(card, data) {
    for (var i = 0; i < renderQueue.length; i++) {
      if (renderQueue[i].card === card) {
        renderQueue[i].data = data;
        return;
      }
    }
    renderQueue.push({ card: card, data: data });
    if (!rafId) rafId = requestAnimationFrame(flushRender);
  }

  function insertCard(card) {
    if (emptyBox && emptyBox.parentNode) emptyBox.remove();
    feed.appendChild(card);
    scrollBottom();
  }

  /* ---------------- 朗读 / 复制 ---------------- */

  function speak(text) {
    if (!text) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = S.lang || "de-DE";
      u.rate = 0.95;
      var voices = window.speechSynthesis.getVoices() || [];
      var want = (S.lang || "de").slice(0, 2).toLowerCase();
      for (var i = 0; i < voices.length; i++) {
        if (voices[i].lang && voices[i].lang.toLowerCase().indexOf(want) === 0) {
          u.voice = voices[i];
          break;
        }
      }
      window.speechSynthesis.speak(u);
    } catch (e) {
      toast("这台手机不支持朗读");
    }
  }

  function copy(text) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { toast("已复制"); },
        function () { toast("复制失败"); }
      );
    } else {
      toast("浏览器不允许复制");
    }
  }

  /* ---------------- 流式调用 ---------------- */

  async function streamAnswer(text, force, onDelta) {
    var url = String(S.baseUrl || DEFAULTS.baseUrl).replace(/\/+$/, "") + "/chat/completions";
    var messages = KH.buildMessages(text, {
      course: S.course,
      myName: S.myName,
      history: history,
      force: force
    });

    var ac = new AbortController();
    var timer = setTimeout(function () { ac.abort(); }, 45000);

    var res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + S.apiKey
        },
        body: JSON.stringify({
          model: S.model || "deepseek-chat",
          messages: messages,
          stream: true,
          temperature: 0.5,
          max_tokens: 520
        }),
        signal: ac.signal
      });
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }

    if (!res.ok) {
      var body = "";
      try { body = await res.text(); } catch (e2) {}
      clearTimeout(timer);
      throw new Error("HTTP " + res.status + " " + body.slice(0, 180));
    }

    var reader = res.body.getReader();
    var decoder = new TextDecoder("utf-8");
    var buf = "";

    try {
      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });

        var lines = buf.split("\n");
        buf = lines.pop();

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line || line.indexOf("data:") !== 0) continue;
          var payload = line.slice(5).trim();
          if (payload === "[DONE]") return;
          var json;
          try { json = JSON.parse(payload); } catch (e3) { continue; }
          var delta = json.choices && json.choices[0] && json.choices[0].delta;
          if (delta && typeof delta.content === "string" && delta.content) {
            onDelta(delta.content);
          }
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---------------- 任务队列 ---------------- */

  var history = [];
  var queue = [];
  var busy = false;
  var lastFinal = "";
  var lastUtterance = "";

  function enqueue(text, force) {
    text = String(text || "").replace(/\s+/g, " ").trim();
    if (!text) return;
    if (!force && text === lastFinal) return;
    lastFinal = text;
    lastUtterance = text;
    btnAnswer.disabled = false;
    queue.push({ text: text, force: !!force });
    // 老师语速快时别排长队，只保留最新三条
    while (queue.length > 3) queue.shift();
    pump();
  }

  async function pump() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      var job = queue.shift();
      await handleJob(job);
    }
    busy = false;
  }

  async function handleJob(job) {
    var card = makeCard(job.text);
    insertCard(card);

    var parser = KH.createParser();
    var stick = true;

    try {
      await streamAnswer(job.text, job.force, function (delta) {
        parser.feed(delta);
        scheduleRender(card, parser.data);
      });

      parser.flush();
      renderCard(card, parser.data);
      card.classList.remove("pending");
      card.querySelector(".ans-text").classList.remove("cursor");
      card.querySelector(".zh-text").classList.remove("cursor");

      var isQ = KH.isQuestionAnswer(parser.data.Q);
      if (isQ) {
        card.classList.add("isq");
        if (S.vibrate && navigator.vibrate) {
          try { navigator.vibrate([0, 90, 70, 90]); } catch (e) {}
        }
        if (S.tts && parser.data.A) speak(parser.data.A);
        if (S.autoAnswer) scrollBottom();
      } else if (stick) {
        scrollBottom();
      }

      // 给朗读/复制按钮挂上内容
      var ansText = parser.data.A || "";
      var zhText = parser.data.T || "";
      card.querySelector(".act-speak").addEventListener("click", function () {
        speak(ansText);
      });
      card.querySelector(".act-copy").addEventListener("click", function () {
        copy(ansText || zhText);
      });

      if (job.text) {
        history.push(job.text);
        while (history.length > 4) history.shift();
      }
      setDot("on");
    } catch (e) {
      card.classList.remove("pending");
      card.classList.add("err");
      var zhEl = card.querySelector(".zh-text");
      zhEl.textContent = "没答出来";
      zhEl.classList.remove("cursor");
      var msg = document.createElement("div");
      msg.className = "err-msg";
      msg.textContent = friendlyError(e);
      card.appendChild(msg);
      setDot("err");
      console.error("[klassenhelfer]", e);
    }
  }

  /* ---------------- 语音识别 ---------------- */

  var rec = null;
  var running = false;
  var activeMode = null;
  var restartTimer = null;
  var wakeLock = null;
  var errorStreak = 0;

  function getSR() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function setLive(text) {
    liveTxt.textContent = text || (running ? "…" : "还没开始听");
    liveEl.classList.toggle("idle", !text);
  }

  function buildRecognition() {
    var SR = getSR();
    var r = new SR();
    r.lang = S.lang || "de-DE";
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onstart = function () {
      setDot("on");
      errorStreak = 0;
      setLive("");
      hideBanner();
    };

    r.onresult = function (ev) {
      var interim = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var result = ev.results[i];
        var alt = result[0];
        if (!alt) continue;
        if (result.isFinal) {
          var txt = (alt.transcript || "").trim();
          if (txt) {
            setLive("");
            enqueue(txt, false);
          }
        } else {
          interim += alt.transcript || "";
        }
      }
      if (interim) setLive(interim);
    };

    r.onerror = function (ev) {
      var code = ev && ev.error ? ev.error : "unknown";
      if (code === "no-speech" || code === "aborted") return;
      if (code === "not-allowed" || code === "service-not-allowed") {
        showBanner(
          "麦克风/语音服务被拒绝（" + code + "）。点地址栏左边的锁图标，把「麦克风」改成允许，然后刷新。"
        );
        stopListening();
        return;
      }
      if (code === "network") {
        showBanner(
          "语音识别连不上服务器（network）。手机可能缺 Google 语音服务，或者当前网络到不了 Google。" +
            "先打开 diagnose 或 mic-test 页面确认。"
        );
        setDot("err");
        return;
      }
      if (code === "language-not-supported") {
        showBanner("不支持 " + (S.lang || "") + " 这个语言包。去设置里换一个语言再试。");
        return;
      }
      if (code === "audio-capture") {
        showBanner("找不到麦克风（audio-capture）。检查是不是连了蓝牙耳机，或麦克风被别的 App 占用。");
        stopListening();
        return;
      }
      showBanner("识别出错：" + code);
      errorStreak++;
      if (errorStreak > 4) {
        stopListening();
      }
    };

    r.onend = function () {
      if (!running) {
        setDot("");
        return;
      }
      clearTimeout(restartTimer);
      // Chrome 长时间静音会自动结束，这里自动续上
      restartTimer = setTimeout(function () {
        if (!running) return;
        try {
          r.start();
        } catch (e) {
          setTimeout(function () {
            if (running) { try { r.start(); } catch (e2) {} }
          }, 600);
        }
      }, 260);
    };

    return r;
  }

  async function acquireWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        wakeLock = await navigator.wakeLock.request("screen");
      }
    } catch (e) {
      /* 不支持就算了 */
    }
  }

  function startListening() {
    if (running) return;
    if (!S.apiKey) {
      toast("先去设置里填 API Key");
      openSheet();
      return;
    }
    if (S.asrMode === "server") startServerMode();
    else startBrowserMode();
  }

  function markRunning() {
    btnMic.textContent = "停止";
    btnMic.classList.add("on");
    liveEl.style.display = "";
    liveEl.classList.remove("idle");
    setLive("");
    acquireWakeLock();
  }

  function unmarkRunning() {
    btnMic.textContent = "开始听";
    btnMic.classList.remove("on");
    setDot("");
    setLive("");
    liveEl.style.display = "none";
    if (wakeLock) {
      try { wakeLock.release(); } catch (e) {}
      wakeLock = null;
    }
  }

  /* ---------------- 方式 A：浏览器内置识别 ---------------- */

  function startBrowserMode() {
    if (!getSR()) {
      showBanner("这个浏览器不支持内置语音识别。去设置里把「语音识别方式」换成服务器端。");
      return;
    }
    running = true;
    activeMode = "browser";
    errorStreak = 0;
    rec = buildRecognition();
    try {
      rec.start();
    } catch (e) {
      running = false;
      activeMode = null;
      setDot("err");
      showBanner("启动识别失败：" + (e.message || e));
      return;
    }
    markRunning();
    toast("开始听了，把手机放桌上");
  }

  function stopBrowserMode() {
    clearTimeout(restartTimer);
    if (rec) {
      try { rec.stop(); } catch (e) {}
      try { rec.abort(); } catch (e) {}
      rec = null;
    }
  }

  /* ---------------- 方式 B：服务器端识别（录音 → 上传转写） ---------------- */

  var srv = {
    stream: null,
    ctx: null,
    analyser: null,
    mrec: null,
    chunks: [],
    vad: null,
    timer: 0,
    chain: Promise.resolve(),
    mime: "",
    calibrating: false,
    samples: [],
    rmsBuf: null
  };

  function pickMime() {
    if (!window.MediaRecorder) return "";
    var cands = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
    for (var i = 0; i < cands.length; i++) {
      try {
        if (MediaRecorder.isTypeSupported(cands[i])) return cands[i];
      } catch (e) {}
    }
    return "";
  }

  function startSegment() {
    if (!running || !srv.stream) return;
    srv.chunks = [];
    try {
      srv.mrec = srv.mime
        ? new MediaRecorder(srv.stream, { mimeType: srv.mime })
        : new MediaRecorder(srv.stream);
    } catch (e) {
      showBanner("录音初始化失败：" + (e.message || e));
      return;
    }
    srv.mrec.ondataavailable = function (ev) {
      if (ev.data && ev.data.size) srv.chunks.push(ev.data);
    };
    srv.mrec.onstop = function () {
      var blob = new Blob(srv.chunks, { type: srv.mime || "audio/webm" });
      srv.chunks = [];
      if (blob.size > 2000) sendSegment(blob);
      if (running) startSegment();
    };
    try {
      srv.mrec.start();
    } catch (e) {
      showBanner("开始录音失败：" + (e.message || e));
    }
  }

  function cutSegment() {
    if (srv.vad) srv.vad.reset();
    if (srv.mrec && srv.mrec.state === "recording") {
      try { srv.mrec.stop(); } catch (e) {}
    }
  }

  function sendSegment(blob) {
    setLive("识别中…");
    var cfg = {
      apiKey: S.asrKey,
      provider: S.asrProvider || "groq",
      baseUrl: S.asrBaseUrl || "",
      model: S.asrModel || "",
      language: S.lang || "de-DE"
    };
    srv.chain = srv.chain.then(function () {
      return window.KH_ASR.transcribe(blob, cfg).then(
        function (text) {
          setLive("");
          if (text) enqueue(text, false);
        },
        function (e) {
          setLive("");
          showBanner("转写失败：" + friendlyError(e));
        }
      );
    });
  }

  function tickServer() {
    if (!srv.analyser) return;
    if (!srv.rmsBuf || srv.rmsBuf.length !== srv.analyser.fftSize) {
      srv.rmsBuf = new Uint8Array(srv.analyser.fftSize);
    }
    srv.analyser.getByteTimeDomainData(srv.rmsBuf);

    var sum = 0;
    for (var i = 0; i < srv.rmsBuf.length; i++) {
      var v = (srv.rmsBuf[i] - 128) / 128;
      sum += v * v;
    }
    var rms = Math.sqrt(sum / srv.rmsBuf.length);

    // 前 1.2 秒先测环境噪音，自动定阈值
    if (srv.calibrating) {
      srv.samples.push(rms);
      if (srv.samples.length >= 12) {
        var sorted = srv.samples.slice().sort(function (a, b) { return a - b; });
        var med = sorted[Math.floor(sorted.length / 2)];
        srv.vad.setThreshold(Math.min(0.06, Math.max(0.008, med * 3)));
        srv.calibrating = false;
        setLive("");
      }
      return;
    }

    var r = srv.vad.feed(rms, performance.now());
    if (r.started) setLive("●");
    if (r.cut) cutSegment();
  }

  async function startServerMode() {
    if (!S.asrKey) {
      toast("服务器端识别要先填语音识别 Key");
      openSheet();
      return;
    }
    if (!window.MediaRecorder) {
      showBanner("这个浏览器不支持录音，请用 Chrome");
      return;
    }

    running = true;
    activeMode = "server";
    markRunning();
    setDot("on");
    setLive("先安静 1 秒，校准环境噪音…");

    try {
      srv.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      });
    } catch (e) {
      running = false;
      activeMode = null;
      unmarkRunning();
      setDot("err");
      showBanner("麦克风打不开（" + (e.name || e) + "）。检查浏览器麦克风权限。");
      return;
    }

    var AC = window.AudioContext || window.webkitAudioContext;
    srv.ctx = new AC();
    var src = srv.ctx.createMediaStreamSource(srv.stream);
    srv.analyser = srv.ctx.createAnalyser();
    srv.analyser.fftSize = 1024;
    src.connect(srv.analyser);

    srv.vad = KH.createVad({});
    srv.samples = [];
    srv.calibrating = true;
    srv.rmsBuf = null;
    srv.mime = pickMime();
    srv.chunks = [];

    startSegment();
    srv.timer = setInterval(tickServer, 100);
    toast("开始听了（服务器端识别）");
  }

  function stopServerMode() {
    clearInterval(srv.timer);
    srv.timer = 0;
    if (srv.mrec) {
      srv.mrec.onstop = null;
      try { srv.mrec.stop(); } catch (e) {}
      srv.mrec = null;
    }
    if (srv.analyser) {
      try { srv.analyser.disconnect(); } catch (e) {}
      srv.analyser = null;
    }
    if (srv.ctx) {
      try { srv.ctx.close(); } catch (e) {}
      srv.ctx = null;
    }
    if (srv.stream) {
      srv.stream.getTracks().forEach(function (t) { t.stop(); });
      srv.stream = null;
    }
    srv.vad = null;
    srv.chunks = [];
  }

  /* ---------------- 统一停止 ---------------- */

  function stopListening() {
    running = false;
    if (activeMode === "server") stopServerMode();
    else stopBrowserMode();
    activeMode = null;
    unmarkRunning();
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && running && !wakeLock) {
      acquireWakeLock();
    }
  });

  /* ---------------- 设置面板 ---------------- */

  var BIND = {
    fKey: "apiKey",
    fBase: "baseUrl",
    fModel: "model",
    fLang: "lang",
    fCourse: "course",
    fName: "myName",
    fAsrMode: "asrMode",
    fAsrProvider: "asrProvider",
    fAsrKey: "asrKey"
  };

  var CHECKS = { fAuto: "autoAnswer", fVibrate: "vibrate", fTts: "tts" };

  function openSheet() {
    sheet.classList.add("open");
    syncForm();
  }

  function closeSheet() {
    sheet.classList.remove("open");
  }

  function syncForm() {
    for (var id in BIND) {
      var node = $(id);
      if (node) node.value = S[BIND[id]] || "";
    }
    for (var cid in CHECKS) {
      var box = $(cid);
      if (box) box.checked = !!S[CHECKS[cid]];
    }
    updateLabels();
  }

  function updateLabels() {
    var l = LANG_NAMES[S.lang] || (S.lang || "").slice(0, 2).toUpperCase();
    langLabel.textContent = l + " → 中文";
  }

  function applySettingsToUI() {
    document.body.classList.toggle("discreet", !!S.discreet);
    updateLabels();
  }

  // 绑定事件
  for (var id in BIND) {
    (function (field, key) {
      var node = $(field);
      if (!node) return;
      var handler = function () {
        S[key] = node.value.trim();
        saveSettings();
        updateLabels();
      };
      node.addEventListener("input", handler);
      node.addEventListener("change", handler);
    })(id, BIND[id]);
  }

  for (var cid in CHECKS) {
    (function (field, key) {
      var node = $(field);
      if (!node) return;
      node.addEventListener("change", function () {
        S[key] = node.checked;
        saveSettings();
      });
    })(cid, CHECKS[cid]);
  }

  // 填了语音识别 Key 就自动切到服务器端，省得手动忘记切
  (function () {
    var node = $("fAsrKey");
    if (!node) return;
    node.addEventListener("change", function () {
      if (node.value.trim() && S.asrMode !== "server") {
        S.asrMode = "server";
        saveSettings();
        var sel = $("fAsrMode");
        if (sel) sel.value = "server";
        toast("已切换为服务器端识别");
      }
    });
  })();

  document.querySelectorAll("[data-close]").forEach(function (n) {
    n.addEventListener("click", closeSheet);
  });

  btnSettings.addEventListener("click", openSheet);

  btnDiscreet.addEventListener("click", function () {
    S.discreet = !S.discreet;
    saveSettings();
    applySettingsToUI();
    toast(S.discreet ? "低调模式：字小、颜色淡" : "普通模式");
  });

  /* ---------------- 连接测试 ---------------- */

  var btnTest = $("btnTest");
  var testOut = $("testOut");

  btnTest.addEventListener("click", async function () {
    if (!S.apiKey) {
      testOut.className = "test-out bad";
      testOut.textContent = "Key 是空的";
      return;
    }
    testOut.className = "test-out";
    testOut.textContent = "测试中…";
    btnTest.disabled = true;

    try {
      var url = String(S.baseUrl || DEFAULTS.baseUrl).replace(/\/+$/, "") + "/chat/completions";
      var res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + S.apiKey
        },
        body: JSON.stringify({
          model: S.model || "deepseek-chat",
          messages: [{ role: "user", content: "只回复两个字母：ok" }],
          max_tokens: 8,
          stream: false
        })
      });
      if (!res.ok) {
        var t = await res.text();
        throw new Error("HTTP " + res.status + " " + t.slice(0, 120));
      }
      var j = await res.json();
      var reply = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
      testOut.className = "test-out ok";
      testOut.textContent = "通了，模型回：" + reply.trim().slice(0, 20);
    } catch (e) {
      testOut.className = "test-out bad";
      testOut.textContent = friendlyError(e);
    } finally {
      btnTest.disabled = false;
    }
  });

  /* ---------------- 底部按钮 ---------------- */

  btnMic.addEventListener("click", function () {
    if (running) stopListening();
    else startListening();
  });

  btnAnswer.addEventListener("click", function () {
    var text = lastUtterance || (liveTxt.textContent !== "…" ? liveTxt.textContent : "");
    if (!text) {
      toast("还没听到内容");
      return;
    }
    if (!S.apiKey) {
      toast("先去设置里填 API Key");
      openSheet();
      return;
    }
    enqueue(text, true);
    toast("按提问处理");
  });

  /* ---------------- 启动 ---------------- */

  applySettingsToUI();

  // 临时探针：?metrics 输出布局尺寸，用于排查横向溢出
  if (/metrics/.test(location.search)) {
    var probe = document.createElement("pre");
    probe.id = "METRICS";
    var over = [].slice.call(document.querySelectorAll("body *")).filter(function (n) {
      var r = n.getBoundingClientRect();
      return r.right > window.innerWidth + 0.5 || r.left < -0.5;
    }).slice(0, 8).map(function (n) {
      var r = n.getBoundingClientRect();
      return (n.tagName + "." + (n.className || "")).slice(0, 40) + " [" + Math.round(r.left) + "," + Math.round(r.right) + "]";
    });
    probe.textContent = "METRICS " + JSON.stringify({
      iw: window.innerWidth,
      ih: window.innerHeight,
      dpr: window.devicePixelRatio,
      docSW: document.documentElement.scrollWidth,
      bodySW: document.body.scrollWidth,
      mainSW: feed.scrollWidth,
      mainCW: feed.clientWidth,
      secure: window.isSecureContext,
      speech: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
      proto: location.protocol,
      sheetOpen: sheet.classList.contains("open"),
      mainOp: getComputedStyle(feed).opacity,
      cardOp: feed.querySelector(".card") ? getComputedStyle(feed.querySelector(".card")).opacity : null,
      culprits: over
    });
    document.body.appendChild(probe);
  }

  // 预览模式：?demo  直接看界面长什么样，不连模型
  if (/[?&#]demo\b/.test(location.search + location.hash)) {
    var demo1 = makeCard("Was ist der Unterschied zwischen Aktiva und Passiva in der Bilanz");
    renderCard(demo1, {
      Q: "yes",
      T: "资产负债表里的资产和负债有什么区别？",
      A: "Aktiva zeigen, was das Unternehmen besitzt, also Maschinen, Lager und Forderungen. Passiva zeigen, woher das Geld kommt, also Eigenkapital und Schulden. Beide Seiten sind immer gleich hoch.",
      H: "考点是 Bilanzgleichung：资产 = 负债 + 权益。被追问就补一句「Die Bilanz ist immer ausgeglichen」。"
    });
    demo1.classList.remove("pending");
    demo1.classList.add("isq");
    demo1.querySelectorAll(".cursor").forEach(function (n) { n.classList.remove("cursor"); });
    insertCard(demo1);

    var demo2 = makeCard("Wir schauen uns jetzt die Umsatzentwicklung der letzten drei Jahre an");
    renderCard(demo2, {
      Q: "no",
      T: "我们现在看一下过去三年的营业额变化。",
      A: "",
      H: ""
    });
    demo2.classList.remove("pending");
    demo2.querySelectorAll(".cursor").forEach(function (n) { n.classList.remove("cursor"); });
    insertCard(demo2);
    setDot("");
  } else if (!S.apiKey) {
    setTimeout(function () {
      openSheet();
      toast("先填 API Key，只填一次");
    }, 400);
  }

  // 离线壳（只在 https 下注册；file:// 打开时跳过）
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }

  // 桌面端调试用：window.KH_DEBUG 暴露内部状态
  window.KH_DEBUG = { settings: function () { return S; } };
})();
