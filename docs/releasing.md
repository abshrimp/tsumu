# Releasing Tsumu safely

Use this checklist for a source release or an update to a self-hosted editor.
Record evidence for the exact candidate commit. A successful build, an archive
file, or a browser-only Preview is not sufficient evidence of recoverability.

Preparation and rehearsals use disposable staging resources only. This checklist
does not authorize a live production release, a production restore, deletion of
storage, or publication of release notes. Those are separate operator actions.

The canonical repository is [abshrimp/tsumu](https://github.com/abshrimp/tsumu). Tsumu is a self-hosted application. `private: true` in `package.json` only prevents accidental publication to npm; it doesn't affect whether the source is visible on GitHub.

## 1. Validate the source

Start from a clean checkout with the Node version in `.nvmrc` and the npm version
in `package.json`. Use a disposable working directory without production
credentials or data. Run the following checks individually, retain each exit
code and output, and stop release approval if a required check fails or cannot
run. Application and Worker builds both write `.next`; run them sequentially.

```sh
npm ci
npm run typecheck
npm test
npm run i18n:check
npm run build
npx --no-install playwright install chromium
npm run test:e2e
npm run build:worker
npm audit --omit=dev --audit-level=high
npm audit --audit-level=high
```

Then check by hand:

- Follow the setup instructions in the [English](user-guide.md) and [Japanese](user-guide.ja.md) guides.
- Without any credentials, create a new site, edit it and reopen it.
- Export it as a zip in a format other than Next.js, then import that zip on the home screen and confirm the site comes back intact.
- Confirm that a production instance refuses access until either sign-in or anonymous access has been explicitly configured.

For that last check, use production mode in isolated staging. Do not change the
authentication settings on a live instance. The E2E runner uses `.e2e-data` and
an anonymous test server; confirm it is not reusing an unrelated running server.
CI also checks the Docker runtime and generated export formats; retain those
results for the candidate SHA. An unavailable registry, blocked local socket,
or undiscovered test is an incomplete check, never a pass.

## 2. Staging checks

Record the candidate SHA/version, previous known-good SHA and artifact digest or
Worker version, runtime versions, operator, UTC time, and intended hosting mode.
Inventory the actual storage targets before starting: `TSUMU_DATA_DIR` or Docker
volume for Node/Docker; Worker name, D1, KV and Durable Object namespaces for
Cloudflare. Staging must use different resources, a different URL, test accounts,
and a disposable GitHub repository/branch for publish tests. Disable production
publish destinations and external integrations on any restored staging data.

Default [Worker Previews](worker-previews.md) are anonymous and browser-only.
They can validate the editor UI but cannot establish server persistence,
daily backups, authenticated access or collaboration. Use an isolated,
authenticated environment with server storage for those checks. Inspect the
actual bindings, not just the local config; see the
[storage deployment checks](durable-object-storage.md#deployment).

| Check on the candidate | Evidence required |
| --- | --- |
| Access | Configured users can sign in; disallowed/unauthenticated access is refused under the intended policy. |
| Persistence | Create a disposable site, edit, wait for save, reload and restart the staging editor; content and uploaded media remain. |
| Collaboration | Two sessions see edits; stale/conflicting edits do not silently overwrite saved content. |
| Site lifecycle | Duplicate a fixture, reopen it, delete only the duplicate, and confirm the original and its media still work. |
| Portability | Export a fixture with uploaded assets, import as a new site, compare content and media, and exercise the intended generated format. |
| Publish and history | Publish two versions only to the test repository, rehearse Restore site and Restore edits there, and inspect the resulting commits and editor content. |
| Recovery | Complete the backup/restore drill below and attach its results. |

Do not promote while any applicable row is failed or untested. For a deliberately
browser-only deployment, record server-only checks as not applicable with the
reason; do not count them as tested.

## Backup and restore validation

Choose the tolerated data-loss window (RPO) and recovery time (RTO) before the
drill. Record backup start/end times, source version, storage identity, file
inventory, checksums, and the last saved fixture revision. Keep backup content
private, outside the checkout and outside the source data directory. Preserve
the last validated backup until a new one has passed the drill.

### What must be captured

| Mode | Recovery scope |
| --- | --- |
| Node.js / Docker | The entire stopped `TSUMU_DATA_DIR` or `/data` volume: SQLite, any WAL/SHM files still present, uploaded bytes in `assets/data/`, and metadata in `assets/meta/`. |
| Cloudflare | D1 metadata (including site-to-`room_key` mappings), each site's DocumentRoom data and daily backups, and KV asset bytes/metadata. Keep namespace identities and a coordinated recovery point in the private recovery record. |
| Browser-only | Export each required site with its assets before clearing browser data or changing origin. Server backups do not exist in this mode. |

The seven weekday backups contain editor documents, captured on a later edit
after the UTC day boundary. They are not seven guaranteed calendar days of
snapshots, do not capture every edit, and do not back up uploads, comments,
allowlists or the whole installation. Site deletion removes its automatic
backups. A ZIP or published `_tsumu/doc.json` also does not replace a full server
backup. Verify captured timestamps and content, rather than assuming a successful
save means a daily backup was created.

### Node.js and Docker drill

1. Use fixtures with a known document revision, comments, a daily backup and an
   uploaded image with known bytes and Content-Type. Save the expected values in
   the private drill record.
2. Disable automatic restarts and stop **all** writers. Confirm they have exited.
   Keep them stopped until the copy/archive completes. Sequentially copying a
   live database and its WAL is unsafe even if both files are included. Never
   remove WAL files to make a backup look complete.
3. For Node.js, copy the entire stopped directory into a new, separate backup
   directory. For Docker, use the checked [README backup block](../README.md#docker)
   with the actual container and volume names. A failed stop, copy, archive or
   verification blocks this backup from use; preserve the error and inspect the
   service state before deliberately restarting it. Restart after a successful
   copy, then verify the source editor is healthy.
4. Copy the backup, or extract the self-created archive, into a **new empty
   disposable directory/volume**. Never extract over an existing installation.
   Keep the original archive immutable. Check that `tsumu.db`, assets and metadata
   are present, and compare file checksums before opening the restored database.
   Do not combine files from different backup attempts.
5. Set `TSUMU_RESTORE_DIR` to that disposable directory and run the read-only
   SQLite check below before starting an editor. It checks an existing file and
   will not create an empty database for a mistyped path. It is only a structural
   check; `ok` does not establish that documents and assets agree.

<!-- restore-integrity-check -->
```sh
node --input-type=module <<'NODE'
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const dir = process.env.TSUMU_RESTORE_DIR;
if (!dir) throw new Error('Set TSUMU_RESTORE_DIR to the disposable restored directory');
const file = resolve(dir, 'tsumu.db');
if (!statSync(file).isFile()) throw new Error('Restored tsumu.db is missing');
const db = new DatabaseSync(file, { readOnly: true });
try {
  const rows = db.prepare('PRAGMA integrity_check').all();
  if (rows.length !== 1 || rows[0].integrity_check !== 'ok') {
    throw new Error('Restored SQLite integrity check failed');
  }
  console.log('SQLite integrity: ok; application and asset checks still required');
} finally {
  db.close();
}
NODE
```

6. Start the candidate against **only the restored copy**, on a separate local
   port or staging URL with no production credentials or publish destinations.
   For Docker use a new volume/bind mount and confirm the runtime user can read
   and write it. Compare site count, fixture revision/content, comments, daily
   backup content, uploaded bytes and served Content-Type with the recorded
   expectations. Edit, save, restart, reopen and export/import a fixture.
7. Separately rehearse the previous known-good application against another
   disposable copy after candidate writes. An application rollback is permitted
   only if that version can read and safely write the resulting data. Do not
   introduce compatibility or migration logic as part of this drill.
8. Record elapsed recovery time, recovered timestamp, comparisons and failures.
   A drill passes only when integrity, application behavior, assets and the
   chosen RPO/RTO pass. Any missing data or untested step blocks release readiness.

### Cloudflare drill

Use a dedicated staging Worker with isolated D1, KV and Durable Objects. Consult
the provider's current recovery facilities for the deployed resources and record
their retention and recovery points privately. A D1 export alone does not contain
DocumentRoom documents or KV assets, and Worker code rollback does not rewind
storage. Per-store recovery points are not an atomic cross-store snapshot.

Quiesce staging writes, capture all required stores at a coordinated point, and
rehearse recovery only into disposable resources. Verify that D1 `room_key`
mappings resolve to the recovered DocumentRooms, that document/backup counts and
timestamps match, and that referenced KV files and metadata are readable. Perform
the same content, collaboration, restart/reopen and export checks as above.
Do not delete/recreate a site to reconnect a room: room generations are intentional.
If isolated recovery of any required store is unavailable or unproven, record the
gap and block release readiness; do not experiment on production namespaces.

## 3. Rollback rehearsal and decision

Name the release operator and rollback decision owner. Retain the previous
known-good source/build or image digest, Worker version where applicable,
private configuration inventory and validated backup. Test the rollback on
staging before any rollout.

| Action | Effect and prerequisite |
| --- | --- |
| Editor application rollback | Reverts the editor code/build or container image/Worker version. Keeps stored data; first prove the previous code can safely use candidate-written data on a copy. Preserve storage bindings and namespace identities. |
| Published **Restore site** | Makes a new commit from the selected published version on the target branch. It may trigger that site's hosting deployment; it does not roll back the editor application or its database. Rehearse only on the test repository. |
| **Restore edits** / daily document restore | Replaces editor content as an edit; it does not restore the whole server or its uploads. Use a disposable site in staging and verify assets. |
| Full data recovery | Separate incident operation with potential loss of writes after the backup. This checklist only validates a disposable restore; it supplies no production overwrite command. |

Stop promotion for lost edits/assets, incorrect access, failed saves, wrong
storage bindings, or a failed recovery drill. If such a problem occurs during a
separately authorized rollout, stop further promotion, preserve logs and data,
and have the decision owner choose the rehearsed code rollback. If data safety
or compatibility is uncertain, quiesce writes and investigate on copies before
any recovery decision. Never assume reverting code repairs corrupted data.

## 4. Monitoring and release evidence

Record a pre-change baseline, numeric error/latency thresholds, observation
window and named responder before rollout. Use the same staging fixture and
load when comparing candidate results. The rollout operator must apply these
checks again after any separately authorized release or rollback.

| Signal | Validation / response |
| --- | --- |
| Availability and access | Check page loads and the intended sign-in policy. A `robots.txt` response alone does not validate storage or auth. Unexpected access is an immediate stop. |
| Saves and reloads | Track `/api/doc` failures and latency, conflict responses, saved revision persistence and collaboration reconnects. Investigate unexpected conflict increases; lost acknowledged edits are an immediate stop. |
| Assets and recovery | Check representative upload/read operations, backup age/content, archive verification and last successful restore drill. Missing assets or backups outside RPO block promotion. |
| Storage/runtime | Check Node disk usage and SQLite errors, or Worker errors/CPU, D1/DO/KV failures, quota usage and p50/p95 save/load latency. Compare to the recorded thresholds. |
| Publish and exports | Check generation/publish failures and test-site rendering. Confirm the intended repository and branch before publishing. |

Record results immediately after the change and at the end of the agreed
observation window. Escalate threshold breaches to the named responder; record
the decision and repeat smoke checks after rollback. These are operator checks,
not a claim that automated alerts already exist. Logs and evidence must omit
secrets and private document contents.

## 5. Release notes and source publication

**Include** only source code, documentation, the license and the lockfile.

**Leave out** environment files, `wrangler.local.jsonc`, `.wrangler/`, build output, databases, backup archives and test artifacts.

> [!WARNING]
> Inspect every file — and the Git history — that will become public, looking for credentials and private site content. Adding a file to `.gitignore` doesn't remove it from history that already exists.

Prepare draft release notes using this template; keep sensitive recovery details
in a private operator record:

```text
Version / candidate commit:
Previous known-good version:
User-visible fixes and changes:
Runtime requirements (Node, npm, hosting mode):
Storage or operational changes / required operator steps:
Validation: exact SHA, commands, results and CI evidence links:
Staging and restore drill: date, mode, pass/fail, achieved RPO/RTO:
Rollback rehearsal: previous version, result, limitations:
Monitoring: owner, thresholds, observation window and result/pending:
Known issues and blocked or untested checks:
```

Only after applicable checks and restore/rollback rehearsals pass for the exact
commit, and the operator separately authorizes publication:

1. Create a version tag that matches the version in `package.json`.
2. Publish the reviewed release notes with the evidence above. Do not describe
   blocked or untested checks as passing.

Build artifacts and editor data are not part of a source release.

## Data formats

The editable document format is the canonical `SiteDoc` with `schemaVersion: 1`.
Browser storage uses `tsumu-` keys, clipboard data uses
`application/x-tsumu+json`, and exported ZIPs store editing data and
publish metadata in `_tsumu/`. Imports require this same document schema.

Document backups, restoring, undo, and rolling back to a published version
remain supported.
