import { redirect } from "next/navigation";
import { auth, authConfigured } from "../../auth";
import { Globe, MousePointerClick, Smartphone } from "lucide-react";
import GoogleSignIn from "../../components/GoogleSignIn";
import BrandMark from "../../components/BrandMark";
import { serverTr } from "../../lib/i18n-server";

export async function generateMetadata() {
  const tr = await serverTr();
  return { title: tr("Sign in | Tsumu") };
}

/** ログイン画面の左に表示する、エディタの画面の見本（飾り） */
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
  // Edge での Cookie の検証と違い、auth() は現在の許可リストも確認する。
  if (authConfigured() && await auth()) redirect("/");

  const { error } = await searchParams;
  const tr = await serverTr();
  return (
    <main className="login-page">
      <section className="login-visual">
        <EditorPreview />
        <ul className="login-points">
          <li>
            <MousePointerClick size={15} />
            {tr("Edit text and images directly on the page")}
          </li>
          <li>
            <Smartphone size={15} />
            {tr("Check and adjust the phone layout as you go")}
          </li>
          <li>
            <Globe size={15} />
            {tr("Publish your site with a single click")}
          </li>
        </ul>
      </section>

      <section className="login-side">
        <div className="login-card">
          <BrandMark size={44} />
          <h1>Tsumu</h1>
          <p className="login-tagline">Design freely. Build openly.</p>
          <p className="login-desc">
            {tr("Edit your website visually and publish it as is.")}
          </p>
          {error === "AccessDenied" ? (
            <p className="login-error" role="alert">
              {tr("This Google account doesn't have access yet. Ask an administrator to add it.")}
            </p>
          ) : error ? (
            <p className="login-error" role="alert">
              {tr("Couldn't sign in. Wait a moment and try again.")}
            </p>
          ) : null}
          <GoogleSignIn label={tr("Sign in with Google")} busyLabel={tr("Redirecting to Google…")} />
          <p className="login-note">{tr("Sign in with a Google account that has been granted access.")}</p>
        </div>
      </section>
    </main>
  );
}
