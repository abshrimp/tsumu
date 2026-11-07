export type NodeType =
  | "box"
  | "image"
  | "divider"
  | "code"
  | "instance"
  | "icon"
  | "field"
  | "media"
  | "embed"
  | "list";

export type FieldKind =
  | "input"
  | "textarea"
  | "select"
  | "checkbox"
  | "radio"
  | "file"
  | "submit";

export type InputType =
  | "text"
  | "email"
  | "password"
  | "number"
  | "tel"
  | "url"
  | "search"
  | "date"
  | "time"
  | "datetime-local"
  | "month"
  | "week"
  | "color"
  | "range";

export interface FieldContent {
  kind: FieldKind;
  /** HTML input type used when kind is input. */
  inputType?: InputType;
  /** Text displayed beside a checkbox or radio button; supports {variable} interpolation. */
  label?: string;
  /** Initial input, textarea, or select value; supports {variable} interpolation. */
  defaultValue?: string;
  /** Hint shown when a field is empty; supports {variable} interpolation. */
  placeholder?: string;
  /** Select options; support {variable} interpolation. */
  options?: string[];
  /** Whether a checkbox or radio button is checked initially. */
  checked?: boolean;
  /** Radio group name. Only one button per group can be selected; the selected value is available through {groupName}. */
  group?: string;
  /** Whether the control is disabled. */
  disabled?: boolean;
  /** Require a value before submitting the form. */
  required?: boolean;
  /** Minimum, maximum, and step values for numeric and date/time controls. */
  min?: string;
  max?: string;
  step?: string;
  /** Maximum character count for text inputs and textareas. */
  maxLength?: number;
  /** Number of visible rows in a textarea. */
  rows?: number;
  /** Accepted file types, such as image/* or .pdf. */
  accept?: string;
  /** Whether the file input accepts multiple files. */
  multiple?: boolean;
}

export interface MediaContent {
  kind: "video" | "audio";
  src: string;
  assetId?: string;
  loop?: boolean;
  autoplay?: boolean;
  muted?: boolean;
}

export interface EmbedContent {
  kind: "youtube" | "map" | "url";
  /** User input: a YouTube URL, an address, or an embeddable URL. */
  src: string;
}

export interface IconContent {
  /** Lucide icon name in kebab-case. */
  name: string;
  /** SVG markup used for inline rendering. */
  svg: string;
}

export interface Motion {
  id: string;
  /** State triggers create transitions; other triggers create animations. */
  trigger: "state" | "hover" | "active" | "load" | "in-view";
  /** CSS property monitored by a state transition. */
  property?: string;
  /** Named animation keyframes, or custom when customKeyframes is supplied. */
  keyframes?: string;
  /** Body of an @keyframes rule, e.g. from {...} to {...}. */
  customKeyframes?: string;
  /** Duration in seconds. */
  duration: number;
  /** Delay in seconds. */
  delay: number;
  easing: string;
  /** A repeat count of -1 means infinite repetitions. */
  repeat?: number;
  direction?: "normal" | "reverse" | "alternate";
  fillMode?: "both" | "forwards" | "backwards" | "none";
}

export type Semantic =
  | "auto"
  | "form"
  | "button"
  | "div"
  | "section"
  | "header"
  | "footer"
  | "nav"
  | "main"
  | "article"
  | "span"
  | "custom";

/** The base breakpoint applies at every width. Others use breakpoint IDs; defaults include lg (tablet), md (landscape mobile), and sm (mobile). Custom breakpoints may be added in site settings. */
export type Breakpoint = string;

/** A responsive breakpoint for styles at or below a specified width. */
export interface BreakpointDef {
  id: string;
  label: string;
  /** Maximum viewport width in pixels (max-width). */
  maxWidth: number;
}
export type StyleState = "default" | "hover" | "active" | "focus";

/** Map of camelCase CSS properties to string values. */
export type StyleMap = Record<string, string>;

/** Breakpoints map to interaction states, then to style declarations; absent breakpoints have no overrides. */
export type NodeStyles = Record<Breakpoint, Partial<Record<StyleState, StyleMap>>>;

/** Reserved ID used to select the document body as an editable element. */
export const BODY_NODE_ID = "__body__";

export interface LinkSetting {
  kind: "url" | "page";
  url?: string;
  pageId?: string;
  newTab?: boolean;
  /** Position of the synthetic click-to-open event in the script editor. */
  pos?: ScriptPos;
}

/* Script events and actions. */

/** Reserved target for the current element. */
export const SELF_TARGET = "@self";

/** Reserved target for the current page in the script editor. */
export const PAGE_TARGET = "@page";

export type ScriptTrigger =
  | "click"
  | "hover-start"
  | "hover-end"
  | "change"
  | "load"
  | "in-view";

export interface ScriptPos {
  x: number;
  y: number;
}

export type ScriptOp =
  | "eq"
  | "neq"
  | "contains"
  | "not-contains"
  | "starts-with"
  | "ends-with"
  | "gt"
  | "lt"
  | "empty"
  | "not-empty"
  /** Matches any item in a comma-separated value or array. */
  | "in";

export interface ScriptCond {
  /** Condition subject: element value, checked state, visibility, hover state, or a variable. */
  subject: "value" | "checked" | "visible" | "hovered" | "var";
  /** Target attribute ID; SELF_TARGET means the current element. Not used for variable conditions. */
  target: string;
  /** Left-hand operand for variable conditions; may interpolate {variables} into text. */
  left?: string;
  /** Comparison operator for value and variable conditions. */
  op?: ScriptOp;
  value?: string;
  /** Negate checked, visible, or hovered conditions. */
  not?: boolean;
}

/** Condition used for array filtering. */
export interface FilterCond {
  field: string;
  op: ScriptOp;
  /** Expand {variables} at runtime. */
  value: string;
  /** Combine with the preceding condition using AND; otherwise use OR. */
  and?: boolean;
}

export type ScriptStep = { id: string } & (
  | { kind: "show" | "hide" | "toggle"; target: string }
  | { kind: "open-page"; pageId: string; newTab?: boolean }
  | { kind: "open-url"; url: string; newTab?: boolean }
  | { kind: "scroll-to"; target: string }
  | { kind: "set-value"; target: string; value: string }
  /** Enable, disable, or toggle an input or button. */
  | { kind: "set-enabled"; target: string; op: "enable" | "disable" | "toggle" }
  | {
      /** Filter array entries by a field. Replaces an existing filter on the same field. */
      kind: "filter-array";
      /** Array variable name. */
      array: string;
      field: string;
      op: ScriptOp;
      /** Expand {variables} at runtime. */
      value: string;
      /** Extra filter conditions connected by AND/OR. Items pass if any AND-connected group matches. */
      or?: FilterCond[];
      /** Filter slot number. Re-running a filter using the same number replaces it. */
      no?: number;
      /** Combine this filter with the other filters on this array using AND by default. */
      join?: "and" | "or";
    }
  | {
      kind: "unfilter-array";
      array: string;
      /** Filter slot number to remove; omit to remove all filters. */
      no?: number;
    }
  | {
      /** Sort entries in an array by the given field. Replaces the existing sort on that array. */
      kind: "sort-array";
      array: string;
      field: string;
      dir: "asc" | "desc";
    }
  | {
      /** Save a string in the browser (localStorage, then cookies, then in-memory fallback). */
      kind: "store-save";
      key: string;
      /** Value may interpolate {variables}. */
      value: string;
      /** Also store a cookie shared across subdomains of the published site. */
      shared?: boolean;
    }
  | {
      /** Load a stored string into a variable; use an empty string when missing. */
      kind: "store-load";
      key: string;
      into: string;
      /** Read the shared cross-subdomain cookie first. */
      shared?: boolean;
    }
  | {
      /** Split a string into an array using a delimiter. */
      kind: "split";
      /** Source text may interpolate {variables}. */
      source: string;
      /** Delimiter; an empty string defaults to a comma. */
      sep: string;
      into: string;
    }
  | {
      /** Find the first array element whose field equals the value; use an empty value when absent. */
      kind: "array-find";
      array: string;
      /** Nested field path, such as slug or category.name. */
      field: string;
      /** Value may interpolate {variables}, including {slug}. */
      value: string;
      into: string;
    }
  | {
      /** Join array items into a string using a delimiter. */
      kind: "join";
      array: string;
      /** Path of the field to join when items are objects; omit for the item itself. */
      field?: string;
      /** Delimiter; an empty string concatenates values directly. */
      sep: string;
      into: string;
    }
  | {
      /** Set a field on each array item. Primitive items are wrapped as objects with a {value} field. */
      kind: "array-field";
      array: string;
      /** Literal text, {itemField}, or {variable}; a single placeholder preserves the source value's type. */
      value: string;
      /** Name of the field to set. */
      field: string;
    }
  | {
      /** Store the array length in a variable, or zero when the source is not an array. */
      kind: "count";
      array: string;
      into: string;
    }
  | {
      /** Assign a value to a variable. A single {variable} placeholder preserves the original type, including arrays and objects; nested paths such as {data.items.0} are supported. */
      kind: "set-var";
      value: string;
      into: string;
    }
  | {
      /** Replace every occurrence of find in source with to and assign the result to a variable. */
      kind: "replace";
      source: string;
      /** Text to replace; do nothing if empty. */
      find: string;
      /** Replacement text. An empty value deletes matches; regex replacements support $1 and $&. */
      to: string;
      into: string;
      /** Treat find as a regular expression. Interpolated variable values are escaped as literals; repetition forms {2}, {2,}, {2,4} and escaped braces remain regex syntax. */
      regex?: boolean;
    }
  | {
      /** Arithmetic expression with +, -, *, /, %, parentheses, and {variables}. */
      kind: "calc";
      expr: string;
      into: string;
    }
  | {
      /** Add, remove, or toggle a value in a delimiter-separated list stored as a string. Avoid duplicates and empty segments. */
      kind: "list-edit";
      /** Target variable name. */
      into: string;
      /** Toggle removes an existing value or adds a missing value. */
      op: "add" | "remove" | "toggle";
      /** Value may interpolate {variables}. */
      value: string;
      /** Delimiter; an empty string defaults to a comma. */
      sep: string;
    }
  | {
      /** Text to copy to the clipboard; may interpolate {variables}. */
      kind: "copy";
      value: string;
    }
  | { kind: "wait"; seconds: number }
  | {
      /** Repeat nested steps times times; zero repeats indefinitely with a brief pause each iteration. */
      kind: "repeat";
      times: number;
      then: ScriptStep[];
    }
  | {
      /** Run nested steps for each array element. Item fields are available as {field}; writing a field on the iterated array changes only the current item. */
      kind: "for-each";
      array: string;
      then: ScriptStep[];
    }
  /* Fetch page data. This action runs only directly under the current page's load trigger. Published sites normally run these requests on the server before rendering, in order. Results are available via {name.field}. */
  | {
      /** Fetch JSON from a URL; may interpolate {variables}. Assign the result to the as name. */
      kind: "fetch";
      url: string;
      /** HTTP method; defaults to GET. */
      method?: FetchMethod;
      /** Request headers; values may interpolate {variables}. */
      headers?: FetchHeader[];
      /** JSON request body for non-GET methods. Interpolated placeholders inside strings are JSON-escaped. */
      body?: string;
      /** Result name; elements can reference nested values with {name.field}. */
      as?: string;
      /** Sample response shown in the editor; arrays may be truncated. */
      sample?: unknown;
      /** Original lengths of truncated sample arrays, keyed by their paths. */
      sampleTotals?: Record<string, number>;
      fetchedAt?: number;
    }
  | {
      kind: "if";
      cond: ScriptCond;
      then: ScriptStep[];
      /** Omit else for a one-branch condition; provide an array for the alternative branch. */
      else?: ScriptStep[];
    }
);

export type ScriptStepKind = ScriptStep["kind"];

export type FetchMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface FetchHeader {
  name: string;
  value: string;
}

export interface Script {
  id: string;
  /** A script without a trigger represents disconnected blocks and does not execute. */
  trigger?: ScriptTrigger;
  /** When leaving a hovered element, do not fire hover-end if the pointer is over content shown by hover-start. */
  keepOnShown?: boolean;
  steps: ScriptStep[];
  pos: ScriptPos;
}

export interface TextContent {
  content: string;
  /** Heading 0 represents paragraph text; levels 1 through 6 represent h1 through h6. */
  heading: number;
}

export interface ImageContent {
  src: string;
  alt: string;
  width: number;
  height: number;
  assetId?: string;
  priority?: boolean;
  /** Disable iOS Safari's anti-blur workaround for SVGs with shadows. */
  crispShadow?: boolean;
}

export interface DocNode {
  id: string;
  type: NodeType;
  name: string;
  semantic: Semantic;
  /** HTML tag name to render when semantic is custom, e.g. pre or aside. */
  customTag?: string;
  text: TextContent | null;
  /** Simple click-to-open action represented as an anchor element. */
  link: LinkSetting | null;
  /** Event-triggered actions that cannot be represented by link. */
  scripts?: Script[];
  image?: ImageContent;
  code?: { html: string };
  icon?: IconContent;
  field?: FieldContent;
  media?: MediaContent;
  embed?: EmbedContent;
  list?: ListContent;
  /** Component ID referenced by an instance node. */
  componentId?: string;
  children: string[];
  styles: NodeStyles;
  /** Raw CSS declarations applied permanently to this element. */
  customCss?: string;
  motions?: Motion[];
  /** Responsive breakpoints at which the element is hidden. */
  hiddenOn?: Breakpoint[];
  locked?: boolean;
  /** HTML id attribute. It can be used as an anchor, a submitted form field name, or a {ID} variable for text-bearing elements. */
  attrId?: string;
}

/** Image reference as either a URL or an asset ID. */
export interface ImageRef {
  url?: string;
  assetId?: string;
}

export interface Page {
  id: string;
  name: string;
  /** An empty slug is the homepage. Nested paths such as blog/post-1 are supported. */
  slug: string;
  /** Query string without ?. Its parameters become variables on the page, e.g. {tab}. */
  query?: string;
  title: string;
  /** Marks a newly added or copied page whose title is not yet finalized. Finalizing its name also sets the title unless the title was edited separately. */
  titlePending?: boolean;
  description: string;
  /** BCP 47 page language; inherits the site's language when absent. */
  lang?: string;
  /** Styles applied to the body of this specific page. */
  bodyStyles?: NodeStyles;
  /** HTML overscroll background color; defaults to the body's background. */
  htmlBackground?: string;
  noindex?: boolean;
  /** Exclude this draft page from publish/export. */
  unpublished?: boolean;
  /** Raw HTML page. When set, the visual element editor is unavailable for this page. */
  rawHtml?: string | null;
  /** Folder in the editor's page list; unrelated to the published URL. */
  folderId?: string;
  /** Custom markup prepended to this page body, e.g. JSON-LD or analytics tags. */
  customTopHtml?: string;
  /** Custom markup appended to this page body. */
  customEndHtml?: string;
  /** Permanent HTTP 301 redirect target. */
  redirectTo?: string;
  /** External reverse-proxy destination displayed under this page's original URL. */
  rewriteTo?: string;
  /** Open Graph image preview for this page. */
  ogImage?: ImageRef | null;
  /** Disconnected script blocks displayed in the script editor; they do not execute. */
  scripts?: Script[];
  /** Scripts triggered by events on this page, including load and page-level data fetching. */
  pageScripts?: Script[];
  children: string[];
}

/** Folder used to organize pages in the editor; unrelated to URL structure. */
export interface PageFolder {
  id: string;
  name: string;
}

/** Additional Google Font. Use variable for weights when this is a variable font. */
export interface CustomFont {
  family: string;
  weights: string[] | "variable";
}

/** Reusable component definition. Its master node tree resides in nodes. */
export interface Component {
  id: string;
  name: string;
  rootId: string;
}

/** Template settings for a list that repeats content for array items. */
export interface ListContent {
  /** Array variable name, optionally using nested paths such as products.reviews. */
  from?: string;
  /** Maximum number of items to display; omit for all items. */
  limit?: number;
}

/** Original archive provenance and CSS dependency edges. Uploaded bytes are never rewritten. */
export interface ZipAssetMetadata {
  version: 1;
  group: string;
  path: string;
  stylesheet?: {
    source: string;
    references: { url: string; assetId: string; suffix: string }[];
  };
}

export interface Asset {
  id: string;
  name: string;
  /** Workers KV storage key, served through /api/assets/file. */
  path?: string;
  /** Embedded data URL used when server asset storage is not configured. */
  dataUrl?: string;
  /** Asset size in bytes, used in the storage usage display. */
  bytes?: number;
  /** MIME type; an absent value is treated as an image in some views. */
  mimeType?: string;
  width: number;
  height: number;
  /** Whether an SVG contains a filter such as a shadow; undefined means not yet checked. */
  svgFilter?: boolean;
  zip?: ZipAssetMetadata;
}

export interface LoadingScreenSetting {
  enabled: boolean;
  /** Editable page used to render the loading screen. */
  pageId?: string;
  /** Minimum duration in milliseconds. */
  minDuration?: number;
  /** Fade-out duration in milliseconds. */
  fadeDuration?: number;
  /** Show only once per tab session. */
  showOnce?: boolean;
}

/** Default page-data regeneration interval, in seconds. */
export const DEFAULT_DATA_REVALIDATE = 60;

/** Progressive Web App configuration. */
export interface PwaSetting {
  enabled: boolean;
  /** App name; defaults to the site name. */
  name?: string;
  /** Short name displayed below the home-screen icon; defaults to the app name. */
  shortName?: string;
  /** App icon; defaults to the home-screen icon, then the favicon. A 512x512 PNG is recommended. */
  icon?: ImageRef | null;
  /** Display mode. */
  display?: "standalone" | "fullscreen" | "minimal-ui" | "browser";
  /** Theme color for browser chrome. */
  themeColor?: string;
  /** Background color shown during launch. */
  backgroundColor?: string;
}

export interface SiteDoc {
  siteName: string;
  /** BCP 47 language code for the published site (e.g. ja, en, zh-Hant). Defaults to ja; used for html lang and related metadata. */
  lang?: string;
  /** Shared color palette for the site. */
  colorPalette?: string[];
  /** Published site URL, e.g. https://example.com. Used to construct absolute OGP URLs. */
  siteUrl?: string;
  /** Page-data regeneration interval in seconds. A generated page may serve cached JSON between regenerations; default is 60, and 0 fetches on every request. */
  dataRevalidate?: number;
  /** Hosting mode for published pages that fetch data. The default uses ISR on standard platforms; cloudflare uses per-request rendering with a Cloudflare JSON cache. */
  hosting?: "cloudflare";
  favicon?: ImageRef | null;
  /** Apple home-screen icon, ideally a 180x180 PNG. */
  appleTouchIcon?: ImageRef | null;
  /** Default Open Graph preview image for the site. */
  ogImage?: ImageRef | null;
  loadingScreen?: LoadingScreenSetting;
  pwa?: PwaSetting;
  pages: Record<string, Page>;
  pageOrder: string[];
  /** Folders in editor display order. Page.folderId assigns membership. */
  pageFolders?: PageFolder[];
  nodes: Record<string, DocNode>;
  assets: Record<string, Asset>;
  components?: Record<string, Component>;
  /** Additional Google Fonts. */
  customFonts?: CustomFont[];
  /** Custom markup for the HTML head, e.g. meta or script tags. */
  customHeadHtml?: string;
  /** Custom markup appended to the body. */
  customBodyEndHtml?: string;
  /** Breakpoints sorted from larger to smaller widths; default includes lg, md, and sm. */
  breakpoints?: BreakpointDef[];
  /** Desktop canvas width in pixels; defaults to 1280. */
  baseWidth?: number;
}
