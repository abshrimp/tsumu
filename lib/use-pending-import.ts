"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** 選択先・値・パネルが変わったら、読み込み中だった操作の結果を反映しない。 */
export function usePendingImport(scope: string) {
  const revision = useRef(0);
  const [busy, setBusy] = useState(false);
  const cancel = useCallback(() => {
    revision.current++;
    setBusy(false);
  }, []);

  useLayoutEffect(() => {
    cancel();
    return () => { revision.current++; };
  }, [scope, cancel]);

  const begin = () => {
    const own = ++revision.current;
    setBusy(true);
    const current = () => revision.current === own;
    return {
      current,
      finish: () => {
        if (current()) cancel();
      },
    };
  };
  return { busy, begin, cancel };
}
