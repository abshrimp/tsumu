"use client";

import { useRef, useState } from "react";
import { FileDown, FileUp, LoaderCircle } from "lucide-react";
import { showAlert, showConfirm } from "../lib/dialog";
import { userMessage } from "../lib/errors";
import { tr } from "../lib/i18n";
import { withImportUploads } from "../lib/import-uploads";
import { createSiteBackup } from "../lib/site-backup";
import { parseSiteImport, restoreImportAssets } from "../lib/site-import";
import { IMPORT_LIMITS } from "../lib/site-import-format";
import { usePendingImport } from "../lib/use-pending-import";
import { useEditor } from "../lib/store";

/** Manual backups live alongside automatic history and published rollbacks. */
export default function BackupFileControls({ onDone }: { onDone?: () => void }) {
  const doc = useEditor(s => s.doc);
  const input = useRef<HTMLInputElement>(null);
  const pending = usePendingImport("history-backup-file");
  const [exporting, setExporting] = useState(false);

  const exportBackup = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const blob = await createSiteBackup(doc);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `tsumu-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      link.click();
      // Safari may not have started the download when click() returns.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      void showAlert(userMessage(error, tr("Could not create the backup file.")));
    } finally {
      setExporting(false);
    }
  };

  const loadBackup = async (file: File) => {
    const operation = pending.begin();
    try {
      const zip = file.name?.toLowerCase().endsWith(".zip") ?? false;
      const limit = zip ? IMPORT_LIMITS.zipBytes : IMPORT_LIMITS.docBytes;
      if (file.size > limit) throw new Error(tr("The import file is too large."));
      const parsed = await parseSiteImport(new Uint8Array(await file.arrayBuffer()), zip ? "zip" : "doc");
      if (!operation.current()) return;
      if (parsed.warnings.length) {
        throw new Error(tr("Backup is incomplete: {details}", { details: parsed.warnings.join("; ").slice(0, 500) }));
      }
      const confirmed = await showConfirm(
        tr("Your current edits will be replaced with this file's content. Undo (⌘Z) brings back what you have now."),
        { title: tr("Load the backup?"), okLabel: tr("Load") },
      );
      if (!confirmed || !operation.current()) return;

      if (zip) {
        await withImportUploads(async createdPaths => {
          const restored = await restoreImportAssets(parsed, () => {
            if (!operation.current()) throw new Error("Backup import cancelled");
          }, createdPaths);
          if (!operation.current()) throw new Error("Backup import cancelled");
          if (restored.warnings.length) {
            throw new Error(tr("Backup is incomplete: {details}", { details: restored.warnings.join("; ").slice(0, 500) }));
          }
          useEditor.getState().restoreDoc(restored.doc);
        });
      } else {
        // Standalone doc.json is still an editable-document import; its remote URLs are not portable.
        useEditor.getState().restoreDoc(parsed.doc);
      }
      onDone?.();
    } catch (error) {
      if (operation.current()) {
        void showAlert(userMessage(error, tr("Make sure it's a backup file saved from this editor.")), {
          title: tr("Couldn't load this file"),
        });
      }
    } finally {
      operation.finish();
    }
  };

  const busy = exporting || pending.busy;
  return (
    <div className="hist-backup" data-tutorial="site-backup">
      <div className="hist-backup-label">
        <strong>{tr("Backup file")}</strong>
        <span className="hint">{tr("ZIP backups include all images, fonts and other assets, even if unused.")}</span>
      </div>
      <div className="hist-acts">
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void exportBackup()}>
          {exporting ? <LoaderCircle size={12} className="spin" /> : <FileDown size={12} />}
          {tr("Export backup ZIP")}
        </button>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => input.current?.click()}>
          {pending.busy ? <LoaderCircle size={12} className="spin" /> : <FileUp size={12} />}
          {tr("Load backup file")}
        </button>
        <input
          ref={input}
          type="file"
          aria-label={tr("Load backup file")}
          accept=".zip,.json,application/zip,application/json"
          style={{ display: "none" }}
          onChange={event => {
            const file = event.target.files?.[0];
            if (file) void loadBackup(file);
            event.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
