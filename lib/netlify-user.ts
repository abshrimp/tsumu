import { NextResponse } from "next/server";
import { authConfigured } from "../auth";
import type { ActivityUser } from "./activity";

/** OAuth always requires a Google-authenticated user already authorized at the API boundary. */
export function requireNetlifyUser(user: ActivityUser | null): ActivityUser | NextResponse {
  if (!authConfigured() || !user) {
    return NextResponse.json({
      error: "Sign in to Tsumu with an authorized account before connecting Netlify.",
    }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  }
  return user;
}
