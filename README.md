# My Planner: encrypted notes + planner

A notes and planner app that runs entirely in your browser. You can use it from any device at
`https://jaswin90.github.io/planner/`.

- **Planner**: Day and Month views. A sidebar of sticky tasks sorted into **Unplanned / Doing / Planned /
  Backlog / Done**. Drag a sticky onto a day (Month view) or an hour (Day view) to plan it.
- **Notes**: rich text (headings, bold/italic/underline, highlight, lists, checklists, quotes, code, links),
  **photos inline**, and **PDFs or any other file attached**. Paste or drag files straight in. You can preview
  PDFs and photos inside the app.
- **Sign in with Google.** Your data syncs between your devices through a hidden app folder in your own Google Drive.
- **End-to-end encrypted.** Everything (text, photos, PDFs) is encrypted in the browser with your passphrase
  before it is saved or uploaded. Google, GitHub and the app author can't read it.
- Works offline. It saves on the device and syncs when you're back online. You can install it as an app
  ("Install" / "Add to Home screen").

No server, no database, no build step, no dependencies.

---

## What you need to do (one-time setup, ~10 minutes)

### 1. Turn on GitHub Pages
1. Merge this branch into `main` (or push it there).
2. On GitHub, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. The workflow `.github/workflows/pages.yml` runs the tests and publishes the site. It ends up at
   `https://jaswin90.github.io/planner/`.

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
5. Copy the **Client ID** (it looks like `1234567890-abc...apps.googleusercontent.com`) into
   [`js/config.js`](js/config.js):
   ```js
   googleClientId: '1234567890-abc....apps.googleusercontent.com',
   ```
   Commit and push. The client ID is **not a secret**. Google only accepts it from the origins you listed.

> In "Testing" mode Google may ask you to sign in again about once a week. That's normal.

### 3. First use
1. Open the site and click **Sign in with Google**.
2. Choose a **passphrase** (10+ characters; four or five random words works well).
3. **Save the recovery code** it shows you, on paper or in a password manager. If you forget the passphrase
   **and** lose the recovery code, your data can't be recovered. That's the price of real encryption.
4. On your other devices, sign in with the same Google account and enter the same passphrase.

Try it without Google: "Use on this device only" keeps everything (encrypted) in that browser only.

---

## Security

| Threat | Protection |
|---|---|
| Someone reads your Google Drive / Google itself | Everything is AES-256-GCM encrypted before upload. Drive only holds ciphertext. |
| Weak passphrase brute force | PBKDF2-SHA256 with 600,000 iterations (OWASP 2023+ guidance); 10+ characters; strength check. |
| App sees your other Drive files | Uses only the `drive.appdata` scope: a private, hidden folder just for this app. No access to your other files. |
| Stolen laptop / browser storage | Local cache is encrypted the same way. Auto-lock after 15 min idle (configurable). Lock button. Google token kept in memory only. |
| Malicious note content (XSS) | Strict allow-list HTML sanitizer on every save and render; pasted scripts, event handlers, `javascript:` links, iframes and remote images are stripped. |
| Injected scripts / data theft | Strict Content-Security-Policy: scripts only from this site and Google sign-in; network only to Google APIs. |
| Dangerous attachments | Files open as images, PDF or plain text only; anything else (HTML, SVG…) is downloaded, never rendered. |
| Swapped / tampered files | Each encrypted file is bound to its name (AES-GCM associated data); any change is detected. |
| Clickjacking | The app refuses to run inside a frame. |
| Tracking / referrer leaks | No analytics, no third-party fonts or CDNs, `no-referrer`. |
| Lost passphrase | Recovery code (160-bit), can be regenerated from Settings. |
| Passphrase change | Re-wraps the key; works across devices without re-encrypting data. |

Limits to know about:
- GitHub Pages can't send HTTP security headers, so the CSP is a `<meta>` tag. This covers script, network
  and frame rules. Framing protection is done in JavaScript.
- Anyone who can run code on your unlocked device (malware, a malicious browser extension) can see what you
  see. Encryption protects data at rest and in transit, not an unlocked screen.
- "Export backup" (Settings) writes an **unencrypted** file. Store it carefully.

See [DESIGN.md](DESIGN.md) for how it works inside.

## Develop / test

```bash
python3 -m http.server 8080      # then open http://localhost:8080
node --test tests/*.test.mjs     # crypto + merge unit tests
node tests/e2e.mjs               # full browser test (needs Playwright + Chromium)
```
