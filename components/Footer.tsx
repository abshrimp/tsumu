"use client";

import {
  CloudAlert,
  CloudCheck,
  CloudOff,
  CloudUpload,
  Globe,
  LoaderCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { docFingerprint, useEditor } from "../lib/store";
import { getLang, tr } from "../lib/i18n";
import { siteApi } from "../lib/site";
import { relativeTime } from "../lib/time";
import type { ActivityEntry, SiteActivity } from "../lib/activity";
import UserAvatar from "./UserAvatar";

/* ---------- 最近の編集・最後の公開（ホバーで出すカード） ---------- */

/** サーバーの記録（D1 が無いときは null。読み込み中は undefined） */
function useSiteActivity(): { activity: SiteActivity | null | undefined; load: () => void } {
  const [activity, setActivity] = useState<SiteActivity | null | undefined>(undefined);
  const loadedAt = useRef(0);
  const load = useCallback(() => {
    // 開くたびに取りに行かず、少しの間は前の結果を使う
    if (Date.now() - loadedAt.current < 10_000) return;
    loadedAt.current = Date.now();
    void fetch(siteApi("/api/activity"))
      .then(async (res) => (res.ok ? ((await res.json()) as SiteActivity) : null))
      .catch(() => null)
      .then(setActivity);
  }, []);
  // 保存・公開したら、次に開いたときに取り直す
  const cloudSavedAt = useEditor((s) => s.cloudSavedAt);
  const publishedAt = useEditor((s) => s.publishedAt);
  useEffect(() => {
    loadedAt.current = 0;
  }, [cloudSavedAt, publishedAt]);
  return { activity, load };
}

function Person({ entry, time }: { entry: ActivityEntry; time?: boolean }) {
  return (
    <div className="ftr-person">
      <UserAvatar user={entry} />
      <span className="ftr-person-name">
        <strong>{entry.name || entry.email || tr("ログインなしの編集者")}</strong>
        {entry.name && entry.email && <small>{entry.email}</small>}
      </span>
      {time && (
        <time dateTime={new Date(entry.at).toISOString()} title={new Date(entry.at).toLocaleString(getLang())}>
          {relativeTime(entry.at)}
        </time>
      )}
    </div>
  );
}

/** 公開した時刻と、公開した人（サーバーの記録が無ければ、このブラウザで公開した時刻だけ） */
function PublishInfo({ entry, localAt, loading }: { entry: ActivityEntry | null; localAt: number | null; loading: boolean }) {
  const at = Math.max(entry?.at ?? 0, localAt ?? 0);
  if (!at) {
    return <p className="ftr-pop-empty">{loading ? tr("読み込み中…") : tr("まだ公開されていません")}</p>;
  }
  // このブラウザで、サーバーに記録が無い（または記録より新しい）公開をした
  const local = !entry || (localAt ?? 0) > entry.at;
  return (
    <>
      <p className="ftr-pop-time">
        {new Date(at).toLocaleString(getLang())}
        <small>{relativeTime(at)}</small>
      </p>
      <span className="ftr-pop-label">{tr("公開した人")}</span>
      {local ? (
        <p className="ftr-pop-empty">
          {tr("このブラウザから公開しました。公開した人は、サーバーの保存先（D1）があるときに記録されます。")}
        </p>
      ) : (
        <Person entry={entry} />
      )}
    </>
  );
}

/** ホバー・フォーカスで上に出るカード */
function HoverCard({ children, card, onOpen }: { children: ReactNode; card: ReactNode; onOpen: () => void }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      onOpen();
      setOpen(true);
    }, 250);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 150);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <span className="ftr-hover" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {open && (
        <div className="ftr-pop" role="tooltip">
          {card}
        </div>
      )}
    </span>
  );
}

function PopSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ftr-pop-sec">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

export default function Footer() {
  const savedAt = useEditor((s) => s.savedAt);
  const cloudState = useEditor((s) => s.cloudState);
  const cloudSavedAt = useEditor((s) => s.cloudSavedAt);
  const cloudError = useEditor((s) => s.cloudError);
  const publishedAt = useEditor((s) => s.publishedAt);
  const publishedFingerprint = useEditor((s) => s.publishedFingerprint);
  const doc = useEditor((s) => s.doc);
  const activePageId = useEditor((s) => s.activePageId);

  const { activity, load } = useSiteActivity();
  // 公開済みかどうかの表示にも使うため、開いたときに一度読み込む
  useEffect(() => load(), [load]);
  // ほかの人の公開も含めた最後の公開（サーバーの記録が無ければこのブラウザの記録）
  const lastPublishAt = Math.max(activity?.lastPublish?.at ?? 0, publishedAt ?? 0) || null;

  const page = doc.pages[activePageId];
  const isLoadingPage = doc.loadingScreen?.pageId === activePageId;
  const pageCount = doc.pageOrder.length;
  const nodeCount = Object.keys(doc.nodes).length;

  // 公開時の内容と比較して未公開の変更を判定する（編集中は重いのでデバウンス）
  const [changedSincePublish, setChangedSincePublish] = useState(false);
  useEffect(() => {
    if (!publishedFingerprint) return;
    const timer = setTimeout(() => {
      setChangedSincePublish(docFingerprint(doc) !== publishedFingerprint);
    }, 600);
    return () => clearTimeout(timer);
  }, [doc, publishedFingerprint]);

  return (
    <footer className="ftr">
      <span className="hint">
        {page
          ? isLoadingPage
            ? tr("ローディング画面")
            : tr("{name}（/{slug}）", { name: page.name, slug: page.slug })
          : ""}
        {" · "}
        {tr("{pages}ページ · {nodes}要素", { pages: pageCount, nodes: nodeCount })}
      </span>

      <div className="ftr-spacer" />

      <HoverCard
        onOpen={load}
        card={
          <>
            <PopSection title={tr("最後の公開")}>
              <PublishInfo entry={activity?.lastPublish ?? null} localAt={publishedAt} loading={activity === undefined} />
            </PopSection>
            {activity?.lastTestPublish && (
              <PopSection title={tr("最後のテスト公開")}>
                <PublishInfo entry={activity.lastTestPublish} localAt={null} loading={false} />
              </PopSection>
            )}
            {publishedAt && publishedFingerprint && changedSincePublish && (
              <p className="ftr-pop-note">{tr("公開した後に変更があります。公開すると反映されます。")}</p>
            )}
          </>
        }
      >
        <span
          className="hint"
          data-tutorial="publish-status"
          tabIndex={0}
          style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
        >
          <Globe size={12} />
          {lastPublishAt
            ? publishedFingerprint && changedSincePublish
              ? tr("未公開の変更あり")
              : tr("公開済み")
            : tr("未公開")}
        </span>
      </HoverCard>

      <HoverCard
        onOpen={load}
        card={
          <>
            {cloudState === "local" || activity === null ? (
              <PopSection title={tr("保存")}>
                <p className="ftr-pop-empty">
                  {cloudState === "local"
                    ? tr("サーバー保存が設定されていないため、このブラウザにだけ保存しています。クリックで再接続します。")
                    : tr("編集した人の記録は、サーバーの保存先（D1）があるときに表示されます。")}
                </p>
              </PopSection>
            ) : (
              <>
                <PopSection title={tr("最新の変更")}>
                  {activity?.lastEdit ? (
                    <Person entry={activity.lastEdit} time />
                  ) : (
                    <p className="ftr-pop-empty">{activity === undefined ? tr("読み込み中…") : tr("まだ記録がありません")}</p>
                  )}
                </PopSection>
                {activity && (
                  <PopSection title={tr("直近10分に変更した人（{n}人）", { n: activity.recentEditors.length })}>
                    {activity.recentEditors.length ? (
                      activity.recentEditors.map((e) => <Person key={e.email || "-"} entry={e} time />)
                    ) : (
                      <p className="ftr-pop-empty">{tr("いません")}</p>
                    )}
                  </PopSection>
                )}
              </>
            )}
            {cloudSavedAt && cloudState !== "local" && (
              <p className="ftr-pop-note">{tr("サーバーに保存 {p1}", { p1: new Date(cloudSavedAt).toLocaleString(getLang()) })}</p>
            )}
            {cloudState === "error" && cloudError && <p className="ftr-pop-note">{cloudError}</p>}
            {cloudState === "error" && <p className="ftr-pop-note">{tr("クリックで再接続します")}</p>}
          </>
        }
      >
        <button
          className="hint"
          data-tutorial="save-status"
          style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
          onClick={() => {
            if (cloudState === "local" || cloudState === "error") {
              window.dispatchEvent(new Event("cloud-sync-retry"));
            }
          }}
        >
          {cloudState === "checking" && (
            <>
              <LoaderCircle size={12} className="spin" />
              {tr("同期を確認中…")}
            </>
          )}
          {cloudState === "saving" && (
            <>
              <CloudUpload size={13} />
              {tr("サーバーへ保存中…")}
            </>
          )}
          {cloudState === "synced" && (
            <>
              <CloudCheck size={13} />
              {tr("サーバー保存済み")}
              {cloudSavedAt &&
                ` ${new Date(cloudSavedAt).toLocaleTimeString(getLang())}`}
            </>
          )}
          {cloudState === "local" && (
            <>
              <CloudOff size={13} />
              {tr("このブラウザにのみ保存")}
              {savedAt && ` ${new Date(savedAt).toLocaleTimeString(getLang())}`}
            </>
          )}
          {cloudState === "error" && (
            <>
              <CloudAlert size={13} style={{ color: "var(--warn)" }} />
              {tr("サーバーに保存できません（このブラウザには保存済み）")}
            </>
          )}
        </button>
      </HoverCard>

    </footer>
  );
}
