import { blake3 } from "@noble/hashes/blake3";
import { envVar } from "./env";
import type { PublishTarget } from "./generator";
import { assertGeneratedPaths } from "./generator/output-paths";
import { hostingProjectName } from "./publish-provider";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const MAX_ZIP_BYTES = 25 * 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 60 * 1024 * 1024;
const MAX_FILES = 2000;

/** A validated static-hosting payload, with no editable project data. */
export interface StaticFile {
  path: string;
  bytes: Uint8Array;
}

export interface StaticDeployment {
  id: string;
  url: string;
  state: string;
}

export interface StaticDeploymentHistory extends StaticDeployment {
  date: string;
  canRestore: boolean;
}

export function isPublicStaticPath(path: string): boolean {
  const normalized = path.normalize("NFC").toLowerCase();
  const segments = normalized.split("/");
  return !segments.some((segment) =>
    segment === "_tsumu" || segment === ".git" || segment === ".env" ||
    segment.startsWith(".env.") || segment === "doc.json"
  );
}

/** Reject zip bombs, unsafe paths, symlinks and editable data before contacting a provider. */
export async function readStaticZip(raw: ArrayBuffer): Promise<StaticFile[]> {
  if (!raw.byteLength || raw.byteLength > MAX_ZIP_BYTES) throw new Error("The site ZIP is too large (25 MiB maximum).");
  // ZIP parsing belongs to this upload handler, not the editor's eager bundle.
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(raw, { checkCRC32: false, createFolders: false });
  const entries = Object.values(zip.files).filter((file) => !file.dir);
  if (!entries.length || entries.length > MAX_FILES) throw new Error("The site has too many files.");
  if (!entries.some((file) => file.name === "index.html")) throw new Error("The exported site has no index.html.");
  const paths = entries.map((file) => file.name);
  if (paths.some((path) => path === "_worker.js" || path.startsWith("functions/"))) {
    throw new Error("Pages Functions and custom Workers cannot be deployed as static HTML.");
  }
  assertGeneratedPaths({
    files: Object.fromEntries(paths.map((path) => [path, ""])),
    binaries: {},
    remoteAssets: {},
  });
  if (paths.some((path) => !isPublicStaticPath(path))) {
    throw new Error("Editable project data and secret files must not be published.");
  }
  let total = 0;
  const files: StaticFile[] = [];
  for (const file of entries) {
    const perm = typeof file.unixPermissions === "string"
      ? parseInt(file.unixPermissions, 8) : file.unixPermissions ?? 0;
    if ((perm & 0o170000) === 0o120000) throw new Error("Symbolic links cannot be published.");
    // JSZip exposes the ZIP header size internally; reject large entries before inflating them.
    const size = (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (typeof size === "number" && (size > MAX_FILE_BYTES || total + size > MAX_TOTAL_BYTES)) {
      throw new Error("The site contains files that exceed the upload size limit.");
    }
    const bytes = await file.async("uint8array");
    total += bytes.byteLength;
    if (bytes.byteLength > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) {
      throw new Error("The site contains files that exceed the upload size limit.");
    }
    files.push({ path: file.name, bytes });
  }
  return files;
}

export async function readZipRequest(request: Request): Promise<ArrayBuffer> {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/zip") {
    throw new Error("A static-site ZIP is required.");
  }
  const header = request.headers.get("content-length");
  if (header && Number(header) > MAX_ZIP_BYTES) throw new Error("The site ZIP is too large.");
  if (!request.body) throw new Error("A static-site ZIP is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_ZIP_BYTES) throw new Error("The site ZIP is too large.");
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result.buffer;
}

function mimeType(path: string): string {
  const ext = path.split(".").at(-1)?.toLowerCase();
  const types: Record<string, string> = {
    html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8", js: "application/javascript; charset=utf-8",
    mjs: "application/javascript; charset=utf-8", json: "application/json",
    txt: "text/plain; charset=utf-8", xml: "application/xml", svg: "image/svg+xml",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", avif: "image/avif", ico: "image/x-icon",
    woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
    mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav",
    pdf: "application/pdf", wasm: "application/wasm", webmanifest: "application/manifest+json",
  };
  return types[ext ?? ""] ?? "application/octet-stream";
}

function asBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** Wrangler's Pages asset hash: BLAKE3(base64(file bytes) + extension), first 16 bytes. */
export function pagesAssetHash(bytes: Uint8Array, path: string): string {
  const ext = path.match(/\.([^./]+)$/)?.[1] ?? "";
  return Array.from(blake3(new TextEncoder().encode(asBase64(bytes) + ext)).subarray(0, 16),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type CloudflareEnvelope<T> = { success: boolean; result: T };

async function cloudflareRequest<T>(
  path: string,
  step: string,
  init: RequestInit = {},
  jwt?: string,
): Promise<T> {
  const token = jwt ?? envVar("CLOUDFLARE_API_TOKEN");
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is not configured.");
  const response = await fetch(CLOUDFLARE_API + path, {
    ...init,
    redirect: "error",
    headers: { Authorization: "Bearer " + token, ...init.headers },
  });
  if (!response.ok) throw new Error(step + " failed (HTTP " + response.status + ").");
  const data = await response.json() as CloudflareEnvelope<T>;
  if (!data.success) throw new Error(step + " was rejected by Cloudflare.");
  return data.result;
}

function cloudflarePath(project: string): string {
  const account = envVar("CLOUDFLARE_ACCOUNT_ID");
  if (!account || !/^[a-f0-9]{32}$/i.test(account)) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID must be a valid account ID.");
  }
  return "/accounts/" + account + "/pages/projects/" + encodeURIComponent(project);
}

async function cloudflareProject(project: string): Promise<void> {
  const path = cloudflarePath(project);
  const token = envVar("CLOUDFLARE_API_TOKEN");
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is not configured.");
  const response = await fetch(CLOUDFLARE_API + path, {
    headers: { Authorization: "Bearer " + token }, redirect: "error",
  });
  if (response.ok) return;
  if (response.status !== 404) throw new Error("Cloudflare Pages project lookup failed (HTTP " + response.status + ").");
  // Direct Upload projects do not have a connected Git repository.
  const createPath = path.slice(0, path.lastIndexOf("/"));
  await cloudflareRequest(createPath, "Create Cloudflare Pages project", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: project, production_branch: "main" }),
  });
}

async function publishCloudflare(project: string, target: PublishTarget, files: StaticFile[]): Promise<StaticDeployment> {
  await cloudflareProject(project);
  const path = cloudflarePath(project);
  const upload = await cloudflareRequest<{ jwt?: string }>(path + "/upload-token", "Get Pages upload token");
  if (!upload.jwt) throw new Error("Cloudflare did not return an upload token.");

  const manifest: Record<string, string> = {};
  const byHash = new Map<string, { bytes: Uint8Array; contentType: string }>();
  for (const file of files) {
    if (file.path === "_headers" || file.path === "_redirects" || file.path === "_routes.json") continue;
    const hash = pagesAssetHash(file.bytes, file.path);
    manifest["/" + file.path] = hash;
    if (!byHash.has(hash)) byHash.set(hash, { bytes: file.bytes, contentType: mimeType(file.path) });
  }
  const hashes = [...byHash.keys()];
  const missing = await cloudflareRequest<string[]>("/pages/assets/check-missing",
    "Check Pages assets", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hashes }),
    }, upload.jwt);

  // Batch uploads to stay within Workers' outbound subrequest and body limits.
  let batch: { key: string; value: string; base64: true; metadata: { contentType: string } }[] = [];
  let batchBytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    await cloudflareRequest("/pages/assets/upload", "Upload Pages assets", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    }, upload.jwt);
    batch = [];
    batchBytes = 0;
  };
  for (const hash of missing) {
    const file = byHash.get(hash);
    if (!file) throw new Error("Cloudflare requested an unknown file hash.");
    const encoded = asBase64(file.bytes);
    if (batch.length >= 50 || batchBytes + encoded.length > 4 * 1024 * 1024) await flush();
    batch.push({ key: hash, value: encoded, base64: true, metadata: { contentType: file.contentType } });
    batchBytes += encoded.length;
  }
  await flush();
  await cloudflareRequest("/pages/assets/upsert-hashes", "Register Pages assets", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hashes }),
  }, upload.jwt);
  const form = new FormData();
  form.set("manifest", JSON.stringify(manifest));
  form.set("branch", target === "test" ? "tsumu-preview" : "main");
  form.set("commit_message", "Publish from Tsumu");
  for (const name of ["_headers", "_redirects", "_routes.json"]) {
    const config = files.find((file) => file.path === name);
    if (config) form.set(name, new Blob([config.bytes as BlobPart], { type: "text/plain" }), name);
  }
  const deployment = await cloudflareRequest<{ id?: string; url?: string; latest_stage?: { status?: string } }>(
    path + "/deployments", "Create Pages deployment", { method: "POST", body: form });
  if (!deployment.id) throw new Error("Cloudflare did not return a deployment ID.");
  return {
    id: deployment.id,
    url: deployment.url ?? "https://" + project + ".pages.dev",
    state: deployment.latest_stage?.status ?? "queued",
  };
}

export async function deployStaticSite(
  siteId: string,
  target: PublishTarget,
  files: StaticFile[],
): Promise<StaticDeployment> {
  const project = hostingProjectName(siteId, "cloudflare", target);
  return publishCloudflare(project, target, files);
}

export async function listStaticDeployments(
  siteId: string,
  target: PublishTarget,
): Promise<StaticDeploymentHistory[]> {
  const project = hostingProjectName(siteId, "cloudflare", target);
  // History must not create an empty Pages project.
  const path = cloudflarePath(project) + "/deployments?per_page=25";
  const token = envVar("CLOUDFLARE_API_TOKEN");
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is not configured.");
  const response = await fetch(CLOUDFLARE_API + path, {
    headers: { Authorization: "Bearer " + token },
    redirect: "error",
  });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error("Read Pages deployments failed (HTTP " + response.status + ").");
  const data = await response.json() as CloudflareEnvelope<Array<{
    id?: string; url?: string; created_on?: string; environment?: string;
    latest_stage?: { status?: string };
    deployment_trigger?: { metadata?: { branch?: string } };
  }>>;
  if (!data.success) throw new Error("Read Pages deployments was rejected by Cloudflare.");
  return data.result.filter((x) => x.id && (target === "production"
    ? x.environment === "production"
    : x.environment === "preview" && x.deployment_trigger?.metadata?.branch === "tsumu-preview"))
    .map((x) => ({
      id: x.id!, date: x.created_on ?? "",
      url: x.url ?? "https://" + project + ".pages.dev",
      state: x.latest_stage?.status ?? "unknown",
      canRestore: target === "production" && x.latest_stage?.status === "success",
    }));
}

export async function restoreStaticDeployment(
  siteId: string,
  target: PublishTarget,
  deploymentId: string,
): Promise<void> {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(deploymentId)) throw new Error("Invalid deployment ID.");
  const existing = await listStaticDeployments(siteId, target);
  if (!existing.some((x) => x.id === deploymentId && x.canRestore)) {
    throw new Error("This deployment cannot be restored.");
  }
  const project = hostingProjectName(siteId, "cloudflare", target);
  await cloudflareRequest(cloudflarePath(project) +
    "/deployments/" + encodeURIComponent(deploymentId) + "/rollback",
    "Restore Pages deployment", { method: "POST" });
}
