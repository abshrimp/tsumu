import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isOfficialEditorHost } from "../../../lib/external-edit/official.mjs";
import McpSiteChooser from "./client";

/** Only the hosted editor can accept the hosted MCP relay's site invitations. */
export default async function McpSiteChooserPage() {
  if (!isOfficialEditorHost((await headers()).get("host"))) notFound();
  return <McpSiteChooser />;
}
