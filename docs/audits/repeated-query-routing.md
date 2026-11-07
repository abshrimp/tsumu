# Repeated query conditions

A page with the saved URL `/results?category=books&category=music` previously
matched `category=music`, even though incoming repeated query parameters use
their first value. Its generated page link could therefore open the default
page and its metadata instead of the linked page. Canvas URL navigation had the
same mismatch.

Routing now parses the saved conditions using the first value of each nonempty
key, matching `URLSearchParams.get()` and the generated route's existing
first-value request handling. Keys and values use standard query decoding,
including percent escapes and `+` spaces. Repeated keys count as one condition.
The most specific matching page still wins, ties keep page order, and an
unmatched URL still falls back to the default page or the first page.

Publish checks compare these same conditions. For example, `category=books`
and `category=books&category=music` now conflict on the same path because both
select the first value `books`. Different first values remain distinct. Empty
keys continue to have no routing condition.

Saved query strings and generated link URLs are not rewritten. This is a
routing change only: existing query-variable extraction for scripts/data,
page-copy naming, and script/data UI behavior are unchanged.

## Verification

- Unit regressions execute actual generated page modules and metadata, as well
  as the real Canvas navigation hook. They cover ordinary page links, repeated
  keys, encoded keys/values, empty values, route collisions, specificity and
  fallback order.
- The baseline fails 17 of the 19 new regressions. The final local suite passes
  all 1,483 tests; typecheck and translation checks pass. Local checks used
  Node 24.22.1/npm 11.9.0, below the repository's declared CI runtime versions.
- Browser regressions cover repeated ordinary URL/page navigation on static and
  `[slug]` routes after a saved-document reload, without changing the document.
  Both tests are registered but unexecuted locally. Production build and native
  browser execution remain to be verified in CI; local Chromium launch is
  unavailable in the current environment.
