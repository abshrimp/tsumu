import { SEARCH_FORM_QUERY } from "./search-form";

/** React / Vite の SPA の書き出しで使う、ブラウザ標準の GET のフォーム。 */
export const REACT_SEARCH_FORM = String.raw`import { useEffect, useRef, type ComponentPropsWithoutRef } from "react";

function fieldNames(form: HTMLFormElement): string[] {
  return Array.from(form.elements).map((el) => (el as HTMLInputElement).name).filter(Boolean);
}

${SEARCH_FORM_QUERY}

export default function SearchForm({ children, ...rest }: ComponentPropsWithoutRef<"form">) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const restore = () => {
      const form = ref.current;
      if (!form) return;
      const qs = new URLSearchParams(window.location.search);
      const submitted = fieldNames(form).some((name) => qs.has(name));
      for (const el of Array.from(form.elements)) {
        const input = el as HTMLInputElement;
        if (!input.name || ["file", "button", "submit", "reset", "image"].includes(input.type)) continue;
        const values = qs.getAll(input.name);
        const value = values[0] ?? null;
        if (el instanceof HTMLSelectElement) {
          const options = Array.from(el.options);
          // 複数選択は同名のクエリをすべて復元し、以前の選択も解除する。
          if (el.multiple) {
            for (const option of options)
              option.selected = submitted ? values.includes(option.value) : option.defaultSelected;
            continue;
          }
          const pick = (value === null ? undefined : options.find((o) => o.value === value)) ??
            options.find((o) => o.defaultSelected) ?? options[0];
          if (pick) pick.selected = true;
        } else if (input.type === "checkbox" || input.type === "radio") {
          input.checked = submitted
            ? (input.type === "radio" ? input.value === value : values.includes(input.value))
            : input.defaultChecked;
        } else if ("defaultValue" in input) {
          input.value = value ?? input.defaultValue;
        }
      }
      form.dispatchEvent(new Event("input", { bubbles: true }));
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  return (
    <form
      ref={ref}
      {...rest}
      method="get"
      onSubmit={(event) => {
        const qs = searchQuery(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
        if (!qs) return;
        event.preventDefault();
        window.location.assign(window.location.pathname + (qs.size ? "?" + qs : "") + window.location.hash);
      }}
    >
      {children}
    </form>
  );
}
`;
