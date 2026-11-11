/**
 * English-language snapshot of Tsumu's canonical SiteDoc schema.
 * Source: lib/types.ts. The TypeScript declarations are kept identical;
 * source comments have been omitted to avoid untranslated descriptions.
 * The canonical schema, not this documentation snapshot, governs runtime data.
 */

import type { ValueTransform } from "./script-model/compose";

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

export interface FieldOption {
  label: string;
  value: string;
}

export interface FieldContent {
  kind: FieldKind;
  
  inputType?: InputType;
  
  label?: string;
  
  defaultValue?: string;
  
  placeholder?: string;
  
  options?: FieldOption[];
  
  checked?: boolean;
  

  group?: string;
  
  disabled?: boolean;
  
  required?: boolean;
  
  min?: string;
  max?: string;
  step?: string;
  
  maxLength?: number;
  
  rows?: number;
  
  accept?: string;
  
  multiple?: boolean;
}

export interface MediaSource {
  src: string;
  assetId?: string;
  assetSuffix?: string;
  type?: string;
  media?: string;
}

export interface MediaContent {
  sources?: MediaSource[];
  kind: "video" | "audio";
  src: string;
  assetId?: string;
  assetSuffix?: string;
  loop?: boolean;
  autoplay?: boolean;
  muted?: boolean;
}

export interface EmbedContent {
  kind: "youtube" | "map" | "url";
  
  src: string;
}

export interface IconContent {
  
  name: string;
  
  svg: string;
}

export interface Motion {
  id: string;
  
  trigger: "state" | "hover" | "active" | "load" | "in-view";
  
  property?: string;
  
  keyframes?: string;
  
  customKeyframes?: string;
  
  duration: number;
  
  delay: number;
  easing: string;
  
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

export type Breakpoint = string;

export interface BreakpointDef {
  id: string;
  label: string;
  
  maxWidth: number;
}
export type StyleState = "default" | "hover" | "active" | "focus" | `custom:${string}`;

export type StyleMap = Record<string, string>;

export type NodeStyles = Record<Breakpoint, Partial<Record<StyleState, StyleMap>>>;

export const BODY_NODE_ID = "__body__";

export interface LinkSetting {
  kind: "url" | "page";
  url?: string;
  pageId?: string;
  newTab?: boolean;
  
  pos?: ScriptPos;
}

export const SELF_TARGET = "@self";

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
  | "contains"
  | "starts-with"
  | "ends-with"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "empty"
  | "has-key"
  
  | "in";

export interface ScriptCond {
  
  subject: "value" | "checked" | "visible" | "hovered" | "var";
  
  target: string;
  
  left?: string;
  
  op?: ScriptOp;
  value?: string;
  
  not?: boolean;
}

export interface JoinedScriptCond extends ScriptCond {
  
  and: boolean;
}

export interface FilterCond {
  field: string;
  op: ScriptOp;
  
  value: string;
  
  not?: boolean;
  
  and?: boolean;
}

export type ScriptStep = { id: string } & (
  | { kind: "show" | "hide" | "toggle"; target: string }
  | { kind: "set-state"; target: string; state: string }
  | { kind: "open-page"; pageId: string; newTab?: boolean }
  | { kind: "open-url"; url: string; newTab?: boolean }
  | { kind: "scroll-to"; target: string }
  | { kind: "set-value"; target: string; value: string }
  
  | { kind: "set-enabled"; target: string; op: "enable" | "disable" | "toggle" }
  | {
      
      kind: "list-display";
      mode: "filter" | "sort" | "clear";
      array: string;
      field: string;
      op: ScriptOp;
      value: string;
      
      not?: boolean;
      
      or?: FilterCond[];
      no?: number;
      join?: "and" | "or";
      dir: "asc" | "desc";
    }
  | {
      
      kind: "store-save";
      key: string;
      
      value: string;
      
      shared?: boolean;
    }
  | {
      
      kind: "store-load";
      key: string;
      into: string;
      
      shared?: boolean;
    }
  | { kind: "set-list-item"; list: string; key: string; value: string }
  | { kind: "remove-list-item"; list: string; mode: "value" | "key"; value: string }
  | { kind: "break-loop" }
  | {
      

      kind: "set-var";
      value: string;
      into: string;
    }
  | {
      
      kind: "transform";
      
      source: string;
      
      into: string;
      transform: ValueTransform;
    }
  | {
      
      kind: "copy";
      value: string;
    }
  | { kind: "wait"; seconds: number | string }
  | {
      
      kind: "repeat";
      times: number | string;
      then: ScriptStep[];
    }
  | {
      

      kind: "for-each";
      array: string;
      then: ScriptStep[];
    }
  

  | {
      
      kind: "fetch";
      url: string;
      
      method?: FetchMethod;
      
      headers?: FetchHeader[];
      
      body?: string;
      
      as?: string;
      preview?: { sample?: unknown; totals?: Record<string, number>; fetchedAt?: number; };
    }
  | {
      kind: "if";
      cond: ScriptCond;
      
      conditions?: JoinedScriptCond[];
      then: ScriptStep[];
      
      else?: ScriptStep[];
    }
);

export type FetchMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface FetchHeader {
  name: string;
  value: string;
}

export interface Script {
  id: string;
  
  trigger?: ScriptTrigger;
  
  keepOnShown?: boolean;
  steps: ScriptStep[];
  pos: ScriptPos;
}

export interface TextContent {
  content: string;
  
  heading: number;
}

export interface ImageContent {
  src: string;
  alt: string;
  width: number;
  height: number;
  assetId?: string;
  assetSuffix?: string;
  priority?: boolean;
  
  crispShadow?: boolean;
}

export interface DocNode {
  id: string;
  type: NodeType;
  name: string;
  semantic: Semantic;
  
  customTag?: string;
  text: TextContent | null;
  
  link: LinkSetting | null;
  
  scripts?: Script[];
  image?: ImageContent;
  code?: { html: string };
  icon?: IconContent;
  field?: FieldContent;
  media?: MediaContent;
  embed?: EmbedContent;
  list?: ListContent;
  
  componentId?: string;
  children: string[];
  styles: NodeStyles;
  
  customCss?: string;
  
  htmlClass?: string;
  
  htmlAttrs?: Record<string, string>;
  motions?: Motion[];
  
  hiddenOn?: Breakpoint[];
  locked?: boolean;
  

  attrId?: string;
}

export interface ImageRef {
  url?: string;
  assetId?: string;
}

export interface Page {
  id: string;
  name: string;
  
  slug: string;
  
  query?: string;
  title: string;
  

  titlePending?: boolean;
  description: string;
  
  lang?: string;
  
  bodyStyles?: NodeStyles;
  
  htmlBackground?: string;
  noindex?: boolean;
  
  unpublished?: boolean;
  
  rawHtml?: string | null;
  
  folderId?: string;
  
  customTopHtml?: string;
  
  customEndHtml?: string;
  
  redirectTo?: string;
  
  rewriteTo?: string;
  
  ogImage?: ImageRef | null;
  
  scripts?: Script[];
  
  pageScripts?: Script[];
  children: string[];
}

export interface PageFolder {
  id: string;
  name: string;
}

export interface CustomFont {
  family: string;
  weights: string[] | "variable";
}

export interface Component {
  id: string;
  name: string;
  rootId: string;
}

export interface ListContent {
  
  from?: string;
  
  limit?: number;
}

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
  
  path?: string;
  
  dataUrl?: string;
  
  bytes?: number;
  
  mimeType?: string;
  width: number;
  height: number;
  
  svgFilter?: boolean;
  zip?: ZipAssetMetadata;
}

export interface LoadingScreenSetting {
  enabled: boolean;
  
  pageId?: string;
  
  minDuration?: number;
  
  fadeDuration?: number;
  
  showOnce?: boolean;
}

export const DEFAULT_DATA_REVALIDATE = 60;

export interface PwaSetting {
  enabled: boolean;
  
  name?: string;
  
  shortName?: string;
  
  icon?: ImageRef | null;
  
  display?: "standalone" | "fullscreen" | "minimal-ui" | "browser";
  
  themeColor?: string;
  
  backgroundColor?: string;
}

export interface SiteDoc {
  schemaVersion: 1;
  siteName: string;
  

  lang?: string;
  
  colorPalette?: string[];
  
  siteUrl?: string;
  

  dataRevalidate?: number;
  

  hosting?: "cloudflare";
  favicon?: ImageRef | null;
  
  appleTouchIcon?: ImageRef | null;
  
  ogImage?: ImageRef | null;
  loadingScreen?: LoadingScreenSetting;
  pwa?: PwaSetting;
  pages: Record<string, Page>;
  pageOrder: string[];
  
  pageFolders?: PageFolder[];
  nodes: Record<string, DocNode>;
  assets: Record<string, Asset>;
  components?: Record<string, Component>;
  
  customFonts?: CustomFont[];
  
  customHeadHtml?: string;
  
  customBodyEndHtml?: string;
  
  breakpoints?: BreakpointDef[];
  
  baseWidth?: number;
}
