# My Planner: encrypted notes + planner

A notes and planner app that runs entirely in your browser. You can use it from any device at
`https://jaswin90.github.io/planner/`.

- **Planner**: Day and Month views. A sidebar of sticky tasks sorted into **Unplanned / Doing / Planned /
  Backlog / Done**. Drag a sticky onto a day (Month view) or an hour (Day view) to plan it.
- **Notes**: rich text (headings, bold/italic/underline, highlight, lists, checklists, quotes, code, links),
  **photos inline**, and **PDFs or any other file attached**. Paste or drag files straight in. You can preview
  PDFs and photos inside the app.
- **Sign in with Google.** Your data syncs between your devices through a hidden app folder in your own Google Drive.
- **Simple login.** Just Google sign-in, with no extra passwords. Files are stored encrypted, and your Google
  account is the key.
- Works offline. It saves on the device and syncs when you're back online. You can install it as an app
  ("Install" / "Add to Home screen").

No server, no database, no build step, no dependencies.

---

## What you need to do (one-time setup, ~10 minutes)

### 1. Turn on GitHub Pages
1. On GitHub, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
2. Go to **Actions → "Test and deploy to GitHub Pages" → Run workflow** (or just push a commit).
   It runs the tests and publishes the site at `https://jaswin90.github.io/planner/`.
   Pushes to the default branch (or `main`) redeploy automatically.

> On a free GitHub plan, Pages only works for **public** repositories. That's safe here: the code holds no
> secrets and your data never goes into the repo. To keep the repo private you need GitHub Pro.

### 2. Set up Google sign-in (free)
1. Open <https://console.cloud.google.com/> and create a project, e.g. "My Planner".
2. **APIs & Services → Library**: search for **Google Drive API** and click **Enable**.
3. **APIs & Services → OAuth consent screen** (also called "Google Auth Platform"):
   - User type **External**, app name "My Planner", your email as support and developer contact.
   - **Data access / Scopes**: add `.../auth/drive.appdata`, `openid`, `email` and `profile`.
   - **Audience / Test users**: add your Gmail address (and anyone else who will use it).
     You can leave the app in "Testing" mode for personal use.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - **Authorized JavaScript origins**: `https://jaswin90.github.io`
     (add `http://localhost:8080` too if you want to test on your computer)
   - No redirect URIs needed.
5. Copy the **Client ID** (it looks like `1234567890-abc...apps.googleusercontent.com`). Don't put it in the code.
   Store it in the repo settings instead:
   **GitHub → Settings → Secrets and variables → Actions → New repository secret**,
   Name `GOOGLE_CLIENT_ID`, Secret = the client ID. Then re-run the deploy
   (**Actions → Test and deploy to GitHub Pages → Run workflow**).
   The workflow inserts it into the published site. (It is visible in the live site, as it must be for any
   Google sign-in; Google only accepts it from the origins you listed.)

> In "Testing" mode Google may ask you to sign in again about once a week. That's normal.

### 3. First use
Open the site and click **Sign in with Google**. That's it. On your other devices, sign in with the same Google
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
