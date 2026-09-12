import { DurableObject } from "cloudflare:workers";
import {
  StructuredDocumentStore, type DocumentSqlStorage,
  type SiteSnapshot, type SiteSaveResult,
} from "./lib/structured-document-store";
import type { DocPatch } from "./lib/doc-patch";
import { extractAssetReferences } from "./lib/asset-gc-plan";

/**
 * 1つのサイトは、常に1つの SQLite 版 Durable Object の ID に対応する。
 * RPC のメソッドに届くのは Worker のバインディング経由だけで、公開された HTTP の
 * ルーティングからは呼べない。認証は呼び出し側で行う。
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
   * 現在保存されているエディタの文書のアセット参照だけを返す。
   * 古いバックアップや GitHub に公開した版は、7日間の未使用アセットの保持期間の
   * 判定から意図的に除いている。
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
