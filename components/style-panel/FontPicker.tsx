"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleHelp, Plus, Search, X } from "lucide-react";
import type { CustomFont } from "../../lib/types";
import { parseAdobeKitInput } from "../../lib/adobe-fonts-embed";
import { registerAdobeFont, removeAdobeWebProject } from "../../lib/adobe-fonts-registration";
import { googleFontWeights, searchGoogleFonts, type GoogleFontFilter } from "../../lib/google-font-catalog";
import { allFonts } from "../../lib/style";
import { usePendingImport } from "../../lib/use-pending-import";
import { useEditor } from "../../lib/store";
import { openHelp } from "../../lib/help";
import { showConfirm, useDialogs } from "../../lib/dialog";
import { tr } from "../../lib/i18n";
import { PropSelect, useInspector } from "../controls";

type AdobeFamily = { name: string; family: string; loading: "css" | "dynamic" };
type AdobeStatus = "idle" | "checking" | "available" | "reachable" | "missing" | "unknown";

const WEB_PROJECTS_URL = "https://fonts.adobe.com/my_fonts#web_projects-section";

export function FontPicker({ inheritedValue }: { inheritedValue: string }) {
  const insp = useInspector();
  const doc = useEditor((state) => state.doc);
  const updateDoc = useEditor((state) => state.updateDoc);
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<"google" | "adobe">("google");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<GoogleFontFilter>("all");
  const [chosenGoogle, setChosenGoogle] = useState("");
  const [projectInput, setProjectInput] = useState("");
  const [showProjectInput, setShowProjectInput] = useState(false);
  const [projectStatus, setProjectStatus] = useState<AdobeStatus>("idle");
  const [projectFonts, setProjectFonts] = useState<AdobeFamily[]>([]);
  const [chosenAdobe, setChosenAdobe] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pending = usePendingImport(JSON.stringify([insp.editTarget, insp.get("fontFamily").value]));
  const { busy } = pending;
  const searchRef = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const fonts = allFonts(doc.customFonts, doc.adobeFonts);
  const results = useMemo(() => searchGoogleFonts(query, filter), [query, filter]);
  const project = parseAdobeKitInput(projectInput);
  const kitId = project?.kitId;
  // Registered families remain selectable even if Adobe's public metadata endpoint is unavailable.
  const visibleAdobeFonts = projectFonts.length ? projectFonts :
    (doc.adobeFonts ?? []).filter((font) => font.kitId === kitId)
      .map((font) => ({ name: font.family, family: font.family, loading: font.loading }));
  const availableFamily = visibleAdobeFonts.find((font) => font.family === chosenAdobe);
  const existingKits = [...new Set((doc.adobeFonts ?? []).map((font) => font.kitId))];

  const removeProject = async (id: string) => {
    const count = (useEditor.getState().doc.adobeFonts ?? []).filter(font => font.kitId === id).length;
    if (!count) return;
    const confirmed = await showConfirm(
      tr("Remove Web Project {kitId} from this site? Its {count} registered fonts and all font-family settings using them will be removed. The project in Adobe Fonts will not be deleted.", { kitId: id, count }),
      { title: tr("Remove Adobe Web Project"), okLabel: tr("Delete"), danger: true },
    );
    if (!confirmed) return;
    // The Web Project is removed only from Tsumu; Adobe's project remains untouched.
    pending.cancel();
    updateDoc(site => { removeAdobeWebProject(site, id); });
    if (kitId === id) {
      setProjectInput("");
      setChosenAdobe("");
      setProjectFonts([]);
      setProjectStatus("idle");
    }
    setError(null);
  };

  const close = () => {
    pending.cancel();
    setOpen(false);
    setError(null);
  };

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    requestAnimationFrame(() => (provider === "google" ? searchRef.current : modalRef.current?.querySelector<HTMLInputElement>("#font-project-input"))?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (useDialogs.getState().queue.length) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        pending.cancel();
        setOpen(false);
        setError(null);
      } else if (event.key === "Tab" && modalRef.current) {
        const items = [...modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled])'
        )].filter((item) => item.getClientRects().length > 0);
        if (!items.length) return;
        if (event.shiftKey && document.activeElement === items[0]) {
          event.preventDefault();
          items[items.length - 1].focus();
        } else if (!event.shiftKey && document.activeElement === items[items.length - 1]) {
          event.preventDefault();
          items[0].focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previousFocus.current?.focus();
    };
  }, [open]);

  // Preview only the first few matching families, and sample a limited set of glyphs.
  useEffect(() => {
    if (!open || provider !== "google" || typeof document === "undefined") return;
    const names = [...new Set([...results.slice(0, 7), chosenGoogle].filter(Boolean))].slice(0, 8);
    if (!names.length) return;
    const timeout = setTimeout(() => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.id = "font-add-preview";
      link.href = "https://fonts.googleapis.com/css2?" +
        names.map((name) => "family=" + encodeURIComponent(name).replace(/%20/g, "+")).join("&") +
        "&display=swap&text=" + encodeURIComponent("こんにちは ABC abc 123");
      document.head.appendChild(link);
    }, 200);
    return () => {
      clearTimeout(timeout);
      document.getElementById("font-add-preview")?.remove();
    };
  }, [open, provider, results, chosenGoogle]);

  // Adobe documents its published-kit metadata as public: no Adobe account token needed.
  useEffect(() => {
    if (!open || provider !== "adobe" || !kitId) {
      setProjectStatus("idle");
      setProjectFonts([]);
      return;
    }
    const controller = new AbortController();
    setProjectStatus("checking");
    setProjectFonts([]);
    setChosenAdobe("");
    const timeout = setTimeout(() => {
      void fetch("/api/fonts/adobe/status?kitId=" + encodeURIComponent(kitId), {
        signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) return { status: "unknown", fonts: [] };
        return response.json() as Promise<{ status: string; fonts: AdobeFamily[] }>;
      }).then((data) => {
        if (controller.signal.aborted) return;
        const status = ["available", "reachable", "missing"].includes(data.status) ? data.status as AdobeStatus : "unknown";
        setProjectStatus(status);
        setProjectFonts(Array.isArray(data.fonts) ? data.fonts.filter((font) =>
          font && typeof font.family === "string" &&
          /^[A-Za-z][A-Za-z0-9 _-]{0,79}$/.test(font.family) &&
          (font.loading === "css" || font.loading === "dynamic")
        ).slice(0, 100) : []);
      }).catch(() => { if (!controller.signal.aborted) setProjectStatus("unknown"); });
    }, 250);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [open, provider, kitId]);

  const addGoogle = async () => {
    const name = (chosenGoogle || query).trim().replace(/\s+/g, " ");
    if (!name) { setError(tr("Choose a font from the search results.")); return; }
    if (doc.adobeFonts?.some((font) => font.family === name)) {
      setError(tr("A font with this name is already registered from another provider."));
      return;
    }
    const request = pending.begin();
    setError(null);
    try {
      const enc = encodeURIComponent(name).replace(/%20/g, "+");
      const tryFetch = async (axis: string): Promise<string | null> => {
        if (!request.current()) return null;
        try {
          const res = await fetch("https://fonts.googleapis.com/css2?family=" + enc + axis + "&display=swap");
          return res.ok ? res.text() : null;
        } catch { return null; }
      };
      // Do not probe an unsupported 100..900 range: Google returns 400 without
      // CORS headers for many static Japanese fonts (for example Shippori Mincho).
      const knownWeights = googleFontWeights(name);
      const body = await tryFetch(":wght@" + (knownWeights?.[0] ?? "400"));
      const found: CustomFont | null = body ? {
        family: name,
        weights: knownWeights?.length ? knownWeights
          : /font-weight:\s*100\s+900\b/.test(body) ? "variable"
          : [...new Set([...body.matchAll(/font-weight:\s*(\d+)/g)].map(match => match[1]))].sort(),
      } : null;
      if (!request.current()) return;
      if (!found) {
        setError(tr("Not found on Google Fonts. Enter the name exactly as shown on fonts.google.com."));
        return;
      }
      updateDoc((site) => {
        site.customFonts = [...(site.customFonts ?? []).filter((font) => font.family !== name), found!];
      });
      insp.set({ fontFamily: name });
      setOpen(false);
      setQuery("");
      setChosenGoogle("");
    } catch {
      if (request.current()) setError(tr("Couldn't check. Check your network connection."));
    } finally {
      request.finish();
    }
  };

  const addAdobe = () => {
    if (!kitId) { setError(tr("Enter the Adobe Fonts Web Project ID or URL.")); return; }
    const family = availableFamily?.family ?? "";
    if (!/^[A-Za-z][A-Za-z0-9 _-]{0,79}$/.test(family)) {
      setError(tr("Choose a font from the Web Project."));
      return;
    }
    if (fonts.some((font) => font.value === family &&
      !doc.adobeFonts?.some((adobe) => adobe.family === family))) {
      setError(tr("A font with this name is already registered from another provider."));
      return;
    }
    updateDoc((site) => {
      registerAdobeFont(site, { family, kitId, loading: availableFamily!.loading });
    });
    insp.set({ fontFamily: family });
    setOpen(false);
    setProjectInput("");
    setShowProjectInput(false);
    setChosenAdobe("");
    setError(null);
  };

  const modal = (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <div className="modal font-add-modal" role="dialog" aria-modal="true"
        ref={modalRef} aria-labelledby="font-add-title">
        <div className="font-add-header">
          <div>
            <h2 id="font-add-title">{tr("Add a font")}</h2>
            <p className="hint">{tr("Search Google Fonts or choose a font from an Adobe Web Project.")}</p>
          </div>
          <button type="button" className="icon-btn" aria-label={tr("Close")} onClick={close}>
            <X size={17}/>
          </button>
        </div>
        <div className="font-add-tabs" role="group" aria-label={tr("Font provider")}>
          {(["google", "adobe"] as const).map((source) => (
            <button key={source} type="button" className={"btn" + (provider === source ? " is-on" : "")}
              aria-pressed={provider === source}
              onClick={() => {
                pending.cancel();
                setProvider(source);
                setError(null);
              }}>{source === "google" ? "Google Fonts" : "Adobe Fonts"}</button>
          ))}
        </div>
        <div className="font-add-content">
          {provider === "google" ? (
            <>
              <div className="font-add-search">
                <Search size={16}/>
                <input ref={searchRef} type="search" className="input"
                  aria-label={tr("Search Google Fonts")}
                  placeholder={tr("Search by font name")}
                  value={query} onChange={(event) => {
                    pending.cancel();
                    setQuery(event.target.value);
                    setChosenGoogle("");
                    setError(null);
                  }}/>
                <select className="input" aria-label={tr("Font category")}
                  value={filter} onChange={(event) => {
                    setFilter(event.target.value as GoogleFontFilter);
                    setChosenGoogle("");
                  }}>
                  <option value="all">{tr("All fonts")}</option>
                  <option value="japanese">{tr("Japanese fonts")}</option>
                  <option value="sans-serif">{tr("Sans Serif")}</option>
                  <option value="serif">{tr("Serif")}</option>
                  <option value="display">{tr("Display")}</option>
                  <option value="handwriting">{tr("Handwriting")}</option>
                  <option value="monospace">{tr("Monospace")}</option>
                </select>
              </div>
              <p className="hint">{query ? tr("Search results") : tr("Suggested fonts")}</p>
              <div className="font-add-results" role="group" aria-label={tr("Google Font results")}>
                {results.map((name) => (
                  <button type="button" key={name} className={"font-add-result" + (chosenGoogle === name ? " is-on" : "")}
                    aria-pressed={chosenGoogle === name}
                    onClick={() => { pending.cancel(); setChosenGoogle(name); setError(null); }}>
                    <span>{name}</span>
                    <span style={{ fontFamily: '"' + name + '", sans-serif' }}>{tr("Sample typography")}</span>
                  </button>
                ))}
              </div>
              {query && !results.length && (
                <p className="hint">{tr("No match in the catalog. The exact font name can still be checked.")}</p>
              )}
              {(chosenGoogle || query) && (
                <p className="font-add-selected" aria-live="polite">
                  {tr("Selected font")}: <strong>{chosenGoogle || query}</strong>
                </p>
              )}
            </>
          ) : (
            <>
              {existingKits.length > 0 && (
                <div className="font-add-existing">
                  <p className="hint">{tr("Web Projects already used in this site")}</p>
                  <div className="font-add-kits">
                    {existingKits.map(id => (
                      <div className="font-add-kit" key={id}>
                        <button type="button" className={"btn btn-sm" + (kitId === id ? " is-on" : "")}
                          aria-pressed={kitId === id}
                          onClick={() => {
                            setProjectInput(id);
                            setShowProjectInput(false);
                            setChosenAdobe("");
                            setError(null);
                          }}>{id}</button>
                        <button type="button" className="icon-btn font-add-kit-remove"
                          aria-label={tr("Remove Web Project {kitId}", { kitId: id })}
                          data-tip={tr("Remove Web Project and its fonts")}
                          onClick={() => removeProject(id)}>
                          <X size={13}/>
                        </button>
                      </div>
                    ))}
                    <button type="button" className="icon-btn font-add-kit-add"
                      aria-label={tr("Add another Web Project")}
                      data-tip={tr("Add another Web Project")}
                      onClick={() => {
                        setProjectInput("");
                        setChosenAdobe("");
                        setShowProjectInput(true);
                        setError(null);
                        requestAnimationFrame(() => modalRef.current?.querySelector<HTMLInputElement>("#font-project-input")?.focus());
                      }}>
                      <Plus size={14}/>
                    </button>
                  </div>
                </div>
              )}
              {(existingKits.length === 0 || showProjectInput) && (
                <div className="font-add-project-input">
                <div className="font-add-label-row">
                  <label className="font-add-label" htmlFor="font-project-input">
                    {tr("Web Project ID or URL")}
                  </label>
                  <button type="button" className="icon-btn"
                    aria-label={tr("How to add Adobe Fonts")}
                    data-tip={tr("How to add Adobe Fonts")}
                    onClick={() => {
                      close();
                      openHelp("text-adobe-fonts");
                    }}>
                    <CircleHelp size={14}/>
                  </button>
                </div>
                <input className="input" id="font-project-input" value={projectInput}
                  aria-label={tr("Web Project ID or URL")}
                  placeholder="abcdefg"
                  onChange={(event) => {
                    setProjectInput(event.target.value);
                    setChosenAdobe("");
                    setError(null);
                  }}/>
                <p className="hint">
                  <a href={WEB_PROJECTS_URL} target="_blank" rel="noopener noreferrer">
                    {tr("Adobe Fonts Web Projects")}
                  </a>
                  {tr(' shows the "Project ID". Enter that value here.')}
                  {" "}
                  {tr("If you have not created a Web Project, open a font page (for example, ")}
                  <a href="https://fonts.adobe.com/fonts/source-han-serif-japanese"
                    target="_blank" rel="noopener noreferrer">
                    {tr("Source Han Serif Japanese")}
                  </a>
                  {tr(') and click the "</>" button to create one.')}
                </p>
                </div>
              )}
              {kitId && (
                <div className="font-add-project" aria-live="polite">
                  <p className="hint">{tr("Web Project {kitId}", { kitId })}</p>
                  {projectStatus === "checking" && <p className="hint">{tr("Checking Adobe Web Project…")}</p>}
                  {projectStatus === "missing" && (
                    <p className="hint font-add-warning">
                      {tr("This Web Project was not found or is not published. Check it in Adobe Fonts.")}
                    </p>
                  )}
                  {projectStatus === "reachable" && (
                    <p className="hint" role="status">
                      {tr("Adobe's font delivery server responds, but its font list is unavailable. Check the project in Adobe Fonts.")}
                    </p>
                  )}
                  {projectStatus === "unknown" && (
                    <p className="hint" role="status">
                      {tr("Adobe's font list could not be retrieved. This does not prove the project has expired. Check the project in Adobe Fonts.")}
                    </p>
                  )}
                  {projectStatus === "available" && visibleAdobeFonts.length === 0 && (
                    <p className="hint">{tr("No published fonts were found. Add a font to this Web Project in Adobe Fonts.")}</p>
                  )}
                  {visibleAdobeFonts.length > 0 && (
                    <>
                      <p className="font-add-label">{tr("Choose a font from this Web Project")}</p>
                      <div className="font-add-results font-add-adobe-results" role="group"
                        aria-label={tr("Adobe project fonts")}>
                        {visibleAdobeFonts.map((font) => (
                          <button type="button" key={font.family}
                            className={"font-add-result" + (chosenAdobe === font.family ? " is-on" : "")}
                            aria-pressed={chosenAdobe === font.family}
                            onClick={() => { setChosenAdobe(font.family); setError(null); }}>
                            <span>{font.name}</span>
                            <small>{font.family}</small>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
          {error && <p className="hint font-add-warning" role="alert">{error}</p>}
        </div>
        <div className="font-add-footer">
          <button type="button" className="btn" onClick={close}>{tr("Cancel")}</button>
          <button type="button" className="btn btn-primary" disabled={
            provider === "google" ? busy || !(chosenGoogle || query.trim()) :
              !kitId || !availableFamily
          } onClick={() => provider === "google" ? void addGoogle() : addAdobe()}>
            {provider === "google" && busy ? tr("Checking…") : tr("Add")}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div style={{ display: "flex", gap: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <PropSelect prop="fontFamily"
            unsetLabel={tr("Inherited ({inheritedValue})", { inheritedValue })}
            options={fonts.map((font) => ({
              label: font.label,
              value: font.value,
              labelStyle: { fontFamily: '"' + font.value + '", sans-serif' },
            }))}/>
        </div>
        <button type="button" className="icon-btn" data-tip={tr("Add a font")}
          onClick={() => { pending.cancel(); setError(null); setOpen(true); }}>
          <Plus size={13}/>
        </button>
      </div>
      {open && (typeof document === "undefined" ? modal : createPortal(modal, document.body))}
    </>
  );
}
