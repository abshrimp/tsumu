/**
 * AIに渡す、エディタのしくみの説明と、編集の操作（edit_site ツール）の定義。
 * どのプロバイダでも同じ内容を使う
 */

export const SYSTEM = `You are the AI assistant inside Tsumu, an open-source visual website builder. The user describes changes in natural language; you make them by calling the edit_site tool, then briefly tell the user what you changed.

How the editor's data works:
- A page is a tree of elements. Each element has an id, a type (box, image, divider, code, icon, field, media, embed, list, instance), a display name, optional text, a link, and styles.
- A "box" with text is a text element (a heading when "heading" is 1-6, a paragraph otherwise). A box without text is a container whose children are laid out with CSS flexbox or grid set on the box itself. Only boxes without text can contain elements.
- Styles are CSS properties with string values, e.g. fontSize "18px", backgroundColor "#111827", display "flex", gap "16px". They are stored per breakpoint and state: breakpoint "base" applies to every screen width (the desktop design); every other breakpoint id applies at that max-width and below, overriding base. States are default, hover, active, focus.
- Layout is set on the parent: use display flex / grid, flexDirection, gap, alignItems, justifyContent, padding. Prefer width in % or max-width over fixed pixel widths, and avoid fixed heights and absolute positioning so pages stay responsive. For mobile adjustments use set_style with a smaller breakpoint.
- "instance" elements are reused components; their contents can't be edited from the page. Elements with hasScripts have behavior attached; keep them unless asked.
- The special id "body" refers to the page body (page-wide background, font, etc.).

How to work:
- Read the current state in <editor_state>. "selectedElementId" is what the user has selected; "this", "it" or "the selected element" usually means that element.
- Make exactly the change requested, keep everything else as it is, and match the site's existing colors, fonts and spacing.
- Before calling edit_site, give one short sentence in the user's language describing the intended edits. This is a public progress update: describe actions, not private reasoning, and do not claim edits are already applied.
- Batch all operations for a request into as few edit_site calls as possible. New elements can be referenced later through "ref"; the tool returns a refs map of these names to element ids. Reuse those names or ids in subsequent calls. If the tool reports errors, fix only the failed operations with another call; successful operations have already been applied to the working copy.
- If the request is unclear or impossible with these operations (e.g. scripts, data lists, uploading images), say so briefly instead of guessing, and suggest what the user can do in the editor.
- Write new page text in the page's language ("language" in <editor_state>, a BCP 47 code) unless the user asks for another language. Use real, sensible text content rather than lorem ipsum. For images without a source the user gave, use https://picsum.photos/seed/<word>/<w>/<h> placeholders.
- Never claim a change was made unless edit_site confirmed it. If you need to edit the page, actually call edit_site rather than returning code or a plan.
- Reply in the same language as the user's latest message, in one to three short sentences, without listing element ids.`;

/** 自由なキーのまとまりを引数にできないAPI向けの補足 */
export const PORTABLE_NOTE = `

Notes for this tool:
- Write styles as CSS declaration strings, e.g. "font-size: 18px; background-color: #111827; display: flex". Use "property: unset" to remove a property.
- Create nested elements with separate insert operations: insert the container with a "ref", then insert each child with "parent" set to that ref.`;

export const TOOL_NAME = "edit_site";
export const TOOL_DESCRIPTION =
  "Apply edit operations to the page in order. Returns which operations were applied and any errors. All operations of one request are undone together by the user's undo.";

const OPS_DESCRIPTION =
  "One of: set_style {id, styles, breakpoint?, state?}; set_text {id, text, level?}; insert {node, parent?|after?|before?, index?}; move {id, parent?|after?|before?, index?}; delete {id}; duplicate {id, ref?}; rename {id, name}; set_link {id, link: {url|pageId, newTab?} | null}; set_image {id, src?, alt?}; set_hidden {id, breakpoints: string[]} (breakpoints where the element is hidden; [] shows it everywhere); update_page {title?, description?, name?}";

const OP_NAMES = [
  "set_style",
  "set_text",
  "insert",
  "move",
  "delete",
  "duplicate",
  "rename",
  "set_link",
  "set_image",
  "set_hidden",
  "update_page",
];

/**
 * edit_site の引数の JSON Schema。
 * portable = true のときは、スタイルを CSS の文字列にし、要素の入れ子を使わない形にする
 * （Gemini などの OpenAI 互換APIは、自由なキーのまとまりや入れ子の定義をうまく扱えないため）
 */
export function editToolSchema(portable: boolean): Record<string, unknown> {
  const styles = portable
    ? { type: "string", description: 'CSS declarations, e.g. "font-size: 18px; color: #111827"' }
    : {
        type: "object",
        description: "camelCase CSS property -> value (string, or number for px). null removes the property.",
        additionalProperties: true,
      };
  const link = {
    type: "object",
    description: "Open a URL or one of the site's pages. Omit or null to remove the link.",
    properties: { url: { type: "string" }, pageId: { type: "string" }, newTab: { type: "boolean" } },
  };
  const node: Record<string, unknown> = {
    type: "object",
    description: "An element to create.",
    properties: {
      ref: { type: "string", description: "Temporary name to refer to this element from later operations in the same call" },
      type: { type: "string", enum: ["box", "text", "heading", "button", "image", "divider", "code"] },
      name: { type: "string", description: "Display name in the layers panel" },
      text: { type: "string", description: "Text for text, heading and button" },
      level: { type: "integer", description: "Heading level 1-6" },
      tag: {
        type: "string",
        enum: ["section", "header", "footer", "nav", "main", "article", "div", "form", "span"],
        description: "Semantic tag for a box",
      },
      styles,
      hover: { ...styles, description: "Styles while hovered" },
      responsive: portable
        ? {
            type: "array",
            description: "Styles for a breakpoint and smaller screens",
            items: {
              type: "object",
              properties: { breakpoint: { type: "string" }, styles },
              required: ["breakpoint", "styles"],
            },
          }
        : { type: "object", description: "breakpoint id -> styles for that width and below", additionalProperties: styles },
      link,
      src: { type: "string", description: "Image URL" },
      alt: { type: "string", description: "Image description for accessibility" },
      html: { type: "string", description: "HTML for a code element" },
      ...(portable
        ? {}
        : { children: { type: "array", description: "Child elements (box only)", items: { type: "object" } } }),
    },
    required: ["type"],
  };
  return {
    type: "object",
    properties: {
      operations: {
        type: "array",
        items: {
          type: "object",
          description: OPS_DESCRIPTION,
          properties: {
            op: { type: "string", enum: OP_NAMES },
            id: { type: "string" },
            styles,
            breakpoint: { type: "string" },
            state: { type: "string", enum: ["default", "hover", "active", "focus"] },
            text: { type: "string" },
            level: { type: "integer" },
            node,
            parent: { type: "string", description: 'Parent box id or ref, or "page" for the top level of the page' },
            index: { type: "integer", description: "Position among the parent's children (default: end)" },
            after: { type: "string", description: "Place right after this element (instead of parent/index)" },
            before: { type: "string", description: "Place right before this element (instead of parent/index)" },
            ref: { type: "string" },
            name: { type: "string" },
            link,
            src: { type: "string" },
            alt: { type: "string" },
            breakpoints: { type: "array", items: { type: "string" } },
            title: { type: "string" },
            description: { type: "string" },
          },
          required: ["op"],
        },
      },
    },
    required: ["operations"],
  };
}
