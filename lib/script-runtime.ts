/**
 * スクリプトの実行ランタイム（プレビューと書き出したサイトで共用）と、使う機能だけを残す書き出し
 */

import { NAVIGATION_RUNTIME } from "./url-policy";
import { type ScriptCond, type ScriptStep, type ScriptTrigger, type SiteDoc } from "./types";
import { isDataStep, listFromOf, pagePlan } from "./data";
import { extractVars, hardNavPatterns } from "./vars";
import { fieldVarNames } from "./fields";
import { EMPTY_GIF, allScripts, pageNodeIds, walkSteps } from "./script";

/* ---------- 実行ランタイム ---------- */

/**
 * プレビューと書き出しサイトで共用するランタイム（素のJS）。
 * `(SCRIPT_RUNTIME)(env).install(root)` で data-scripts を持つ要素のスクリプトを動かす。
 * env: showDisplay(el) / openPage(step) / openUrl(url, newTab) / setValue(id, v) / touch(el)
 *   / setVar(name, v) / storePrefix
 *
 * `/*#名前*\/ … /*\/名前*\/` で囲んだ部分は、書き出し時にその機能を使っていなければ削る
 * （`a|b` はどちらかを使っていれば残す）。プレビューでは単なるコメントとして全部動く。
 */
export const SCRIPT_RUNTIME = `function (env) {
  ${NAVIGATION_RUNTIME}
  /*#env*/
  env = env || {};
  function touch(el) {
    if (env.touch) env.touch(el);
  }
  /*/env*/
  var cache = new Map();
  function parse(el) {
    var raw = el.getAttribute("data-scripts") || "[]";
    var v = cache.get(raw);
    if (!v) {
      try {
        v = JSON.parse(raw);
      } catch (e) {
        v = [];
      }
      cache.set(raw, v);
    }
    return v;
  }
  function has(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }
  // "items.0.title" のような位置を掘る（配列の "-1" は最後の要素）
  function dig(v, path) {
    var keys = String(path).split(".");
    for (var i = 0; i < keys.length; i++) {
      if (v == null || typeof v !== "object") return undefined;
      var k = keys[i];
      v = Array.isArray(v) && k === "-1" ? v[v.length - 1] : v[k];
    }
    return v;
  }
  // 表示用の文字にする（配列は「, 」でつなぐ）
  function text(v) {
    if (v == null) return "";
    if (Array.isArray(v)) return v.map(text).filter(Boolean).join(", ");
    if (typeof v === "object") return "";
    return String(v);
  }
  /*#calc*/
  // + - * / % とかっこだけの式を計算する（読めなければ空）
  function calc(s) {
    var src = String(s).replace(/,/g, "").replace(/×/g, "*").replace(/÷/g, "/");
    var i = 0;
    function sp() {
      while (/\\s/.test(src.charAt(i))) i++;
    }
    function num() {
      sp();
      var c = src.charAt(i);
      if (c === "(") {
        i++;
        var v = add();
        sp();
        if (src.charAt(i) !== ")") throw 0;
        i++;
        return v;
      }
      if (c === "-" || c === "+") {
        i++;
        return c === "-" ? -num() : num();
      }
      var m = /^\\d*\\.?\\d+(?:e[+-]?\\d+)?/i.exec(src.slice(i));
      if (!m) throw 0;
      i += m[0].length;
      return Number(m[0]);
    }
    function mul() {
      var v = num();
      for (;;) {
        sp();
        var c = src.charAt(i);
        if (c !== "*" && c !== "/" && c !== "%") return v;
        i++;
        var r = num();
        v = c === "*" ? v * r : c === "/" ? v / r : v % r;
      }
    }
    function add() {
      var v = mul();
      for (;;) {
        sp();
        var c = src.charAt(i);
        if (c !== "+" && c !== "-") return v;
        i++;
        var r = mul();
        v = c === "+" ? v + r : v - r;
      }
    }
    try {
      var v = add();
      sp();
      if (i < src.length || !isFinite(v)) return "";
      // 0.1 + 0.2 のような小数の誤差を丸める
      return Math.round(v * 1e10) / 1e10;
    } catch (e) {
      return "";
    }
  }
  /*/calc*/
  /*#show|visible*/
  function isHidden(el) {
    return getComputedStyle(el).display === "none";
  }
  /*/show|visible*/
  /*#show*/
  function show(el) {
    /*#env*/
    touch(el);
    /*/env*/
    el.style.display = "";
    if (isHidden(el)) {
      el.style.display =
        /*#env*/
        (env.showDisplay && env.showDisplay(el)) ||
        /*/env*/
        el.getAttribute("data-toggle-show") ||
        "block";
    }
  }
  function hide(el) {
    /*#env*/
    touch(el);
    /*/env*/
    el.style.display = "none";
  }
  /*/show*/
  function inputOf(el) {
    return el.matches("input,select,textarea")
      ? el
      : el.querySelector("input,select,textarea");
  }
  // 同じグループ（name）のラジオボタン
  function radiosOf(input) {
    if (!input.name) return [input];
    try {
      return Array.prototype.slice.call(
        document.querySelectorAll('input[type="radio"][name="' + CSS.escape(input.name) + '"]')
      );
    } catch (e) {
      return [input];
    }
  }
  // 真偽として読む（空・off・false・0・no はオフ、ほかはオン）
  function truthy(v) {
    v = String(v == null ? "" : v).trim().toLowerCase();
    return v !== "" && v !== "off" && v !== "false" && v !== "0" && v !== "no";
  }
  // グループ名と別のIDで、ラジオボタンを1つだけ指しているか（そのボタンを選んでいるかが値になる）
  function isRadioItem(el, input) {
    return !!input && input.type === "radio" && !!el.id && el.id !== input.name;
  }
  // 入力欄の状態（{ID.disabled} / {ID.length} / {ID.index}）。入力欄でなければ undefined
  function stateOf(els, prop) {
    var input = els.length ? inputOf(els[0]) : null;
    if (!input && els.length && els[0].matches("button")) input = els[0];
    if (!input) return undefined;
    var radios = input.type === "radio" ? radiosOf(input) : null;
    switch (prop) {
      case "disabled":
        return String(!!input.disabled);
      case "length":
        return String(valueOf(els).length);
      case "index":
        if (input.tagName === "SELECT") return String(input.selectedIndex + 1);
        if (radios) {
          var at = -1;
          radios.forEach(function (r, i) {
            if (r.checked) at = i;
          });
          return at < 0 ? "" : String(at + 1);
        }
        return undefined;
      default:
        return undefined;
    }
  }
  function valueOf(els) {
    for (var i = 0; i < els.length; i++) {
      var input = inputOf(els[i]);
      if (!input) return (els[i].textContent || "").trim();
      // チェックボックス・グループのラジオボタン1つは、チェックしているか（true / false）
      if (input.type === "checkbox" || isRadioItem(els[i], input)) return input.checked ? "true" : "false";
      if (input.type === "radio") {
        // グループのどれかが選ばれていれば、その値
        var hit = radiosOf(input).filter(function (r) {
          return r.checked;
        })[0];
        if (hit) return hit.value;
        continue;
      }
      return input.value;
    }
    return "";
  }
  /*#go*/
  function go(url, newTab) {
    if (!url || safeNavigationUrl(url) === "#") return;
    url = safeNavigationUrl(url);
    if (newTab) {
      window.open(url, "_blank", "noopener");
      return;
    }
    if (url.charAt(0) === "#") {
      location.hash = url;
      return;
    }
    var r = window.next && window.next.router;
    // リダイレクト・中継・HTMLページは Next.js のページではないので、ブラウザの通常の移動にする
    var hard = ((env && env.hardNav) || []).some(function (re) {
      return new RegExp(re).test(url);
    });
    if (url.charAt(0) === "/" && url.charAt(1) !== "/" && !hard && r && r.push) r.push(url);
    else location.href = url;
  }
  /*/go*/
  /*#value|var|filter*/
  function cmp(v, op, w) {
    switch (op) {
      case "neq": return v !== w;
      case "contains": return v.indexOf(w) >= 0;
      case "not-contains": return v.indexOf(w) < 0;
      case "starts-with": return v.lastIndexOf(w, 0) === 0;
      case "ends-with": return v.length >= w.length && v.indexOf(w, v.length - w.length) >= 0;
      case "gt": return parseFloat(v) > parseFloat(w);
      case "lt": return parseFloat(v) < parseFloat(w);
      case "empty": return v === "";
      case "not-empty": return v !== "";
      case "in":
        return w.split(",").some(function (x) {
          return x.trim() === v;
        });
      default: return v === w;
    }
  }
  /*/value|var|filter*/
  /*#wait|repeat*/
  function sleep(s) {
    return new Promise(function (res) {
      setTimeout(res, Math.max(0, (Number(s) || 0) * 1000));
    });
  }
  /*/wait|repeat*/
  /*#store*/
  // ストレージ: localStorage → このホストだけのクッキー（ls_キー） → メモリ の順に使う
  var prefix = "";
  /*#env*/
  prefix = env.storePrefix || "";
  /*/env*/
  var mem = {};
  // 共有: 公開URLのドメイン（例: example.com）の全サブドメインで読み書きするクッキー。
  // ほかのサイトと同じクッキーを使えるよう、名前はキーそのまま・値はエンコードして書く
  var sharedDomain = (env && env.sharedDomain) || "";
  function domainAttr() {
    var h = location.hostname;
    return sharedDomain && (h === sharedDomain || h.slice(-sharedDomain.length - 1) === "." + sharedDomain)
      ? "; Domain=" + sharedDomain
      : "";
  }
  function lsGet(k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  }
  function ckName(k) {
    return "ls_" + encodeURIComponent(k);
  }
  function ckGet(k) {
    return cookieGet(ckName(k));
  }
  function cookieGet(name) {
    var n = name + "=";
    var parts = document.cookie ? document.cookie.split("; ") : [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].indexOf(n) !== 0) continue;
      try {
        return decodeURIComponent(parts[i].slice(n.length));
      } catch (e) {
        return null;
      }
    }
    return null;
  }
  function ckSet(k, v, age) {
    document.cookie =
      ckName(k) + "=" + encodeURIComponent(v) + "; path=/; max-age=" + age + "; SameSite=Lax" +
      (location.protocol === "https:" ? "; Secure" : "");
  }
  function scSet(k, v) {
    document.cookie =
      encodeURIComponent(k) + "=" + encodeURIComponent(v) + "; Max-Age=31536000; Path=/" + domainAttr() +
      "; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
    return cookieGet(encodeURIComponent(k)) === v;
  }
  function storeGet(key, shared) {
    var k = prefix + key;
    if (shared) {
      var s = cookieGet(encodeURIComponent(k));
      if (s != null) return s;
    }
    var v = lsGet(k);
    if (v == null) v = ckGet(k);
    if (v == null && has(mem, k)) v = mem[k];
    return v == null ? "" : v;
  }
  function storeSet(key, v, shared) {
    var k = prefix + key;
    try {
      if (shared && scSet(k, v)) {
        // 共有クッキーに書けたら、このサイトだけの保存は残さない（古い値が混ざらないように）
        try {
          localStorage.removeItem(k);
        } catch (e) {}
        if (ckGet(k) != null) ckSet(k, "", 0);
        delete mem[k];
        return;
      }
    } catch (e) {}
    try {
      localStorage.setItem(k, v);
      if (localStorage.getItem(k) === v) {
        if (ckGet(k) != null) ckSet(k, "", 0);
        delete mem[k];
        return;
      }
    } catch (e) {}
    // 書けなかったときに古い値が先に読まれないよう消しておく
    try {
      localStorage.removeItem(k);
    } catch (e) {}
    try {
      ckSet(k, v, 31536000);
      if (ckGet(k) === v) {
        delete mem[k];
        return;
      }
    } catch (e) {}
    mem[k] = v;
  }
  /*/store*/
  return {
    install: function (root) {
      var alive = true;
      // 画面上の変数（ストレージから読み込んだ値・分解した配列など）
      var vars = {};
      function getVar(name) {
        return has(vars, name) ? vars[name] : dig(vars, name);
      }
      function writeVar(name, v) {
        if (!name) return;
        if (name.indexOf(".") < 0 || has(vars, name)) {
          vars[name] = v;
          return;
        }
        var ks = name.split(".");
        var cur = vars;
        for (var i = 0; i < ks.length - 1; i++) {
          var k = ks[i].trim();
          var nx = cur[k];
          if (nx == null || typeof nx !== "object" || Array.isArray(nx)) {
            vars[name] = v;
            return;
          }
          var cp = {};
          for (var ok in nx) if (has(nx, ok)) cp[ok] = nx[ok];
          cur[k] = cp;
          cur = cp;
        }
        cur[ks[ks.length - 1].trim()] = v;
      }
      // リストのお手本（data-tpl）の中は {名前} が未解決の非表示の複製元なので対象にしない
      function inTpl(el) {
        return !!(el.closest && el.closest("[data-tpl]"));
      }
      // グループ名（name）で探すラジオボタン
      function groupOf(name) {
        try {
          return Array.prototype.slice
            .call(root.querySelectorAll('input[type="radio"][name="' + CSS.escape(name) + '"]'))
            .filter(function (el) {
              return !inTpl(el);
            });
        } catch (e) {
          return [];
        }
      }
      function find(self, target) {
        if (!target || target === "@self") return self ? [self] : [];
        var els;
        try {
          els = Array.prototype.slice
            .call(root.querySelectorAll("#" + CSS.escape(target)))
            .filter(function (el) {
              return !inTpl(el);
            });
        } catch (e) {
          return [];
        }
        // リストの項目の中から動かしたときは、同じ項目の中の要素を先に使う
        //（リストでは同じIDが項目の数だけ並ぶため）
        var row = self && self.closest && self.closest("[data-row],[data-item]");
        if (row) {
          var mine = els.filter(function (el) {
            return row.contains(el);
          });
          if (mine.length) return mine;
        }
        return els;
      }
      // {名前} の値: リストの項目 → 画面上の変数 → 同じIDの要素の値 → URLの検索パラメータ
      function lookup(name, self, item) {
        if (item) {
          var iv = has(item, name) ? item[name] : dig(item, name);
          if (iv !== undefined) return iv;
        }
        var v = getVar(name);
        if (v !== undefined) return v;
        var dot = name.indexOf(".");
        var head = dot < 0 ? name : name.slice(0, dot);
        var prop = dot < 0 ? "" : name.slice(dot + 1);
        var els = find(self, head);
        // ラジオボタンのグループ名
        if (!els.length) els = groupOf(head);
        if (els.length) {
          var state = prop ? stateOf(els, prop) : undefined;
          return state !== undefined ? state : valueOf(els);
        }
        try {
          var q = new URLSearchParams(location.search).get(name);
          if (q != null) return q;
        } catch (e) {}
        return "";
      }
      // {名前} を値に置き換える（「\\{」は文字の「{」）。名前に使える文字は配信時の置き換え（lib/vars.ts）と同じで、
      // 空白・引用符を含む { … }（CSS や JSON、「{ 期間限定 }」のような文字）は変数ではない
      function resolve(s, self, item) {
        return String(s == null ? "" : s).replace(/\\\\\\{|\\{([^{}\\s"'<>\`]+)\\}/g, function (m, k) {
          if (k == null) return "{";
          return text(lookup(k.trim(), self, item));
        });
      }
      /*#calc*/
      // 式の {名前} を数に置き換える（数でなければ 0。「1,000」の区切りは除く）
      function resolveNum(s, self, item) {
        return String(s == null ? "" : s).replace(/\\\\\\{|\\{([^{}\\s"'<>\`]+)\\}/g, function (m, k) {
          if (k == null) return "{";
          var n = Number(text(lookup(k.trim(), self, item)).replace(/,/g, ""));
          return "(" + (isFinite(n) ? n : 0) + ")";
        });
      }
      /*/calc*/
      // URL用（値をエンコードする。配信時に残した %7B名前%7D も置き換える）。
      // 先頭の変数がURLそのもの（https:// や / で始まる）なら、そのまま使う
      function resolveUrl(s, self, item) {
        return String(s == null ? "" : s).replace(
          /\\\\\\{|\\{([^{}\\s"'<>\`]+)\\}|%7B(.*?)%7D/gi,
          function (m, a, b, at) {
            if (m === "\\\\{") return "{";
            var k = a;
            if (k == null) {
              try {
                k = decodeURIComponent(b);
              } catch (e) {
                return m;
              }
              // URL にもともとある %7B…%7D（変数の名前にならないもの）はそのまま
              if (!/^[^{}\\s"'<>\`]+$/.test(k)) return m;
            }
            var v = text(lookup(k.trim(), self, item));
            return at === 0 && (/^(?:https?:|mailto:|tel:|data:image\\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\\.microsoft\\.icon)[;,])/i.test(v) || (v.charAt(0) === "/" && v.charAt(1) !== "/") || v.charAt(0) === "#")
              ? v
              : encodeURIComponent(v);
          }
        );
      }
      // 画面上で値が決まる {変数} を含む文字（data-live）・入力欄の案内文と初期値を書き直す
      function refreshLive() {
        root.querySelectorAll("[data-live]").forEach(function (el) {
          if (inTpl(el)) return;
          var t = el.firstChild;
          if (!t || t.nodeType !== 3) {
            t = document.createTextNode("");
            el.insertBefore(t, el.firstChild);
          }
          var next = resolve(el.getAttribute("data-live"), el);
          if (t.nodeValue !== next) t.nodeValue = next;
        });
        root.querySelectorAll("[data-live-placeholder]").forEach(function (el) {
          if (inTpl(el)) return;
          el.placeholder = resolve(el.getAttribute("data-live-placeholder"), el);
        });
        // 初期値は、まだ自分で入力していない入力欄だけ書き直す
        root.querySelectorAll("[data-live-value]").forEach(function (el) {
          if (inTpl(el) || el.hasAttribute("data-edited")) return;
          var nv = resolve(el.getAttribute("data-live-value"), el);
          if (el.value !== nv) el.value = nv;
        });
      }
      /*#live*/
      function onLiveInput(e) {
        if (e.isTrusted && e.target && e.target.setAttribute) e.target.setAttribute("data-edited", "");
        refreshLive();
      }
      /*/live*/
      function setVar(name, v) {
        if (!name) return;
        writeVar(name, v);
        /*#env*/
        if (env.setVar) env.setVar(name, v);
        /*/env*/
        refreshLive();
        /*#clist*/
        var rk = name.split(".")[0];
        root.querySelectorAll("[data-client-list]").forEach(function (list) {
          var a = list.getAttribute("data-array") || "";
          if (a === name || a.indexOf(name + ".") === 0 || a === rk || a.indexOf(rk + ".") === 0) renderList(list);
        });
        /*/clist*/
      }
      /*#if*/
      function test(c, self, sc) {
        /*#var*/
        if (c.subject === "var") {
          return cmp(resolve(c.left, self, sc), c.op, resolve(c.value, self, sc));
        }
        /*/var*/
        var els = find(self, c.target);
        var r = false;
        /*#value*/
        if (c.subject === "value") {
          var w = resolve(c.value, self, sc);
          // チェックボックスなどのオン・オフは、on / true / off / false / 空 のどれで書いても比べられる
          var box = els.length ? inputOf(els[0]) : null;
          if (box && (box.type === "checkbox" || isRadioItem(els[0], box))) {
            var on = !!box.checked;
            if (c.op === "empty") return !on;
            if (c.op === "not-empty") return on;
            if (!c.op || c.op === "eq" || c.op === "neq") {
              var same = truthy(w) === on;
              return c.op === "neq" ? !same : same;
            }
          }
          return cmp(valueOf(els), c.op, w);
        }
        /*/value*/
        /*#checked*/
        if (c.subject === "checked") {
          r = els.some(function (el) {
            var i = inputOf(el);
            return !!(i && i.checked);
          });
        }
        /*/checked*/
        /*#visible*/
        if (c.subject === "visible") r = els.length > 0 && !isHidden(els[0]);
        /*/visible*/
        /*#hovered*/
        if (c.subject === "hovered") {
          r = els.some(function (el) {
            return el.matches(":hover");
          });
        }
        /*/hovered*/
        return c.not ? !r : r;
      }
      /*/if*/
      /*#filter*/
      // 配列の絞り込み: 配列の名前 → [{ no, join, conds: [{ field, op, value, and }] }]。
      // 1回の絞り込みの条件は「かつ」でつないだ組のどれか1つを満たせばよい。
      // 絞り込みどうしは、かかった順に join（and = かつ / or = または）でつなぐ
      var filters = new Map();
      // 項目の値（"address.city" のような入れ子の位置も読む）
      function fieldOf(item, f) {
        if (item == null) return undefined;
        return has(item, f) ? item[f] : dig(item, f);
      }
      function passOne(conds, item) {
        var ok = false;
        var grp = true;
        conds.forEach(function (c, i) {
          if (i && !c.and) {
            ok = ok || grp;
            grp = true;
          }
          var fv = fieldOf(item, c.field);
          grp = grp && cmp(fv == null ? "" : String(fv), c.op, c.value);
        });
        return ok || grp;
      }
      function passes(fs, item) {
        var acc = true;
        fs.forEach(function (f, i) {
          var r = passOne(f.conds, item);
          acc = i === 0 ? r : f.join === "or" ? acc || r : acc && r;
        });
        return acc;
      }
      // 配列の並べ替え: 配列の名前 → { field, dir }
      var sorts = new Map();
      function itemOf(w) {
        try {
          return JSON.parse(w.getAttribute("data-item")) || {};
        } catch (e) {
          return {};
        }
      }
      // 数値どうしは数値で、それ以外は数字を数値として比べる（エディタの compareValues と同じ）
      function order(x, y) {
        return typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x == null ? "" : x).localeCompare(String(y == null ? "" : y), "ja", {
              numeric: true,
            });
      }
      // 配信済みのリスト: 項目（data-item）の並びを入れ替える
      function applySort(list) {
        var s = sorts.get(list.getAttribute("data-array"));
        if (!s) return;
        var dir = s.dir === "desc" ? -1 : 1;
        var rows = Array.prototype.filter
          .call(list.children, function (w) {
            return w.hasAttribute("data-item");
          })
          .map(function (w, i) {
            return { w: w, v: fieldOf(itemOf(w), s.field), i: i };
          });
        rows.sort(function (a, b) {
          return order(a.v, b.v) * dir || a.i - b.i;
        });
        // 並びが変わらないなら動かさない（動かすと要素の変化を見張る処理がまた並べ替えを呼び、
        // 毎フレーム並べ替え続けてしまう）
        if (
          rows.every(function (r, i) {
            return r.i === i;
          })
        ) {
          return;
        }
        rows.forEach(function (r) {
          list.appendChild(r.w);
        });
      }
      // 配列を並べるリストに、いまの並べ替え・絞り込みを反映する
      function relist(name) {
        listsOf(name).forEach(function (list) {
          /*#clist*/
          // 画面上で並べるリストは、表示件数より先に並べ替え・絞り込むため並べ直す
          if (list.hasAttribute("data-client-list")) {
            renderList(list);
            return;
          }
          /*/clist*/
          applySort(list);
          applyFilters(list);
        });
      }
      function applyFilters(list) {
        var fs = filters.get(list.getAttribute("data-array")) || [];
        Array.prototype.forEach.call(list.children, function (w) {
          if (!w.hasAttribute("data-item")) return;
          w.style.display = passes(fs, itemOf(w)) ? "contents" : "none";
        });
      }
      function listsOf(name) {
        try {
          return Array.prototype.slice.call(
            root.querySelectorAll('[data-array="' + CSS.escape(name) + '"]')
          );
        } catch (e) {
          return [];
        }
      }
      /*/filter*/
      /*#clist|filter*/
      // 配列の要素を項目にする（文字や数値は {値} に入れる）
      function itemsOf(v) {
        var out = [];
        if (!Array.isArray(v)) return out;
        v.forEach(function (x) {
          if (x == null || Array.isArray(x)) return;
          out.push(typeof x === "object" ? x : { "値": x });
        });
        return out;
      }
      /*/clist|filter*/
      /*#clist*/
      // 画面上で値が決まる配列のリスト: お手本（data-tpl）を項目ごとに複製して並べる
      var rendered = new WeakSet();
      function fillJson(v, item) {
        return v
          // JSON の中の「\\{」（文字としての「{」）は「\\\\{」になっているので、そのまま残す
          .replace(/\\\\\\\\\\{|\\{([^{}\\s"'<>\`]+)\\}/g, function (m, k) {
            if (k == null) return m;
            return JSON.stringify(text(lookup(k.trim(), null, item))).slice(1, -1);
          })
          .replace(/%7B(.*?)%7D/gi, function (m, b, at, all) {
            try {
              var k = decodeURIComponent(b).trim();
              if (!/^[^{}\\s"'<>\`]+$/.test(k)) return m;
              var v = text(lookup(k, null, item));
              // URLの先頭（JSON の文字列の始まり）の変数がURLそのもの（https:// や / で始まる）なら、そのまま入れる
              //（配信時の interpolateUrl・画面上の resolveUrl と同じ）
              if (all.charAt(at - 1) === '"' && (/^(?:https?:|mailto:|tel:|data:image\\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\\.microsoft\\.icon)[;,])/i.test(v) || (v.charAt(0) === "/" && v.charAt(1) !== "/") || v.charAt(0) === "#")) {
                return JSON.stringify(v).slice(1, -1);
              }
              return encodeURIComponent(v);
            } catch (e) {
              return m;
            }
          });
      }
      function fill(n, item) {
        if (n.nodeType === 3) {
          if (n.nodeValue.indexOf("{") >= 0) n.nodeValue = resolve(n.nodeValue, null, item);
          return;
        }
        if (n.nodeType !== 1) return;
        Array.prototype.slice.call(n.attributes).forEach(function (a) {
          var v = a.value;
          if (v.indexOf("{") < 0 && !/%7B/i.test(v)) return;
          n.setAttribute(
            a.name,
            a.name === "data-scripts"
              ? fillJson(v, item)
              : a.name === "href"
                ? safeNavigationUrl(resolveUrl(v, null, item))
                : a.name === "src"
                  ? resolve(v, null, item) || "${EMPTY_GIF}"
                  : resolve(v, null, item)
          );
        });
        // カスタムコード・アイコン（data-raw）の中身は書いたまま（配信前に並べるリスト・エディタと同じ）
        if (n.hasAttribute("data-raw")) return;
        for (var c = n.firstChild; c; c = c.nextSibling) fill(c, item);
      }
      function renderList(list) {
        rendered.add(list);
        var tpl = null;
        Array.prototype.slice.call(list.children).forEach(function (c) {
          if (c.hasAttribute("data-row")) list.removeChild(c);
          else if (c.hasAttribute("data-tpl")) tpl = c;
        });
        if (!tpl) return;
        var items = itemsOf(getVar(list.getAttribute("data-array") || ""));
        /*#filter*/
        // 並べ替え・絞り込みは表示件数で切る前に
        var name = list.getAttribute("data-array") || "";
        var fs = filters.get(name) || [];
        items = items.filter(function (x) {
          return passes(fs, x);
        });
        var so = sorts.get(name);
        if (so) {
          var sd = so.dir === "desc" ? -1 : 1;
          items = items
            .map(function (x, i) {
              return { x: x, i: i };
            })
            .sort(function (a, b) {
              return order(fieldOf(a.x, so.field), fieldOf(b.x, so.field)) * sd || a.i - b.i;
            })
            .map(function (r) {
              return r.x;
            });
        }
        /*/filter*/
        var lim = Number(list.getAttribute("data-limit")) || 0;
        if (lim > 0) items = items.slice(0, lim);
        items.forEach(function (item) {
          var row = document.createElement("div");
          row.setAttribute("data-row", "");
          row.setAttribute("data-item", JSON.stringify(item));
          row.style.display = "contents";
          Array.prototype.forEach.call(tpl.childNodes, function (c) {
            var copy = c.cloneNode(true);
            fill(copy, item);
            row.appendChild(copy);
          });
          list.appendChild(row);
        });
      }
      /*/clist*/
      /*#set*/
      function setValue(self, id, v) {
        var els = find(self, id);
        if (!els.length) els = groupOf(id);
        var first = els.length ? inputOf(els[0]) : null;
        // チェックボックス・グループのラジオボタン1つは、オン・オフを「true」/「false」にそろえる
        var toggle = !!first && (first.type === "checkbox" || isRadioItem(els[0], first));
        if (toggle) v = truthy(v) ? "true" : "false";
        // ラジオ（グループの値）はグループのボタンすべてから選ぶ
        else if (first && first.type === "radio") els = radiosOf(first);
        if (valueOf(els) === v) return;
        // 値が変わった入力欄だけに知らせる（ラジオは選ばれたボタンだけ。外れたボタンは知らせない）
        var changed = [];
        els.forEach(function (el) {
          var input = inputOf(el);
          if (!input) return;
          if (input.type === "checkbox" || input.type === "radio") {
            var on = toggle ? v === "true" : input.value === v;
            if (input.checked === on) return;
            input.checked = on;
            if (!on && input.type === "radio") return;
          } else {
            // ファイルの欄は、選んだファイルを外す（空にする）ことだけができる
            if (input.value === v || (input.type === "file" && v !== "")) return;
            input.value = v;
          }
          changed.push(input);
        });
        /*#env*/
        if (env.setValue && env.setValue(id, v)) {
          // 反映後に「値が変わったとき」を動かす
          setTimeout(function () {
            els.forEach(function (el) {
              fire(el, "change");
            });
          }, 0);
          return;
        }
        /*/env*/
        changed.forEach(function (input) {
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        });
      }
      /*/set*/
      // くり返し中の要素（cx: { array, index, item, up, run }）の項目を、外側から順に重ねた値
      function scopeOf(cx) {
        if (!cx) return undefined;
        var o = scopeOf(cx.up) || {};
        for (var k in cx.item) if (has(cx.item, k)) o[k] = cx.item[k];
        return o;
      }
      function merged(a, b) {
        var o = {};
        var k;
        for (k in a || {}) if (has(a, k)) o[k] = a[k];
        for (k in b || {}) if (has(b, k)) o[k] = b[k];
        return o;
      }
      function exec(st, self, cx) {
        var sc = scopeOf(cx);
        switch (st.kind) {
          /*#show*/
          case "show":
            find(self, st.target).forEach(show);
            break;
          case "hide":
            find(self, st.target).forEach(hide);
            break;
          case "toggle":
            find(self, st.target).forEach(function (el) {
              if (isHidden(el)) show(el);
              else hide(el);
            });
            break;
          /*/show*/
          /*#scroll*/
          case "scroll-to": {
            var el = find(self, st.target)[0];
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            break;
          }
          /*/scroll*/
          /*#go*/
          case "open-page":
            /*#env*/
            if (env.openPage) {
              env.openPage(st);
              break;
            }
            /*/env*/
            go(st.href, st.newTab);
            break;
          case "open-url": {
            var url = resolveUrl(st.url, self, sc);
            /*#env*/
            if (env.openUrl) {
              env.openUrl(url, !!st.newTab);
              break;
            }
            /*/env*/
            go(url, st.newTab);
            break;
          }
          /*/go*/
          /*#set*/
          case "set-value":
            setValue(self, st.target, resolve(st.value, self, sc));
            break;
          case "set-enabled":
            // 入力欄（ラジオはグループごと）・ボタンを操作できる / できない状態にする
            (find(self, st.target).length ? find(self, st.target) : groupOf(st.target)).forEach(function (el) {
              var ctl = el.matches("button") ? el : inputOf(el);
              if (!ctl) return;
              var list = ctl.type === "radio" && !isRadioItem(el, ctl) ? radiosOf(ctl) : [ctl];
              list.forEach(function (c) {
                c.disabled = st.op === "toggle" ? !c.disabled : st.op === "disable";
              });
            });
            refreshLive();
            break;
          /*/set*/
          /*#filter*/
          case "filter-array": {
            if (!st.array || !st.conds || !st.conds.length) break;
            var fs = (filters.get(st.array) || []).slice();
            // 番号の無い絞り込みは、項目の組で同じものを見分ける
            var key =
              st.no != null
                ? "n" + st.no
                : "f" +
                  st.conds
                    .map(function (c) {
                      return c.field;
                    })
                    .sort()
                    .join("|");
            var entry = {
              key: key,
              no: st.no,
              join: st.join,
              conds: st.conds.map(function (c) {
                return { field: c.field, op: c.op, value: resolve(c.value, self, sc), and: c.and };
              }),
            };
            // 同じ番号の絞り込みはもう一度動かすと置き換わる（かかった順は保つ）
            var at = -1;
            fs.forEach(function (f, i) {
              if (f.key === key) at = i;
            });
            if (at >= 0) fs[at] = entry;
            else fs.push(entry);
            filters.set(st.array, fs);
            relist(st.array);
            break;
          }
          case "unfilter-array":
            // 番号を指定すればその絞り込みだけ、なければすべて解除
            if (st.no != null) {
              filters.set(
                st.array,
                (filters.get(st.array) || []).filter(function (f) {
                  return f.no !== st.no;
                })
              );
            } else filters.delete(st.array);
            relist(st.array);
            break;
          case "sort-array":
            if (!st.array || !st.field) break;
            sorts.set(st.array, { field: st.field, dir: st.dir });
            relist(st.array);
            break;
          /*/filter*/
          /*#store*/
          case "store-save":
            if (st.key) storeSet(st.key, resolve(st.value, self, sc), !!st.shared);
            break;
          case "store-load":
            setVar(st.into, st.key ? storeGet(st.key, !!st.shared) : "");
            break;
          /*/store*/
          /*#setvar*/
          case "set-var": {
            // 配信前に値が決まる {名前} だけの値は、配信時にそのまま入っている
            if ("raw" in st) {
              setVar(st.into, st.raw);
              break;
            }
            // {名前} だけなら値をそのまま入れる（配列はリストで並べられる配列のまま）
            var sv = /^\\{([^{}]+)\\}$/.exec(String(st.value || "").trim());
            setVar(st.into, sv ? lookup(sv[1].trim(), self, sc) : resolve(st.value, self, sc));
            break;
          }
          /*/setvar*/
          /*#calc*/
          case "calc":
            setVar(st.into, calc(resolveNum(st.expr, self, sc)));
            break;
          /*/calc*/
          /*#replace*/
          case "replace": {
            var rsrc = resolve(st.source, self, sc);
            var rto = resolve(st.to, self, sc);
            if (st.regex) {
              var rpat = (Array.isArray(st.find) ? st.find : [st.find || ""])
                .map(function (p) {
                  return typeof p === "string"
                    ? p
                    : resolve(p.v, self, sc).replace(/[.*+?^$()|{}[\\]\\\\]/g, "\\\\$&");
                })
                .join("");
              var rre = null;
              try {
                rre = rpat ? new RegExp(rpat, "g") : null;
              } catch (e) {}
              // 書き方の誤った正規表現なら置き換えない
              setVar(st.into, rre ? rsrc.replace(rre, rto) : rsrc);
            } else {
              var rfind = resolve(st.find, self, sc);
              setVar(st.into, rfind ? rsrc.split(rfind).join(rto) : rsrc);
            }
            break;
          }
          /*/replace*/
          /*#ledit*/
          case "list-edit": {
            if (!st.into) break;
            var lsep = st.sep || ",";
            var lcur = getVar(st.into);
            var parts = (Array.isArray(lcur) ? lcur.map(text) : text(lcur).split(lsep))
              .map(function (x) {
                return x.trim();
              })
              .filter(Boolean);
            var lv = resolve(st.value, self, sc).trim();
            if (lv) {
              var lat = parts.indexOf(lv);
              if (st.op === "remove" || (st.op === "toggle" && lat >= 0)) {
                parts = parts.filter(function (x) {
                  return x !== lv;
                });
              } else if (lat < 0) parts.push(lv);
            }
            setVar(st.into, parts.join(lsep));
            break;
          }
          /*/ledit*/
          /*#split*/
          case "split":
            setVar(
              st.into,
              resolve(st.source, self, sc)
                .split(st.sep || ",")
                .map(function (x) {
                  return x.trim();
                })
                .filter(Boolean)
            );
            break;
          /*/split*/
          /*#item*/
          case "array-find": {
            var list = getVar(st.array);
            var key = resolve(st.value, self, sc);
            var hit = null;
            if (Array.isArray(list) && st.field) {
              for (var fi = 0; fi < list.length; fi++) {
                var fv = dig(list[fi], st.field);
                var fs = fv == null ? "" : String(fv);
                if (fs === key || encodeURIComponent(fs) === key) {
                  hit = list[fi];
                  break;
                }
              }
            }
            setVar(st.into, hit);
            break;
          }
          case "array-field": {
            // 各要素に項目を足す（{項目} だけなら値をそのまま、ほかは文字にして入れる）
            var av = getVar(st.array);
            if (!Array.isArray(av) || !st.field) break;
            var one = /^\\{([^{}]+)\\}$/.exec(String(st.value || "").trim());
            /*#each*/
            // 同じ配列の要素ごとのくり返しの中では、くり返し中の要素だけに入れる
            var lp = cx;
            while (lp && lp.array !== st.array) lp = lp.up;
            if (lp) {
              var lo = {};
              for (var lk in lp.item) if (has(lp.item, lk)) lo[lk] = lp.item[lk];
              lo[st.field] = one ? lookup(one[1].trim(), self, sc) : resolve(st.value, self, sc);
              lp.item = lo;
              var lv2 = av.slice();
              lv2[lp.index] = lo;
              // リストの描き直しは、くり返しが終わったときに1回だけ
              writeVar(st.array, lv2);
              lp.run.dirty = true;
              break;
            }
            /*/each*/
            setVar(
              st.array,
              av.map(function (x) {
                if (x == null || Array.isArray(x)) return x;
                var it = typeof x === "object" ? x : { "値": x };
                var ao = {};
                for (var ak in it) if (has(it, ak)) ao[ak] = it[ak];
                var am = merged(sc, it);
                ao[st.field] = one ? lookup(one[1].trim(), self, am) : resolve(st.value, self, am);
                return ao;
              })
            );
            break;
          }
          case "count": {
            var ca = getVar(st.array);
            var cn = Array.isArray(ca) ? ca.length : 0;
            if (!Array.isArray(ca)) {
              try {
                var cl0 = root.querySelector('[data-array="' + CSS.escape(st.array) + '"]:not([data-client-list])');
                if (cl0) {
                  cn = Array.prototype.filter.call(cl0.children, function (w) {
                    return w.hasAttribute("data-item");
                  }).length;
                }
              } catch (e) {}
            }
            /*#filter*/
            // 件数は、いまかかっている絞り込みの後の数
            var cf = filters.get(st.array) || [];
            if (Array.isArray(ca)) {
              cn = itemsOf(ca).filter(function (x) {
                return passes(cf, x);
              }).length;
            } else {
              // 配信前に決まった配列は画面上に値が無いので、並べているリストの項目から数える
              var cl = listsOf(st.array).filter(function (l) {
                return !l.hasAttribute("data-client-list");
              })[0];
              if (cl) {
                cn = Array.prototype.filter.call(cl.children, function (w) {
                  return w.hasAttribute("data-item") && passes(cf, itemOf(w));
                }).length;
              }
            }
            /*/filter*/
            setVar(st.into, cn);
            break;
          }
          case "join": {
            var src = getVar(st.array);
            setVar(
              st.into,
              Array.isArray(src)
                ? src
                    .map(function (x) {
                      var v = st.field && x && typeof x === "object" ? dig(x, st.field) : x;
                      return v == null || typeof v === "object" ? "" : String(v);
                    })
                    .filter(function (x) {
                      return x !== "";
                    })
                    .join(st.sep || "")
                : text(src)
            );
            break;
          }
          /*/item*/
          /*#copy*/
          case "copy": {
            var tx = resolve(st.value, self, sc);
            var fallback = function () {
              var ta = document.createElement("textarea");
              ta.value = tx;
              ta.setAttribute("readonly", "");
              ta.style.position = "fixed";
              ta.style.opacity = "0";
              document.body.appendChild(ta);
              ta.select();
              try {
                document.execCommand("copy");
              } catch (e) {}
              document.body.removeChild(ta);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(tx).catch(fallback);
            } else {
              fallback();
            }
            break;
          }
          /*/copy*/
        }
      }
      /*#repeat*/
      // times 回（0 = ずっと）中のブロックをくり返す。ずっとのときは止まらないよう少し間をあける
      function loop(st, self, cx, n) {
        var times = Number(st.times) || 0;
        if (!alive || (times > 0 && n >= times)) return Promise.resolve();
        return runSteps(st.then, self, cx)
          .then(function () {
            return times > 0 ? null : sleep(0.05);
          })
          .then(function () {
            return loop(st, self, cx, n + 1);
          });
      }
      /*/repeat*/
      /*#each*/
      // 配列の要素ごとに中のブロックを動かす（くり返しの途中で格納した項目は次の要素から見える）
      function each(st, self, up, run, i) {
        var arr = getVar(st.array);
        if (!alive || !Array.isArray(arr) || i >= arr.length) {
          if (run.dirty) setVar(st.array, getVar(st.array));
          return Promise.resolve();
        }
        var x = arr[i];
        if (x == null || Array.isArray(x)) return each(st, self, up, run, i + 1);
        var cx = { array: st.array, index: i, item: typeof x === "object" ? x : { "値": x }, up: up, run: run };
        return runSteps(st.then, self, cx).then(function () {
          return each(st, self, up, run, i + 1);
        });
      }
      /*/each*/
      function runSteps(steps, self, cx) {
        var i = 0;
        function next() {
          while (alive && i < steps.length) {
            var st = steps[i++];
            /*#wait*/
            if (st.kind === "wait") return sleep(st.seconds).then(next);
            /*/wait*/
            /*#if*/
            if (st.kind === "if") {
              var branch = test(st.cond, self, scopeOf(cx)) ? st.then : st.else;
              if (branch && branch.length) {
                return runSteps(branch, self, cx).then(next);
              }
              continue;
            }
            /*/if*/
            /*#repeat*/
            if (st.kind === "repeat") {
              if (!st.then || !st.then.length) continue;
              return loop(st, self, cx, 0).then(next);
            }
            /*/repeat*/
            /*#each*/
            if (st.kind === "for-each") {
              if (!st.then || !st.then.length) continue;
              return each(st, self, cx, { dirty: false }, 0).then(next);
            }
            /*/each*/
            exec(st, self, cx);
          }
          return Promise.resolve();
        }
        return next();
      }
      // keep: 省略 = すべて / true・false = 「表示した要素の上も含める」のもの・それ以外だけ
      function fire(el, trigger, keep) {
        parse(el).forEach(function (s) {
          if (s.trigger !== trigger) return;
          /*#keep*/
          if (keep !== undefined && !!s.keep !== keep) return;
          /*/keep*/
          runSteps(s.steps || [], el);
        });
      }
      function chain(t) {
        var out = [];
        var el = t && t.nodeType === 1 ? t : t && t.parentElement;
        el = el && el.closest("[data-scripts]");
        while (el && root.contains(el)) {
          out.push(el);
          el = el.parentElement && el.parentElement.closest("[data-scripts]");
        }
        return out;
      }
      /*#click*/
      function clickSteps(el) {
        return parse(el).filter(function (s) {
          return s.trigger === "click";
        });
      }
      function opensPage(steps) {
        return (steps || []).some(function (st) {
          return st.kind === "open-page" || st.kind === "open-url" ||
            opensPage(st.then) || opensPage(st.else);
        });
      }
      // 押した場所から外側へたどって、最初に見つかる「クリックしたとき」を持つ要素
      function innerClick(t) {
        var els = chain(t);
        for (var i = 0; i < els.length; i++) if (clickSteps(els[i]).length) return els[i];
        return null;
      }
      // リンクの中のボタン（お気に入りなど）を押したときは、外側のリンクを開かない。
      // Next.js の Link は先に動くので、捕捉の段階で止める
      function onClickCapture(e) {
        var inner = innerClick(e.target);
        var a = inner && inner.parentElement && inner.parentElement.closest("a[href]");
        if (a && root.contains(a)) e.preventDefault();
      }
      function onClick(e) {
        var inner = null;
        chain(e.target).forEach(function (el) {
          var steps = clickSteps(el);
          // 内側で動いた要素があれば、外側の「ページを開く」は動かさない
          if (inner && steps.some(function (s) { return opensPage(s.steps); })) return;
          fire(el, "click");
          if (!inner && steps.length) inner = el;
        });
      }
      /*/click*/
      /*#hover*/
      /*#keep*/
      // 「ホバーし始めたとき」に表示する要素（メニューなど）
      function shownByHover(el) {
        var out = [];
        function walk(steps) {
          (steps || []).forEach(function (st) {
            if (st.kind === "show" || st.kind === "toggle") {
              find(el, st.target).forEach(function (t) {
                if (t !== el && out.indexOf(t) < 0) out.push(t);
              });
            } else if (st.kind === "if") {
              walk(st.then);
              walk(st.else);
            } else if (st.kind === "repeat" || st.kind === "for-each") {
              walk(st.then);
            }
          });
        }
        parse(el).forEach(function (s) {
          if (s.trigger === "hover-start") walk(s.steps);
        });
        return out;
      }
      function keepsHover(el) {
        return parse(el).some(function (s) {
          return s.trigger === "hover-end" && s.keep;
        });
      }
      // 「表示した要素の上も含める」要素 → 外れ判定のタイマー（null = 判定待ちなし）。
      // 表示した要素へカーソルが移っている間は「ホバーが外れた」としない
      var hovering = new Map();
      function leaveLater(el) {
        clearTimeout(hovering.get(el));
        hovering.set(
          el,
          setTimeout(function () {
            if (!alive || !hovering.has(el)) return;
            var still = [el].concat(shownByHover(el)).some(function (g) {
              return root.contains(g) && g.matches(":hover");
            });
            if (still) {
              hovering.set(el, null);
              return;
            }
            hovering.delete(el);
            fire(el, "hover-end", true);
          }, 150)
        );
      }
      /*/keep*/
      function onOver(e) {
        chain(e.target).forEach(function (el) {
          // 子要素間の移動では発火させない
          if (e.relatedTarget && el.contains(e.relatedTarget)) return;
          /*#keep*/
          if (hovering.has(el)) {
            // 表示したメニューなどから戻ってきた
            clearTimeout(hovering.get(el));
            hovering.set(el, null);
            return;
          }
          if (keepsHover(el)) hovering.set(el, null);
          /*/keep*/
          fire(el, "hover-start");
        });
      }
      function onOut(e) {
        /*#keep*/
        var done = [];
        /*/keep*/
        chain(e.target).forEach(function (el) {
          if (e.relatedTarget && el.contains(e.relatedTarget)) return;
          /*#keep*/
          if (hovering.has(el)) {
            done.push(el);
            leaveLater(el);
            fire(el, "hover-end", false);
            return;
          }
          /*/keep*/
          fire(el, "hover-end");
        });
        /*#keep*/
        // 表示したメニュー側から離れたときも、元の要素の外れ判定をする
        hovering.forEach(function (t, el) {
          if (t === null && done.indexOf(el) < 0) leaveLater(el);
        });
        /*/keep*/
      }
      /*/hover*/
      /*#change*/
      function onInput(e) {
        chain(e.target).forEach(function (el) {
          fire(el, "change");
        });
      }
      /*/change*/
      /*#inview*/
      var io =
        typeof IntersectionObserver !== "undefined"
          ? new IntersectionObserver(function (entries) {
              entries.forEach(function (en) {
                if (!en.isIntersecting) return;
                io.unobserve(en.target);
                fire(en.target, "in-view");
              });
            })
          : null;
      /*/inview*/
      /*#scan*/
      var seen = new WeakSet();
      // いま表示しているページ（公開サイトのページの目印 data-page-body）
      var pageId = null;
      function scan() {
        if (!alive) return;
        // Next.js のページ遷移でページが替わったら、前のページの変数・絞り込み・並べ替えを捨てる
        //（配列の名前はサイト全体で共通なので、残すと別のページのリストまで絞り込まれる）
        var body = root.querySelector("[data-page-body]");
        var pid = body ? body.getAttribute("data-page-body") : null;
        if (pid !== pageId) {
          if (pageId !== null) {
            vars = {};
            /*#filter*/
            filters.clear();
            sorts.clear();
            /*/filter*/
          }
          pageId = pid;
        }
        /*#clist*/
        // 描き直された（まだ並べていない）リストを並べる
        root.querySelectorAll("[data-client-list]").forEach(function (list) {
          if (!rendered.has(list)) renderList(list);
        });
        /*/clist*/
        /*#filter*/
        // 描き直されたリストにも並べ替え・絞り込みをかけ直す
        if (sorts.size || filters.size) {
          root.querySelectorAll("[data-array]").forEach(function (list) {
            if (list.hasAttribute("data-client-list")) return;
            applySort(list);
            applyFilters(list);
          });
        }
        /*/filter*/
        root.querySelectorAll("[data-scripts]").forEach(function (el) {
          if (seen.has(el) || inTpl(el)) return;
          seen.add(el);
          var list = parse(el);
          /*#load*/
          if (list.some(function (s) { return s.trigger === "load"; })) {
            fire(el, "load");
          }
          /*/load*/
          /*#inview*/
          if (io && list.some(function (s) { return s.trigger === "in-view"; })) {
            io.observe(el);
          }
          /*/inview*/
        });
      }
      var queued = false;
      var mo = new MutationObserver(function () {
        if (queued) return;
        queued = true;
        requestAnimationFrame(function () {
          queued = false;
          scan();
        });
      });
      mo.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-scripts"],
      });
      scan();
      /*/scan*/
      /*#click*/
      root.addEventListener("click", onClickCapture, true);
      root.addEventListener("click", onClick);
      /*/click*/
      /*#hover*/
      root.addEventListener("mouseover", onOver);
      root.addEventListener("mouseout", onOut);
      /*/hover*/
      /*#change*/
      root.addEventListener("input", onInput);
      /*/change*/
      /*#live*/
      // 入力欄の値を使う {ID} の文字を、入力するたびに書き直す
      root.addEventListener("input", onLiveInput);
      refreshLive();
      /*/live*/
      return function dispose() {
        alive = false;
        /*#filter*/
        filters.clear();
        sorts.clear();
        /*/filter*/
        /*#keep*/
        hovering.forEach(function (t) {
          clearTimeout(t);
        });
        hovering.clear();
        /*/keep*/
        /*#scan*/
        mo.disconnect();
        /*/scan*/
        /*#inview*/
        if (io) io.disconnect();
        /*/inview*/
        /*#click*/
        root.removeEventListener("click", onClickCapture, true);
        root.removeEventListener("click", onClick);
        /*/click*/
        /*#hover*/
        root.removeEventListener("mouseover", onOver);
        root.removeEventListener("mouseout", onOut);
        /*/hover*/
        /*#change*/
        root.removeEventListener("input", onInput);
        /*/change*/
        /*#live*/
        root.removeEventListener("input", onLiveInput);
        /*/live*/
      };
    },
  };
}`;

/** ランタイムの差し替え口（省略時は素のDOM・画面遷移で動く） */
export interface ScriptEnv {
  /** 表示に戻すときの display 値 */
  showDisplay?: (el: HTMLElement) => string;
  openPage?: (step: { pageId: string; href: string; newTab?: boolean }) => void;
  openUrl?: (url: string, newTab: boolean) => void;
  /** true を返すと値の設定を引き受けたことになる */
  setValue?: (id: string, value: string) => boolean;
  /** 表示を変えた要素（プレビュー終了時の掃除用） */
  touch?: (el: HTMLElement) => void;
  /** 画面上の変数が変わった（プレビューでリストなどを描き直す） */
  setVar?: (name: string, value: unknown) => void;
  /** ストレージのキーの前に付ける文字（プレビューでエディタ自身の保存と混ざらないように） */
  storePrefix?: string;
  /** 共有ストレージのクッキーのドメイン（このドメインかそのサブドメインで開いたときだけ付ける） */
  sharedDomain?: string;
  /** ページ遷移を使わずブラウザの通常の移動にするURLのパターン（正規表現の文字列。hardNavPatterns） */
  hardNav?: string[];
}

export function createScriptRuntime(env: ScriptEnv): {
  install: (root: ParentNode & Node) => () => void;
} {
  return new Function(`return (${SCRIPT_RUNTIME})`)()(env);
}

/** ランタイムの機能名（SCRIPT_RUNTIME 内の `/*#名前*\/` と対応） */
type RuntimeFeature =
  | "env"
  | "live"
  | "click"
  | "hover"
  | "keep"
  | "change"
  | "load"
  | "inview"
  | "scan"
  | "show"
  | "scroll"
  | "go"
  | "set"
  | "filter"
  | "wait"
  | "if"
  | "store"
  | "split"
  | "ledit"
  | "setvar"
  | "calc"
  | "replace"
  | "item"
  | "copy"
  | "repeat"
  | "each"
  | "clist"
  | ScriptCond["subject"];

const STEP_FEATURE: Record<
  Exclude<ScriptStep["kind"], "fetch">,
  RuntimeFeature
> = {
  show: "show",
  hide: "show",
  toggle: "show",
  "scroll-to": "scroll",
  "open-page": "go",
  "open-url": "go",
  "set-value": "set",
  "set-enabled": "set",
  "filter-array": "filter",
  "unfilter-array": "filter",
  "sort-array": "filter",
  "store-save": "store",
  "store-load": "store",
  split: "split",
  "list-edit": "ledit",
  "set-var": "setvar",
  calc: "calc",
  replace: "replace",
  "array-find": "item",
  "array-field": "item",
  join: "item",
  count: "item",
  copy: "copy",
  wait: "wait",
  if: "if",
  repeat: "repeat",
  "for-each": "each",
};

const TRIGGER_FEATURE: Record<ScriptTrigger, RuntimeFeature> = {
  click: "click",
  "hover-start": "hover",
  "hover-end": "hover",
  change: "change",
  load: "load",
  "in-view": "inview",
};

/**
 * 入力欄の値を {ID} で使う文字・入力欄があるか（公開サイトでは、入力するたびにブラウザで書き直す）
 */
export function usesLiveFields(doc: SiteDoc): boolean {
  for (const page of Object.values(doc.pages)) {
    if (page.unpublished) continue;
    const ids = pageNodeIds(doc, page.id);
    const { clientVars } = pagePlan(doc, page.id);
    const live = new Set<string>(clientVars);
    for (const id of ids) {
      const n = doc.nodes[id];
      if (n?.type === "field") fieldVarNames(n).forEach((v) => live.add(v));
    }
    if (!live.size) continue;
    for (const id of ids) {
      const n = doc.nodes[id];
      const strs = [
        n?.text?.content,
        n?.field?.placeholder,
        n?.field?.defaultValue,
        n?.field?.label,
        ...(n?.field?.options ?? []),
      ];
      if (strs.some((t) => t && extractVars(t).some((v) => live.has(v.split(".")[0])))) return true;
    }
  }
  return false;
}

/** サイト内のスクリプトが使う機能 */
function runtimeFeatures(doc: SiteDoc): Set<RuntimeFeature> {
  const out = new Set<RuntimeFeature>();
  if (usesLiveFields(doc)) out.add("live");
  for (const s of allScripts(doc)) {
    if (!s.trigger || !s.steps.some((st) => !isDataStep(st))) continue;
    out.add(TRIGGER_FEATURE[s.trigger]);
    if (s.trigger === "hover-end" && s.keepOnShown) out.add("keep");
    walkSteps(s.steps, (st) => {
      if (isDataStep(st)) return;
      out.add(STEP_FEATURE[st.kind]);
      if (st.kind === "if") out.add(st.cond.subject);
    });
  }
  // 画面上で値が決まる配列を並べるリスト
  for (const page of Object.values(doc.pages)) {
    const { clientVars } = pagePlan(doc, page.id);
    if (!clientVars.size) continue;
    const hasClientList = pageNodeIds(doc, page.id).some((id) => {
      const n = doc.nodes[id];
      return n?.type === "list" && clientVars.has((listFromOf(n) ?? "").split(".")[0]);
    });
    if (hasClientList) out.add("clist");
  }
  // 要素の追加を見張るのは「開いたとき」「画面に入ったとき」・絞り込みの掛け直し・リストの描画だけ
  if (out.has("load") || out.has("inview") || out.has("filter") || out.has("clist")) {
    out.add("scan");
  }
  return out;
}

/** 使わない機能のブロックを削る（入れ子のブロックも処理する） */
function pickFeatures(src: string, on: Set<string>): string {
  return src.replace(
    /\/\*#([\w|-]+)\*\/([\s\S]*?)\/\*\/\1\*\//g,
    (_, names: string, body: string) =>
      names.split("|").some((n) => on.has(n)) ? pickFeatures(body, on) : ""
  );
}

/** 行コメント・インデント・空行を落とす（文の区切りは改行のまま残す） */
export function compactJs(src: string): string {
  return src
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//"))
    .join("\n");
}

/** 書き出しサイト用の /scripts.js（サイトで使う機能だけを含める） */
export function scriptsFile(doc: SiteDoc): string {
  const runtime = pickFeatures(SCRIPT_RUNTIME, runtimeFeatures(doc));
  const domain = sharedCookieDomain(doc);
  const hardNav = hardNavPatterns(Object.values(doc.pages));
  const envObj = {
    ...(domain ? { sharedDomain: domain } : {}),
    ...(hardNav.length ? { hardNav } : {}),
  };
  const env = Object.keys(envObj).length ? JSON.stringify(envObj) : "";
  return compactJs(`(${runtime})(${env}).install(document);`) + "\n";
}

/** 共有ストレージのクッキーのドメイン（公開URLのホスト。先頭の www. は除く） */
export function sharedCookieDomain(doc: SiteDoc): string {
  try {
    const host = new URL(doc.siteUrl ?? "").hostname;
    return host.replace(/^www\./, "");
  } catch {
    return "";
  }
}
