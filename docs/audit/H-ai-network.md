# Audit H — AI operations and outbound networking

Audit baseline: `1ba32974d4b5ecf441e36428e765d0542207c421`  
Integration target: current `main` (including merged import/publish/editor changes)  
Branch: `audit/H-ai-network`  
PR: https://github.com/abshrimp/tsumu/pull/27

## Trust boundaries

```text
Browser UI / editor state (untrusted)
  |  authenticated POST /api/ai, bounded JSON document
  v
AI request validation -> reconstruct scoped SiteDoc summary -> provider API (secret key only on server)
  |                             |
  |                             +-- model outputs / tool calls / streams (untrusted)
  v
applyAiOps on a throwaway scoped document -> bounded operations + node growth
  |  only validated operations returned; no direct save
  v
Browser receives completed result -> checks document snapshot -> atomic apply / single undo
  |
  +-- failure, cancellation or changed snapshot: no changes applied

Browser script editor or data-source preview (untrusted URL and request options)
  |  authenticated POST /api/fetch-json; bounded JSON body
  v
fetchPublic -> URL policy -> DNS / IP preflight -> pinned Node lookup at connect
  |          -> manual redirect revalidation -> deadline -> bounded response
  v
JSON parse -> editor state

Generated server-side sites bundle lib/safe-fetch.ts via a synchronized source
and reapply the same outbound-request policy.
```

## Findings and mitigations

| Finding | Impact | Root cause | Change | Regression coverage |
|---|---|---|---|---|
| AUD-H-001 | Medium / resource exhaustion | `/api/fetch-json` read its request JSON without a byte budget | Shared bounded streaming reader (2 MiB proxy limit); malformed Content-Length and chunked bodies rejected | `tests/read-json-request.test.mts` |
| AUD-H-002 | Medium / resource exhaustion | Unbounded upstream non-streaming JSON, error payloads and cumulative SSE bytes | 4 MiB provider JSON, 32 KiB error details, 8 MiB cumulative streams; abort oversized bodies | `tests/audit-h-ai-network.test.mts` |
| AUD-H-003 | Low / key defense in depth | Compatible-model requests used implicit automatic redirects with bearer authorization | Reject all provider redirects | `tests/audit-h-ai-network.test.mts` |
| AUD-H-004 | Medium / sensitive logging | Provider-controlled error details were logged verbatim | Log only error category and HTTP status; avoid logging arbitrary exception messages | Source review of `app/api/ai/route.ts` |
| AUD-H-005 | Medium / prompt manipulation | Editor-controlled text could inject literal `</editor_state>` delimiters | Escape delimiter characters and explicitly treat site data as untrusted in the model instruction | `tests/audit-h-ai-network.test.mts` |
| AUD-H-006 | Medium / stalled requests | Node DNS preflight ran outside the HTTP request deadline | Deadline and request cancellation apply to preflight; connect-time lookup still validates each resolved address | DNS tests in `tests/audit-h-ai-network.test.mts` and pre-existing `tests/security.test.mts` |
| AUD-H-007 | Medium / large edits | AI could repeatedly request bulk element insertions and duplicates without a growth cap | Bound node growth for each tool call and for the entire model request | `tests/audit-h-ai-network.test.mts` |
| AUD-H-008 | Regression prevention | Exported sites copy the server fetch policy | Regenerate `lib/generator/safe-fetch-source.ts` from the audited source | `tests/generated-safe-fetch-sync.test.mts` |

## Reviewed paths

- `lib/ai/`, `lib/aiOps.ts`, `components/AiChat.tsx` and `app/api/ai/route.ts` — model tools, validation, cancellation, context integrity, progress, undo/redo.
- `lib/safe-fetch.ts`, `app/api/fetch-json/route.ts`, `lib/fetch-request.ts`, `lib/fetch-preview.ts` — input, DNS/IP validation, rebinding, redirects, outbound payloads, size caps, errors.
- `lib/generator/safe-fetch-source.ts` — generated-site security policy parity.

Pre-existing tests also cover AI rollback, clone identity, streaming interruption, all HTTP methods, SSRF/private addresses and redirects, and data-source refetching. The current PR adds focused tests only where those existing tests did not exercise the identified paths.

## Verification and remaining risk

- No destructive real-user data operation is performed in this audit.
- Regression cases are isolated tests using simulated model responses and DNS answers; they do not require real provider API keys.
- A system prompt cannot eliminate all prompt injection. Scoped, validated operations and atomic client replay remain the principal integrity boundary; unexpected requested edits still deserve user review.
- On Cloudflare Workers, URL hostname checks remain in application code, while private IP reachability and connection routing rely on the platform's global `fetch` public-network constraints. A deployment that changes the Worker's outbound network/VPC policy needs a separate platform test and review. See https://developers.cloudflare.com/workers/platform/known-issues/ and https://developers.cloudflare.com/workers/runtime-apis/fetch/.
- Full TypeScript, unit, generated-project, Cloudflare and E2E checks should be verified against the final PR commit. Independent reviewer approval is required before merging.
