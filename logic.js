/* Klassenhelfer 纯逻辑层
 * ---------------------------------------------------------------
 * 不依赖 DOM，浏览器挂到 window.KH，Node 里可 require 做单元测试。
 * 包含三块：
 *   1) 德语问句启发式识别（决定界面要不要提示"这是提问"）
 *   2) 流式协议解析器（把模型输出切成 Q/T/A/H 四段实时上屏）
 *   3) 提示词构造
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KH = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* 1. 问句识别                                                         */
  /* ------------------------------------------------------------------ */

  // 德语 W-Wort（疑问词）。注意 Chrome 的语音识别不会给标点，
  // 所以不能指望问号，只能靠疑问词 + 句式。
  var W_WORDS = [
    "wer", "wen", "wem", "wessen", "was", "wie", "warum", "weshalb", "wieso",
    "wo", "wann", "wohin", "woher", "welcher", "welche", "welches", "welchen",
    "welchem", "womit", "wovon", "wofür", "worum", "wieviel", "wieviele"
  ];

  // 要求全班/个人开口的祈使句
  var IMPERATIVE_VERBS = [
    "erklären", "beschreiben", "nennen", "sagen", "geben", "zeigen",
    "vergleichen", "diskutieren", "begründen", "berechnen", "rechnen",
    "erläutern", "skizzieren", "definieren", "fassen", "formulieren"
  ];

  // 德语的"是非问句"把变位动词放句首：Können Sie …, Ist das …, Haben wir …
  var VERB_FIRST = [
    "ist", "sind", "war", "waren", "hat", "haben", "hatte", "hatten",
    "kann", "können", "kannst", "könnte", "könnten", "muss", "müssen",
    "soll", "sollen", "will", "wollen", "wird", "werden", "würde", "würden",
    "darf", "dürfen", "gibt", "braucht", "brauchen", "hilft", "helfen",
    "stimmt", "bedeutet", "heißt", "funktioniert", "geht", "macht", "gilt",
    "zählt", "weiß", "wissen", "kennt", "kennen"
  ];


  // 两字母名字里，这些和德语常用虚词完全同形，做点名判断会天天误触发
  var NAME_STOPWORDS = [
    "an", "am", "ab", "ob", "so", "da", "es", "er", "in", "im", "um",
    "wo", "zu", "man", "als", "bis", "ja", "nie", "mal", "ein", "aus"
  ];

  function normalize(text) {    return String(text == null ? "" : text)
      .replace(/\s+/g, " ")
      .replace(/^[\s,.;:!?-]+/, "")
      .trim();
  }

  function tokenize(text) {
    return text.toLowerCase().split(/[^a-zäöüß0-9]+/).filter(Boolean);
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * 判断一句话像不像老师在提问。
   * @param {string} text 德语识别文本
   * @param {{myName?: string}} [opts]
   * @returns {{score: number, isQuestion: boolean, reasons: string[]}}
   */
  function detectQuestion(text, opts) {
    opts = opts || {};
    var t = normalize(text);
    var tokens = tokenize(t);
    var reasons = [];
    var score = 0;

    // 点名优先判断：老师只喊一个名字也是提问
    var named = false;
    if (opts.myName) {
      var name = normalize(opts.myName).toLowerCase();
      // 两个字的名字（Yu、Li、Wu）很常见，但 "an" "in" "so" 这类会和德语虚词撞，直接不算
      var tooAmbiguous = name.length < 2 || NAME_STOPWORDS.indexOf(name) >= 0;
      if (!tooAmbiguous) {
        var nameRe = new RegExp("(^|[^a-zäöüß])" + escapeRe(name) + "([^a-zäöüß]|$)", "i");
        if (nameRe.test(t.toLowerCase())) {
          named = true;
          score += 3.5;
          reasons.push("punkt-nennung");
        }
      }
    }

    if (tokens.length < 2) {
      return { score: score, isQuestion: named, reasons: reasons.length ? reasons : ["too-short"] };
    }

    // 识别引擎偶尔会带标点
    if (/\?\s*$/.test(t)) {
      score += 4;
      reasons.push("fragezeichen");
    }

    // 句首三个词里出现疑问词 —— 德语疑问句的典型形态
    var head = tokens.slice(0, 3);
    var headHit = head.some(function (w) { return W_WORDS.indexOf(w) >= 0; });
    if (headHit) {
      score += 3;
      reasons.push("w-wort-am-anfang");
    } else if (tokens.some(function (w) { return W_WORDS.indexOf(w) >= 0; })) {
      // 句中出现疑问词弱得多（"das, was ich meine" 这种干扰）
      score += 1.5;
      reasons.push("w-wort");
    }

    // 变位动词开头 = 是非问句
    if (VERB_FIRST.indexOf(tokens[0]) >= 0) {
      score += 3;
      reasons.push("verb-am-anfang");
    }


    // "Erklären Sie ..." / "Nennen Sie ..." / "Rechnen Sie ..."
    var impRe = new RegExp(
      "\\b(?:" + IMPERATIVE_VERBS.map(escapeRe).join("|") + ")\\s+(?:Sie|ihr|mir|uns)\\b",
      "i"
    );
    if (impRe.test(t)) {
      score += 3;
      reasons.push("imperativ");
    }

    // "weiß jemand", "kann jemand", "hat jemand eine Idee"
    if (/\b(?:weiß|kann|kennt|hat|hätte)\s+jemand\b/i.test(t)) {
      score += 2;
      reasons.push("jemand");
    }

    // 课堂确认句式："Verstanden?", "Alle mitgekommen?", "Noch Fragen?"
    if (/\b(verstanden|klar|mitgekommen|noch\s+fragen|fragen\s+dazu|alles\s+klar|wer\s+hat\s+das)\b/i.test(t)) {
      score += 2;
      reasons.push("check-frage");
    }

    // 虚拟式客套："Könnten Sie ...", "Würden Sie ..."
    if (/\b(könnte|könnten|würde|würden|hätte|hätten|wäre|wären|dürfte)\b/i.test(t)) {
      score += 1;
      reasons.push("konjunktiv");
    }

    return { score: score, isQuestion: score >= 2.5, reasons: reasons };
  }

  /* ------------------------------------------------------------------ */
  /* 2. 流式协议解析                                                     */
  /* ------------------------------------------------------------------ */

  var MARKERS = { Q: "@@Q", T: "@@T", A: "@@A", H: "@@H" };
  var MARKER_RE = /^[`\s]*@@([QTAH])\b[ \t]*(.*)$/;

  /**
   * 增量解析器。模型按 @@Q/@@T/@@A/@@H 分段输出，
   * 每来一个 delta 就 feed 一次，data 里永远是最新全文。
   */
  function createParser() {
    var data = { Q: "", T: "", A: "", H: "" };
    var section = null;
    var carry = "";

    function handleLine(line) {
      var trimmed = line.trim();

      // 模型偶尔会套 ``` 代码块
      if (/^```/.test(trimmed)) {
        trimmed = trimmed.replace(/^```[a-zA-Z]*/, "").trim();
        if (!trimmed) return;
      }

      var m = MARKER_RE.exec(trimmed);
      if (m) {
        section = m[1];
        var rest = (m[2] || "").trim();
        if (rest) {
          data[section] += (data[section] ? "\n" : "") + rest;
        }
        return;
      }

      if (!section) return;
      data[section] += (data[section] ? "\n" : "") + line;
    }

    return {
      data: data,
      feed: function (chunk) {
        carry += String(chunk == null ? "" : chunk);
        var lines = carry.split("\n");
        carry = lines.pop();
        for (var i = 0; i < lines.length; i++) handleLine(lines[i]);
        return data;
      },
      flush: function () {
        if (carry) {
          handleLine(carry);
          carry = "";
        }
        return data;
      }
    };
  }

  /** 把 @@Q 段归一化成布尔 */
  function isQuestionAnswer(q) {
    var v = String(q || "").trim().toLowerCase();
    return v === "yes" || v === "ja" || v === "true" || v === "1" || v.indexOf("yes") === 0;
  }

  /* ------------------------------------------------------------------ */
  /* 2.5 语音活动检测（把连续录音切成一句一句）                          */
  /* ------------------------------------------------------------------ */

  /**
   * 服务器端识别的核心：麦克风一直在录，靠能量判断"这段话说完了"，
   * 一说完就切一段音频发走。不依赖任何浏览器语音服务。
   *
   * @param {{threshold?:number, silenceMs?:number, minSpeechMs?:number, maxMs?:number}} [options]
   */
  function createVad(options) {
    options = options || {};
    var threshold = options.threshold || 0.012;
    var silenceMs = options.silenceMs || 700;
    var minSpeechMs = options.minSpeechMs || 350;
    var maxMs = options.maxMs || 15000;

    var active = false;
    var voiceFrames = 0;
    var startTs = 0;
    var lastVoiceTs = 0;

    return {
      setThreshold: function (v) {
        threshold = v;
      },
      getThreshold: function () {
        return threshold;
      },
      isActive: function () {
        return active;
      },
      reset: function () {
        active = false;
        voiceFrames = 0;
      },
      /**
       * @param {number} rms 当前帧的能量（0~1）
       * @param {number} now 时间戳（毫秒）
       */
      feed: function (rms, now) {
        now = now == null ? Date.now() : now;
        var out = { started: false, cut: false, durationMs: 0 };

        if (!active) {
          if (rms > threshold) {
            voiceFrames++;
            // 连续两帧过阈值才算"开口"，避免爆音误触发
            if (voiceFrames >= 2) {
              active = true;
              startTs = now - 250; // 往前留 250ms，别吃掉第一个音
              lastVoiceTs = now;
              out.started = true;
            }
          } else {
            voiceFrames = 0;
          }
          return out;
        }

        if (rms > threshold) lastVoiceTs = now;

        var dur = now - startTs;
        if (dur > maxMs) {
          out.cut = true;
        } else if (now - lastVoiceTs > silenceMs && lastVoiceTs - startTs > minSpeechMs) {
          out.cut = true;
        }

        if (out.cut) {
          out.durationMs = dur;
          active = false;
          voiceFrames = 0;
        }
        return out;
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* 3. 提示词                                                           */
  /* ------------------------------------------------------------------ */

  var SYSTEM_PROMPT = [
    "你给一个在德国读大学的中国留学生当课堂助教。他德语听力跟不上，老师随时可能突然提问，他必须在几秒内用德语开口回答。",
    "",
    "你会收到一段老师刚说的话。它来自手机语音识别：可能有错词、没有标点、可能被截断。你要自己判断它到底是什么意思。",
    "",
    "任务：",
    "1. 翻译：翻成自然口语化的中文。专业术语保留德语原词并加简短中文解释，例如：「Die Elastizität（弹性，指需求量对价格变化的敏感程度）」。",
    "2. 判断：这是不是老师在向学生提问、点名、或要求有人开口回答？课堂上的自问自答、纯讲授、念幻灯片都不算。",
    "3. 如果算提问：写一段他可以照着念出来的德语回答。",
    "",
    "德语回答的硬性要求：",
    "- 像学生自己说的话：口语、简洁，2~3 句，最多 60 个德语词。",
    "- 直接给内容，不要写「Das ist eine gute Frage」这类开场废话。",
    "- 不分点、不用 markdown、不用论文书面腔。",
    "- 必须用上老师问到的德语专业术语。",
    "- 德语必须语法正确：主语和动词的数要一致。Aktiva / Passiva / Kosten / Umsätze 这类是复数，动词用 zeigen 不是 zeigt；die Bilanz 单数是 zeigt。名词性、格、冠词也要对。",
    "- 输出前在心里默读一遍做语法检查，宁可句子短一点，也不要出现一眼能看出的语法错。",
    "- 信息不足时给一个稳妥且正确的框架式回答（如「Ich würde sagen, dass …, weil …」或「Wenn ich es richtig verstanden habe, geht es um …」），绝对不要瞎编年份、人名、数字、文献。",
    "- 如果老师是在点名让他回答，回答用「Ich」开头。",
    "",
    "输出格式（严格）：四个标记各自独占一行，顺序固定，不要加别的标记，不要代码块围栏，不要任何解释。",
    "",
    "@@Q",
    "yes 或 no",
    "@@T",
    "中文翻译",
    "@@A",
    "德语回答（不是提问就留空）",
    "@@H",
    "中文提示：一两句话说明这个回答在讲什么，以及万一被追问可以补哪一点（不是提问就留空）"
  ].join("\n");

  /**
   * 构造 messages。
   * @param {string} utterance 老师刚说的话（德语）
   * @param {{course?: string, myName?: string, history?: string[], force?: boolean}} ctx
   */
  function buildMessages(utterance, ctx) {
    ctx = ctx || {};
    var history = (ctx.history || []).slice(-4);

    var parts = [];
    parts.push("【课程背景】" + (ctx.course ? ctx.course : "（未填写，按通用大学课堂处理）"));
    if (ctx.myName) parts.push("【我的名字】" + ctx.myName);
    if (history.length) {
      parts.push("【前面几轮的话，供理解上下文】\n" + history.map(function (s, i) {
        return (i + 1) + ". " + s;
      }).join("\n"));
    }
    parts.push("【老师刚说】\n" + String(utterance || "").trim());
    if (ctx.force) {
      parts.push("【注意】老师现在确实在问我，我必须开口回答，请务必给出德语回答。");
    }

    return [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: parts.join("\n\n") }
    ];
  }

  /* ------------------------------------------------------------------ */

  return {
    MARKERS: MARKERS,
    SYSTEM_PROMPT: SYSTEM_PROMPT,
    normalize: normalize,
    detectQuestion: detectQuestion,
    createParser: createParser,
    createVad: createVad,
    isQuestionAnswer: isQuestionAnswer,
    buildMessages: buildMessages
  };
});
