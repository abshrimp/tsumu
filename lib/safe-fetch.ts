/**
 * ユーザーが指定したURLをサーバーから取得する（SSRF対策）。
 * - http(s) だけ。サーバー自身・社内ネットワーク・クラウドのメタデータなど、公開されていない宛先には送らない
 * - リダイレクトは1回ずつ宛先を確かめて追う（公開URLから内部の宛先へ転送されても届かない）
 * - 本文は上限までしか読まない
 */

/** 公開されていない宛先として拒否するホスト名か（IPアドレスの書き方は URL が正規化したもの） */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  if (!host || host.includes("..")) return true;
  if (host.startsWith("[")) return isPrivateIPv6(host.slice(1, -1));
  const v4 = parseIPv4(host);
  if (v4) return isPrivateIPv4(v4);
  // 「.」の無い名前（metadata・db など）は社内の名前解決で内部の機械を指す
  if (!host.includes(".")) return true;
  return /(^|\.)(localhost|local|internal|intranet|lan|home\.arpa|localdomain)$/.test(host);
}

function parseIPv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

function isPrivateIPv4([a, b]: number[]): boolean {
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || // キャリアグレードNAT
    (a === 169 && b === 254) || // リンクローカル・クラウドのメタデータ
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function isPrivateIPv6(addr: string): boolean {
  // DNS の返す省略形・ゼロ埋め表記も URL と同じ形で判定する。
  let a: string;
  try { a = new URL(`http://[${addr}]/`).hostname.slice(1, -1); }
  catch { return true; }
  // :: で始まる（未指定・ループバック・IPv4 埋め込み）、ユニークローカル、リンク/サイトローカル、マルチキャスト、NAT64、6to4、ドキュメント用
  if (
    !/^[23]/.test(a) || a.startsWith("2001:") ||
    /^(fc|fd|fe[89abcf]|ff|64:ff9b:|2002:|2001:db8:|100::)/.test(a)
  ) {
    return true;
  }
  // 0 を省かずに書いた未指定・ループバック（0:0:0:0:0:0:0:0 / 0:0:0:0:0:0:0:1）および IPv4 対応アドレス
  return (
    /^0{1,4}(:0{1,4}){6}:0{0,3}[01]$/.test(a) ||
    /^0{1,4}(:0{1,4}){4}:(ffff|0{1,4}):/.test(a)
  );
}

/** 名前解決した先が内部の宛先でないか（Node.js で動くときだけ確かめられる） */
async function resolvesPrivate(hostname: string): Promise<boolean> {
  if (hostname.startsWith("[") || parseIPv4(hostname)) return false;
  if (isWorker()) return false;
  const { lookup } = builtin<typeof import("node:dns/promises")>("node:dns/promises");
  try {
    const addrs = await lookup(hostname, { all: true });
    return !addrs.length || addrs.some((r) => (r.family === 6 ? isPrivateIPv6(r.address) : isPrivateHost(r.address)));
  } catch {
    throw new BlockedUrlError("DNS lookup failed");
  }
}

function isWorker(): boolean {
  return globalThis.navigator?.userAgent === "Cloudflare-Workers";
}

// 静的 import は Edge/Workers 用のバンドルにも入るため、Node の組み込みだけを実行時に読む。
function builtin<T>(name: string): T {
  const load = globalThis.process?.getBuiltinModule;
  if (!load) throw new BlockedUrlError("safe network transport unavailable");
  return load(name) as T;
}

/**
 * Node では実際に接続する際の DNS 結果を検査する。
 * 事前の検査だけだと、検査後の再解決で内部IPに切り替える DNS rebinding が通ってしまう。
 * Workers はプラットフォームの公開ネットワーク用 fetch を使う。
 */
async function fetchOnce(url: URL, init: RequestInit): Promise<Response> {
  if (isWorker() || url.hostname.startsWith("[") || parseIPv4(url.hostname)) return fetch(url, init);
  const http = builtin<typeof import("node:http")>(url.protocol === "https:" ? "node:https" : "node:http");
  const dns = builtin<typeof import("node:dns/promises")>("node:dns/promises");
  const zlib = builtin<typeof import("node:zlib")>("node:zlib");
  const headers = new Headers(init.headers);
  headers.set("accept-encoding", "identity");
  if (init.body != null && typeof init.body !== "string") throw new BlockedUrlError("unsupported request body");
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: init.method, headers: Object.fromEntries(headers), agent: false,
      signal: init.signal ?? undefined,
      lookup(host, options, callback) {
        dns.lookup(host, { all: true }).then((addresses) => {
          if (!addresses.length || addresses.some((r) => isPrivateHost(r.family === 6 ? `[${r.address}]` : r.address))) {
            callback(new BlockedUrlError("private DNS address"), "", 4);
            return;
          }
          const candidates = options.family ? addresses.filter((r) => r.family === options.family) : addresses;
          if (!candidates.length) { callback(new BlockedUrlError("no public address"), "", 4); return; }
          // この結果をソケットに渡す。別の名前解決や、検査を省略した再試行はしない。
          if (options.all) callback(null, candidates);
          else callback(null, candidates[0].address, candidates[0].family);
        }).catch((e: Error) => callback(e, "", 4));
      },
    }, (res) => {
      const responseHeaders = new Headers();
      for (const [k, v] of Object.entries(res.headers)) {
        if (v !== undefined) responseHeaders.set(k, Array.isArray(v) ? v.join(", ") : v);
      }
      const status = res.statusCode ?? 502;
      if ([301, 302, 303, 307, 308].includes(status) || init.method === "HEAD" || [204, 205, 304].includes(status)) {
        res.destroy();
        resolve(new Response(null, { status, headers: responseHeaders }));
        return;
      }
      // 圧縮された応答も展開後の大きさで制限する。
      const encoding = responseHeaders.get("content-encoding")?.toLowerCase();
      const decoder = encoding === "gzip" ? zlib.createGunzip() : encoding === "deflate" ? zlib.createInflate() : encoding === "br" ? zlib.createBrotliDecompress() : null;
      const stream = decoder ? res.pipe(decoder) : res;
      res.on("error", (e) => { decoder?.destroy(e); reject(e); });
      void (async () => {
        try {
          const chunks: Uint8Array[] = [];
          let size = 0;
          for await (const chunk of stream) {
            size += chunk.length;
            if (size > 5 * 1024 * 1024) throw new TooLargeError("too large");
            chunks.push(chunk);
          }
          responseHeaders.delete("content-encoding");
          responseHeaders.delete("content-length");
          resolve(new Response(new Blob(chunks as BlobPart[]), { status, headers: responseHeaders }));
        } catch (e) { req.destroy(); stream.destroy(); reject(e); }
      })();
    });
    req.on("error", reject);
    req.end(init.body ?? undefined);
  });
}

export class BlockedUrlError extends Error {}
export class TooLargeError extends Error {}

/** 送ってよいURLか確かめる（だめなら BlockedUrlError） */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError("invalid url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BlockedUrlError("protocol");
  if (url.username || url.password) throw new BlockedUrlError("credentials");
  if (isPrivateHost(url.hostname) || (await resolvesPrivate(url.hostname))) {
    throw new BlockedUrlError("private host");
  }
  return url;
}

/** リダイレクトを1回ずつ確かめながら取得する */
export async function fetchPublic(
  raw: string,
  init: RequestInit,
  maxRedirects = 5
): Promise<Response> {
  let url = await assertPublicUrl(raw);
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;
  const headers = new Headers(init.headers);
  // 接続先やHTTPフレーミングを呼び出し側のヘッダーで上書きさせない。
  for (const name of ["host", "connection", "content-length", "transfer-encoding", "upgrade", "proxy-authorization", "proxy-connection"]) headers.delete(name);
  const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
  for (let i = 0; ; i++) {
    const res = await fetchOnce(url, { ...init, signal, headers, method, body, redirect: "manual" });
    const location = res.headers.get("location");
    if (![301, 302, 303, 307, 308].includes(res.status) || !location) return res;
    await res.body?.cancel().catch(() => {});
    if (i >= maxRedirects) throw new BlockedUrlError("too many redirects");
    const next = await assertPublicUrl(new URL(location, url).toString());
    // 任意のヘッダーや本文には API キーなどが入るため、別オリジンへは転送しない。
    // 認証のない GET/HEAD の転送だけ許す（プロトコル・ポートの変更も別オリジン）。
    if (next.origin !== url.origin) {
      if (body != null || [...headers.keys()].some((name) => !["accept", "accept-language"].includes(name))) {
        throw new BlockedUrlError("cross-origin redirect with credentials or body");
      }
      if (method !== "GET" && method !== "HEAD") throw new BlockedUrlError("cross-origin write redirect");
    }
    // 303 と、POST の 301・302 は GET で取り直す（ブラウザと同じ）
    if ((res.status === 303 && method !== "HEAD") || ((res.status === 301 || res.status === 302) && method === "POST")) {
      method = "GET";
      body = undefined;
      for (const name of ["content-type", "content-length", "content-encoding", "content-language", "content-location"]) headers.delete(name);
    }
    url = next;
  }
}

/** 本文を上限まで読む（超えたら TooLargeError。Content-Length が無い・偽っていても上限で止める） */
export async function readTextLimited(res: Response, maxBytes: number): Promise<string> {
  if (Number(res.headers.get("content-length")) > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new TooLargeError("too large");
  }
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0;
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new TooLargeError("too large");
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}
