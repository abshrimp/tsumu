"use client";

import { isEnterKey } from "../lib/keys";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toggleCommentMode } from "../lib/comment-store";
import { hydrateBrowserDoc, insertPointFor, persistDoc, useEditor } from "../lib/store";
import type { SiteDoc } from "../lib/types";
import { localSaveState, watchLocalSaveBlock, warnForDeletedLocalSave, type LocalSaveSnapshot } from "../lib/local-save";
import type {
  CollabClientMessage,
  CollabServerMessage,
  DocChangeMessage,
} from "../lib/collab";
import { applyDocPatchAtRevision } from "../lib/doc-patch";
import { shareUnchangedDoc } from "../lib/doc-share";
import { errorOf, scheduleCloudSave, sendCloudDoc, type CollabRequestInput, type DeferredCloudConflict } from "../lib/cloud-save";
import { mergeDocs } from "../lib/merge";
import { css2FamilyToken } from "../lib/style";
import {
  replaceEmbeddedAsset,
  uploadEmbeddedAsset,
} from "../lib/assets";
import { startImageInsertion } from "../lib/image-drop";
import { clipboardArtworkFile, hasClipboardArtwork } from "../lib/clipboard";
import { activeContentNames, clipboardPayload, isOwnClip } from "../lib/clip-transfer";
import { showAlert, showConfirm } from "../lib/dialog";
import EditorLoading from "./EditorLoading";
import Header from "./Header";
import Footer from "./Footer";
import LeftPanel from "./LeftPanel";
import Canvas from "./Canvas";
import RightPanel from "./RightPanel";
import LeaveAnimator from "./LeaveAnimator";
import DialogHost from "./DialogHost";
import ScriptEditor from "./ScriptEditor";
import TooltipLayer from "./Tooltip";
import Tutorial from "./Tutorial";
import HelpCenter from "./HelpCenter";
import AiChat from "./AiChat";
import GuideOverlay from "./GuideOverlay";
import { closeHelp, openHelp, stopGuide, toggleHelp, useHelp } from "../lib/help";
import { userMessage } from "../lib/errors";
import SafeBoundary from "./SafeBoundary";
import { getLang, tr } from "../lib/i18n";
import { readLocalStorage } from "../lib/local-storage";
import { useServerStatus } from "../lib/status";
import { currentSiteId, siteApi, siteKey } from "../lib/site";
import { installNoDblClickSelect } from "../lib/no-dblclick-select";
import { storageKey } from "../lib/storage-keys";
import { trackPanelResize } from "../lib/panel-resize";

const PANEL_MIN = { l: 200, r: 240 } as const;

function clampPanel(w: number, side: "l" | "r"): number {
  return Math.max(PANEL_MIN[side], Math.min(460, w));
}

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

/** サーバーへ未保存の変更が残っているか（ブラウザを閉じても残るフラグ） */
const UNSYNCED_KEY = siteKey(storageKey("unsynced-v1"));
/** 同時編集の WebSocket がつながるまで待つ時間（過ぎたら打ち切り、SSE・ポーリングで受け取る） */
const WS_OPEN_TIMEOUT_MS = 5000;
/** 一時的な失敗で保存できなかったときに、自動で保存し直すまでの間隔（失敗が続くと倍にしていく） */
const SAVE_RETRY_MIN_MS = 3000;
const SAVE_RETRY_MAX_MS = 60_000;
/** ヘルプを一度でも自動で開いたか（はじめての人にだけ開く） */
const HELP_SEEN_KEY = storageKey("help-seen-v1");

function setUnsyncedFlag(on: boolean) {
  try {
    if (on) window.localStorage.setItem(UNSYNCED_KEY, "1");
    else window.localStorage.removeItem(UNSYNCED_KEY);
  } catch {
    // 保存できなくても同期自体には影響しない
  }
}

/**
 * パネル間のつまみ。ドラッグで幅を変える（最小幅より狭くはならない。閉じるのはヘッダーのボタン・⌘[ ⌘]）。
 * dir は「右へ動かすとパネルが広がる」なら 1、狭まるなら -1。
 */
function PanelResizer({
  width,
  dir,
  side,
  onResize,
}: {
  width: number;
  dir: 1 | -1;
  side: "l" | "r";
  onResize: (w: number) => void;
}) {
  const resizeCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => resizeCleanup.current?.(), []);
  return (
    <div
      className="panel-resizer"
      onPointerDown={(e) => {
        if (e.button !== 0 || resizeCleanup.current) return;
        e.preventDefault();
        let cleanup: (() => void) | null = null;
        cleanup = trackPanelResize(
          e,
          e.currentTarget,
          width,
          dir,
          (nextWidth) => onResize(clampPanel(nextWidth, side)),
          () => {
            if (resizeCleanup.current === cleanup) resizeCleanup.current = null;
          },
        );
        resizeCleanup.current = cleanup;
      }}
    />
  );
}

export type EditorProps = { onReady?: () => void };

export default function Editor({ onReady }: EditorProps = {}) {
  // モジュール内の仮の初期データを見せず、最初の読み込み結果が決まるまで準備画面を保つ。
  // 再接続や保存中には戻さない（入力欄やキャンバスをアンマウントしない）。
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  useEffect(() => {
    if (!initialLoadComplete) return;
    const key = storageKey("import-warnings-v1") + ":" + currentSiteId();
    let warnings: unknown;
    try {
      const raw = window.sessionStorage.getItem(key);
      if (!raw) return;
      window.sessionStorage.removeItem(key);
      warnings = JSON.parse(raw);
    } catch { return; }
    if (!Array.isArray(warnings) || !warnings.length) return;
    const lines = warnings.filter((item): item is string => typeof item === "string");
    if (!lines.length) return;
    void showAlert(lines.slice(0, 20).join("\n") +
      (lines.length > 20 ? "\n" + tr("There are additional import notices.") : ""), {
      title: tr("Import notices"),
    });
  }, [initialLoadComplete]);
  // ページが準備画面を持つ場合は、描画前に完了を伝えて同じ画面を一度だけ閉じる。
  useLayoutEffect(() => {
    if (initialLoadComplete) onReady?.();
  }, [initialLoadComplete, onReady]);
  const doc = useEditor((s) => s.doc);
  const markSaved = useEditor((s) => s.markSaved);
  // 保存した版を覚え、次の編集を前の「保存済み」と取り違えない。
  const [localSave, setLocalSave] = useState<LocalSaveSnapshot | null>(null);
  const localSiteDeleted = useRef(false);
  const browserSaveState = localSaveState(localSave, doc);
  const cloudState = useEditor((s) => s.cloudState);
  // DB未設定と一時的な503を区別する。判定できない間は安全側で離脱を保護する。
  const browserOnly = useServerStatus()?.db === false;
  const localSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveLocalDoc = useCallback((snapshot: SiteDoc) => {
    const run = async () => {
      const attempt = localSiteDeleted.current ? "deleted" : await persistDoc(snapshot);
      const result = localSiteDeleted.current ? "deleted" : attempt;
      if (result === "deleted") localSiteDeleted.current = true;
      if (result === "saved") markSaved();
      else useEditor.setState({ savedAt: null });
      setLocalSave({ doc: snapshot, result });
    };
    // Serialize attempts so every write uses the last committed baseline.
    localSaveQueue.current = localSaveQueue.current.then(run, run);
  }, [markSaved]);
  useEffect(() => watchLocalSaveBlock((result) => {
    if (result === "deleted") localSiteDeleted.current = true;
    useEditor.setState({ savedAt: null });
    setLocalSave((previous) => previous?.result === "deleted" ? previous : { doc: useEditor.getState().doc, result });
  }), []);
  const mode = useEditor((s) => s.mode);
  const activePageId = useEditor((s) => s.activePageId);
  const scriptEditor = useEditor((s) => s.scriptEditor);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cloudTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 保存の応答を反映し終わるまで、次の保存は開始しない。 */
  const activeCloudSave = useRef<Promise<void> | null>(null);
  const cloudSaveQueued = useRef(false);
  const collabClientId = useRef(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const collabSocket = useRef<WebSocket | null>(null);
  const collabRequests = useRef(
    new Map<
      string,
      {
        resolve: (message: CollabServerMessage) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >()
  );
  const cloudReady = useRef(false);
  /** サーバー未保存のローカル変更があるか（ポーリング取り込みの抑止に使う） */
  const cloudDirty = useRef(false);
  /** 初回同期が完了する前の編集も未保存として残す。 */
  const observedDoc = useRef(doc);
  /** Hydration is a baseline read, not a new user edit. */
  const initialBrowserDocObserved = useRef(false);
  /** 最後に同期した版の識別子（自分の保存分を見分ける） */
  const lastSyncedRev = useRef<string | null>(null);
  /** 最後に同期した時点のドキュメント（三方向マージのベース） */
  const lastSyncedDoc = useRef<SiteDoc | null>(null);
  /** リモート取り込みによる doc 変更では自動保存（エコー）をしない */
  const skipNextCloudSave = useRef(false);
  /** テキスト編集中に競合したため、編集の確定後に保存し直す */
  const retrySaveAfterEdit = useRef(false);
  const deferredCloudConflict = useRef<DeferredCloudConflict | null>(null);
  /** 変更が無くても自動保存をもう一度動かすための番号 */
  const [saveRetry, setSaveRetry] = useState(0);
  /** 一時的な失敗のあとの、自動の保存し直しの予約と次の間隔 */
  const saveRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRetryDelay = useRef(SAVE_RETRY_MIN_MS);
  const retrySaveNow = useCallback(() => {
    if (saveRetryTimer.current) clearTimeout(saveRetryTimer.current);
    saveRetryTimer.current = null;
    setSaveRetry((n) => n + 1);
  }, []);
  const retrySaveLater = useCallback(() => {
    if (saveRetryTimer.current) return;
    saveRetryTimer.current = setTimeout(retrySaveNow, saveRetryDelay.current);
    saveRetryDelay.current = Math.min(saveRetryDelay.current * 2, SAVE_RETRY_MAX_MS);
  }, [retrySaveNow]);
  /** 起動時に検出した、ローカル未同期の変更とサーバー内容の競合 */
  const [conflict, setConflict] = useState<{
    doc: SiteDoc;
    rev: string | null;
    savedAt: number;
  } | null>(null);
  const [panelL, setPanelL] = useState(() =>
    clampPanel(Number(readLocalStorage("panel-l-w")) || 252, "l")
  );
  const [panelR, setPanelR] = useState(() =>
    clampPanel(Number(readLocalStorage("panel-r-w")) || 288, "r")
  );
  /** 左右パネルを閉じているか */
  const [closedL, setClosedL] = useState(() => readFlag("panel-l-closed"));
  const [closedR, setClosedR] = useState(() => readFlag("panel-r-closed"));
  /** 開閉の切り替え直後だけ幅をアニメーションする（ドラッグ中は追従を優先） */
  const [panelAnim, setPanelAnim] = useState(false);
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const togglePanel = useCallback((side: "l" | "r", open?: boolean) => {
    setPanelAnim(true);
    if (animTimer.current) clearTimeout(animTimer.current);
    animTimer.current = setTimeout(() => setPanelAnim(false), 260);
    (side === "l" ? setClosedL : setClosedR)((c) => (open === undefined ? !c : !open));
  }, []);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);
  const internalClipboardOwned = useRef(false);

  useEffect(() => {
    try {
      window.localStorage.setItem("panel-l-w", String(panelL));
      window.localStorage.setItem("panel-r-w", String(panelR));
      window.localStorage.setItem("panel-l-closed", closedL ? "1" : "0");
      window.localStorage.setItem("panel-r-closed", closedR ? "1" : "0");
    } catch {
      return;
    }
  }, [panelL, panelR, closedL, closedR]);

  useEffect(() => installNoDblClickSelect(), []);

  // 操作ガイドが案内する場所のあるパネルを開く（detail = "l" | "r"）
  useEffect(() => {
    const open = (e: Event) => {
      const side = (e as CustomEvent<"l" | "r">).detail;
      if (side === "l" || side === "r") togglePanel(side, true);
    };
    window.addEventListener("tsumu-open-panel", open);
    return () => window.removeEventListener("tsumu-open-panel", open);
  }, [togglePanel]);

  // 入力中の欄の外を押したら、先に確定させる。
  // キャンバスはフォーム部品へのフォーカスを止めるため mousedown の既定動作を取り消しており、
  // そのままだと入力欄が blur されず、選択が変わったときに入力した値が失われる
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body) return;
      const editable =
        active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable;
      if (!editable) return;
      const t = e.target as Element | null;
      if (!t || active.contains(t)) return;
      // 変数の候補など、入力欄にフォーカスを残したまま押すもの
      if (t.closest?.(".var-comp, [data-keep-focus]")) return;
      active.blur();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, []);

  // はじめてエディタを開いたときは、使い方を探せるヘルプを開いておく
  useEffect(() => {
    if (!initialLoadComplete) return;
    try {
      if (window.localStorage.getItem(HELP_SEEN_KEY)) return;
    } catch {
      return;
    }
    // 開いたことを記録するのは実際に開くとき（開発時の StrictMode で effect が2回動いても開くように）
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(HELP_SEEN_KEY, "1");
      } catch {
        // 記録できなくても開く
      }
      openHelp();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [initialLoadComplete]);

  // ⌘[ / ⌘] で左右のパネルを開閉
  useEffect(() => {
    if (!initialLoadComplete) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key !== "[" && e.key !== "]") return;
      if (useEditor.getState().mode !== "design") return;
      e.preventDefault();
      togglePanel(e.key === "[" ? "l" : "r");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePanel, initialLoadComplete]);

  useEffect(() => {
    const ownClipboard = () => {
      internalClipboardOwned.current = true;
    };
    const releaseClipboard = () => {
      internalClipboardOwned.current = false;
    };
    window.addEventListener("tsumu-internal-copy", ownClipboard);
    window.addEventListener("blur", releaseClipboard);
    // テキストをコピーしたら、次の貼り付けはそのテキストにする
    window.addEventListener("copy", releaseClipboard);
    window.addEventListener("cut", releaseClipboard);
    return () => {
      window.removeEventListener("tsumu-internal-copy", ownClipboard);
      window.removeEventListener("blur", releaseClipboard);
      window.removeEventListener("copy", releaseClipboard);
      window.removeEventListener("cut", releaseClipboard);
    };
  }, []);

  useEffect(() => {
    if (!pasteNotice) return;
    const timer = window.setTimeout(() => setPasteNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [pasteNotice]);

  useEffect(() => {
    if (!initialLoadComplete) return;
    const pending = new Set<ReturnType<typeof startImageInsertion>>();
    let mounted = true;
    let latestPaste = 0;
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }
      // ネイティブの貼り付けも、ショートカットと同じく編集中の画面だけを対象にする。
      // Ctrl+Vを横取りしないプレビュー・モーダルで、背後の文書を変更しない。
      if (
        useEditor.getState().mode !== "design" ||
        document.querySelector(".se-backdrop, .modal-backdrop:not(.is-leaving)")
      ) return;
      const data = event.clipboardData;
      if (!data) return;
      const own = ++latestPaste;
      // Clipboard API が利用できずコピー形式が空の場合だけ、エディタ内の控えを使う。
      // 画像や外部テキストを持つ貼り付けは必ずOS側の内容を優先する。
      if (data.types.length === 0 && internalClipboardOwned.current && useEditor.getState().clipboard) {
        event.preventDefault();
        useEditor.getState().pasteClipboard();
        return;
      }
      // エディタでコピーした要素（ほかのサイト・タブでコピーしたものも）
      const clip = clipboardPayload(data);
      if (clip) {
        const { payload: copied, raw } = clip;
        event.preventDefault();
        const paste = () => {
          useEditor.getState().pasteClipboard(copied);
          if (copied.site !== currentSiteId()) setPasteNotice(tr("Pasted elements from another site"));
        };
        // このブラウザのエディタでコピーしたものでなければ（ほかのWebサイトが書き込んだかもしれない）、
        // 貼り付けるとすぐ動く HTML（カスタムコード・アイコン）を含むときは確かめる
        const active = isOwnClip(raw) ? [] : activeContentNames(copied);
        if (!active.length) {
          paste();
          return;
        }
        const destination = useEditor.getState();
        void showConfirm(
          tr("The elements you're pasting contain content that runs as HTML ({names}), and they weren't copied in this editor. Only paste data you copied from a source you trust.", {
            names: active.slice(0, 3).join(tr(", ")) + (active.length > 3 ? tr("and {count} more", { count: active.length - 3 }) : ""),
          }),
          { title: tr("Paste this content?"), okLabel: tr("Paste", "paste_variant_1"), danger: true }
        ).then((ok) => {
          const now = useEditor.getState();
          if (ok && mounted && own === latestPaste &&
              now.doc === destination.doc && now.historyRevision === destination.historyRevision &&
              now.activePageId === destination.activePageId && now.selection === destination.selection &&
              now.selectedIds === destination.selectedIds && now.editingComponentId === destination.editingComponentId &&
              now.insertMode === destination.insertMode && now.mode === "design" &&
              now.scriptEditor === destination.scriptEditor) paste();
        });
        return;
      }
      if (!hasClipboardArtwork(data)) {
        if (Array.from(data.types).some((type) => /figma|illustrator|aicb|pdf/i.test(type))) {
          event.preventDefault();
          setPasteNotice(tr("In Figma use \"Copy as SVG\"; in Illustrator, enable \"Include SVG code\" when copying"));
        }
        return;
      }
      event.preventDefault();
      setPasteNotice(tr("Pasting design…"));
      // SVG・ファイル・data URLの読み取りを待つ前に、貼り付け先を確定する。
      const state = useEditor.getState();
      const { doc, selection, activePageId, editingComponentId } = state;
      const component = editingComponentId ? doc.components?.[editingComponentId] : null;
      const point = insertPointFor(doc, selection,
        component ? { kind: "node", id: component.rootId } : { kind: "page", id: activePageId }, state.insertMode);
      const task = startImageInsertion(async () => {
        const file = await clipboardArtworkFile(data);
        if (!file) throw new Error(tr("Couldn't read the image data"));
        return [file];
      }, point, {
        quiet: true,
        prepareNode(node, asset, file) {
          node.name = file.type === "image/svg+xml" ? tr("Pasted SVG") : tr("Pasted image");
          const base = (node.styles.base ??= {});
          base.default = { ...base.default, width: asset.width ? `${asset.width}px` : "100%", maxWidth: "100%", borderRadius: "0px" };
        },
      });
      pending.add(task);
      void task.done.then(({ inserted, files, error }) => {
        pending.delete(task);
        if (!mounted || own !== latestPaste) return;
        setPasteNotice(error ? userMessage(error, tr("Couldn't paste")) : !inserted ? null :
          files[0]?.type === "image/svg+xml" ? tr("Pasted the SVG as a vector image") : tr("Image pasted"));
      });
    };
    window.addEventListener("paste", onPaste);
    return () => {
      mounted = false;
      window.removeEventListener("paste", onPaste);
      for (const task of pending) task.cancel();
    };
  }, [initialLoadComplete]);

  // カスタムGoogle Fontsをエディタのプレビュー用に読み込む
  useEffect(() => {
    const families = doc.customFonts ?? [];
    const id = "custom-google-fonts";
    let link = document.getElementById(id) as HTMLLinkElement | null;
    if (!families.length) {
      link?.remove();
      return;
    }
    const href = `https://fonts.googleapis.com/css2?${families
      .map(css2FamilyToken)
      .join("&")}&display=swap`;
    if (!link) {
      link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    if (link.href !== href) link.href = href;
  }, [doc.customFonts]);

  // 自動保存（500msデバウンス、IndexedDB）
  useEffect(() => {
    if (!initialLoadComplete) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveLocalDoc(doc);
    }, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [doc, saveLocalDoc, initialLoadComplete]);

  const requestViaWebSocket = useCallback(
    (input: CollabRequestInput): Promise<CollabServerMessage> => {
      const socket = collabSocket.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error("WebSocket is not connected"));
      }
      const requestId = crypto.randomUUID();
      const message = { ...input, requestId } as CollabClientMessage;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          collabRequests.current.delete(requestId);
          reject(new Error("WebSocket request timed out"));
        }, 15000);
        collabRequests.current.set(requestId, { resolve, reject, timer });
        try {
          socket.send(JSON.stringify(message));
        } catch (error) {
          clearTimeout(timer);
          collabRequests.current.delete(requestId);
          reject(error instanceof Error ? error : new Error(tr("Couldn't send")));
        }
      });
    },
    []
  );

  const waitForWebSocket = useCallback(async (): Promise<boolean> => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (collabSocket.current?.readyState === WebSocket.OPEN) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  }, []);

  const loadCloudDoc = useCallback(async (): Promise<Record<string, any>> => {
    if (await waitForWebSocket()) {
      try {
        const message = await requestViaWebSocket({ type: "load" });
        if (message.type === "snapshot") return message;
        if (message.type === "error") throw new Error(message.message);
      } catch {
        // 接続が切れた場合はHTTPへフォールバック
      }
    }
    const response = await fetch(siteApi("/api/doc"));
    if (!response.ok) {
      const error = new Error(String(response.status));
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }
    return response.json();
  }, [requestViaWebSocket, waitForWebSocket]);

  const saveCloudDoc = useCallback(
    (snapshot: SiteDoc, base: string | null, baseDoc?: SiteDoc) =>
      sendCloudDoc({
        collabSocket,
        clientId: collabClientId.current,
        requestViaWebSocket,
        savedAt: () => useEditor.getState().cloudSavedAt,
      }, snapshot, base, baseDoc),
    [requestViaWebSocket]
  );

  // 起動時：サーバーのドキュメントを取得（あれば正とする）
  const runSyncFromServer = useCallback(async () => {
    await hydrateBrowserDoc();
    const s = useEditor.getState();
    const localBeforeLoad = s.doc;
    // IndexedDB hydration changes the store reference, but is not an unsynced edit.
    // Observe it before reconciliation, without clearing a genuine unsynced flag.
    if (!initialBrowserDocObserved.current) {
      observedDoc.current = localBeforeLoad;
      initialBrowserDocObserved.current = true;
    }
    cloudReady.current = false;
    if (cloudTimer.current) clearTimeout(cloudTimer.current);
    s.setCloud("checking");
    try {
      // 再接続時も、進行中の保存が確定してから最新版を読み込む。
      await activeCloudSave.current;
      const data = await loadCloudDoc();
      if (data.exists === true) {
        // 壊れた応答を「サーバーが空」と扱って初期データを保存しない。
        if (!data.rev || !data.doc?.pages || !data.doc?.nodes || !data.doc?.pageOrder?.length) {
          throw new Error("Invalid document snapshot");
        }
        let unsynced = false;
        try {
          unsynced = window.localStorage.getItem(UNSYNCED_KEY) === "1";
        } catch {
          unsynced = false;
        }
        const local = useEditor.getState().doc;
        if (
          (unsynced || cloudDirty.current || local !== localBeforeLoad) &&
          JSON.stringify(local) !== JSON.stringify(data.doc)
        ) {
          const baseDoc = lastSyncedDoc.current;
          if (!baseDoc) {
            // 前回のローカル変更がサーバー未保存のまま残っていて、どの版から編集したか
            // 分からなければ、どちらを使うかユーザーに選ばせる（cloudReady は選択まで立てない）
            setConflict({
              doc: data.doc,
              rev: data.rev ?? null,
              savedAt: data.savedAt,
            });
            return;
          }
          // 同期した版が分かっていれば（編集中の再接続など）、自動保存の競合と同じく三方向マージする。
          // 二択にすると、他の人の変更を上書きで消すか、自分の変更を捨てるしかなくなる
          lastSyncedRev.current = data.rev;
          lastSyncedDoc.current = data.doc;
          s.applyRemoteDoc(mergeDocs(baseDoc, local, data.doc));
          s.setCloud("saving");
        } else {
          setUnsyncedFlag(false);
          cloudDirty.current = false;
          lastSyncedRev.current = data.rev ?? null;
          lastSyncedDoc.current = data.doc;
          skipNextCloudSave.current = true;
          s.replaceDoc(data.doc);
          s.setCloud("synced", data.savedAt);
        }
      } else if (data.exists === false) {
        // サーバーが空 → 手元のドキュメントを初回アップロード
        const snapshot = useEditor.getState().doc;
        const put = await saveCloudDoc(snapshot, null);
        if (put.ok) {
          lastSyncedRev.current = put.data.rev ?? null;
          lastSyncedDoc.current = snapshot;
          cloudDirty.current = useEditor.getState().doc !== snapshot;
          setUnsyncedFlag(cloudDirty.current);
          s.setCloud("synced", put.data.savedAt ?? Date.now());
          if (cloudDirty.current) setSaveRetry((n) => n + 1);
        } else if (put.status === 409 && put.data.doc && put.data.rev) {
          // 空であることを確認した後、他の編集者が先に保存した。
          setConflict({ doc: put.data.doc, rev: put.data.rev, savedAt: put.data.savedAt });
          return;
        } else {
          s.setCloud("error", undefined, errorOf(put));
          return;
        }
      } else {
        throw new Error("Invalid document snapshot");
      }
      cloudReady.current = true;
    } catch (error) {
      useEditor
        .getState()
        .setCloud(
          (error as Error & { status?: number }).status === 503
            ? "local"
            : "error"
        );
      // 読み込み失敗後は版が不明なため、自動保存を許可しない。
    } finally {
      // オフライン・取得失敗・競合でも、手元の内容と既存の復旧操作は使えるようにする。
      setInitialLoadComplete(true);
    }
  }, [loadCloudDoc, saveCloudDoc]);

  /** 実行中の起動時同期（重ねて呼ばれたら同じものを待つ） */
  const syncing = useRef<Promise<void> | null>(null);
  // 2つ目が後から終わると、1つ目の取り込み後に始まった保存を「未保存の変更」と
  // 取り違えて競合の確認を出してしまうため、同時には1つだけ動かす
  //（開発時の StrictMode では起動時の処理が2回呼ばれる）
  const syncFromServer = useCallback((): Promise<void> => {
    syncing.current ??= runSyncFromServer().finally(() => {
      syncing.current = null;
    });
    return syncing.current;
  }, [runSyncFromServer]);

  /** 競合の解決: ローカルを正としてサーバーへ保存 or サーバー内容で置き換え */
  const resolveConflict = useCallback(
    async (which: "local" | "remote") => {
      if (!conflict) return;
      const s = useEditor.getState();
      setConflict(null);
      cloudReady.current = false;
      if (which === "remote") {
        setUnsyncedFlag(false);
        cloudDirty.current = false;
        lastSyncedRev.current = conflict.rev;
        lastSyncedDoc.current = conflict.doc;
        skipNextCloudSave.current = true;
        cloudReady.current = true;
        s.replaceDoc(conflict.doc);
        s.setCloud("synced", conflict.savedAt);
        return;
      }
      s.setCloud("saving");
      try {
        // 確認画面を開いた後の他の編集も、版の照合で保護する。
        if (!conflict.rev) throw new Error("Missing document revision");
        const snapshot = useEditor.getState().doc;
        const res = await saveCloudDoc(snapshot, conflict.rev);
        if (res.ok) {
          const data = res.data;
          lastSyncedRev.current = data.rev ?? null;
          lastSyncedDoc.current = snapshot;
          cloudDirty.current = useEditor.getState().doc !== snapshot;
          setUnsyncedFlag(cloudDirty.current);
          cloudReady.current = true;
          s.setCloud("synced", data.savedAt ?? Date.now());
          if (cloudDirty.current) setSaveRetry((n) => n + 1);
        } else if (res.status === 409 && res.data.doc && res.data.rev) {
          setConflict({ doc: res.data.doc, rev: res.data.rev, savedAt: res.data.savedAt });
          s.setCloud("checking");
        } else {
          s.setCloud("error", undefined, errorOf(res));
        }
      } catch {
        s.setCloud("error");
      }
    },
    [conflict, saveCloudDoc]
  );

  useEffect(() => {
    void syncFromServer();
    const onRetry = () => {
      // 同期した版が分かっていれば読み込み直さず、保存だけやり直す（他の人の変更とは409で自動マージする）
      if (cloudReady.current && lastSyncedRev.current && lastSyncedDoc.current) retrySaveNow();
      else void syncFromServer();
    };
    window.addEventListener("cloud-sync-retry", onRetry);
    return () => window.removeEventListener("cloud-sync-retry", onRetry);
  }, [syncFromServer, retrySaveNow]);

  // 変更をサーバーへ自動保存（800msデバウンス）。
  // 起動時のIndexedDB読込とサーバーからの初期取得は、ユーザー編集ではない。
  useEffect(() => {
    if (!initialLoadComplete) return;
    return scheduleCloudSave({
      observedDoc, cloudReady, cloudDirty, skipNextCloudSave, cloudTimer, activeCloudSave,
      cloudSaveQueued, lastSyncedRev, lastSyncedDoc, retrySaveAfterEdit, deferredCloudConflict,
      getState: useEditor.getState, saveCloudDoc, setUnsyncedFlag,
      requestRetry: () => setSaveRetry((n) => n + 1),
      retryLater: retrySaveLater,
    }, doc);
  }, [doc, initialLoadComplete, saveCloudDoc, saveRetry, retrySaveLater]);

  // 回線が戻ったら待たずに保存し直す。保存できたら、自動の保存し直しを取りやめて間隔を最初に戻す
  useEffect(() => {
    const onOnline = () => {
      if (saveRetryTimer.current) retrySaveNow();
    };
    window.addEventListener("online", onOnline);
    const unsubscribe = useEditor.subscribe((s, prev) => {
      if (s.cloudState !== "synced" || prev.cloudState === "synced") return;
      if (saveRetryTimer.current) clearTimeout(saveRetryTimer.current);
      saveRetryTimer.current = null;
      saveRetryDelay.current = SAVE_RETRY_MIN_MS;
    });
    return () => {
      window.removeEventListener("online", onOnline);
      unsubscribe();
      if (saveRetryTimer.current) clearTimeout(saveRetryTimer.current);
      saveRetryTimer.current = null;
    };
  }, [retrySaveNow]);

  // 競合でテキスト編集の確定を待っていた保存を、編集を終えたら（文字を変えていなくても）やり直す
  useEffect(
    () =>
      useEditor.subscribe((s, prev) => {
        if (prev.editingText && !s.editingText && retrySaveAfterEdit.current) {
          retrySaveAfterEdit.current = false;
          setSaveRetry((n) => n + 1);
        }
      }),
    []
  );

  // ブラウザ内に埋め込んだ画像など（画像の保存先に置けなかったもの）を整理して、編集データを小さく保つ。
  // 要素の src への複製を外し、保存先が使えるならアップロードしてパスに置き換える。
  // 読み込みが済んで同期した（またはブラウザ内保存に決まった）ときに確かめる
  useEffect(() => {
    let running = false;
    /** 画像の保存先（KV など）があるか。分からなければ null（次の機会に確かめ直す） */
    let assetStorage: boolean | null = null;
    const tidy = async () => {
      if (running) return;
      running = true;
      try {
        const embedded = Object.values(useEditor.getState().doc.assets).filter((a) => a.dataUrl && !a.path);
        if (!embedded.length) return;
        assetStorage ??= await fetch("/api/status")
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => (data ? data.assets === true : null))
          .catch(() => null);
        if (!assetStorage) return;
        for (const asset of embedded) {
          const path = await uploadEmbeddedAsset(asset).catch(() => null);
          if (!path) return;
          useEditor.getState().updateDoc((d) => {
            // アップロード中に差し替え・削除されていたら触らない
            if (d.assets[asset.id]?.dataUrl === asset.dataUrl) replaceEmbeddedAsset(d, asset.id, path);
          }, { history: false });
        }
      } finally {
        running = false;
      }
    };
    return useEditor.subscribe((s, prev) => {
      if (s.cloudState !== prev.cloudState && (s.cloudState === "synced" || s.cloudState === "local")) void tidy();
    });
  }, []);

  // 読込・保存・更新受信をWebSocketで行い、切断中だけHTTPへフォールバックする。
  // WebSocket が使えない環境（Node.js・Docker）では、更新の受信を Server-Sent Events で行う
  useEffect(() => {
    let stopped = false;
    /** 更新の通知（/api/collab/events）。WebSocket に一度も繋がらなかったときだけ開く */
    let events: EventSource | null = null;
    let eventsOpen = false;
    let inFlight = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 1000;
    let pendingRemote: DocChangeMessage | null = null;
    let fallbackTick = 0;

    const applyRemote = (message: DocChangeMessage): boolean => {
      const incomingRev = Number(message.rev);
      const currentRev = Number(lastSyncedRev.current ?? 0);
      if (Number.isFinite(incomingRev) && incomingRev <= currentRev) {
        if (pendingRemote?.rev === message.rev) pendingRemote = null;
        return true;
      }
      const state = useEditor.getState();
      if (
        !cloudReady.current ||
        cloudDirty.current ||
        state.cloudState === "saving" ||
        state.editingText ||
        document.hidden
      ) {
        if (!pendingRemote || Number(pendingRemote.rev) < incomingRev) pendingRemote = message;
        return false;
      }
      const baseDoc = lastSyncedDoc.current;
      // 全体で届いた版は、どの要素も新しい参照になる。履歴があるときは、手元と同じ内容の要素を
      // 手元の参照にそろえ、履歴（最大100件）の付け替えが変わった要素だけを比べれば済むようにする
      const incomingDoc = message.type === "doc-updated"
        ? (state.past.length || state.future.length ? shareUnchangedDoc(state.doc, message.doc) : message.doc)
        : applyDocPatchAtRevision(baseDoc, lastSyncedRev.current, message.base, message.patch);
      if (!incomingDoc) {
        if (!pendingRemote || Number(pendingRemote.rev) < incomingRev) pendingRemote = message;
        // 差分が欠けた場合だけ全体を取得する。版が違う差分を無理に適用しない。
        void pullFallback();
        return false;
      }
      lastSyncedRev.current = message.rev;
      lastSyncedDoc.current = incomingDoc;
      skipNextCloudSave.current = true;
      state.applyRemoteDoc(incomingDoc, message.type === "doc-patched" && baseDoc
        ? { baseDoc, patch: message.patch } : undefined);
      state.setCloud("synced", message.savedAt);
      // 通知は順不同で届くことがある。古い版を適用しても、保留中の新しい版は捨てない
      if (pendingRemote && Number(pendingRemote.rev) <= incomingRev) pendingRemote = null;
      return true;
    };

    const pullFallback = async () => {
      if (stopped || inFlight || !cloudReady.current) return;
      const s = useEditor.getState();
      // ローカルに未保存の変更がある間・テキスト編集中・保存中は取り込まない
      if (s.cloudState === "local" || s.cloudState === "checking") return;
      if (cloudDirty.current || s.cloudState === "saving") return;
      if (s.editingText) return;
      if (document.hidden) return;
      inFlight = true;
      try {
        const metaRes = await fetch(siteApi("/api/doc", { meta: 1 }));
        if (!metaRes.ok) return;
        const meta = await metaRes.json();
        if (
          !meta.exists ||
          !meta.rev ||
          meta.rev === lastSyncedRev.current
        ) {
          return;
        }
        // 新しいスナップショットがある → 全体を取得して反映
        const res = await fetch(siteApi("/api/doc"));
        if (!res.ok) return;
        const data = await res.json();
        if (!data.exists || !data.doc?.pages || !data.doc?.pageOrder?.length) {
          return;
        }
        if (stopped) return;
        applyRemote({ type: "doc-updated", rev: data.rev, savedAt: data.savedAt, doc: data.doc });
      } catch {
        // 失敗は無視して次回に再試行
      } finally {
        inFlight = false;
      }
    };

    /** 更新がすぐ届く接続があるか（無ければポーリングで確認する） */
    const liveConnected = () =>
      collabSocket.current?.readyState === WebSocket.OPEN || eventsOpen;

    const closeEvents = () => {
      events?.close();
      events = null;
      eventsOpen = false;
    };

    const openEvents = () => {
      if (stopped || events) return;
      const source = new EventSource(
        `/api/collab/events?site=${encodeURIComponent(currentSiteId())}&clientId=${encodeURIComponent(
          collabClientId.current
        )}`
      );
      events = source;
      source.addEventListener("open", () => {
        eventsOpen = true;
        // つながる前（再接続の間）の保存を取りこぼさないよう、一度確認する
        void pullFallback();
      });
      source.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(String(event.data)) as CollabServerMessage;
          if (message.type === "doc-updated" || message.type === "doc-patched") applyRemote(message);
        } catch {
          // 未知のメッセージは無視する
        }
      });
      source.addEventListener("error", () => {
        eventsOpen = false;
        // 使えない環境（204 など）では閉じたままにし、ポーリングで確認する
        if (source.readyState === EventSource.CLOSED && events === source) events = null;
      });
    };

    const scheduleReconnect = () => {
      if (stopped || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    };

    const connect = () => {
      if (
        stopped ||
        document.hidden ||
        collabSocket.current?.readyState === WebSocket.OPEN ||
        collabSocket.current?.readyState === WebSocket.CONNECTING
      ) {
        return;
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${protocol}//${window.location.host}/api/collab?clientId=${encodeURIComponent(
        collabClientId.current
      )}&site=${encodeURIComponent(currentSiteId())}`;
      const nextSocket = new WebSocket(url);
      collabSocket.current = nextSocket;
      let opened = false;
      // WebSocket を受け付けないサーバー（next start）は応答せず、接続中のまま止まるので打ち切る
      const openTimer = setTimeout(() => {
        if (!opened) nextSocket.close();
      }, WS_OPEN_TIMEOUT_MS);

      nextSocket.addEventListener("open", () => {
        opened = true;
        clearTimeout(openTimer);
        reconnectDelay = 1000;
        closeEvents();
        if (cloudReady.current) {
          void requestViaWebSocket({ type: "load", knownRev: lastSyncedRev.current ?? undefined })
            .then((message) => {
              if (
                message.type === "snapshot" &&
                message.exists &&
                message.rev &&
                message.savedAt &&
                message.doc
              ) {
                applyRemote({
                  type: "doc-updated",
                  rev: message.rev,
                  savedAt: message.savedAt,
                  doc: message.doc,
                });
              }
            })
            .catch(() => undefined);
        }
      });
      nextSocket.addEventListener("message", (event) => {
        if (event.data === "pong") return;
        try {
          const message = JSON.parse(String(event.data)) as CollabServerMessage;
          if ("requestId" in message && message.requestId) {
            const pending = collabRequests.current.get(message.requestId);
            if (pending) {
              clearTimeout(pending.timer);
              collabRequests.current.delete(message.requestId);
              if (message.type === "error") {
                pending.reject(new Error(message.message));
              } else {
                pending.resolve(message);
              }
            }
          } else if (message.type === "doc-updated" || message.type === "doc-patched") {
            applyRemote(message);
          }
        } catch {
          // 未知のメッセージは無視する
        }
      });
      nextSocket.addEventListener("close", () => {
        clearTimeout(openTimer);
        if (collabSocket.current === nextSocket) collabSocket.current = null;
        for (const [requestId, pending] of collabRequests.current) {
          clearTimeout(pending.timer);
          pending.reject(new Error("WebSocket disconnected"));
          collabRequests.current.delete(requestId);
        }
        // WebSocket を受け付けないサーバー（Node.js・Docker）なら、更新の通知を SSE で受け取る
        if (!opened) openEvents();
        scheduleReconnect();
      });
      nextSocket.addEventListener("error", () => {
        nextSocket.close();
      });
    };

    connect();

    // 保留中のリモート変更を再試行し、WebSocket・SSE のどちらも無いときだけ10秒間隔でHTTP確認する
    const id = setInterval(() => {
      if (pendingRemote) applyRemote(pendingRemote);
      fallbackTick = (fallbackTick + 1) % 5;
      if (fallbackTick === 0 && !liveConnected()) {
        void pullFallback();
      }
    }, 2000);

    // タブがアクティブに戻ったときは再接続して即時チェック
    const onVisible = () => {
      if (!document.hidden) {
        connect();
        if (pendingRemote) applyRemote(pendingRemote);
        if (!liveConnected()) {
          void pullFallback();
        }
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(id);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      closeEvents();
      collabSocket.current?.close(1000, "editor closed");
      collabSocket.current = null;
      for (const pending of collabRequests.current.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Editor closed"));
      }
      collabRequests.current.clear();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [requestViaWebSocket]);

  // 未同期の変更・削除されたブラウザ保存先にしかない内容を、離脱前に知らせる
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const state = useEditor.getState();
      // ブラウザのみが保存先なら、現在の版がブラウザへ保存済みかで判断する。
      // DBがある（または設定状況を取得できない）場合は未同期の変更を保護する。
      const warn = browserOnly
        ? browserSaveState !== "saved"
        : cloudDirty.current || state.cloudState === "saving" || warnForDeletedLocalSave(browserSaveState, state.cloudState);
      if (warn) {
        e.preventDefault();
        // Chrome向け（preventDefaultだけでは無効なバージョンがある）
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [browserOnly, browserSaveState]);

  // キーボードショートカット
  useEffect(() => {
    if (!initialLoadComplete) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }
      const s = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      // ?（Shift+/）でヘルプを開け閉めする
      if (e.key === "?" && !mod && !e.altKey) {
        e.preventDefault();
        toggleHelp();
        return;
      }
      // テキストを選択している間のコピー・切り取りはブラウザに任せる
      if (mod && (key === "c" || key === "x")) {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && sel.toString()) return;
      }
      // スクリプトエディタを開いている間・プレビュー中は、取り消し / やり直し以外の要素操作をしない
      //（プレビューでは選択枠が見えないまま、選んでいた要素を Delete などで消してしまう）
      const isUndoKey = mod && (key === "z" || (key === "y" && !e.metaKey));
      if ((document.querySelector(".se-backdrop") || s.mode === "preview") && !isUndoKey) {
        return;
      }
      // 公開・設定などのモーダルを開いている間は、後ろの要素を操作しない
      if (document.querySelector(".modal-backdrop:not(.is-leaving)")) return;

      // C でコメントモードを切り替える
      if (key === "c" && !mod && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        toggleCommentMode();
        return;
      }

      if (isUndoKey) {
        e.preventDefault();
        // Ctrl+Y（Windows）/ Shift+Cmd+Z でやり直し
        if (key === "y" || e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && key === "a") {
        e.preventDefault();
        s.selectAll();
      } else if (mod && key === "d") {
        if (s.selection && s.doc.nodes[s.selection]) {
          e.preventDefault();
          // 複数選んでいれば、まとめて複製する（コピー・削除と同じく選択中の全要素が対象）
          s.duplicateNodes(s.selectedIds.length > 1 ? s.selectedIds : [s.selection]);
        }
      } else if (mod && key === "c") {
        if (s.selection && s.doc.nodes[s.selection]) {
          e.preventDefault();
          s.copyNode(s.selection);
        }
      } else if (mod && key === "x") {
        if (s.selection && s.doc.nodes[s.selection] && !s.doc.nodes[s.selection].locked) {
          e.preventDefault();
          s.copyNode(s.selection, { unlockedOnly: true });
          s.deleteNodes(s.selectedIds.length > 1 ? s.selectedIds : [s.selection]);
        }
      } else if (e.key === "Backspace" || e.key === "Delete") {
        // 複数選んでいれば、まとめて消す
        const ids = s.selectedIds.length > 1 ? s.selectedIds : s.selection ? [s.selection] : [];
        if (ids.some((id) => s.doc.nodes[id] && !s.doc.nodes[id].locked)) {
          e.preventDefault();
          s.deleteNodes(ids);
        }
      } else if (e.key === "Escape") {
        // ヘルプを開いていれば、選択を外す前にヘルプを閉じる
        if (useHelp.getState().open && !document.querySelector(".dd-menu, .color-pop")) {
          closeHelp();
          return;
        }
        // ドロップダウン等のポップアップが開いている間は選択を保持
        if (!document.querySelector(".dd-menu, .color-pop, .modal")) {
          if (!s.selection && s.editingComponentId) {
            s.setEditingComponent(null);
          } else {
            s.select(null);
          }
        }
      } else if (isEnterKey(e) && e.shiftKey) {
        if (s.selection) {
          e.preventDefault();
          s.selectParent();
        }
      } else if (isEnterKey(e) && s.selection) {
        const node = s.doc.nodes[s.selection];
        if (node?.type === "box" && node.children.length === 0) {
          e.preventDefault();
          s.setEditingText(s.selection);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [initialLoadComplete]);

  const startTutorial = useCallback(() => {
    closeHelp();
    stopGuide();
    togglePanel("l", true);
    togglePanel("r", true);
    const state = useEditor.getState();
    state.setMode("design");
    state.setBreakpoint("base");
    state.setLeftTab("layers");
    state.select(null);
    setTutorialOpen(true);
  }, [togglePanel]);

  if (!initialLoadComplete) return onReady ? null : <EditorLoading />;

  return (
    <div className="app">
      <Header
        panels={{ l: !closedL, r: !closedR }}
        onTogglePanel={togglePanel}
      />
      {browserSaveState === "deleted" && cloudState !== "synced" && (
        <div className="local-save-notice" role="alert">
          {tr("The save location in this browser was deleted. Your content is still on screen. Copy what you need or export a ZIP before closing.")}
        </div>
      )}
      <div
        className={`app-main${closedL ? " is-l-closed" : ""}${closedR ? " is-r-closed" : ""}${panelAnim ? " is-panel-anim" : ""}`}
        style={
          {
            "--panel-l-w": `${closedL ? 0 : panelL}px`,
            "--panel-r-w": `${closedR ? 0 : panelR}px`,
            "--panel-l-full": `${panelL}px`,
            "--panel-r-full": `${panelR}px`,
          } as React.CSSProperties
        }
      >
        {mode === "design" && (
          <>
            <SafeBoundary label={tr("Left panel", "left_panel_variant_1")} resetKey={activePageId}>
              <LeftPanel />
            </SafeBoundary>
            {!closedL && (
              <PanelResizer
                width={panelL}
                dir={1}
                side="l"
                onResize={setPanelL}
              />
            )}
          </>
        )}
        <SafeBoundary label={tr("Canvas")} resetKey={activePageId}>
          <Canvas />
        </SafeBoundary>
        {mode === "design" && (
          <>
            {!closedR && (
              <PanelResizer
                width={panelR}
                dir={-1}
                side="r"
                onResize={setPanelR}
              />
            )}
            <SafeBoundary label={tr("Right panel", "right_panel_variant_1")} resetKey={activePageId}>
              <RightPanel />
            </SafeBoundary>
          </>
        )}
      </div>
      <Footer
        localSaveState={browserSaveState}
        onRetryLocalSave={() => {
          if (saveTimer.current) clearTimeout(saveTimer.current);
          saveLocalDoc(useEditor.getState().doc);
        }}
      />
      <TooltipLayer />
      <LeaveAnimator />
      <DialogHost />
      {scriptEditor && (
        <ScriptEditor
          key={`${scriptEditor.focusNodeId ?? ""}:${scriptEditor.focusScriptId ?? ""}`}
          focusNodeId={scriptEditor.focusNodeId}
          focusScriptId={scriptEditor.focusScriptId}
          onClose={() => useEditor.getState().openScriptEditor(null)}
        />
      )}
      {pasteNotice && (
        <div className="paste-notice" role="status">
          {pasteNotice}
        </div>
      )}
      <SafeBoundary label={tr("AI")}>
        <AiChat />
      </SafeBoundary>
      <SafeBoundary label={tr("Help")} onClose={closeHelp}>
        <HelpCenter onStartTutorial={startTutorial} />
      </SafeBoundary>
      <SafeBoundary label={tr("Guide")} onClose={() => stopGuide()}>
        <GuideOverlay />
      </SafeBoundary>
      {tutorialOpen && (
        <SafeBoundary label={tr("Tutorial")} onClose={() => setTutorialOpen(false)}>
          <Tutorial onClose={() => setTutorialOpen(false)} />
        </SafeBoundary>
      )}
      {conflict && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>{tr("You have unsaved changes")}</h2>
            <p className="modal-desc">
              {tr("Edits you made in this browser last time were never saved to the server. Which version do you want to keep editing?")}
            </p>
            <p className="hint" style={{ margin: "0 0 4px" }}>
              {tr("Last saved to server:")}{" "}
              {new Date(conflict.savedAt).toLocaleString(getLang())}
              {tr(" (may include changes from other people or browsers)")}
            </p>
            <p className="hint" style={{ margin: 0 }}>
              {tr("\"Use this browser's version\" overwrites the server copy. \"Use the server version\" discards this browser's changes.")}
            </p>
            <div className="modal-actions">
              <button
                className="btn"
                onClick={() => void resolveConflict("remote")}
              >
                {tr("Use the server version")}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void resolveConflict("local")}
              >
                {tr("Use this browser's version")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
