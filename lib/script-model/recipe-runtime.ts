import type { ValueTransform } from "./compose";

export type RecipeEvaluation =
  | { kind: "value"; value: unknown }
  | { kind: "missing" }
  | { kind: "error"; code: string };

/**
 * Pure, self-contained evaluator shared by editor samples, SSR and client JS.
 * Do not capture imports or local helpers: the exported site embeds this function.
 * Undefined is missing; null is a real value. No input object is mutated.
 */
export function evaluateValueRecipe(input: unknown, steps: readonly ValueTransform[]): RecipeEvaluation {
  const failure = (code: string): RecipeEvaluation => ({ kind: "error", code });
  const missing: RecipeEvaluation = { kind: "missing" };
  if (!Array.isArray(steps) || steps.length > 32) return failure("invalid-recipe");
  let current = input;
  let absent = current === undefined;
  try {
    for (const step of steps) {
      if (!step || typeof step !== "object" || !("kind" in step)) return failure("invalid-recipe");
      switch (step.kind) {
        case "fallback":
        case "fallback-nullish":
          if (typeof step.text !== "string" || step.text.length > 10000) return failure("invalid-recipe");
          if (absent || (step.kind === "fallback-nullish" && current === null)) {
            current = step.text;
            absent = false;
          }
          break;
        case "field":
        case "has": {
          if (absent) {
            if (step.kind === "has") { current = false; absent = false; }
            break;
          }
          if (typeof step.key !== "string" || step.key.length > 256 || !current || typeof current !== "object" || Array.isArray(current))
            return failure("type-mismatch");
          const present = Object.prototype.hasOwnProperty.call(current, step.key);
          if (step.kind === "has") { current = present; absent = false; }
          else { current = present ? (current as Record<string, unknown>)[step.key] : undefined; absent = !present; }
          break;
        }
        case "index": {
          if (absent) break;
          if (!Array.isArray(current) || !Number.isInteger(step.index) || step.index < -1 || step.index > 1000000)
            return failure("type-mismatch");
          const index = step.index === -1 ? current.length - 1 : step.index;
          absent = !Object.prototype.hasOwnProperty.call(current, index);
          current = absent ? undefined : current[index];
          break;
        }
        case "length":
          if (absent) break;
          if (!Array.isArray(current)) return failure("type-mismatch");
          current = current.length;
          break;
        case "format":
          if (absent) break;
          if (typeof current !== "string" && typeof current !== "number" && typeof current !== "boolean")
            return failure("type-mismatch");
          current = String(current);
          break;
        case "stringify":
          if (absent) break;
          current = JSON.stringify(current);
          if (typeof current !== "string" || current.length > 100000) return failure("limit-exceeded");
          break;
        case "parse":
          if (absent) break;
          if (typeof current !== "string" || current.length > 100000) return failure("type-mismatch");
          try { current = JSON.parse(current); } catch { return failure("invalid-json"); }
          break;
        default:
          return failure("invalid-recipe");
      }
    }
    return absent ? missing : { kind: "value", value: current };
  } catch {
    return failure("invalid-recipe");
  }
}
