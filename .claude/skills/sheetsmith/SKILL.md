---
name: sheetsmith
description: >
  Guided, self-checking pipeline for building spreadsheets and dashboards. Gates on output at the start —
  **defaults to a live Google Sheet**, or a local **.xlsx** file on request — then interviews the user on
  type, scope, tabs, and styling, drafts one workbook spec, spawns adversarial sub-agents to verify every
  formula, builds it (native charts, KPI cards, banding, conditional formats, themed colors), and validates
  the result before handing it over. Trigger when the user says "build me a spreadsheet", "make a Google
  Sheet", "design a dashboard", "budget/P&L/tracker/financial model", "spreadsheet from scratch",
  "spreadsheet wizard", or wants a new workbook with working, trustworthy formulas. Produces a Google Sheet
  URL (or .xlsx path) plus a QA report. Do NOT use for a quick throwaway inline table (just answer directly),
  or to operate on an already-existing sheet (build new here).
---

# Sheetsmith

The one pipeline for building a spreadsheet or dashboard: pick the output surface, interview, draft a spec,
**adversarially verify every formula**, build, and validate. The verification loop is the point — a
Sheetsmith workbook ships with checked formulas and a QA report, not a "looks good" rubber stamp. One spec
feeds two renderers: a native **Google Sheet** (default) or a local **.xlsx** file.

## When to use
- "Build me a spreadsheet / Google Sheet / dashboard from scratch"
- "Make me a budget / P&L / project tracker / financial model"
- "Spreadsheet wizard" / a new workbook with formulas they can trust, with an at-a-glance dashboard
- **Not** for a quick one-off table in chat → write it inline.
- **Not** for editing/analyzing an already-existing sheet → this builds new.

## Workflow

### Phase 0 — Gate: choose the output surface  ← always first
Ask once, up front: **"Live Google Sheet (shareable, renders natively) or a local .xlsx file?"**
- **Google Sheet (default / recommended).** Requires the one-time OAuth setup. If `scripts/token.json`
  is missing, walk the user through `scripts/SHEETS_SETUP.md` first (or offer `.xlsx` now and Google later).
- **.xlsx file.** Works immediately, no setup; offline/portable.
Record the choice — it only changes the *build* + *validation* steps; everything else is shared.

### Phase 1 — Intake interview
Ask these, one topic at a time (adapt; don't dump all at once):
1. **Type / purpose** — budget, P&L, project tracker, financial model, schedule, inventory, CRM, other.
2. **Scope** — columns/metrics, time range, granularity (daily / weekly / monthly).
3. **Tabs** — how many and what each holds (e.g. `Data` → `Summary` → `Dashboard`).
4. **Formulas** — sums/rollups, % change, lookups, conditional logic, cross-tab references.
5. **Styling** — header/theme color, row banding, number/currency formats, conditional-format rules.
6. **Dashboard?** — a `Dashboard` tab with KPI cards (label + big number), charts (bar/line/pie), and visual
   highlighting (color scales / data bars where supported), drawn from the data tabs.
7. **Destination** — Sheet title (Google) or filename + path (.xlsx); anyone to share with (Google).

Branch: a known type starts from a template (below); "other" is built from the scope answers.
Integrity rule: **don't draft the spec until intake is answered** (or defaults are explicitly authorized + logged).

### Phase 2 — Draft the workbook spec
Write one workbook-spec JSON (see `references/spec-schema.md`) to `/tmp/<name>-spec.json` — the artifact the QA
agents attack and *both* renderers consume. **For a dashboard, build to `references/dashboard-layout.md`:** a
`Dashboard` tab (`columns: []`) with a spacer-grid (`column_widths`), `section_bars`, panel `fills`, KPI cards,
and charts laid out so cards and their charts align in the same panel columns. The default `theme` (pastel +
terracotta, from the "Budget by Paycheck" reference) is applied unless overridden.

### Phase 3 — QA checkpoint 1: spec audit (pre-build)
Spawn **3 parallel sub-agents with the Agent tool** (`subagent_type: Explore`), one per lens, each pointed at
the saved spec and told to *try to break it*. Prompt template per agent (substitute `<LENS>`):

> "You are an adversarial spreadsheet-formula auditor. Read the workbook spec at `<spec path>`. Your lens:
> **<LENS>**. Try to find broken formulas. Return every defect as `cell-or-range → what's wrong → fix`,
> quoting the offending formula. If you find none, list the specific things you checked. Do NOT rubber-stamp:
> a reply of 'looks good' with no itemized checks is a failed review and will be re-run."

Lenses: **Reference correctness** (right cells/ranges/tabs; off-by-one; wrong column; `#REF!` risk) ·
**Edge cases** (div-by-zero, empty/partial ranges, text-in-numeric, sign errors, % bases) ·
**Reconciliation** (totals sum their parts; cross-tab refs resolve; math adds up end-to-end).
An agent with no itemized checks is **re-run, not accepted**. Fix every concrete finding; record each for the report.

### Phase 4 — Build (by the Phase-0 target)
**Google Sheet:**
```
cd scripts && node build_sheet.js /tmp/<name>-spec.json      # prints the Sheet URL
```
**.xlsx file:**
```
python3 scripts/build_xlsx.py /tmp/<name>-spec.json <out.xlsx>   # needs openpyxl
```
Both apply the `theme` to KPI cards, **section bars**, and **chart series** (never default colors), the
spacer-grid, banding, number formats, merges, conditional formats, freezes, and hidden gridlines.

### Phase 5 — QA checkpoint 2: post-build validation
Confirm formulas evaluated (no `#REF!`/`#DIV/0!`) and **independently recompute a sample** (≥3 formula cells).
- **Google:** read back via the API in `scripts/`:
  ```js
  const fs=require("fs"),{google}=require("googleapis");
  const sheets=google.sheets({version:"v4",auth:google.auth.fromJSON(JSON.parse(fs.readFileSync("token.json","utf8")))});
  sheets.spreadsheets.values.get({spreadsheetId:"<ID>",range:"Data!A1:Z60",valueRenderOption:"FORMATTED_VALUE"}).then(r=>console.log(r.data.values));
  ```
- **.xlsx:** parse with openpyxl and inspect formula cells:
  ```python
  import openpyxl
  for ws in openpyxl.load_workbook("<out.xlsx>"):
      for row in ws.iter_rows():
          for c in row:
              if isinstance(c.value,str) and c.value.startswith("="): print(ws.title,c.coordinate,c.value)
  ```
Any error/mismatch → fix the spec and rebuild. Record sampled cells + results.

### Phase 6 — QA checkpoint 3: formatting & layout audit
Audit against `references/dashboard-layout.md`'s checklist: headers frozen; number formats consistent;
**charts themed (no default colors); chart `data`/`categories` point at real ranges; KPI values resolve;
spacer-grid applied; cards/charts/section bars aligned and not overlapping; readable contrast.**
- **Google:** pull rendered specs via `spreadsheets.get` with `fields:"sheets(charts,properties)"`.
- **.xlsx:** chart colors don't survive an openpyxl re-read — read them from the file:
  `import zipfile,re; [print(n, re.findall(r'srgbClr val="([0-9A-Fa-f]{6})"', zipfile.ZipFile("<out.xlsx>").read(n).decode())) for n in zipfile.ZipFile("<out.xlsx>").namelist() if re.match(r"xl/charts/chart\d+\.xml$",n)]`
Ask: *would the user trust and use this as-is?* Fix what doesn't pass.

### Phase 7 — Deliver
Hand over the **Sheet URL** (Google) or **.xlsx path**, plus the QA report.

## Google output: prerequisite & constraints
- **One-time OAuth** (`scripts/SHEETS_SETUP.md`): create a Desktop OAuth client → `scripts/credentials.json` →
  `node authorize.js` → `token.json`. Don't attempt a Google build before `token.json` exists.
- **Sheets-API limits (vs .xlsx):** `data_bar`/`icon_set` conditional formats aren't supported (the builder
  skips them with a warning — use `color_scale`/`cell_is`); pie/doughnut slice colors auto-assign (bar/line ARE themed).

## Integrity rules
- Never deliver without all three QA checkpoints.
- Every formula agent-verified (cp 1) and a sample independently recomputed (cp 2).
- No build before the output gate + intake are answered. Never silently auto-correct — record every fix.
- Confirm the destination before writing. Google Sheets land in the user's own Drive (scope `drive.file`).

## Output format — the QA report
```
## Sheetsmith QA Report — <name>  (<Google Sheet | .xlsx>)
Tabs: <n> | Formulas checked: <n> | Independently recomputed: <n sampled>
Checkpoint 1 — spec audit:    Found <…> → Fixed <…>  | or  Clean (attacked X,Y,Z)
Checkpoint 2 — post-build:     Formulas intact <y/n> | Sample recompute <cell = expected vs got>
Checkpoint 3 — formatting:     Charts themed <y/n> | Layout/alignment <pass notes>
Confidence: <high/medium + why>   Deferred: <pivots, sparklines, images, data-bars-on-Sheets, etc.>
Delivered: <URL or path>
```

## Starter templates (by type)
- **Budget** — `Data` (Month, Category, Budget, Actual, Variance=`Budget-Actual`) → `Summary` (rollups, totals).
- **P&L** — `Detail` (Date, Account, Amount) → `P&L` (Revenue, COGS, Gross, OpEx, Net) with monthly columns.
- **Project tracker** — `Tasks` (Task, Owner, Status, Start, Due, % done) + conditional format on overdue.
- **Financial model** — `Assumptions` → `Model` (driver-based, cross-tab refs) → `Outputs`.
- **Dashboard** — a `Dashboard` tab (`columns: []`) with KPI cards (`=SUM(Data!…)`) across the top + 1-2 charts
  below, pulling from the data tab(s); pair with color scales / data bars on the data tab.

## Anti-patterns to avoid
- **Skipping the output gate.** Always settle Google-vs-.xlsx first — it changes build + validation.
- **Cosmetic QA.** Agents must attack specific formulas or be re-run.
- **Unverified formulas / charts on default colors** — the `[!GENERIC]` failure; theme charts and recompute formulas.
- **Building before the interview**, or **silent fixes** (every correction goes in the QA report).
- **A Google build before `token.json` exists** — do the one-time setup first, or fall back to .xlsx.

## Assets
- `scripts/build_sheet.js` — spec → native Google Sheet (Sheets API; themed charts, cards, formats).
- `scripts/build_xlsx.py` — spec → local styled `.xlsx` (openpyxl).
- `scripts/authorize.js` + `scripts/SHEETS_SETUP.md` — one-time Google OAuth.
- `references/spec-schema.md` — the shared workbook-spec format (both renderers).
- `references/dashboard-layout.md` — the dashboard layout & color system (from "Budget by Paycheck").
