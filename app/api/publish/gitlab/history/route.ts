import { NextResponse } from "next/server";
import { serverTr } from "../../../../../lib/i18n-server";
import { publishProvider } from "../../../../../lib/publish-provider";
import { recordPublish, requireAuth } from "../../../../../lib/server";
import { requireSiteAccess } from "../../../../../lib/site-access";
import { siteIdOf, siteDestOf, destParam } from "../../../../../lib/site-server";
import { targetConfig, configError, type TargetConfig } from "../../../../../lib/github";
import { gitlabClient, type GitLabCommitAction } from "../../../../../lib/gitlab";
import { matchesPublishTarget, publishConflictMessage } from "../../../../../lib/publish-preconditions";
import { validatePublishDocument } from "../../../../../lib/publish-security";
import { readJsonObjectLimited, jsonErrorStatus } from "../../../../../lib/api-json";
import { readTextLimited, TooLargeError } from "../../../../../lib/safe-fetch";
import { IMPORT_LIMITS } from "../../../../../lib/site-import-format";
import { userMessage } from "../../../../../lib/errors";
import {
  DOC_PATH, GENERATED_MANIFEST_PATH, isSafeCommitPath, isProtectedPath,
  planPublish, conflictingCommitPaths, serializeGeneratedManifest,
} from "../../../../../lib/publish-files";
import type { PublishTarget } from "../../../../../lib/generator";

export const maxDuration = 60;
const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };
const isSha = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{40}$/i.test(v);
const conflict = (tr: (msg: string) => string) =>
  NextResponse.json({ error: tr(publishConflictMessage) }, { status: 409 });
const targetOf = (v: unknown): PublishTarget => v === "test" ? "test" : "production";

export async function GET(req: Request) {
  const tr = await serverTr();
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    if (publishProvider() !== "github") return conflict(tr);
  } catch {
    return NextResponse.json({ error: "Invalid PUBLISH_PROVIDER configuration." }, { status: 503 });
  }
  const params = new URL(req.url).searchParams;
  const siteId = await siteIdOf(params.get("site"));
  if (siteId instanceof NextResponse) return siteId;
  const siteDenied = await requireSiteAccess(siteId, "view");
  if (siteDenied) return siteDenied;
  const dest = await siteDestOf(siteId, destParam(params));
  if (dest instanceof NextResponse) return dest;
  if (dest.gitProvider !== "gitlab") return conflict(tr);
  const target = targetOf(params.get("target"));
  const conf = targetConfig(dest, target);
  let expected: unknown;
  try { expected = JSON.parse(params.get("expected") ?? "null"); } catch { /* invalid */ }
  if (!matchesPublishTarget(expected, siteId, target, conf, targetConfig(dest, "production").branch)) return conflict(tr);
  const error = configError(dest, target, tr);
  if (error) return NextResponse.json({ error }, { status: 503 });
  const client = gitlabClient(conf as Required<TargetConfig>, tr);
  try {
    const history = await client.history();
    const docSha = params.get("doc");
    if (!docSha) return NextResponse.json(history, { headers: PRIVATE_NO_STORE });
    // Only versions visible on the selected branch are eligible for recovery.
    if (!isSha(docSha) || !history.commits.some(commit => commit.sha === docSha)) {
      return NextResponse.json({ error: tr("This version doesn't include editor data") }, { status: 404 });
    }
    const path = "/repository/files/" + encodeURIComponent(DOC_PATH) + "/raw?ref=" + docSha;
    const res = await client.request(path);
    if (res.status === 404) {
      return NextResponse.json({ error: tr("This version doesn't include editor data") }, { status: 404 });
    }
    if (!res.ok) await client.fail(tr("Fetching editor data"), res);
    const bodyText = await readTextLimited(res, IMPORT_LIMITS.docBytes);
    return new NextResponse(bodyText, { headers: { ...PRIVATE_NO_STORE, "Content-Type": "application/json; charset=utf-8" } });
  } catch (error) {
    if (error instanceof TooLargeError) {
      return NextResponse.json({ error: tr("The edit data exceeds the size limit.") }, { status: 413 });
    }
    return NextResponse.json({ error: tr(userMessage(error, "Couldn't load the history")) }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const tr = await serverTr();
  const denied = await requireAuth("editor");
  if (denied) return denied;
  try {
    if (publishProvider() !== "github") return conflict(tr);
  } catch {
    return NextResponse.json({ error: "Invalid PUBLISH_PROVIDER configuration." }, { status: 503 });
  }
  let body: Record<string, unknown>;
  try {
    body = await readJsonObjectLimited(req, 128 * 1024);
  } catch (error) {
    const status = jsonErrorStatus(error);
    return NextResponse.json({ error: status === 413 ? tr("Request too large") : tr("Invalid request (request body)") }, { status });
  }
  if (!isSha(body.sha) || !isSha(body.expectedHead)) {
    return NextResponse.json({ error: tr("Invalid parameters") }, { status: 400 });
  }
  const sha = body.sha;
  const siteId = await siteIdOf(body.site);
  if (siteId instanceof NextResponse) return siteId;
  const siteDenied = await requireSiteAccess(siteId, "edit");
  if (siteDenied) return siteDenied;
  const dest = await siteDestOf(siteId, body.dest);
  if (dest instanceof NextResponse) return dest;
  if (dest.gitProvider !== "gitlab") return conflict(tr);
  const target = targetOf(body.target);
  const conf = targetConfig(dest, target);
  if (!matchesPublishTarget(body.expected, siteId, target, conf, targetConfig(dest, "production").branch)) return conflict(tr);
  const error = configError(dest, target, tr);
  if (error) return NextResponse.json({ error }, { status: 503 });
  const client = gitlabClient(conf as Required<TargetConfig>, tr);

  try {
    const history = await client.history();
    if (history.head !== body.expectedHead || !history.commits.some(commit => commit.sha === sha)) {
      return conflict(tr);
    }
    const current = await client.snapshot();
    const chosen = await client.snapshot(sha);
    if (!current.head || current.head !== body.expectedHead || !chosen.generated || !current.generated ||
        !Object.hasOwn(chosen.blobs, DOC_PATH)) {
      return conflict(tr);
    }
    const kept = planPublish(current.blobs, current.generated, []).kept;
    const restoreGenerated = Object.fromEntries(
      Object.entries(chosen.generated)
        .filter(([path]) => !Object.hasOwn(kept, path) && isSha(chosen.blobs[path]))
        .map(([path]) => [path, chosen.blobs[path]])
    );
    const outputPaths = [...Object.keys(restoreGenerated), GENERATED_MANIFEST_PATH];
    if (conflictingCommitPaths([...outputPaths, ...Object.keys(kept)]) ||
        outputPaths.some(path => !isSafeCommitPath(path) || isProtectedPath(path)) ||
        !Object.hasOwn(restoreGenerated, DOC_PATH)) {
      return conflict(tr);
    }
    const manifestText = serializeGeneratedManifest(restoreGenerated);
    const actions: GitLabCommitAction[] = [];
    const changedPaths = Object.keys(restoreGenerated).filter(path => current.blobs[path] !== chosen.blobs[path]);
    if (changedPaths.length > 40) {
      return NextResponse.json({ error: tr("This version has too many files to restore in one request.") }, { status: 413 });
    }
    // The GitLab commits API cannot reference existing blob SHAs. Fetch only
    // changed content, preserving every manually maintained path in the branch.
    const docValidationBytes = !changedPaths.includes(DOC_PATH)
      ? await client.blob(chosen.blobs[DOC_PATH])
      : null;
    if (docValidationBytes) {
      const invalid = validatePublishDocument(docValidationBytes, tr);
      if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
    }
    for (const path of changedPaths) {
      const wantedSha = chosen.blobs[path];
      const bytes = await client.blob(wantedSha);
      if (path === DOC_PATH) {
        const invalid = validatePublishDocument(bytes, tr);
        if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
      }
      actions.push({
        action: Object.hasOwn(current.blobs, path) ? "update" : "create",
        file_path: path, content: Buffer.from(bytes).toString("base64"), encoding: "base64",
      });
    }
    for (const path of Object.keys(current.generated)) {
      if (!Object.hasOwn(restoreGenerated, path) && Object.hasOwn(current.blobs, path)) {
        if (!isSafeCommitPath(path) || isProtectedPath(path)) return conflict(tr);
        actions.push({ action: "delete", file_path: path });
      }
    }
    const manifestBytes = new TextEncoder().encode(manifestText);
    const oldManifestBytes = current.blobs[GENERATED_MANIFEST_PATH]
      ? await client.blob(current.blobs[GENERATED_MANIFEST_PATH]) : null;
    if (!oldManifestBytes || new TextDecoder().decode(oldManifestBytes) !== manifestText) {
      actions.push({
        action: Object.hasOwn(current.blobs, GENERATED_MANIFEST_PATH) ? "update" : "create",
        file_path: GENERATED_MANIFEST_PATH, content: Buffer.from(manifestBytes).toString("base64"), encoding: "base64",
      });
    }
    if (!actions.length) return NextResponse.json({ ok: true, commit: current.head });
    const commit = await client.commit(current.head, actions, "Rollback to " + sha.slice(0, 7) + " from Tsumu");
    if (!commit) return conflict(tr);
    try { await recordPublish(siteId, target, dest.roomKey); }
    catch { console.warn("Rollback completed without a local publication record", { siteId, target }); }
    return NextResponse.json({ ok: true, commit,
      commitUrl: "https://gitlab.com/" + conf.repo + "/-/commit/" + commit });
  } catch (error) {
    return NextResponse.json({ error: tr(userMessage(error, "Couldn't roll back")) }, { status: 502 });
  }
}
