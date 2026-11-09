import { DurableObject } from "cloudflare:workers";
import {
  StructuredDocumentStore, type DocumentSqlStorage,
  type SiteSnapshot, type SiteSaveResult,
} from "./lib/structured-document-store";
import type { DocPatch } from "./lib/doc-patch";

/**
 * A single site is always mapped to a single SQLite-backed Durable Object ID.
 * RPC methods are only reachable through the Worker binding, never from the
 * public HTTP routing table. Authentication is enforced by the caller.
 */
export class DocumentRoom extends DurableObject {
  private readonly documents = new StructuredDocumentStore(
    this.ctx.storage as unknown as DocumentSqlStorage,
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
  eraseDocument(): void {
    this.documents.erase();
  }
}
