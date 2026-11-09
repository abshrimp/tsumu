import { NextResponse } from "next/server";
import { serverTr } from "../../../../lib/i18n-server";
import { publishProvider } from "../../../../lib/publish-provider";
import { recordPublish, requireAuth } from "../../../../lib/server";
import { requireSiteAccess } from "../../../../lib/site-access";
import { siteIdOf, siteDestOf } from "../../../../lib/site-server";
import { configError, targetConfig, type TargetConfig } from "../../../../lib/github";
import { gitlabBlobSha, gitlabClient } from "../../../../lib/gitlab";
import { matchesPublishTarget, publishConflictMessage } from "../../../../lib/publish-preconditions";
import { siteHasAsset } from "../../../../lib/site-asset-access";
import { assetStore } from "../../../../lib/kv";
import { dbConfigured, getDb } from "../../../../lib/db";
import { parsePublishedExportOptions, savePublishedExportOptions } from "../../../../lib/publish-preferences";
import { validatePublishDocument } from "../../../../lib/publish-security";
import { jsonErrorStatus, readJsonObjectLimited } from "../../../../lib/api-json";
import { userMessage } from "../../../../lib/errors";
import {
  DOC_PATH, GENERATED_MANIFEST_PATH, conflictingCommitPaths, isProtectedPath,
  isSafeCommitPath, parseGeneratedManifest, planPublish,
} from "../../../../lib/publish-files";
import { isSafeBranch } from "../../../../lib/site-model";
import type { Tr } from "../../../../lib/i18n-server";
import type { PublishTarget } from "../../../../lib/generator";

export const maxDuration = 60;
const MAX_REQUEST_BYTES = 48 * 1024 * 1024;
const MAX_ACTIONS = 3000;
const isSha = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{40}$/i.test(value);

type Asset = { path: string; base64?: string; source?: string };
type Body = {
  site?: unknown; dest?: unknown; target?: unknown; expected?: unknown;
  action?: unknown; path?: unknown; base64?: unknown; source?: unknown;
  expectedHead?: unknown; files?: unknown; assets?: unknown; assetShas?: unknown;
  keptPaths?: unknown; exportOptions?: unknown; message?: unknown;
};

class MissingAssetError extends Error {}

async function assetBytes(siteId: string, asset: Asset, tr: Tr): Promise<Uint8Array> {
  if (!isSafeCommitPath(asset.path) || isProtectedPath(asset.path) ||
      (asset.base64 === undefined) === (asset.source === undefined)) {
    throw new Error("Invalid asset reference");
  }
  if (asset.base64 !== undefined) {
    if (typeof asset.base64 !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(asset.base64)) {
      throw new Error("Invalid asset reference");
    }
    return Buffer.from(asset.base64, "base64");
  }
  if (typeof asset.source !== "string" || !asset.source.startsWith("assets/") ||
      !isSafeCommitPath(asset.source)) {
    throw new Error("Invalid asset reference");
  }
  if (dbConfigured() && !await siteHasAsset(await getDb(), siteId, asset.source)) {
    throw new MissingAssetError(tr("Couldn't load asset: {path}", { path: asset.path }));
  }
  const store = assetStore();
  if (!store) throw new Error("Asset storage isn't configured. Contact your administrator.");
  const data = await store.get(asset.source, { type: "arrayBuffer" });
  if (!data) throw new MissingAssetError(tr("Couldn't load asset: {path}", { path: asset.path }));
  return new Uint8Array(data);
}

function assetObject(raw: unknown): raw is Asset {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const value = raw as Record<string, unknown>;
  return typeof value.path === "string" && isSafeCommitPath(value.path) &&
    !isProtectedPath(value.path) &&
    (typeof value.base64 === "string") !== (typeof value.source === "string") &&
    (value.base64 === undefined || typeof value.base64 === "string") &&
    (value.source === undefined || typeof value.source === "string");
}

const conflict = (tr: (message: string) => string, status = 409) =>
  NextResponse.json({ error: tr(publishConflictMessage) }, { status });

export async function POST(req: Request) {
  const tr = await serverTr();
  const denied = await requireAuth("editor");
  if (denied) return denied;
  try {
    if (publishProvider() !== "github") return conflict(tr);
  } catch {
    return NextResponse.json({ error: "Invalid PUBLISH_PROVIDER configuration." }, { status: 503 });
  }

  let body: Body;
  try {
    body = await readJsonObjectLimited(req, MAX_REQUEST_BYTES) as Body;
  } catch (error) {
    const status = jsonErrorStatus(error);
    return NextResponse.json({ error: status === 413 ? tr("Request too large") : tr("Invalid request (request body)") }, { status });
  }
  const siteId = await siteIdOf(body.site);
  if (siteId instanceof NextResponse) return siteId;
  const deniedSite = await requireSiteAccess(siteId, "edit");
  if (deniedSite) return deniedSite;
  const dest = await siteDestOf(siteId, body.dest);
  if (dest instanceof NextResponse) return dest;
  if (dest.gitProvider !== "gitlab") return conflict(tr);
  const target: PublishTarget = body.target === "test" ? "test" : "production";
  const config = targetConfig(dest, target);
  if (!matchesPublishTarget(body.expected, siteId, target, config, targetConfig(dest, "production").branch)) {
    return conflict(tr);
  }
  const error = configError(dest, target, tr);
  if (error) return NextResponse.json({ error }, { status: 503 });
  const conf = config as Required<TargetConfig>;
  const client = gitlabClient(conf, tr);

  try {
    if (body.action === "tree") {
      const productionBranch = targetConfig(dest, "production").branch;
      let production = await client.head(productionBranch);
      if (!production) {
        const projectRes = await client.request("");
        if (!projectRes.ok) await client.fail(tr("Fetching the repository"), projectRes);
        const project = await projectRes.json() as { empty_repo?: boolean; default_branch?: string | null };
        if (project.empty_repo === true) {
          // GitLab cannot create a new Git tree in a repository without a first
          // commit. Initialize production, not preview, just as GitHub does.
          const init = await client.request("/repository/files/.gitkeep", {
            method: "POST",
            body: JSON.stringify({
              branch: productionBranch, content: "", commit_message: "Initialize repository",
            }),
          });
          production = await client.head(productionBranch);
          if (!init.ok && !production) await client.fail(tr("Initializing the repository"), init);
        } else if (typeof project.default_branch === "string" && isSafeBranch(project.default_branch)) {
          const createBranch = await client.request("/repository/branches", {
            method: "POST",
            body: JSON.stringify({ branch: productionBranch, ref: project.default_branch }),
          });
          production = await client.head(productionBranch);
          if (!createBranch.ok && !production) await client.fail(tr("Creating the branch"), createBranch);
        }
      }
      if (target === "test" && !await client.head()) {
        if (!production) {
          return NextResponse.json({ error: tr("Publish the live branch before creating the test branch.") }, { status: 409 });
        }
        const res = await client.request("/repository/branches", {
          method: "POST",
          body: JSON.stringify({ branch: conf.branch, ref: production }),
        });
        if (!res.ok && !await client.head()) await client.fail(tr("Creating the test branch"), res);
      }
      return NextResponse.json({ ok: true, ...await client.snapshot() }, { headers: { "Cache-Control": "private, no-store" } });
    }

    if (body.action === "upload") {
      const asset = { path: body.path, base64: body.base64, source: body.source };
      if (!assetObject(asset)) return NextResponse.json({ error: tr("Invalid asset reference") }, { status: 400 });
      const bytes = await assetBytes(siteId, asset, tr);
      if (asset.path === DOC_PATH) {
        const invalid = validatePublishDocument(bytes, tr);
        if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
      }
      return NextResponse.json({ ok: true, path: asset.path, sha: await gitlabBlobSha(bytes) });
    }

    if (body.action !== "commit" || !body.files || typeof body.files !== "object" ||
        Array.isArray(body.files) || !Object.keys(body.files).length ||
        !Array.isArray(body.assets) || !body.assets.every(assetObject) ||
        !body.assetShas || typeof body.assetShas !== "object" || Array.isArray(body.assetShas) ||
        !Array.isArray(body.keptPaths) || !body.keptPaths.every(path => typeof path === "string") ||
        !(body.expectedHead === null || isSha(body.expectedHead))) {
      return NextResponse.json({ error: tr("Invalid request (request body)") }, { status: 400 });
    }
    const exportOptions = parsePublishedExportOptions(body.exportOptions);
    if (!exportOptions) return NextResponse.json({ error: tr("Invalid request (request body)") }, { status: 400 });
    const files = body.files as Record<string, unknown>;
    const assets = body.assets as Asset[];
    const assetShas = body.assetShas as Record<string, unknown>;
    const uploadedPaths = new Set(assets.map(asset => asset.path));
    const outputPaths = [...Object.keys(files), ...Object.keys(assetShas)];
    if (outputPaths.length > MAX_ACTIONS || new Set(outputPaths).size !== outputPaths.length ||
        uploadedPaths.size !== assets.length ||
        outputPaths.some(path => !isSafeCommitPath(path) || isProtectedPath(path)) ||
        Object.values(files).some(value => typeof value !== "string") ||
        assets.some(asset => !Object.hasOwn(assetShas, asset.path)) ||
        Object.keys(assetShas).some(path => !isSha(assetShas[path]))) {
      return NextResponse.json({ error: tr("The publish includes a file path that isn't allowed") }, { status: 400 });
    }
    const actual: Record<string, { hash: string; content: string; encoding?: "base64" }> = Object.create(null);
    const committedHashes: Record<string, string> = Object.create(null);
    for (const [path, text] of Object.entries(files)) {
      const content = text as string;
      const hash = await gitlabBlobSha(new TextEncoder().encode(content));
      actual[path] = { hash, content };
      committedHashes[path] = hash;
    }
    for (const asset of assets) {
      const bytes = await assetBytes(siteId, asset, tr);
      const hash = await gitlabBlobSha(bytes);
      if (assetShas[asset.path] !== hash) return conflict(tr, 400);
      actual[asset.path] = { hash, content: Buffer.from(bytes).toString("base64"), encoding: "base64" };
      committedHashes[asset.path] = hash;
    }
    for (const [path, sha] of Object.entries(assetShas)) {
      if (!Object.hasOwn(committedHashes, path)) committedHashes[path] = sha as string;
    }
    if (!Object.hasOwn(actual, DOC_PATH) || !Object.hasOwn(actual, GENERATED_MANIFEST_PATH)) {
      return NextResponse.json({ error: tr("Not an editor data file") }, { status: 400 });
    }
    const doc = actual[DOC_PATH];
    const content = doc.encoding === "base64" ? Buffer.from(doc.content, "base64") : doc.content;
    const invalid = validatePublishDocument(content, tr);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
    const meta = actual[GENERATED_MANIFEST_PATH];
    const generated = parseGeneratedManifest(meta.encoding === "base64"
      ? Buffer.from(meta.content, "base64").toString("utf8") : meta.content);
    if (!generated || Object.keys(generated).length !== outputPaths.length - 1 ||
        Object.entries(generated).some(([path, sha]) =>
          path === GENERATED_MANIFEST_PATH || !Object.hasOwn(committedHashes, path) || committedHashes[path] !== sha)) {
      return NextResponse.json({ error: tr("Publishing stopped because the generated file manifest is invalid.") }, { status: 400 });
    }

    const before = await client.snapshot();
    if (before.head !== body.expectedHead) return conflict(tr);
    for (const [path, sha] of Object.entries(assetShas)) {
      if (!uploadedPaths.has(path) && before.blobs[path] !== sha) return conflict(tr);
    }
    const serverPlan = planPublish(before.blobs, before.generated, outputPaths);
    const expectedKept = body.keptPaths as string[];
    if (expectedKept.some(path => !Object.hasOwn(serverPlan.kept, path)) ||
        conflictingCommitPaths([...outputPaths, ...Object.keys(serverPlan.kept)])) {
      return conflict(tr);
    }
    const actions: Array<{ action: "create" | "update" | "delete"; file_path: string; content?: string; encoding?: string }> = [];
    for (const [path, item] of Object.entries(actual)) {
      if (before.blobs[path] === item.hash) continue;
      actions.push({ action: Object.hasOwn(before.blobs, path) ? "update" : "create",
        file_path: path, content: item.content, ...(item.encoding ? { encoding: item.encoding } : {}) });
    }
    if (before.generated) {
      for (const path of Object.keys(before.generated)) {
        if (!Object.hasOwn(committedHashes, path) && Object.hasOwn(before.blobs, path)) {
          if (isProtectedPath(path) || !isSafeCommitPath(path)) return conflict(tr);
          actions.push({ action: "delete", file_path: path });
        }
      }
    }
    if (actions.length > MAX_ACTIONS) return NextResponse.json({ error: tr("Request too large") }, { status: 413 });
    let commitSha = before.head;
    if (actions.length) {
      if (before.head !== await client.head()) return conflict(tr);
      const res = await client.request("/repository/commits", {
        method: "POST",
        body: JSON.stringify({
          branch: conf.branch,
          ...(before.head === null && target === "test"
            ? { start_branch: targetConfig(dest, "production").branch } : {}),
          commit_message: typeof body.message === "string" ? body.message.slice(0, 500) : "Publish from Tsumu",
          actions,
        }),
      });
      if (!res.ok) {
        // A timeout or conflict may happen after GitLab has created the commit.
        // We never force-push or automatically retry this write.
        await client.fail(tr("Creating the commit"), res);
      }
      const result = await res.json() as { id?: string };
      if (!isSha(result.id)) throw new Error(tr("Couldn't publish"));
      commitSha = result.id;
    }
    let optionsSaved = true;
    if (dbConfigured()) {
      try {
        optionsSaved = await savePublishedExportOptions(await getDb(), siteId, exportOptions, dest.roomKey);
      } catch (error) {
        console.warn("Published to GitLab, but could not save export preferences", error);
        optionsSaved = false;
      }
    }
    try {
      await recordPublish(siteId, target, dest.roomKey);
    } catch {
      console.warn("Publish completed, but could not record the local publication", { siteId, target });
    }
    return NextResponse.json({ ok: true, commit: commitSha,
      commitUrl: commitSha ? "https://gitlab.com/" + conf.repo + "/-/commit/" + commitSha : null, optionsSaved });
  } catch (error) {
    if (error instanceof MissingAssetError) {
      return NextResponse.json({ error: error.message, missing: true }, { status: 404 });
    }
    return NextResponse.json({ error: tr(userMessage(error, "Couldn't publish")) }, { status: 502 });
  }
}
