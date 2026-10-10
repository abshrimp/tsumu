"use client";

import { signOut } from "next-auth/react";
import { useEditor } from "../lib/store";
import { tr } from "../lib/i18n";

/** A navigation-only header. Viewers never see mutation controls. */
export default function ViewerHeader() {
  const pages = useEditor((state) => state.doc.pages);
  const order = useEditor((state) => state.doc.pageOrder);
  const selected = useEditor((state) => state.activePageId);
  const setActivePage = useEditor((state) => state.setActivePage);
  return (
    <header className="viewer-header">
      <a className="viewer-home" href="/">Tsumu</a>
      <select
        className="select viewer-pages"
        aria-label={tr("Page")}
        value={selected}
        onChange={(event) => setActivePage(event.target.value)}
      >
        {order.filter((id) => !!pages[id]).map((id) => (
          <option key={id} value={id}>{pages[id].name}</option>
        ))}
      </select>
      <span className="viewer-permission">{tr("View only")}</span>
      <button type="button" className="btn" onClick={() => void signOut({ callbackUrl: "/login" })}>
        {tr("Sign out")}
      </button>
    </header>
  );
}
