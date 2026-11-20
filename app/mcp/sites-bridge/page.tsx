import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isOfficialEditorHost } from "../../../lib/external-edit/official.mjs";
import McpSitesBridge from "./client";

/** This cross-origin directory is part of the hosted service, not self-hosted Tsumu. */
export default async function McpSitesBridgePage() {
  if (!isOfficialEditorHost((await headers()).get("host"))) notFound();
  return <McpSitesBridge />;
}
