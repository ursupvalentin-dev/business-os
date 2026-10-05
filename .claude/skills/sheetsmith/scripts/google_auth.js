/**
 * Google credentials for the sheetsmith scripts.
 *
 * Uses token.json (written by `node authorize.js` on your own computer) when present, otherwise the
 * GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN environment variables, which is how
 * Claude Code cloud sessions get credentials without a file. See SHEETS_SETUP.md.
 */
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const TOKEN = path.join(__dirname, "token.json");

function loadAuth() {
  if (fs.existsSync(TOKEN)) return google.auth.fromJSON(JSON.parse(fs.readFileSync(TOKEN, "utf8")));
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN) {
    return google.auth.fromJSON({
      type: "authorized_user",
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
    });
  }
  console.error(
    "No Google credentials. Either run `node authorize.js` (writes token.json), or set\n" +
      "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN. See SHEETS_SETUP.md."
  );
  process.exit(1);
}

module.exports = { loadAuth };
