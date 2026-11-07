/** Browser-native GET form for the React/Vite SPA export. */
export const REACT_SEARCH_FORM = String.raw`import { useEffect, useRef, type ComponentPropsWithoutRef } from "react";

function fields(form: HTMLFormElement): string[] {
  return Array.from(form.elements).map((el) => (el as HTMLInputElement).name).filter(Boolean);
}

export default function SearchForm({ children, ...rest }: ComponentPropsWithoutRef<"form">) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const restore = () => {
      const form = ref.current;
      if (!form) return;
      const qs = new URLSearchParams(window.location.search);
      const submitted = fields(form).some((name) => qs.has(name));
      for (const el of Array.from(form.elements)) {
        const input = el as HTMLInputElement;
        if (!input.name || input.type === "file") continue;
        const value = qs.get(input.name);
        if (el instanceof HTMLSelectElement) {
          const options = Array.from(el.options);
          const pick = (value === null ? undefined : options.find((o) => o.value === value)) ??
            options.find((o) => o.defaultSelected) ?? options[0];
          if (pick) pick.selected = true;
        } else if (input.type === "checkbox" || input.type === "radio") {
          input.checked = submitted ? (value !== null && (input.value === value || value === "on")) : input.defaultChecked;
        } else {
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
        event.preventDefault();
        const form = event.currentTarget;
        const qs = new URLSearchParams(window.location.search);
        for (const name of fields(form)) qs.delete(name);
        for (const [key, value] of new FormData(form).entries()) {
          if (typeof value === "string" && value !== "") qs.set(key, value);
        }
        window.location.assign(window.location.pathname + (qs.size ? "?" + qs : "") + window.location.hash);
      }}
    >
      {children}
    </form>
  );
}
`;
