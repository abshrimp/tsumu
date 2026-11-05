"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useEditor } from "./store";

/** 選択先・値・パネルが変わったら、読み込み中だった操作の結果を反映しない。 */
export function usePendingImport(scope: string) {
  const revision = useRef(0);
  const historyRevision = useEditor((s) => s.historyRevision);
  const [busy, setBusy] = useState(false);
  const cancel = useCallback(() => {
    revision.current++;
    setBusy(false);
  }, []);

  useLayoutEffect(() => {
    cancel();
    return () => { revision.current++; };
  }, [scope, historyRevision, cancel]);

  const begin = () => {
    const own = ++revision.current;
    const history = useEditor.getState().historyRevision;
    setBusy(true);
    const historyChanged = () => useEditor.getState().historyRevision !== history;
    const current = () => revision.current === own && !historyChanged();
    return {
      current,
      historyChanged,
      finish: () => {
        if (current()) cancel();
      },
    };
  };
  return { busy, begin, cancel };
}
