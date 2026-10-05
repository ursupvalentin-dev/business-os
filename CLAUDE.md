# business-os

## Spreadsheets
- Build budget spreadsheets as live Google Sheets with the sheetsmith skill (`scripts/build_sheet.js`), not
  as .xlsx files. For budgets, skip sheetsmith's Phase 0 output question: the answer is Google Sheets. Only
  make an .xlsx when the user asks for one.
- Google credentials come from the `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REFRESH_TOKEN`
  environment variables set in the cloud environment's settings. Run `npm ci` in
  `.claude/skills/sheetsmith/scripts` first if `node_modules` is missing.
- If those variables are missing, or Google rejects them (for example an expired sign-in), stop and tell the
  user how to fix it ("Cloud sessions" in `.claude/skills/sheetsmith/scripts/SHEETS_SETUP.md`). Don't fall
  back to .xlsx without asking.
- Never ask for these credentials in chat, print them, or commit `credentials.json` / `token.json`.
- Keep each workbook's spec at `spreadsheets/<name>.spec.json` so it can be rebuilt or edited later.
