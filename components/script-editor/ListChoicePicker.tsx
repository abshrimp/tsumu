"use client";

/**
 * Searchable list chooser used by script blocks. Its portal is not clipped by
 * the zoomed, draggable script workspace.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import { tr } from "../../lib/i18n";
import { anchoredMenuPos } from "../controls";

export interface ListChoice {
  value: string;
  label: string;
  group?: string;
}

export function ListChoicePicker({
  value,
  options,
  onChange,
  readOnly = false,
}: {
  value: string;
  options: ListChoice[];
  onChange: (value: string) => void;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({});
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = options.find((option) => option.value === value);
  const selectedLabel = selected?.label ?? (value ? value + tr("(not found)") : "");
  const placeholder = options.length ? tr("Select a list", "select_a_list_variant_1") : tr("No lists");
  const filter = query.trim().toLocaleLowerCase();
  const visible = open
    ? options.filter((option) => (option.value + " " + option.label).toLocaleLowerCase().includes(filter))
    : [];
  // Reserve the widest option's space so changing the selection never resizes
  // a script block. CJK characters take roughly twice an ASCII character width.
  const widest = options.reduce((max, option) => Math.max(max,
    Array.from(option.label).reduce((length, char) => length + (char.codePointAt(0)! > 255 ? 2 : 1), 0)), 0);
  const triggerWidth = Math.min(220, Math.max(105, widest * 7 + 38));

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const bounds = buttonRef.current.getBoundingClientRect();
    setPosition(anchoredMenuPos(bounds, Math.max(260, bounds.width), 320, false));
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const outside = (target: EventTarget | null) => target instanceof Node &&
      !buttonRef.current?.contains(target) && !menuRef.current?.contains(target);
    const onPointer = (event: PointerEvent) => {
      if (outside(event.target)) setOpen(false);
    };
    const onFocus = (event: FocusEvent) => {
      if (outside(event.target)) setOpen(false);
    };
    const onWheel = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("focusin", onFocus, true);
    window.addEventListener("wheel", onWheel, { capture: true, passive: true });
    window.addEventListener("touchmove", onWheel, { capture: true, passive: true });
    window.addEventListener("resize", onWheel);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("focusin", onFocus, true);
      window.removeEventListener("wheel", onWheel, true);
      window.removeEventListener("touchmove", onWheel, true);
      window.removeEventListener("resize", onWheel);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>('[data-list-index="' + active + '"]');
    if (!list || !row) return;
    const itemBounds = row.getBoundingClientRect();
    const listBounds = list.getBoundingClientRect();
    if (itemBounds.top < listBounds.top) list.scrollTop -= listBounds.top - itemBounds.top;
    if (itemBounds.bottom > listBounds.bottom) list.scrollTop += itemBounds.bottom - listBounds.bottom;
  }, [active, open, query]);

  const show = () => {
    setQuery("");
    setActive(Math.max(0, options.findIndex((option) => option.value === value)));
    setOpen(true);
  };
  const choose = (option?: ListChoice) => {
    if (!option) return;
    setOpen(false);
    if (option.value !== value) onChange(option.value);
    buttonRef.current?.focus();
  };
  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={"se-in se-pm-btn se-list-choice se-in-strong" + (value ? "" : " is-empty") + (open ? " is-open" : "")}
        style={{ width: triggerWidth }}
        disabled={readOnly || !options.length}
        aria-label={tr("Select a list", "select_a_list_variant_1")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => {
          if (!open && event.key === "ArrowDown") {
            event.preventDefault();
            show();
          }
        }}
      >
        <span>{selectedLabel || placeholder}</span>
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="dd-menu se-pm np se-list-picker"
          style={position}
          data-se-popover=""
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          <label className="np-search">
            <Search size={12} />
            <input
              autoFocus
              aria-label={tr("Search by name or ID")}
              placeholder={tr("Search by name or ID")}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  if (visible.length) setActive((current) =>
                    (current + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  choose(visible[Math.min(active, visible.length - 1)]);
                }
              }}
            />
          </label>
          <div id={menuId} className="np-list" role="listbox"
            aria-label={tr("Select a list", "select_a_list_variant_1")} ref={listRef}>
            {visible.map((option, index) => (
              <div key={option.value}>
                {option.group && option.group !== visible[index - 1]?.group && (
                  <div role="presentation" className="se-pm-head">{option.group}</div>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  data-list-index={index}
                  className={"dd-item np-row" + (index === active ? " is-key" : "") +
                    (option.value === value ? " is-sel" : "")}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(option)}
                >
                  <span className="se-pm-key" title={option.value}>{option.label}</span>
                </button>
              </div>
            ))}
            {!visible.length && <div className="se-pm-none">{tr("No lists")}</div>}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
