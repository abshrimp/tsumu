"use client";

import { useEditor } from "./store";
import { usePendingImport } from "./use-pending-import";

/** 破壊的な操作の確認は、利用者が確かめた文書にだけ適用する。 */
export function useDocumentConfirmation(scope: string) {
  const pending = usePendingImport(scope);
  return async (confirm: () => Promise<boolean>): Promise<boolean> => {
    const request = pending.begin();
    const doc = useEditor.getState().doc;
    try {
      const accepted = await confirm();
      return accepted && request.current() && useEditor.getState().doc === doc;
    } finally {
      request.finish();
    }
  };
}
