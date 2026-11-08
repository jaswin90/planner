# My Planner: encrypted notes + planner

A notes and planner app that runs entirely in your browser. You can use it from any device at
`https://jaswin90.github.io/apps/planner/` (published by the site repository `jaswin90/jaswin90.github.io`;
the old address `/planner/` forwards there).

- **Planner**: Day and Month views. Your to-dos are sticky notes in a board on the left, grouped
  **Unplanned / Doing / Planned / Backlog / Done**. Drag a sticky onto a day (Month) or an hour (Day) to plan it.
- **Projects**: pick one from the **Project ▾** dropdown at the top (or create a new one there). The planner and notes
  then show only that project.
- **Notes** (Evernote-style, three panes that fold away): projects | sticky-note list | the note. A note can hold
  headings, lists, checklists, **tables**, **equations** (LaTeX), callouts, **photos**, **voice notes** (record in the
  browser), and **PDFs or any file** (PDFs preview inline). Search also finds file names.
- **One login for the whole site.** Sign in once at `/library/` (invite-only; the same account as the books),
  then click **Connect Google Drive** once. Files are stored encrypted in your own Drive, and your Google account is the key.
- Works offline. It saves on the device and syncs when you're back online. You can install it as an app
  ("Install" / "Add to Home screen").

No server, no database, no build step, no dependencies.

---

## Setup

There is nothing to set up in this repository and no key or client ID in it.

- **Where it runs.** `jaswin90/jaswin90.github.io` fetches this repository's app files (branch named in its
  `site.json`) and publishes them at `/apps/planner/`. This repository's own Pages workflow only runs the tests and
  publishes a redirect from `/planner/` to `/apps/planner/`.
- **Sign-in.** The app uses the site-wide account module `/assets/js/site-auth.js` (Firebase Auth, invite-only).
  People sign in at `/library/`; the admin manages the invite list there. To reach Drive, the app asks Google
  through that same account for the `drive.appdata` scope only. The Google side is set up once for the whole site
  in the Firebase project (see the site repository's README); nobody needs to be added as a "test user".

### First use
Sign in at the library, open the app and click **Connect Google Drive**. That's it. On your other devices, sign in with the same Google
account and everything shows up.

Try it without Google: "Use on this device only" keeps everything (encrypted) in that browser only, which is
handy on a work laptop where Google Drive is blocked. Use Settings → Export backup (password-protected) now and
then, because clearing browser data (or a VDI profile reset) erases it. Import it on any device.

---

## Security

| Threat | Protection |
|---|---|
| Someone gets your files from Drive or this browser | Every file (notes, tasks, photos, PDFs) is AES-256-GCM encrypted. |
| App sees your other Drive files | Uses only the `drive.appdata` scope: a private, hidden folder just for this app. No access to your other files. |
| Someone signs in as you | Your Google account protects everything. **Turn on 2-Step Verification.** |
| Malicious note content (XSS) | Strict allow-list HTML sanitizer on every save and render; pasted scripts, event handlers, `javascript:` links, iframes and remote images are stripped. |
| Injected scripts / data theft | Strict Content-Security-Policy: scripts only from this site and Google sign-in; network only to Google APIs. |
| Dangerous attachments | Files open as images, PDF or plain text only; anything else (HTML, SVG…) is downloaded, never rendered. |
| Swapped / tampered files | Each encrypted file is bound to its name (AES-GCM associated data); any change is detected. |
| Clickjacking | The app refuses to run inside a frame. |
| Tracking / referrer leaks | No analytics, no third-party fonts or CDNs, `no-referrer`. |

What this does **not** protect against (the trade-off for having no passphrase):
- The encryption key is kept in your Drive app folder, so Google, or anyone who gets into your Google
  account, could in principle read your data. If you need protection even from that, it needs a passphrase.
- On a device where you've used the app, the browser keeps a copy so it opens offline. Click **Sign out** on
  shared computers, and use Settings → **Forget this device** to remove that copy.
- "Export backup" (Settings) is password-protected unless you choose "No password".

See [DESIGN.md](DESIGN.md) for how it works inside.

## Develop / test

```bash
python3 -m http.server 8080      # then open http://localhost:8080
node --test tests/*.test.mjs     # crypto + merge unit tests
node tests/e2e.mjs               # full browser test, on-device mode (needs Playwright + Chromium)
node tests/google.e2e.mjs        # Google sign-in + Drive sync against a fake Google, two devices
node tests/sync.e2e.mjs          # sync engine merge between two devices
```
