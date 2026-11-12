"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { useEditor } from "../lib/store";
import { CheckList, docWithSvgFilters } from "./PublishModal";
import { showAlert } from "../lib/dialog";
import { useEscapeToClose } from "../lib/use-escape-to-close";
import { runChecks, type CheckResult } from "../lib/generator/checks";
import { exportProjectZip } from "../lib/exportZip";
import { exportLimitations, exportScopeDoc, DEFAULT_EXPORT_OPTIONS, EXPORT_FRAMEWORK_OPTIONS, type ExportFormat, type ExportLanguage, type ExportStyle, type ExportScope, type ExportOptions } from "../lib/export-formats";
import { Dropdown } from "./controls";
import { userMessage } from "../lib/errors";
import { tr, trNodes } from "../lib/i18n";

export default function ExportModal({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const activePageId = useEditor((s) => s.activePageId);
  const selectedNodeId = useEditor((s) => s.selection);
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState<ExportFormat>(DEFAULT_EXPORT_OPTIONS.framework);
  const [language, setLanguage] = useState<ExportLanguage>(DEFAULT_EXPORT_OPTIONS.language);
  const [style, setStyle] = useState<ExportStyle>(DEFAULT_EXPORT_OPTIONS.style);
  const [scope, setScope] = useState<ExportScope>(DEFAULT_EXPORT_OPTIONS.scope);
  const options: ExportOptions = {
    framework: format, language, style, scope,
    pageId: activePageId,
    nodeId: selectedNodeId ?? undefined,
  };
  const checks = useMemo<CheckResult[]>(() => {
    const compatibility = exportLimitations(doc, options);
    let scoped: typeof doc | null = null;
    try {
      scoped = exportScopeDoc(doc, options);
    } catch {
      // The scope error is already included in the compatibility list.
    }
    return [
      ...(scoped ? runChecks(scoped, { requireHomePage: scope === "project" }) : []),
      ...compatibility.map((message): CheckResult => ({ level: "error", message })),
    ];
  }, [doc, activePageId, selectedNodeId, format, language, style, scope]);
  const hasError = checks.some((check) => check.level === "error");
  useEscapeToClose(onClose, !busy);

  const description = format === "html"
    ? tr("Download a ZIP with ready-to-use HTML, CSS, JavaScript and images. Extract it and open index.html in your browser. No npm or build step is needed.")
    : format === "single-html"
      ? tr("Download one HTML file with embedded images, fonts, CSS and JavaScript. Multiple pages cannot be exported at the same time.")
      : trNodes("Export as a {framework} project. After extracting the files, run {cmd} to start.", {
          framework: tr(EXPORT_FRAMEWORK_OPTIONS.find((item) => item.value === format)?.label ?? "Next.js"),
          cmd: <span className="kbd">npm install && npm run dev</span>,
        });

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal export-modal" onClick={(event) => event.stopPropagation()}>
        <h2>{tr("Export code")}</h2>
        <p className="modal-desc">{description}</p>

        <fieldset className="export-options" disabled={busy}>
          <div className="export-option">
            <div className="export-option-label">{tr("Framework")}</div>
            <Dropdown
              value={format}
              options={EXPORT_FRAMEWORK_OPTIONS.map((option) => ({ ...option, label: tr(option.label) }))}
              onChange={(value) => {
                setFormat(value as ExportFormat);
                if (value === "single-html" && scope === "project") setScope("page");
                if (value === "html" || value === "single-html") {
                  setLanguage("javascript");
                  setStyle("css");
                }
              }}
              style={{ width: "100%" }}
              title={tr("Framework")}
            />
          </div>
          <div className="export-option-grid">
            <div className="export-option">
              <div className="export-option-label">{tr("Language")}</div>
              <Dropdown
                value={language}
                options={format === "html" || format === "single-html"
                  ? [{ value: "javascript", label: "JavaScript" }]
                  : [
                      { value: "typescript", label: "TypeScript" },
                      { value: "javascript", label: "JavaScript" },
                    ]}
                onChange={(value) => setLanguage(value as ExportLanguage)}
                style={{ width: "100%" }}
                title={tr("Language")}
              />
            </div>
            <div className="export-option">
              <div className="export-option-label">{tr("Style")}</div>
              <Dropdown
                value={style}
                options={format === "html" || format === "single-html"
                  ? [{ value: "css", label: "CSS" }]
                  : [
                      { value: "css", label: "CSS" },
                      { value: "css-modules", label: "CSS Modules" },
                      { value: "tailwind", label: "Tailwind CSS" },
                    ]}
                onChange={(value) => setStyle(value as ExportStyle)}
                style={{ width: "100%" }}
                title={tr("Style")}
              />
            </div>
          </div>
          <div className="export-option">
            <div className="export-option-label">{tr("Export scope")}</div>
            <Dropdown
              value={scope}
              options={[
                { value: "component", label: tr("Selected component") },
                { value: "page", label: tr("Current page") },
                ...(format === "single-html" ? [] : [{ value: "project", label: tr("Entire project") }]),
              ]}
              onChange={(value) => setScope(value as ExportScope)}
              style={{ width: "100%" }}
              title={tr("Export scope")}
            />
          </div>
        </fieldset>
        {style === "tailwind" && (
          <p className="hint export-note">
            {tr("Tailwind utilities are available. The CSS that Tsumu generates is still included to preserve your design.")}
          </p>
        )}
        {scope === "component" && (
          <p className="hint export-note">
            {tr("Exports the selected element and its descendants as a standalone page.")}
          </p>
        )}
        {(format === "html" || format === "single-html") && (
          <p className="hint export-note">
            {tr("The HTML format produces files you can open directly, so the language is fixed to JavaScript and the styling to CSS.")}
          </p>
        )}
        {(format === "html" || format === "single-html") && (
          <p className="hint export-note">
            {tr("Fetching external data requires the API to allow CORS. file:// has restrictions, so test on localhost or a similar server.")}
          </p>
        )}
        {format === "single-html" && (
          <p className="hint export-note">
            {tr("External APIs and embedded videos still need an internet connection. If external images cannot be embedded, import them as assets and try again.")}
          </p>
        )}
        {format !== "single-html" && (
          <p className="hint export-note">
            {scope === "project"
              ? tr("The ZIP contains the site’s complete editable source (_tsumu/doc.json). Publish only the generated website files, not its editable data, to a public host.")
              : tr("The ZIP contains the editable source for the exported scope (_tsumu/doc.json). Publish only the generated website files, not its editable data, to a public host.")}
          </p>
        )}
        <CheckList checks={checks} onClose={onClose} />

        <div className="modal-actions">
          <button className="btn" disabled={busy} onClick={onClose}>
            {tr("Cancel")}
          </button>
          <button
            className="btn btn-primary"
            disabled={hasError || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const missing = await exportProjectZip(await docWithSvgFilters(doc), options);
                onClose();
                if (missing.length) {
                  void showAlert(
                    tr("These images weren't found in storage, so they were left out of the ZIP (they may have been deleted).\n{p1}", { p1: missing.join("\n") }),
                    { title: tr("Downloaded without some images") }
                  );
                }
              } catch (error) {
                const title = format === "single-html" ? tr("Could not generate the HTML file") : tr("Couldn't create the zip");
                void showAlert(userMessage(error, title), { title });
              } finally {
                setBusy(false);
              }
            }}
          >
            <Download size={13} />
            {busy ? tr("Generating…") : format === "single-html" ? tr("Download HTML") : tr("Download zip")}
          </button>
        </div>
      </div>
    </div>
  );
}
