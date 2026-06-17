import { NextResponse } from "next/server";
import { dbConfigured, getDb } from "./db";
import { serverTr } from "./i18n-server";
import {
  DEFAULT_BRANCH,
  DEFAULT_PREVIEW_BRANCH,
  getSite,
  isSiteId,
  normalizeSiteInput,
  type SiteDest,
} from "./sites";

/** リクエストのサイトID（?site= や本文の site。必須） */
export async function siteIdOf(value: unknown): Promise<string | NextResponse> {
  if (isSiteId(value)) return value;
  const tr = await serverTr();
  return NextResponse.json({ error: tr("サイトの指定が正しくありません") }, { status: 400 });
}

/**
 * サイトの公開先。D1 があればそこから読む。
 * D1 が無いとき（サイトの一覧をブラウザ内に保存しているとき）は、ブラウザから送られた公開先を使う
 */
export async function siteDestOf(siteId: string, clientDest?: unknown): Promise<SiteDest | NextResponse> {
  if (dbConfigured()) {
    const site = await getSite(await getDb(), siteId);
    if (site) return site;
    const tr = await serverTr();
    return NextResponse.json({ error: tr("サイトが見つかりません") }, { status: 404 });
  }
  const empty: SiteDest = {
    repo: null,
    branch: DEFAULT_BRANCH,
    previewBranch: DEFAULT_PREVIEW_BRANCH,
    siteUrl: null,
    previewUrl: null,
  };
  const parsed =
    clientDest && typeof clientDest === "object"
      ? normalizeSiteInput(clientDest as SiteDest, { name: "-", ...empty })
      : null;
  return parsed?.ok ? parsed.value : empty;
}

/** GET の ?dest=（JSON）を読む（D1 が無いときだけ使う） */
export function destParam(params: URLSearchParams): unknown {
  const raw = params.get("dest");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
