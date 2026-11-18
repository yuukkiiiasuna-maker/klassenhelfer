/* Klassenhelfer — 语音转写（服务器端）
 * ---------------------------------------------------------------
 * 手机只负责录音，音频发到外部 ASR 接口换成文字。
 * 完全不依赖手机的语音识别服务，所以任何手机都能用。
 *
 * 已验证这些接口都允许浏览器直连（CORS 预检通过）。
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KH_ASR = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var PRESETS = {
    groq: {
      label: "Groq（whisper-large-v3-turbo）",
      baseUrl: "https://api.groq.com/openai/v1",
      model: "whisper-large-v3-turbo"
    },
    siliconflow: {
      label: "SiliconFlow",
      baseUrl: "https://api.siliconflow.cn/v1",
      model: "FunAudioLLM/SenseVoiceSmall"
    },
    openai: {
      label: "OpenAI（whisper-1）",
      baseUrl: "https://api.openai.com/v1",
      model: "whisper-1"
    },
    deepgram: {
      label: "Deepgram",
      baseUrl: "https://api.deepgram.com/v1",
      model: "nova-3"
    }
  };

  function resolve(cfg) {
    cfg = cfg || {};
    var p = PRESETS[cfg.provider] || PRESETS.groq;
    return {
      baseUrl: (cfg.baseUrl || p.baseUrl).replace(/\/+$/, ""),
      model: cfg.model || p.model,
      provider: cfg.provider || "groq"
    };
  }

  /**
   * 把一段音频转成文字。
   * @param {Blob} blob 音频（webm/opus 或 wav）
   * @param {{apiKey:string, baseUrl?:string, model?:string, language?:string, provider?:string}} cfg
   * @returns {Promise<string>} 转写文本（可能为空字符串：这段没人说话）
   */
  async function transcribe(blob, cfg) {
    cfg = cfg || {};
    if (!cfg.apiKey) throw new Error("缺少语音识别 Key");

    var r = resolve(cfg);
    var lang = (cfg.language || "de-DE").split("-")[0];

    if (r.provider === "deepgram") {
      var dq = "?model=" + encodeURIComponent(r.model) +
        "&language=" + encodeURIComponent(lang) +
        "&smart_format=true&punctuate=true";
      var dres = await fetch(r.baseUrl + "/listen" + dq, {
        method: "POST",
        headers: {
          "Authorization": "Token " + cfg.apiKey,
          "Content-Type": blob.type || "audio/webm"
        },
        body: blob
      });
      if (!dres.ok) throw new Error("HTTP " + dres.status + " " + (await dres.text()).slice(0, 160));
      var dj = await dres.json();
      var alts = dj.results && dj.results.channels && dj.results.channels[0] &&
        dj.results.channels[0].alternatives;
      return (alts && alts[0] && alts[0].transcript) || "";
    }

    // OpenAI 兼容（Groq / SiliconFlow / OpenAI）
    var form = new FormData();
    form.append("file", blob, "audio.webm");
    form.append("model", r.model);
    form.append("language", lang);
    form.append("response_format", "json");
    form.append("temperature", "0");

    var res = await fetch(r.baseUrl + "/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: "Bearer " + cfg.apiKey },
      body: form
    });

    if (!res.ok) {
      var body = "";
      try { body = await res.text(); } catch (e) {}
      throw new Error("HTTP " + res.status + " " + body.slice(0, 160));
    }

    var json = await res.json();
    return (json.text || "").trim();
  }

  return {
    PRESETS: PRESETS,
    resolve: resolve,
    transcribe: transcribe
  };
});
