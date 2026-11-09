"use client";

import { useEffect, useSyncExternalStore } from "react";
import { readLocalStorage, writeLocalStorage } from "./local-storage";
import { storageKey } from "./storage-keys";

/** エディターの UI だけに適用し、公開サイトのスタイルとは切り離す。 */
type EditorThemePreference = "system" | "light" | "dark";
const STORAGE_KEY = storageKey("editor-appearance");
let selected: EditorThemePreference | null = null;
const listeners = new Set<() => void>();
let activeThemeEffects = 0;

function storedPreference(): EditorThemePreference {
  const value = readLocalStorage(STORAGE_KEY);
  return value === "light" || value === "dark" ? value : "system";
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
  writeLocalStorage(STORAGE_KEY, preference);
  notify();
}

/** 画面全体のモーダルやポップオーバーにも UI の配色を反映する。 */
export function useApplyEditorTheme() {
  const preference = useEditorThemePreference();
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    activeThemeEffects++;
    const apply = () => {
      document.documentElement.dataset.editorTheme =
        preference === "system" ? (media.matches ? "dark" : "light") : preference;
    };
    apply();
    media.addEventListener("change", apply);
    return () => {
      media.removeEventListener("change", apply);
      // The loading page and the editor can overlap briefly; keep the theme
      // until every mounted appearance owner has gone away.
      activeThemeEffects--;
      if (activeThemeEffects === 0) delete document.documentElement.dataset.editorTheme;
    };
  }, [preference]);
}
