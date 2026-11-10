import type { Metadata } from "next";
import "./globals.css";
import "./styles/side-panels.css";
import "./styles/canvas-and-dialogs.css";
import "./styles/accounts-and-loading.css";
import "./styles/tooltips.css";
import "./styles/help-and-guides.css";
import "./styles/page-folders.css";
import "./styles/home.css";
import "./styles/comments.css";
import "./styles/font-add.css";
import "./styles/editor-dark.css";
import { serverLang, serverTr } from "../lib/i18n-server";

export async function generateMetadata(): Promise<Metadata> {
  const tr = await serverTr();
  return {
    title: "Tsumu",
    icons: { icon: [{ url: "/tsumu-mark.svg", type: "image/svg+xml" }] },
    description: tr("A visual editor for building and publishing websites."),
    robots: {
      index: false,
      follow: false,
      nocache: true,
      googleBot: { index: false, follow: false },
    },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang={await serverLang()}>
      <body>{children}</body>
    </html>
  );
}
