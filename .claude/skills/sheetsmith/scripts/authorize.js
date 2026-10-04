#!/usr/bin/env node
/**
 * One-time OAuth consent for the Sheets dashboard builder.
 *
 *   node authorize.js
 *
 * Reads your OAuth desktop client from credentials.json (downloaded from Google Cloud),
 * opens a browser for consent, and saves a reusable token to token.json.
 * See SHEETS_SETUP.md for how to get credentials.json.
 */
const fs = require("fs");
const path = require("path");
const { authenticate } = require("@google-cloud/local-auth");

const HERE = __dirname;
const CRED = path.join(HERE, "credentials.json");
const TOKEN = path.join(HERE, "token.json");

// Minimal scopes: edit spreadsheets + manage only files this app creates (lands in YOUR Drive).
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
];

async function main() {
  if (!fs.existsSync(CRED)) {
    console.error(
      "Missing credentials.json.\n" +
        "Create an OAuth *Desktop app* client in Google Cloud (see SHEETS_SETUP.md),\n" +
        "download it, and save it as:\n  " + CRED
    );
    process.exit(1);
  }
  const client = await authenticate({ scopes: SCOPES, keyfilePath: CRED });
  const keys = JSON.parse(fs.readFileSync(CRED, "utf8"));
  const key = keys.installed || keys.web;
  if (!client.credentials.refresh_token) {
    console.error(
      "No refresh token returned. Revoke prior access at https://myaccount.google.com/permissions " +
        "and re-run, or delete token.json first."
    );
    process.exit(1);
  }
  fs.writeFileSync(
    TOKEN,
    JSON.stringify(
      {
        type: "authorized_user",
        client_id: key.client_id,
        client_secret: key.client_secret,
        refresh_token: client.credentials.refresh_token,
      },
      null,
      2
    )
  );
  console.log("Authorized ✓  token saved to token.json");
  console.log("Now build a dashboard with:  node build_sheet.js <spec.json>");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
