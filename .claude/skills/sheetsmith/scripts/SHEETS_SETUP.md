# One-time Google Sheets API setup (OAuth, ~5 min)

Do this once. After it, `node build_sheet.js <spec.json>` creates dashboards live in your own Drive.

## 1. Create a Google Cloud project + enable the Sheets API
1. Go to <https://console.cloud.google.com/> → create a project (e.g. "Sheets Builder"), or pick an existing one.
2. Enable two APIs (APIs & Services → Library, search + Enable each):
   - **Google Sheets API**
   - **Google Drive API**

## 2. Configure the OAuth consent screen
1. APIs & Services → **OAuth consent screen**.
2. User type **External** (fine for personal use) → fill app name + your email → Save.
3. On **Test users**, add your own Google email. (No verification needed while in "Testing".)

## 3. Create an OAuth **Desktop app** client
1. APIs & Services → **Credentials** → **Create credentials** → **OAuth client ID**.
2. Application type: **Desktop app** → Create.
3. **Download JSON.** Save it as exactly:
   ```
   .claude/skills/sheetsmith/scripts/credentials.json
   ```

## 4. Authorize (one browser approval)
From this `scripts/` folder, run it yourself in the session with the `!` prefix so the browser opens:
```
! cd .claude/skills/sheetsmith/scripts && node authorize.js
```
Approve the consent screen. It writes `token.json`. Done.

## Cloud sessions (Claude Code on the web or in the Claude app)
A cloud session can't run `authorize.js` (its sign-in page redirects to the session's own machine, which
your browser can't reach), and files written there vanish when the session ends. Instead, store the
credentials in the cloud environment's settings, where every new session picks them up:

1. Do steps 1–2 above (project, both APIs, consent screen with yourself as a test user).
2. **Publish the app** (OAuth consent screen / Google Auth Platform → Audience → **Publish app**). While it
   is in "Testing", Google expires the sign-in after 7 days. Unverified is fine for personal use: you'll
   see a "Google hasn't verified this app" screen; choose **Advanced → Go to (your app)**.
3. **Create a Web application client:** Credentials → Create credentials → OAuth client ID → type
   **Web application** → under Authorized redirect URIs add `https://developers.google.com/oauthplayground`
   → Create. Keep the Client ID and Client secret it shows. (A Desktop app client can't be used here.)
4. **Get a refresh token** at <https://developers.google.com/oauthplayground>:
   - Gear icon (top right) → tick **Use your own OAuth credentials** → paste the Client ID and secret.
   - Step 1, "Input your own scopes":
     `https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file`
     → **Authorize APIs** → choose your account → Allow.
   - Step 2 → **Exchange authorization code for tokens** → copy the **Refresh token**.
5. **Add three environment variables** to the cloud environment (environment menu in the session's title
   bar → Edit): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`. Start a new session;
   `google_auth.js` reads them. Never paste these values into a chat.

## Notes
- `credentials.json` and `token.json` are git-ignored — they're secrets, never commit them.
- Scopes requested: `spreadsheets` (edit sheets) + `drive.file` (only files this tool creates). It cannot see your other Drive files.
- To reset: delete `token.json` and re-run `node authorize.js`.
- If you see "access blocked / app not verified": make sure your email is added under **Test users** (step 2.3).
