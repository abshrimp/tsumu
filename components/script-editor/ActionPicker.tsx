"use client";

/**
 * 追加する動作を選ぶパネル。分類ごとに、アイコンと短い名前だけを並べる（説明文は置かない）。
 * 言葉でも検索できる。その場所に置けない動作は薄く表示し、理由はツールチップで伝える。
 */

import { useId, useMemo, useRef, useState, type RefObject } from "react";
import { Search } from "lucide-react";
import { isEnterKey } from "../../lib/keys";
import { tr } from "../../lib/i18n";
import { type ScriptStep } from "../../lib/types";
import { CAT_INFO, CAT_ORDER, PLACE_REASON, catStyle, findActions, type ActionItem } from "./catalog";
import { Popover } from "./Popover";

interface ActionPlaceInfo {
  insideLoop: boolean;
}

function blockedReason(item: ActionItem, place: ActionPlaceInfo): string | null {
  if (item.place === "inside-loop" && !place.insideLoop) return PLACE_REASON["inside-loop"];
  return null;
}

export function ActionPicker({
  anchor,
  place,
  onPick,
  onClose,
}: {
  anchor: RefObject<HTMLElement | null>;
  place: ActionPlaceInfo;
  onPick: (step: ScriptStep) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const found = useMemo(() => findActions(query), [query]);
  // 分類ごとにまとめ、キーボードで動く順番は画面に並ぶ順番と同じにする。
  const groups = useMemo(() => CAT_ORDER
    .map((cat) => ({ cat, items: found.filter((item) => item.cat === cat) }))
    .filter((group) => group.items.length), [found]);
  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const current = Math.min(active, Math.max(0, flat.length - 1));

  const choose = (item: ActionItem | undefined) => {
    if (!item || blockedReason(item, place)) return;
    onPick(item.make());
  };
  const move = (direction: number) => {
    if (!flat.length) return;
    const next = Math.max(0, Math.min(flat.length - 1, current + direction));
    setActive(next);
    // 一覧の中だけをスクロールする（scrollIntoView は外側までスクロールすることがある）。
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-action-index="${next}"]`);
    if (!list || !row) return;
    const rowBox = row.getBoundingClientRect();
    const listBox = list.getBoundingClientRect();
    if (rowBox.top < listBox.top) list.scrollTop -= listBox.top - rowBox.top + 4;
    else if (rowBox.bottom > listBox.bottom) list.scrollTop += rowBox.bottom - listBox.bottom + 4;
  };

  let index = -1;
  return (
    <Popover anchor={anchor} onClose={onClose} width={440} height={470}
      className="se-picker" label={tr("Add an action")}>
      <label className="se-picker-search">
        <Search size={14} aria-hidden="true" />
        <input
          data-autofocus=""
          type="search"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={flat.length ? `${listId}-${current}` : undefined}
          aria-label={tr("Search actions")}
          placeholder={tr("Search actions")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (event.key === "Escape") {
              // 検索欄の標準の動作（入力した文字を消すだけ）ではなく、パネルを閉じる
              event.preventDefault();
              event.stopPropagation();
              onClose();
              return;
            }
            // 2列に並んでいるので、上下は2つ分、左右は1つ分動く
            const step = { ArrowDown: 2, ArrowUp: -2, ArrowRight: 1, ArrowLeft: -1 }[event.key];
            if (step && (Math.abs(step) === 2 || !query)) {
              event.preventDefault();
              move(step);
            } else if (isEnterKey(event)) {
              event.preventDefault();
              choose(flat[current]);
            }
          }}
        />
      </label>
      <div className="se-picker-list" id={listId} role="listbox" aria-label={tr("Actions")} ref={listRef}>
        {groups.map((group) => (
          <div key={group.cat} role="group" aria-label={CAT_INFO[group.cat].label} className="se-picker-group">
            <div className="se-picker-cat" style={catStyle(group.cat)} aria-hidden="true">
              {CAT_INFO[group.cat].label}
            </div>
            <div className="se-picker-grid">
            {group.items.map((item) => {
              index += 1;
              const itemIndex = index;
              const reason = blockedReason(item, place);
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="option"
                  id={`${listId}-${itemIndex}`}
                  data-action-index={itemIndex}
                  data-action={item.key}
                  aria-selected={itemIndex === current}
                  aria-disabled={reason ? true : undefined}
                  title={reason ?? item.hint}
                  className={`se-picker-item${itemIndex === current ? " is-key" : ""}${reason ? " is-blocked" : ""}`}
                  style={catStyle(item.cat)}
                  onMouseMove={() => setActive(itemIndex)}
                  onClick={() => choose(item)}
                >
                  <span className="se-ico" aria-hidden="true"><Icon size={15} strokeWidth={2} /></span>
                  <span className="se-picker-title">{item.title}</span>
                </button>
              );
            })}
            </div>
          </div>
        ))}
        {!flat.length && (
          <p className="se-picker-none" role="status">
            {tr("Nothing matches \"{query}\". Try another word.", { query: query.trim() })}
          </p>
        )}
      </div>
    </Popover>
  );
}
