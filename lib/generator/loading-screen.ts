import type { LoadingScreenSetting } from "../types";

export function loadingScreenCss(setting: LoadingScreenSetting): string {
  return `
[data-site-loading] {
  position: fixed; inset: 0; z-index: 2147483647; overflow: auto;
  background: #fff; color: #18181b; transition: opacity ${Math.max(0, setting.fadeDuration ?? 300)}ms ease;
}
[data-site-loading][hidden] { display: none; }
@media (scripting: none) { [data-site-loading] { display: none; } }
[data-site-loading-spinner] { min-height: 100vh; display: grid; place-items: center; }
[data-site-loading-spinner]::after {
  content: ""; box-sizing: border-box; width: 32px; height: 32px;
  border: 3px solid currentColor; border-right-color: transparent; border-radius: 50%;
  animation: loading-spin 700ms linear infinite;
}
@keyframes loading-spin { to { transform: rotate(360deg); } }
`;
}

/** Shared by the static document and the generated React component. */
export function loadingScreenController(setting: LoadingScreenSetting, typed: boolean): string {
  const type = typed ? ": () => void" : "";
  return `function startLoadingScreen(overlay${typed ? ": HTMLElement" : ""}, show${type}, dismiss${type}, scope = "/") {
  const storageKey = "site-loading-shown:" + scope;
  const once = ${!!setting.showOnce};
  if (once) {
    try {
      if (sessionStorage.getItem(storageKey) === "1") { dismiss(); return; }
    } catch { /* Storage may be unavailable on file URLs. */ }
  }
  const started = Date.now();
  const body = document.body;
  const previousOverflow = body.style.overflow;
  show();
  body.style.overflow = "hidden";
  let fadeTimer = 0, hideTimer = 0;
  let locked = true;
  function unlock() {
    if (!locked) return;
    locked = false;
    if (body.style.overflow === "hidden") body.style.overflow = previousOverflow;
  }
  function finish() {
    fadeTimer = window.setTimeout(() => {
      overlay.style.opacity = "0";
      overlay.style.pointerEvents = "none";
      if (once) {
        try { sessionStorage.setItem(storageKey, "1"); } catch { /* Continue without storage. */ }
      }
      hideTimer = window.setTimeout(() => { unlock(); dismiss(); }, ${Math.max(0, setting.fadeDuration ?? 300)});
    }, Math.max(0, ${Math.max(0, setting.minDuration ?? 500)} - (Date.now() - started)));
  }
  if (document.readyState === "complete") finish();
  else window.addEventListener("load", finish, { once: true });
  return () => {
    window.removeEventListener("load", finish);
    window.clearTimeout(fadeTimer);
    window.clearTimeout(hideTimer);
    unlock();
  };
}`;
}

export function staticLoadingScript(setting: LoadingScreenSetting): string {
  return `(() => {
  ${loadingScreenController(setting, false)}
  const script = document.currentScript;
  const template = script?.previousElementSibling;
  if (!(template instanceof HTMLTemplateElement)) return;
  const overlay = template.content.firstElementChild;
  if (!(overlay instanceof HTMLElement)) return;
  // A packed HTML file uses a data URL for this script. A site's external runtime
  // resides at the root shared by all its pages, even when hosted in a subdirectory.
  const scope = script.src && !script.src.startsWith("data:") ? new URL(".", script.src).pathname : location.pathname;
  startLoadingScreen(overlay, () => template.replaceWith(overlay), () => { template.remove(); overlay.remove(); }, scope);
})();
`;
}
