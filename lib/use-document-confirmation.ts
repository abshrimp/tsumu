"use client";

import { useEditor } from "./store";
import { usePendingImport } from "./use-pending-import";

/** A destructive confirmation applies only to the document the user inspected. */
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
