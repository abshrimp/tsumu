import { DurableObject } from "cloudflare:workers";
import {
  StructuredDocumentStore, type DocumentSqlStorage,
  type SiteSnapshot, type SiteSaveResult,
} from "./lib/structured-document-store";
import type { DocPatch } from "./lib/doc-patch";
import { extractAssetReferences } from "./lib/asset-gc-plan";

/**
 * A single site is always mapped to a single SQLite-backed Durable Object ID.
 * RPC methods are only reachable through the Worker binding, never from the
 * public HTTP routing table. Authentication is enforced by the caller.
 */
export class DocumentRoom extends DurableObject {
  private readonly documents = new StructuredDocumentStore(
    (this.ctx as unknown as { storage: DocumentSqlStorage }).storage,
  );

  getSnapshot(): SiteSnapshot | null {
    return this.documents.snapshot();
  }
  getMetadata(): { rev: string; savedAt: number } | null {
    return this.documents.meta();
  }
  replaceDocument(raw: string, base: string | null): SiteSaveResult {
    return this.documents.replace(raw, base);
  }
  patchDocument(patch: DocPatch, base: string): SiteSaveResult {
    return this.documents.patch(patch, base);
  }
  listAssetReferences(): Array<{ path: string; bytes: number | null }> {
    return this.documents.assetReferences();
  }
  listBackups(): Array<{ day: number; savedAt: number; bytes: number }> {
    return this.documents.listBackups();
  }

  /**
   * Return asset references from the current persisted editor document only.
   * Old backup and GitHub publication revisions are intentionally excluded
   * from the seven-day unused-asset retention policy.
   */
  gcAssetReferences(): string[] {
    const current = this.documents.snapshot();
    return current ? [...extractAssetReferences(current.body)] : [];
  }
  readBackup(day: number): string | null {
    return this.documents.readBackup(day);
  }
  eraseDocument(): void {
    this.documents.erase();
  }
}
