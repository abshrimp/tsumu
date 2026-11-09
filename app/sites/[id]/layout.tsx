import type { Metadata } from "next";
import "../../styles/side-panels.css";
import "../../styles/tooltips.css";
import "../../styles/help-and-guides.css";
import "../../styles/page-folders.css";
import "../../styles/comments.css";
import "../../styles/font-add.css";

// サイト名はブラウザ内の保存から読むこともあるため、タイトルはエディタ側で付ける。
// 遅れて届く共通のメタデータのタイトルが、そのサイト名を上書きしないようにする。
export const metadata: Metadata = { title: null };

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  // ページの effect より先に決まる、唯一の既定のタイトル。
  return <><title>Tsumu</title>{children}</>;
}
