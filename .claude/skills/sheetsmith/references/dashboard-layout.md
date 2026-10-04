# Dashboard Layout & Color System (`sheetsmith`)

The house standard for dashboards — reverse-engineered from a working reference workbook ("Budget by
Paycheck"). When the user asks for a dashboard or charts inline with data cards, build to this. The default
`theme` in `build_xlsx.py` already encodes the palette; this doc explains the *layout discipline* that makes
it read as clean and intentional.

## The three things that make it work

### 1. A spacer-column grid (the "properly spaced" secret)
Don't use uniform columns. Alternate **narrow gutter columns (~3 wide)** with content columns so every panel
sits in whitespace. A content block is `label (~17–20) + value (~7.4)` columns, with a ~3-wide gutter on each
side and a wider gap between blocks. Set this with the tab-level `column_widths` map.

```
[gap 3][LABEL 17.6][gap 3.1][val 7.4][gap 3.1][val 7.4][GAP 3] | [gap][LABEL]...
  A         C          D       E        F        G       H          I  ...
```
- Uniform **`row_height: 18`** for vertical rhythm.
- Group related numbers into **panels**; give each a **section bar** title (see below).
- Keep KPI cards and their chart in the *same* panel columns so they line up.

### 2. A coherent palette (every element themed — including charts)
The default theme (override via top-level `theme`):
| Role | Hex | Use |
|------|-----|-----|
| accent | `EAC6B8` | KPI card fill, accents (terracotta) |
| section_colors | `F6E5A8` `F4C0DB` `F8B6C2` `99E4EB` `ABA5E3` | section-bar fills (one per panel) |
| body_tints | `ECF3F1` `FAF1F3` `FDFBF3` `E6F3F4` `EDE8F8` | panel background `fills` |
| header_font | `FFFFFF` | white text on colored bars/cards |
| border | `E8DAD3` | cell/card outlines |
| chart_palette | `7ED2B6` `F8B6C2` `80D2DA` `B9A4E7` `F6E5A8` `F4C0DB` `A3CEC5` `EAE9F4` | chart series & slices |

Rules:
- **Charts must be colored from `chart_palette`, never Excel defaults.** The build script does this
  automatically (bar/line series and pie/doughnut slices). Don't leave a chart on defaults — that's the #1
  tell of an un-themed dashboard.
- **White text on colored fills**; dark/theme text on light tints. Check contrast.
- One **hero number** can be larger (e.g. a KPI `value_size` of 28–30).

### 3. Charts inline with data cards, titled by a bar (not the chart's own title)
- Put charts on a `Dashboard` tab (`columns: []`) anchored *within* the grid, next to the KPI cards.
- Prefer a **section bar above the chart** as its title and omit the chart's built-in `title` — it reads
  cleaner and stays aligned to the grid.
- Charts can pull data from other tabs via `Tab!A1:B10` refs (the normal pattern: Dashboard reads Data).

## Number formats (from the reference)
- Money: `#,##0.00` (the reference parks the `$` in its own narrow cell; `$#,##0` is also fine).
- Percent: `0.00%`.  Dates: `d" "mmm" "yyyy` (e.g. `1 Jan 2026`).

## "Correct formatting" checklist (what QA checkpoint 4 verifies)
- [ ] Spacer-grid widths applied; nothing cramped; columns wide enough for their content.
- [ ] Every chart's series/slices colored from the theme (no Excel-default blue/orange).
- [ ] KPI cards aligned to the grid; cards/charts do not overlap (check anchors + spans + heights).
- [ ] Section bars merged, filled, white text, one color per panel.
- [ ] Consistent number formats across like columns; `%` where it's a ratio.
- [ ] Text readable on its fill (white on dark/colored, dark on light tints).
- [ ] `hide_gridlines: true` on dashboard tabs (optional but recommended for the canvas look).
- [ ] Freeze panes on data tabs (`A2`).

## Minimal dashboard spec shape
```json
{
  "theme": { /* omit to use the default palette */ },
  "tabs": [
    { "name": "Data", "freeze": "A2", "columns": [...], "rows": [...],
      "conditional_formats": [ {"range":"B2:B20","type":"data_bar"} ] },
    { "name": "Dashboard", "columns": [], "hide_gridlines": true, "row_height": 18,
      "column_widths": {"A":3,"B":3.1,"C":17.6,"D":3.1,"E":7.4,"F":3.1,"G":7.4,"H":3},
      "section_bars": [ {"range":"B2:G2","label":"M O N T H L Y   O V E R V I E W"} ],
      "fills": [ {"range":"B3:G18","color":"FDFBF3"} ],
      "kpi_cards": [
        {"anchor":"B4","span":[2,2],"label":"Total Budget","value":"=SUM(Data!B2:B20)","number_format":"#,##0.00","border":true}
      ],
      "charts": [
        {"type":"bar","anchor":"B8","data":"Data!B1:C20","categories":"Data!A2:A20","width":14,"height":7}
      ] }
  ]
}
```
