"use client";

import dynamic from "next/dynamic";
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
const Home = dynamic(() => loadLocale().then(() => import("../components/Home")), {
  ssr: false,
  loading: () => <HomeLoading />,
});

/** ホーム: サイトの一覧（サイトを開くと /sites/<id> のエディタへ） */
export default function Page() {
  return <Home />;
}
