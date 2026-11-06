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
| `js/crypto.js` | Key derivation, wrapping, encrypt/decrypt (WebCrypto) |
| `js/vault.js` | Decrypted document in memory, local cache, Drive sync, attachments |
| `js/model.js` | Data model, per-item merge, calendar maths (no DOM; unit tested) |
| `js/google.js` | Google Identity Services token client + Drive REST |
| `js/sanitize.js` | Allow-list HTML sanitizer |
| `js/editor.js` | Rich-text editor, photos, file chips, PDF viewer |
| `js/planner.js` | Sidebar of stickies, Day view, Month view, task dialog |
| `js/notes.js` | Note list, search, note editor |
| `js/settings.js` | Projects/notebooks, passphrase, recovery code, backup, delete |
| `js/app.js` | Sign-in, create/unlock screens, header, routing, auto-lock |
| `sw.js` | Offline cache of the app's own files (never user data) |

## Encryption
- Random 256-bit **data key (DEK)**. Every file is `AES-256-GCM(DEK)` with a fresh 96-bit IV.
  Associated data = file purpose (`doc`, `att:<id>`), so ciphertexts can't be swapped.
- The DEK is stored only **wrapped**:
  - by `PBKDF2-SHA256(passphrase, salt, 600k)` → KEK
  - by `PBKDF2-SHA256(recovery code, rsalt, 600k)` → RKEK (160-bit random code)
- `vault-meta.json` (salts + wrapped keys) is not secret. The Drive copy is authoritative, so a passphrase
  changed on one device works everywhere.
- After unlock the DEK is a non-extractable `CryptoKey`. Lock drops it along with all decrypted data and
  object URLs.

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
