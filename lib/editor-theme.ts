"use client";

import { useEffect, useSyncExternalStore } from "react";
import { storageKey } from "./storage-keys";

/** エディターの UI だけに適用し、公開サイトのスタイルとは切り離す。 */
export type EditorThemePreference = "system" | "light" | "dark";
const STORAGE_KEY = storageKey("editor-appearance");
let selected: EditorThemePreference | null = null;
const listeners = new Set<() => void>();

function storedPreference(): EditorThemePreference {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark") return value;
  } catch { /* Storage may be unavailable. */ }
  return "system";
}

function snapshot(): EditorThemePreference {
  if (selected === null && typeof window !== "undefined") selected = storedPreference();
  return selected ?? "system";
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  selected = storedPreference();
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function useEditorThemePreference(): EditorThemePreference {
  return useSyncExternalStore(subscribe, snapshot, () => "system");
}

export function setEditorThemePreference(preference: EditorThemePreference) {
  selected = preference;
  try { window.localStorage.setItem(STORAGE_KEY, preference); } catch { /* Storage is optional. */ }
  notify();
}

/** 画面全体のモーダルやポップオーバーにも UI の配色を反映する。 */
export function useApplyEditorTheme() {
  const preference = useEditorThemePreference();
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.editorTheme =
        preference === "system" ? (media.matches ? "dark" : "light") : preference;
    };
    apply();
    media.addEventListener("change", apply);
    return () => {
      media.removeEventListener("change", apply);
      delete document.documentElement.dataset.editorTheme;
    };
  }, [preference]);
}
