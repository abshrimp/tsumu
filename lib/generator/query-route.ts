/**
 * Static URL query variants. One physical HTML file can display multiple
 * authored pages based on the browser's URLSearchParams, without a server.
 */
export const QUERY_VARIANT_RUNTIME = [
  "(function () {",
  '  const host = document.querySelector("[data-variant-root]");',
  '  const config = document.querySelector("script[data-page-variants]");',
  "  if (!host || !config) return;",
  "  let choices = [];",
  '  try { choices = JSON.parse(config.textContent || "[]"); }',
  '  catch (error) { console.warn("Invalid query variants", error); return; }',
  "  const search = new URLSearchParams(location.search);",
  "  const matching = choices.filter(function (choice) {",
  "    return Object.entries(choice.query).every(function (pair) {",
  "      return search.get(pair[0]) === pair[1];",
  "    });",
  "  });",
  "  matching.sort(function (a, b) {",
  "    return Object.keys(b.query).length - Object.keys(a.query).length;",
  "  });",
  "  const choice = matching[0] || choices[0];",
  "  if (!choice) return;",
  "  host.innerHTML = choice.html;",
  "  if (choice.title) document.title = choice.title;",
  "  if (choice.lang) document.documentElement.lang = choice.lang;",
  '  const description = document.querySelector(\'meta[name="description"]\');',
  '  if (description) description.setAttribute("content", choice.description || "");',
  "})();",
  "",
].join("\n");
