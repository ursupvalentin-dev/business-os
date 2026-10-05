# business-os

## Spreadsheets
- Build budget spreadsheets as live Google Sheets with the sheetsmith skill (`scripts/build_sheet.js`), not
  as .xlsx files. For budgets, skip sheetsmith's Phase 0 output question: the answer is Google Sheets. Only
  make an .xlsx when the user asks for one.
- Google credentials: on the user's own computer, `.claude/skills/sheetsmith/scripts/token.json` (made by
  `node authorize.js` from `credentials.json` in the same folder); in cloud sessions, the
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REFRESH_TOKEN` environment variables. Run `npm ci`
  in `.claude/skills/sheetsmith/scripts` first if `node_modules` is missing.
- If no credentials are available, or Google rejects them (for example an expired sign-in), stop and tell the
  user how to fix it (`.claude/skills/sheetsmith/scripts/SHEETS_SETUP.md`). Don't fall back to .xlsx
  without asking.
- Never ask for these credentials in chat, print them, or commit `credentials.json` / `token.json`.
- Keep each workbook's spec at `spreadsheets/<name>.spec.json` so it can be rebuilt or edited later.
- The user builds many niche budget spreadsheets. For each one: interview first with clickable multiple-choice
  questions (as sheetsmith's Phase 1 does), then make it rich: more tabs and more information than a minimal
  version (for example a Start Here guide, the core tracker tabs, monthly and yearly summaries, goals, and a
  dashboard with charts), and hand over the Google Sheets link. Keep replies to the user short and simple.
