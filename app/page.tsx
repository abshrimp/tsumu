"use client";

import { type ComponentType, useEffect, useState } from "react";
import { loadLocale } from "../lib/i18n";

/** 読み込み中（ホームと同じ配置の骨組み） */
function HomeLoading() {
  return (
    <div className="home" aria-busy>
      <header className="home-top" />
      <main className="home-main">
        <div className="home-grid">
          {[0, 1, 2].map((i) => (
            <div key={i} className="home-card is-skeleton" />
          ))}
        </div>
      </main>
    </div>
  );
}

// 文言を作る前に言語の辞書を読み込む
const loadHome = () => loadLocale().then(() => import("../components/Home"));

type HomeState =
  | { kind: "loading" }
  | { kind: "ok"; Home: ComponentType }
  | { kind: "failed"; error: unknown };

/**
 * ホーム本体を読み込む。表示のたびに読み込み直すので、
 * エラー画面の「もう一度表示する」で読み込みからやり直せる
 */
function useHome(): HomeState {
  const [state, setState] = useState<HomeState>({ kind: "loading" });
  useEffect(() => {
    let alive = true;
    loadHome().then(
      ({ default: Home }) => {
        if (alive) setState({ kind: "ok", Home });
      },
      (error) => {
        if (alive) setState({ kind: "failed", error });
      }
    );
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

/** ホーム: サイトの一覧（サイトを開くと /sites/<id> のエディタへ） */
export default function Page() {
  const state = useHome();
  if (state.kind === "loading") return <HomeLoading />;
  if (state.kind === "failed") throw state.error;
  return <state.Home />;
}
