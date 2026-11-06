# Design

## Goals
Notes + planner, usable from any device, hosted for free on GitHub Pages, with Google sign-in and
all user data end-to-end encrypted. Only two areas: **Planner** (Day and Month views) and **Notes**.
Settings sit behind the gear icon.

## Architecture
Static site (vanilla ES modules, no build). GitHub Pages serves the code only.

```
Browser ──(AES-GCM ciphertext only)──> Google Drive appDataFolder   (sync between devices)
   └────────────────────────────────> IndexedDB                     (offline cache, also ciphertext)
```

| File | Role |
|---|---|
| `js/crypto.js` | Key creation, encrypt/decrypt (WebCrypto) |
| `js/vault.js` | Decrypted document in memory, local cache, Drive sync, attachments |
| `js/model.js` | Data model, per-item merge, calendar maths (no DOM; unit tested) |
| `js/google.js` | Google Identity Services token client + Drive REST |
| `js/sanitize.js` | Allow-list HTML sanitizer |
| `js/editor.js` | Rich-text editor, photos, file chips, PDF viewer |
| `js/planner.js` | Sidebar of stickies, Day view, Month view, task dialog |
| `js/notes.js` | Note list, search, note editor |
| `js/settings.js` | Projects/notebooks, account, backup, delete |
| `js/app.js` | Google sign-in, header, routing |
| `sw.js` | Offline cache of the app's own files (never user data) |

## Encryption
- One random 256-bit **account key** is created on first sign-in and stored as `planner-key.json` in the
  account's Drive app folder (and cached in IndexedDB on each device). No passphrase.
- Every file is `AES-256-GCM(key)` with a fresh 96-bit IV. Associated data = file purpose (`doc`, `att:<id>`),
  so ciphertexts can't be swapped.
- Protection therefore equals the Google account's protection (use 2-Step Verification). It keeps files
  encrypted at rest and stops anything else in the browser or Drive from reading them as plain files, but it is
  not end-to-end against Google.

## Data model
One encrypted document `{ schema, items: { id: item } }`; item types `task`, `note`, `project`, `att`
(attachment metadata). Attachment bytes are separate encrypted files `att-<id>.bin`, fetched on demand and cached.

Task: `title, status (todo|doing|done|backlog), date, time, due, projectId, html, attachments[]`.
Sidebar section is derived: done / backlog / doing / planned (todo with date) / unplanned (todo, no date).

## Sync
Every item has `updatedAt` + `rev`. Sync downloads the remote document, merges **per item** (newer wins,
deterministic tie-break, tombstones for deletes, purged after 90 days), uploads if the remote is behind and
saves locally. It runs 1.5 s after an edit, every 60 s, on focus and when back online. Edits made offline
are kept and merged later. If two devices edit *different* items, nothing is lost. If both edit the *same*
note, the later edit wins.

## Sign-in
Google Identity Services token model, scopes `openid email profile drive.appdata`. The access token lives in
memory only. When it expires, the sync pill shows **Reconnect** (browsers block popups that don't come from a
click). Accounts are kept apart in local storage by Google `sub`.
