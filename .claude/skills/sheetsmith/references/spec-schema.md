# Workbook Spec Schema (`sheetsmith`)

The skill drafts a **workbook spec** (JSON) in Phase 2; the QA agents attack it in Phase 3; then
`scripts/build_xlsx.py <spec.json> <out.xlsx>` materializes it. This file documents the format.

## Top level
```json
{ "filename": "budget-2026.xlsx", "tabs": [ <tab>, ... ] }
```

## Tab
```json
{
  "name": "Data",                       // becomes the sheet tab (Excel caps at 31 chars)
  "freeze": "A2",                        // optional: freeze panes above/left of this cell
  "columns": [ <column>, ... ],
  "rows":    [ <row-object>, ... ],      // each keyed by column "key"
  "formulas": [ <formula>, ... ],
  "conditional_formats": [ <cf>, ... ],
  "kpi_cards": [ <kpi-card>, ... ],      // dashboard tiles (optional)
  "charts":    [ <chart>, ... ],         // dashboard charts (optional)
  "styles": {
    "header":  { "bold": true, "fill": "4472C4", "font_color": "FFFFFF" },
    "banding": { "enabled": true, "color": "D9E1F2" }   // shades even data rows
  }
}
```
A **dashboard tab** may set `columns: []` and use only `kpi_cards` + `charts` that reference other tabs.

## Column
```json
{ "header": "Revenue", "key": "revenue", "width": 14, "number_format": "$#,##0" }
```
- `key` links a column to the field in each row object. `number_format` is an Excel format code
  (`"$#,##0"`, `"0.0%"`, `"#,##0"`, `"yyyy-mm-dd"`, …). `width` is in Excel column-width units.

## Row
A plain object keyed by column `key`s — literal values only (formulas go in `formulas`):
```json
{ "month": "Jan", "budget": 1000, "actual": 920 }
```

## Formula  (two forms)
Explicit single cell:
```json
{ "cell": "E2", "formula": "=C2-D2", "number_format": "$#,##0" }
```
Templated down a column over a row range (`{row}` is substituted per row):
```json
{ "col": "E", "range_rows": [2, 13], "formula": "=C{row}-D{row}", "number_format": "$#,##0" }
```

## Conditional format
Cell-is rule (default):
```json
{ "range": "E2:E13", "type": "cell_is", "operator": "lessThan", "formula": ["0"], "fill": "FFC7CE" }
```
Formula rule:
```json
{ "range": "F2:F50", "type": "formula", "formula": ["$F2>TODAY()"], "fill": "FFC7CE" }
```
Visual rules (great for dashboards):
```json
{ "range": "B2:B13", "type": "data_bar",    "color": "638EC6" }
{ "range": "D2:D13", "type": "color_scale", "min_color": "F8696B", "mid_color": "FFEB84", "max_color": "63BE7B" }
{ "range": "C2:C13", "type": "icon_set",    "icon_style": "3TrafficLights1", "values": [0, 33, 67], "reverse": false }
```

## KPI card  (dashboard tile — a label over a big number)
```json
{ "anchor": "B2", "span": [3, 3], "label": "Total Revenue", "value": "=SUM(Data!B2:B13)",
  "number_format": "$#,##0", "fill": "4472C4", "font_color": "FFFFFF" }
```
- `anchor` is the top-left cell; `span` is `[rows, cols]` (rows ≥ 2: a label row + value area). `value` may be a
  literal or a cross-tab formula. The card is merged and centered.

## Chart  (bar / line / pie)
```json
{ "type": "bar", "title": "Revenue vs Target", "anchor": "B7",
  "data": "Data!B1:C13", "categories": "Data!A2:A13", "height": 8, "width": 16 }
```
- `data` and `categories` are ranges, optionally prefixed with `Tab!` to pull from another sheet (the usual
  dashboard pattern). Include the header row in `data` so the series are named (`titles_from_data`).

## Theme  (top-level, optional)
Sets the palette used for KPI-card fills, section bars, and **chart colors**. Omit to use the built-in
"Budget by Paycheck" default (see `dashboard-layout.md`). Override only the keys you want:
```json
"theme": {
  "accent": "EAC6B8",
  "header_font": "FFFFFF",
  "border": "E8DAD3",
  "section_colors": ["F6E5A8", "F4C0DB", "F8B6C2", "99E4EB"],
  "body_tints":     ["ECF3F1", "FAF1F3", "FDFBF3", "E6F3F4"],
  "chart_palette":  ["7ED2B6", "F8B6C2", "80D2DA", "B9A4E7"]
}
```

## Dashboard / layout fields (tab-level, optional)
```json
{
  "column_widths": { "A": 3, "B": 3.1, "C": 17.6, "D": 3.1, "E": 7.4 },  // the spacer grid
  "row_height": 18,                 // uniform row height
  "hide_gridlines": true,           // canvas look (recommended on dashboard tabs)
  "fills":   [ { "range": "B3:G18", "color": "FDFBF3" } ],   // paint a panel background
  "borders": [ { "range": "B5:C6", "color": "E8DAD3", "style": "thin" } ],  // outline cells
  "section_bars": [ { "range": "B2:G2", "label": "M O N T H L Y  O V E R V I E W", "color": null } ]
}
```
- A **dashboard tab** typically sets `columns: []` and uses `kpi_cards` + `charts` + `section_bars` that
  reference the data tabs. `section_bars` with `color: null` auto-cycle the theme's `section_colors`.
- Charts are auto-colored from `theme.chart_palette`; pass `"colors": [...]` on a chart to override. Chart
  `type` may be `bar | line | pie | doughnut`. Omit a chart `title` and use a `section_bar` above it instead.

## Notes / guardrails for the spec author
- Colors are 6-digit hex **without** `#`.
- Keep formula cell refs consistent with the data layout (header is row 1, data starts row 2).
- The QA agents specifically check: ranges that don't match the data height, off-by-one in `range_rows`,
  wrong column letters, div-by-zero risk, and totals that don't reconcile. Draft defensively.
