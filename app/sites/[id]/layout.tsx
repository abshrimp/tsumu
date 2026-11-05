import type { Metadata } from "next";

// サイト名はブラウザ保存から読むこともあるため、エディタ側で付ける。
// 遅れて届く共通メタデータのタイトルが、そのサイト名を上書きしないようにする。
export const metadata: Metadata = { title: null };

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  // ページの effect より先に確定する、唯一の既定タイトル。
  return <><title>Tsumu</title>{children}</>;
}
