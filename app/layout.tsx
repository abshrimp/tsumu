import type { Metadata } from "next";
import "./globals.css";
import { serverLang, serverTr } from "../lib/i18n-server";

export async function generateMetadata(): Promise<Metadata> {
  const tr = await serverTr();
  return {
    title: "Tsumu",
    description: tr("Webサイトを見たまま編集して公開するエディタです。"),
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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* キャンバスプレビュー用フォント */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&family=M+PLUS+Rounded+1c:wght@400;500;700&family=Noto+Sans+JP:wght@100..900&family=Noto+Serif+JP:wght@200..900&family=Roboto:wght@400;500;700&family=Zen+Maru+Gothic:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
