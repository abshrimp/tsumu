/**
 * Canonicalize imported script references only when the intended node is
 * unambiguous and reachable in the script's page or component.
 *
 * Editor script targets are HTML id attributes (attrId), not SiteDoc node IDs.
 * SiteDocs produced programmatically can confuse these independent identifiers.
 * Assign the missing attribute or rewrite a reference to an existing attribute.
 * Never guess names, repair cross-page references, or override an existing id.
 */
import { walkSteps } from "./script";
import { SELF_TARGET, type Script, type SiteDoc } from "./types";

type Scope = { ids: Set<string>; attrs: Set<string> };

export function normalizeImportedScriptTargets(doc: SiteDoc): SiteDoc {
  const nodes = doc.nodes;
  const occupied = new Set(
    Object.values(nodes).map((node) => node.attrId).filter((id): id is string => !!id)
  );

  const collect = (roots: string[], followInstances: boolean): Set<string> => {
    const found = new Set<string>();
    const pending = [...roots];
    while (pending.length) {
      const id = pending.pop()!;
      if (found.has(id)) continue;
      const node = nodes[id];
      if (!node) continue;
      found.add(id);
      pending.push(...node.children);
      if (followInstances && node.type === "instance") {
        const rootId = doc.components?.[node.componentId ?? ""]?.rootId;
        if (rootId) pending.push(rootId);
      }
    }
    return found;
  };
  const scoped = (ids: Set<string>): Scope => ({
    ids,
    attrs: new Set([...ids].map((id) => nodes[id]?.attrId).filter((id): id is string => !!id)),
  });
  const components = new Map<string, Scope>();
  const componentOwners = new Map<string, string>();
  for (const [id, component] of Object.entries(doc.components ?? {})) {
    const scope = scoped(collect([component.rootId], false));
    components.set(id, scope);
    for (const nodeId of scope.ids) componentOwners.set(nodeId, id);
  }

  const retarget = (target: string, scope: Scope): string => {
    if (!target || target === SELF_TARGET || scope.attrs.has(target) || !scope.ids.has(target)) return target;
    const node = nodes[target];
    if (!node) return target;
    if (!node.attrId) {
      let id = target;
      for (let suffix = 2; occupied.has(id); suffix++) id = target + "-" + suffix;
      node.attrId = id;
      occupied.add(id);
    }
    scope.attrs.add(node.attrId);
    return node.attrId;
  };

  const visitScripts = (scripts: Script[] | undefined, scope: Scope) => {
    for (const script of scripts ?? []) {
      walkSteps(script.steps, (step) => {
        if (step.kind === "if") {
          for (const condition of [step.cond, ...(step.conditions ?? [])]) {
            // A variable condition has no DOM target.
            if (condition.subject !== "var") condition.target = retarget(condition.target, scope);
          }
        } else if ("target" in step) {
          step.target = retarget(step.target, scope);
        }
      });
    }
  };

  const visited = new Set<string>();
  for (const page of Object.values(doc.pages)) {
    const pageScope = scoped(collect(page.children, true));
    visitScripts(page.pageScripts, pageScope);
    for (const id of pageScope.ids) {
      if (visited.has(id)) continue;
      visited.add(id);
      const scope = components.get(componentOwners.get(id) ?? "") ?? pageScope;
      visitScripts(nodes[id]?.scripts, scope);
    }
  }
  // Also canonicalize the definitions of components not used on any page yet.
  for (const scope of components.values()) {
    for (const id of scope.ids) {
      if (visited.has(id)) continue;
      visited.add(id);
      visitScripts(nodes[id]?.scripts, scope);
    }
  }
  return doc;
}
