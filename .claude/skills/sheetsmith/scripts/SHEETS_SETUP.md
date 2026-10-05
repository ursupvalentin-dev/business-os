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

## Notes
- `credentials.json` and `token.json` are git-ignored — they're secrets, never commit them.
- Scopes requested: `spreadsheets` (edit sheets) + `drive.file` (only files this tool creates). It cannot see your other Drive files.
- To reset: delete `token.json` and re-run `node authorize.js`.
- If you see "access blocked / app not verified": make sure your email is added under **Test users** (step 2.3).
