import { validAssetSuffix } from "./media-url";
import { isBreakpointId } from "./breakpoint-id";
/** Runtime checks for optional persisted fields shared by import, save and PATCH. */
type Check = (value: unknown) => boolean;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const str: Check = value => typeof value === "string";
const bool: Check = value => typeof value === "boolean";
const finite: Check = value => typeof value === "number" && Number.isFinite(value);
const nonnegative: Check = value => finite(value) && (value as number) >= 0;
const integer: Check = value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const optional = (value: unknown, check: Check) => value === undefined || check(value);
const nullable = (value: unknown, check: Check) => value == null || check(value);
const arrayOf = (value: unknown, check: Check) =>
  Array.isArray(value) && value.every(check);
const choice = (value: unknown, choices: readonly string[]) =>
  typeof value === "string" && choices.includes(value);
const strings: Check = value => arrayOf(value, str);
const stringMap: Check = value => record(value) && Object.values(value).every(str);
const point: Check = value => record(value) && finite(value.x) && finite(value.y);

export function validImageRef(value: unknown): boolean {
  return record(value) && optional(value.url, str) && optional(value.assetId, str);
}

function validField(value: unknown): boolean {
  if (!record(value) || !choice(value.kind,
    ["input", "textarea", "select", "checkbox", "radio", "file", "submit"])) return false;
  return optional(value.inputType, x => choice(x, [
    "text", "email", "password", "number", "tel", "url", "search",
    "date", "time", "datetime-local", "month", "week", "color", "range",
  ])) &&
    ["label", "defaultValue", "placeholder", "group", "min", "max",
      "step", "accept"].every(key => optional(value[key], str)) &&
    ["checked", "disabled", "required", "multiple"].every(key => optional(value[key], bool)) &&
    optional(value.maxLength, integer) && optional(value.rows, integer) &&
    nullable(value.options, x => arrayOf(x, option =>
      record(option) && str(option.label) && str(option.value)));
}

function validMotion(value: unknown): boolean {
  return record(value) && str(value.id) &&
    choice(value.trigger, ["state", "hover", "active", "load", "in-view"]) &&
    finite(value.duration) && finite(value.delay) && str(value.easing) &&
    optional(value.property, str) && optional(value.keyframes, str) &&
    optional(value.customKeyframes, str) && optional(value.repeat, finite) &&
    optional(value.direction, x => choice(x, ["normal", "reverse", "alternate"])) &&
    optional(value.fillMode, x => choice(x, ["both", "forwards", "backwards", "none"]));
}

/** Reject malformed editor fields that the primary node/tree checks do not cover. */
export function validNodeAdditionalFields(node: Record<string, unknown>): boolean {
  return optional(node.customTag, str) && optional(node.componentId, str) &&
    optional(node.customCss, str) && optional(node.htmlClass, str) &&
    optional(node.htmlAttrs, stringMap) &&
    optional(node.motions, x => arrayOf(x, validMotion)) &&
    optional(node.hiddenOn, strings) && optional(node.locked, bool) &&
    optional(node.attrId, str) &&
    nullable(node.link, x => record(x) &&
      choice(x.kind, ["url", "page"]) &&
      optional(x.url, str) && optional(x.pageId, str) &&
      optional(x.newTab, bool) && optional(x.pos, point)) &&
    nullable(node.image, x => record(x) &&
      str(x.src) && str(x.alt) && finite(x.width) && finite(x.height) &&
      optional(x.assetId, str) && optional(x.assetSuffix, v => str(x.assetId) && validAssetSuffix(v)) && optional(x.priority, bool) &&
      optional(x.crispShadow, bool)) &&
    nullable(node.media, x => record(x) &&
      choice(x.kind, ["video", "audio"]) && str(x.src) &&
      optional(x.assetId, str) && optional(x.assetSuffix, v => str(x.assetId) && validAssetSuffix(v)) &&
      optional(x.sources, values => arrayOf(values, source => record(source) && str(source.src) &&
        optional(source.assetId, str) && optional(source.assetSuffix, v => str(source.assetId) && validAssetSuffix(v)) &&
        optional(source.type, str) && optional(source.media, str))) &&
      ["loop", "autoplay", "muted"].every(key => optional(x[key], bool))) &&
    nullable(node.embed, x => record(x) &&
      choice(x.kind, ["youtube", "map", "url"]) && str(x.src)) &&
    nullable(node.icon, x => record(x) && str(x.name) && str(x.svg)) &&
    nullable(node.code, x => record(x) && str(x.html)) &&
    nullable(node.field, validField) &&
    nullable(node.list, x => record(x) &&
      optional(x.from, str) && optional(x.limit, nonnegative));
}

export function validPageAdditionalFields(page: Record<string, unknown>): boolean {
  return ["query", "lang", "htmlBackground", "folderId",
    "customTopHtml", "customEndHtml", "redirectTo", "rewriteTo"].every(key =>
    optional(page[key], str)) &&
    ["titlePending", "noindex", "unpublished"].every(key => optional(page[key], bool)) &&
    nullable(page.rawHtml, str) && nullable(page.ogImage, validImageRef);
}

function validZipMetadata(value: unknown): boolean {
  if (!record(value) || value.version !== 1 || !str(value.group) || !str(value.path)) return false;
  return optional(value.stylesheet, x => record(x) && str(x.source) &&
    arrayOf(x.references, ref => record(ref) &&
      str(ref.url) && str(ref.assetId) && str(ref.suffix)));
}

export function validAssetAdditionalFields(asset: Record<string, unknown>): boolean {
  return nonnegative(asset.width) && nonnegative(asset.height) &&
    optional(asset.bytes, integer) && optional(asset.svgFilter, bool) &&
    optional(asset.zip, validZipMetadata);
}

function validLoadingScreen(value: unknown): boolean {
  return record(value) && bool(value.enabled) && optional(value.pageId, str) &&
    optional(value.minDuration, nonnegative) &&
    optional(value.fadeDuration, nonnegative) && optional(value.showOnce, bool);
}
function validPwa(value: unknown): boolean {
  return record(value) && bool(value.enabled) &&
    ["name", "shortName", "themeColor", "backgroundColor"].every(key =>
      optional(value[key], str)) &&
    nullable(value.icon, validImageRef) &&
    optional(value.display, x => choice(x, ["standalone", "fullscreen", "minimal-ui", "browser"]));
}
function validCustomFont(value: unknown): boolean {
  return record(value) && str(value.family) &&
    (value.weights === "variable" || arrayOf(value.weights, str));
}
function validBreakpoint(value: unknown): boolean {
  return record(value) && isBreakpointId(value.id) && str(value.label) &&
    nonnegative(value.maxWidth);
}

/** The same site-level invariants apply to imports, local cache and both stores. */
export function validSiteAdditionalFields(site: Record<string, unknown>): boolean {
  return ["lang", "siteUrl", "customHeadHtml", "customBodyEndHtml"].every(key =>
    optional(site[key], str)) &&
    optional(site.colorPalette, strings) &&
    optional(site.dataRevalidate, nonnegative) &&
    optional(site.hosting, x => x === "cloudflare") &&
    ["favicon", "appleTouchIcon", "ogImage"].every(key =>
      nullable(site[key], validImageRef)) &&
    optional(site.loadingScreen, validLoadingScreen) &&
    optional(site.pwa, validPwa) &&
    optional(site.customFonts, x => arrayOf(x, validCustomFont)) &&
    optional(site.breakpoints, x => arrayOf(x, validBreakpoint)) &&
    optional(site.baseWidth, x => finite(x) && (x as number) > 0);
}
