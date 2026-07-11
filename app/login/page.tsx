import { Globe, MousePointerClick, Smartphone } from "lucide-react";
import GoogleSignIn from "../../components/GoogleSignIn";
import BrandMark from "../../components/BrandMark";
import { serverTr } from "../../lib/i18n-server";

export async function generateMetadata() {
  const tr = await serverTr();
  return { title: tr("ログイン | Tsumu") };
}

/** ログイン画面の左に出す、エディタの画面の見本（飾り） */
function EditorPreview() {
  return (
    <div className="login-mock" aria-hidden>
      <div className="login-mock-bar">
        <span />
        <span />
        <span />
        <i />
      </div>
      <div className="login-mock-body">
        <div className="login-mock-panel">
          <b />
          <b />
          <b className="is-in" />
          <b className="is-in" />
          <b />
          <b className="is-in is-sel" />
          <b />
        </div>
        <div className="login-mock-canvas">
          <div className="login-mock-page">
            <div className="login-mock-nav">
              <em />
              <span />
              <span />
              <span />
            </div>
            <div className="login-mock-hero">
              <strong />
              <strong className="is-short" />
              <p />
              <button type="button" tabIndex={-1} />
            </div>
            <div className="login-mock-cards">
              <div />
              <div />
              <div />
            </div>
            <div className="login-mock-select" />
          </div>
        </div>
        <div className="login-mock-panel is-right">
          <b className="is-label" />
          <b className="is-field" />
          <b className="is-label" />
          <b className="is-field" />
          <b className="is-label" />
          <b className="is-field is-accent" />
        </div>
      </div>
    </div>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const tr = await serverTr();
  return (
    <main className="login-page">
      <section className="login-visual">
        <EditorPreview />
        <ul className="login-points">
          <li>
            <MousePointerClick size={15} />
            {tr("見たままの画面で、文字や画像を直接編集")}
          </li>
          <li>
            <Smartphone size={15} />
            {tr("スマホでの見え方も、その場で確かめて調整")}
          </li>
          <li>
            <Globe size={15} />
            {tr("できあがったら、ボタン1つでサイトに公開")}
          </li>
        </ul>
      </section>

      <section className="login-side">
        <div className="login-card">
          <BrandMark size={44} />
          <h1>Tsumu</h1>
          <p className="login-tagline">Design freely. Build openly.</p>
          <p className="login-desc">
            {tr("Webサイトを見たまま編集して、そのまま公開できるエディタです。")}
          </p>
          {error === "AccessDenied" ? (
            <p className="login-error" role="alert">
              {tr("このGoogleアカウントは、まだ利用が許可されていません。管理者にアカウントの追加を依頼してください。")}
            </p>
          ) : error ? (
            <p className="login-error" role="alert">
              {tr("ログインできませんでした。時間をおいて、もう一度お試しください。")}
            </p>
          ) : null}
          <GoogleSignIn label={tr("Googleでログイン")} busyLabel={tr("Googleに移動しています…")} />
          <p className="login-note">{tr("利用を許可されたGoogleアカウントでログインします。")}</p>
        </div>
      </section>
    </main>
  );
}
