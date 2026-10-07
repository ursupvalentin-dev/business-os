#!/usr/bin/env node
/**
 * build_sheet.js — build a NATIVE Google Sheets dashboard from a sheetsmith-style workbook spec.
 *
 *   node build_sheet.js <spec.json>
 *
 * Consumes the same spec format as the `sheetsmith` skill (tabs / columns / rows / formulas /
 * conditional_formats / kpi_cards / charts / section_bars / fills / borders / column_widths / theme),
 * and translates it into Google Sheets API batchUpdate requests so charts, merges, banding, number
 * formats, and conditional formats render natively (no .xlsx import drift).
 *
 * Requires Google credentials: token.json (run authorize.js once) or the GOOGLE_CLIENT_ID /
 * GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN environment variables. See SHEETS_SETUP.md.
 *
 * Known Sheets-API constraints (vs the .xlsx builder):
 *   - data_bar and icon_set conditional formats are NOT supported by the Sheets API → skipped with a warning.
 *   - pie/doughnut per-slice colors aren't settable via the API → Sheets auto-colors those (bar/line/column ARE themed).
 */
const fs = require("fs");
const { google } = require("googleapis");
const { loadAuth } = require("./google_auth");

const DEFAULT_THEME = {
  accent: "EAC6B8",
  header_font: "FFFFFF",
  border: "E8DAD3",
  section_colors: ["F6E5A8", "F4C0DB", "F8B6C2", "99E4EB", "ABA5E3"],
  body_tints: ["ECF3F1", "FAF1F3", "FDFBF3", "E6F3F4", "EDE8F8"],
  chart_palette: ["7ED2B6", "F8B6C2", "80D2DA", "B9A4E7", "F6E5A8", "F4C0DB", "A3CEC5", "EAE9F4"],
};

// ---------- helpers ----------
function hexToColor(hex) {
  let h = String(hex).replace("#", "");
  if (h.length === 8) h = h.slice(2); // strip alpha (FFxxxxxx)
  const n = parseInt(h, 16);
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
}
const colWidthPx = (w) => Math.round(w * 7) + 5; // Excel char-width units → pixels (approx)
const rowHeightPx = (pts) => Math.round(pts * 1.33); // points → pixels (approx)

function colToIdx(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function parseRange(a1) {
  const m = a1.match(/^([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?$/);
  if (!m) throw new Error(`bad A1 range: ${a1}`);
  const sc = colToIdx(m[1]), sr = parseInt(m[2], 10) - 1;
  if (m[3]) {
    return {
      startRowIndex: sr, endRowIndex: parseInt(m[4], 10),
      startColumnIndex: sc, endColumnIndex: colToIdx(m[3]) + 1,
    };
  }
  return { startRowIndex: sr, endRowIndex: sr + 1, startColumnIndex: sc, endColumnIndex: sc + 1 };
}
function splitRef(ref) {
  if (ref.includes("!")) {
    const i = ref.lastIndexOf("!");
    return { title: ref.slice(0, i).replace(/^'|'$/g, "").replace(/''/g, "'"), rng: ref.slice(i + 1) };
  }
  return { title: null, rng: ref };
}
function gridRange(ref, idByTitle, defaultTitle) {
  const { title, rng } = splitRef(ref);
  const gr = parseRange(rng);
  gr.sheetId = idByTitle[title || defaultTitle];
  return gr;
}
function columnsOf(gr) {
  const out = [];
  for (let c = gr.startColumnIndex; c < gr.endColumnIndex; c++)
    out.push({ sheetId: gr.sheetId, startRowIndex: gr.startRowIndex, endRowIndex: gr.endRowIndex, startColumnIndex: c, endColumnIndex: c + 1 });
  return out;
}
const q = (title) => `'${String(title).replace(/'/g, "''")}'`;
// ignore quoted literals: '0" months"' is a number format, not a date
const numFmtType = (p) => {
  const bare = String(p).replace(/"[^"]*"/g, "");
  return /%/.test(bare) ? "PERCENT" : /[ymd]/i.test(bare) ? "DATE" : "NUMBER";
};

// ---------- request builders ----------
function chartRequest(cfg, sheetId, idByTitle, defaultTitle, palette) {
  const kind = cfg.type || "bar";
  const dataGr = gridRange(cfg.data, idByTitle, defaultTitle);
  const catGr = cfg.categories ? gridRange(cfg.categories, idByTitle, defaultTitle) : null;
  // basicChart's headerCount applies to the domain too: when the categories start one row below the
  // series' header row (the usual spec shape), start them on that header row so labels line up with bars
  if (catGr && kind !== "pie" && kind !== "doughnut" && catGr.sheetId === dataGr.sheetId &&
      catGr.startRowIndex === dataGr.startRowIndex + 1) {
    catGr.startRowIndex = dataGr.startRowIndex;
  }
  const a = parseRange(cfg.anchor || "A1");
  const position = {
    overlayPosition: {
      anchorCell: { sheetId, rowIndex: a.startRowIndex, columnIndex: a.startColumnIndex },
      widthPixels: (cfg.width || 12) * 40,
      heightPixels: (cfg.height || 7) * 40,
    },
  };
  let spec;
  if (kind === "pie" || kind === "doughnut") {
    spec = {
      pieChart: {
        legendPosition: "RIGHT_LEGEND",
        pieHole: kind === "doughnut" ? 0.5 : 0,
        domain: { sourceRange: { sources: [catGr || dataGr] } },
        series: { sourceRange: { sources: [dataGr] } },
      },
    };
  } else {
    const colors = cfg.colors || palette;
    const series = columnsOf(dataGr).map((s, i) => {
      const out = { series: { sourceRange: { sources: [s] } }, colorStyle: { rgbColor: hexToColor(colors[i % colors.length]) } };
      // point_colors: one color per bar (a single-series chart that reads like a themed pie)
      if (cfg.point_colors) {
        const n = dataGr.endRowIndex - dataGr.startRowIndex - 1;
        out.styleOverrides = Array.from({ length: n }, (_, k) => ({ index: k, colorStyle: { rgbColor: hexToColor(colors[k % colors.length]) } }));
      }
      return out;
    });
    spec = {
      basicChart: {
        chartType: kind === "line" ? "LINE" : kind === "barh" ? "BAR" : "COLUMN",
        legendPosition: cfg.legend === false ? "NO_LEGEND" : "BOTTOM_LEGEND",
        headerCount: 1,
        domains: catGr ? [{ domain: { sourceRange: { sources: [catGr] } } }] : [],
        series,
      },
    };
  }
  if (cfg.title) spec.title = cfg.title;
  // plot_hidden: chart a hidden helper column (charts skip hidden data by default)
  if (cfg.plot_hidden) spec.hiddenDimensionStrategy = "SHOW_ALL";
  return { addChart: { chart: { spec, position } } };
}

function conditionalRequest(cf, sheetId) {
  const gr = { ...parseRange(cf.range), sheetId };
  const t = cf.type || "cell_is";
  if (t === "data_bar" || t === "icon_set") {
    console.warn(`  (skip) conditional format '${t}' isn't supported by the Sheets API`);
    return null;
  }
  if (t === "color_scale") {
    return {
      addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [gr],
          gradientRule: {
            minpoint: { colorStyle: { rgbColor: hexToColor(cf.min_color || "F8696B") }, type: "MIN" },
            midpoint: { colorStyle: { rgbColor: hexToColor(cf.mid_color || "FFEB84") }, type: "PERCENTILE", value: "50" },
            maxpoint: { colorStyle: { rgbColor: hexToColor(cf.max_color || "63BE7B") }, type: "MAX" },
          },
        },
      },
    };
  }
  let condition;
  if (t === "formula") {
    const f = String(Array.isArray(cf.formula) ? cf.formula[0] : cf.formula);
    // spec formulas follow the openpyxl convention (no leading "="); the Sheets API needs one
    condition = { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: f.startsWith("=") ? f : "=" + f }] };
  } else {
    const opMap = {
      lessThan: "NUMBER_LESS", greaterThan: "NUMBER_GREATER",
      lessThanOrEqual: "NUMBER_LESS_THAN_EQ", greaterThanOrEqual: "NUMBER_GREATER_THAN_EQ",
      equal: "NUMBER_EQ", notEqual: "NUMBER_NOT_EQ",
    };
    const type = opMap[cf.operator || "lessThan"] || "NUMBER_LESS";
    const v = Array.isArray(cf.formula) ? cf.formula[0] : cf.formula ?? "0";
    condition = { type, values: [{ userEnteredValue: String(v) }] };
  }
  return {
    addConditionalFormatRule: {
      index: 0,
      rule: { ranges: [gr], booleanRule: { condition, format: { backgroundColor: hexToColor(cf.fill || "FFC7CE") } } },
    },
  };
}

// ---------- main ----------
async function main() {
  const specPath = process.argv[2];
  if (!specPath) { console.error("usage: node build_sheet.js <spec.json>"); process.exit(2); }
  const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
  const theme = { ...DEFAULT_THEME, ...(spec.theme || {}) };
  const sheets = google.sheets({ version: "v4", auth: loadAuth() });

  const title = (spec.filename || "Dashboard").replace(/\.xlsx$/i, "");
  const created = await sheets.spreadsheets.create({
    requestBody: {
      // Spec formulas use en_US syntax (comma separators). Without an explicit locale the sheet takes the
      // account's, and in comma-decimal locales every formula with a comma becomes #ERROR!.
      properties: { title, locale: spec.locale || "en_US" },
      sheets: spec.tabs.map((t) => ({
        properties: {
          title: t.name.slice(0, 99),
          gridProperties: { rowCount: t.grid_rows || 200, columnCount: t.grid_cols || 30, hideGridlines: !!t.hide_gridlines },
          ...(t.tab_color ? { tabColorStyle: { rgbColor: hexToColor(t.tab_color) } } : {}),
        },
      })),
    },
  });
  const ssId = created.data.spreadsheetId;
  const idByTitle = {};
  for (const s of created.data.sheets) idByTitle[s.properties.title] = s.properties.sheetId;

  // ---- values pass (USER_ENTERED so formulas evaluate) ----
  const valueData = [];
  for (const tab of spec.tabs) {
    const T = q(tab.name);
    const cols = tab.columns || [];
    if (cols.length) valueData.push({ range: `${T}!A1`, values: [cols.map((c) => c.header || "")] });
    const rows = tab.rows || [];
    if (rows.length) {
      valueData.push({ range: `${T}!A2`, values: rows.map((r) => cols.map((c) => (c.key in r ? r[c.key] : ""))) });
    }
    for (const f of tab.formulas || []) {
      if (f.cell) valueData.push({ range: `${T}!${f.cell}`, values: [[f.formula]] });
      else {
        const [s, e] = f.range_rows;
        const col = [];
        for (let row = s; row <= e; row++) col.push([f.formula.replace(/\{row\}/g, String(row))]);
        valueData.push({ range: `${T}!${f.col.toUpperCase()}${s}`, values: col });
      }
    }
    for (const bar of tab.section_bars || []) {
      const { startRowIndex, startColumnIndex } = parseRange(splitRef(bar.range).rng);
      valueData.push({ range: `${T}!${bar.range.split("!").pop().split(":")[0]}`, values: [[bar.label || ""]] });
      void startRowIndex; void startColumnIndex;
    }
    for (const card of tab.kpi_cards || []) {
      const a = parseRange(card.anchor);
      const colL = card.anchor.match(/[A-Za-z]+/)[0];
      valueData.push({ range: `${T}!${colL}${a.startRowIndex + 1}`, values: [[card.label || ""]] });
      valueData.push({ range: `${T}!${colL}${a.startRowIndex + 2}`, values: [[card.value ?? ""]] });
    }
  }
  // sent in chunks so a large workbook stays under the API's request-size limit
  for (let i = 0; i < valueData.length; i += 2000) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: ssId,
      requestBody: { valueInputOption: "USER_ENTERED", data: valueData.slice(i, i + 2000) },
    });
  }

  // ---- formatting / structure pass ----
  const reqs = [];
  for (const tab of spec.tabs) {
    const sheetId = idByTitle[tab.name.slice(0, 99)];
    const cols = tab.columns || [];
    const nRows = (tab.rows || []).length;
    const styles = tab.styles || {};

    // column widths: per-column `width` (data tabs) + tab-level column_widths map
    cols.forEach((c, i) => {
      if (c.width)
        reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: colWidthPx(c.width) }, fields: "pixelSize" } });
    });
    for (const [letter, w] of Object.entries(tab.column_widths || {})) {
      const idx = colToIdx(letter);
      reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: idx, endIndex: idx + 1 }, properties: { pixelSize: colWidthPx(w) }, fields: "pixelSize" } });
    }
    if (tab.row_height)
      reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: tab.grid_rows || 200 }, properties: { pixelSize: rowHeightPx(tab.row_height) }, fields: "pixelSize" } });
    for (const letter of tab.hidden_columns || []) {
      const idx = colToIdx(letter);
      reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: idx, endIndex: idx + 1 }, properties: { hiddenByUser: true }, fields: "hiddenByUser" } });
    }

    // freeze (e.g. "A2" → 1 frozen row)
    if (tab.freeze) {
      const f = parseRange(tab.freeze);
      reqs.push({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: f.startRowIndex, frozenColumnCount: f.startColumnIndex } }, fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount" } });
    }

    // header row styling
    const hs = styles.header || {};
    if (cols.length) {
      reqs.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: cols.length },
          cell: { userEnteredFormat: { backgroundColor: hexToColor(hs.fill || theme.accent), horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", textFormat: { bold: hs.bold !== false, foregroundColorStyle: { rgbColor: hexToColor(hs.font_color || theme.header_font) } } } },
          fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)",
        },
      });
    }

    // number formats per column
    cols.forEach((c, i) => {
      if (c.number_format)
        reqs.push({ repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: nRows + 1 || 2, startColumnIndex: i, endColumnIndex: i + 1 }, cell: { userEnteredFormat: { numberFormat: { type: numFmtType(c.number_format), pattern: c.number_format } } }, fields: "userEnteredFormat.numberFormat" } });
    });

    // number formats set on individual formulas (override the column's, as in the .xlsx builder)
    for (const f of tab.formulas || []) {
      if (!f.number_format) continue;
      const rng = f.cell ? parseRange(f.cell) : parseRange(`${f.col}${f.range_rows[0]}:${f.col}${f.range_rows[1]}`);
      reqs.push({ repeatCell: { range: { ...rng, sheetId }, cell: { userEnteredFormat: { numberFormat: { type: numFmtType(f.number_format), pattern: f.number_format } } }, fields: "userEnteredFormat.numberFormat" } });
    }

    // number formats on any range (e.g. empty input cells that should show $ once typed in)
    for (const nf of tab.number_formats || []) {
      reqs.push({ repeatCell: { range: { ...parseRange(nf.range), sheetId }, cell: { userEnteredFormat: { numberFormat: { type: numFmtType(nf.format), pattern: nf.format } } }, fields: "userEnteredFormat.numberFormat" } });
    }

    // banding
    const band = styles.banding || {};
    if (band.enabled && nRows > 0) {
      reqs.push({ addBanding: { bandedRange: { range: { sheetId, startRowIndex: 1, endRowIndex: nRows + 1, startColumnIndex: 0, endColumnIndex: cols.length }, rowProperties: { firstBandColorStyle: { rgbColor: hexToColor("FFFFFF") }, secondBandColorStyle: { rgbColor: hexToColor(band.color || "F2F2F2") } } } } });
    }

    // panel fills
    for (const fcfg of tab.fills || []) {
      reqs.push({ repeatCell: { range: { ...parseRange(fcfg.range), sheetId }, cell: { userEnteredFormat: { backgroundColor: hexToColor(fcfg.color) } }, fields: "userEnteredFormat.backgroundColor" } });
    }

    // section bars (fill + center bold white + merge)
    (tab.section_bars || []).forEach((bar, i) => {
      const gr = { ...parseRange(splitRef(bar.range).rng), sheetId };
      const color = bar.color || theme.section_colors[i % theme.section_colors.length];
      reqs.push({ repeatCell: { range: gr, cell: { userEnteredFormat: { backgroundColor: hexToColor(color), horizontalAlignment: bar.align ? bar.align.toUpperCase() : "CENTER", verticalAlignment: "MIDDLE", textFormat: { bold: true, fontSize: bar.size || 11, foregroundColorStyle: { rgbColor: hexToColor(bar.font_color || theme.header_font) } } } }, fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)" } });
      reqs.push({ mergeCells: { range: gr, mergeType: "MERGE_ALL" } });
    });

    // KPI cards (fill + label/value formats + merges)
    for (const card of tab.kpi_cards || []) {
      const a = parseRange(card.anchor);
      const [sr, sc] = [a.startRowIndex, a.startColumnIndex];
      const [rowsN, colsN] = card.span || [2, 2];
      const span = Math.max(rowsN, 2);
      const fill = hexToColor(card.fill || theme.accent);
      const fg = { rgbColor: hexToColor(card.font_color || theme.header_font) };
      reqs.push({ repeatCell: { range: { sheetId, startRowIndex: sr, endRowIndex: sr + span, startColumnIndex: sc, endColumnIndex: sc + colsN }, cell: { userEnteredFormat: { backgroundColor: fill } }, fields: "userEnteredFormat.backgroundColor" } });
      reqs.push({ repeatCell: { range: { sheetId, startRowIndex: sr, endRowIndex: sr + 1, startColumnIndex: sc, endColumnIndex: sc + colsN }, cell: { userEnteredFormat: { horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", textFormat: { bold: true, fontSize: card.label_size || 10, foregroundColorStyle: fg } } }, fields: "userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat)" } });
      const valFmt = { horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", textFormat: { bold: true, fontSize: card.value_size || 20, foregroundColorStyle: fg } };
      if (card.number_format) valFmt.numberFormat = { type: numFmtType(card.number_format), pattern: card.number_format };
      reqs.push({ repeatCell: { range: { sheetId, startRowIndex: sr + 1, endRowIndex: sr + span, startColumnIndex: sc, endColumnIndex: sc + colsN }, cell: { userEnteredFormat: valFmt }, fields: "userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat,numberFormat)" } });
      reqs.push({ mergeCells: { range: { sheetId, startRowIndex: sr, endRowIndex: sr + 1, startColumnIndex: sc, endColumnIndex: sc + colsN }, mergeType: "MERGE_ALL" } });
      reqs.push({ mergeCells: { range: { sheetId, startRowIndex: sr + 1, endRowIndex: sr + span, startColumnIndex: sc, endColumnIndex: sc + colsN }, mergeType: "MERGE_ALL" } });
    }

    // borders
    for (const b of tab.borders || []) {
      const side = { style: (b.style || "thin") === "thin" ? "SOLID" : "SOLID_MEDIUM", colorStyle: { rgbColor: hexToColor(b.color || theme.border) } };
      const inner = b.inner_vertical === false ? { innerHorizontal: side } : { innerHorizontal: side, innerVertical: side };
      reqs.push({ updateBorders: { range: { ...parseRange(b.range), sheetId }, top: side, bottom: side, left: side, right: side, ...inner } });
    }

    // text styles on any range (labels and table headers outside a columns table)
    for (const t of tab.text_styles || []) {
      const fmt = { verticalAlignment: "MIDDLE", textFormat: { bold: !!t.bold, italic: !!t.italic, fontSize: t.size || 10, foregroundColorStyle: { rgbColor: hexToColor(t.color || "000000") } } };
      let fields = "userEnteredFormat(textFormat,verticalAlignment";
      if (t.align) { fmt.horizontalAlignment = t.align.toUpperCase(); fields += ",horizontalAlignment"; }
      if (t.wrap) { fmt.wrapStrategy = "WRAP"; fields += ",wrapStrategy"; }
      reqs.push({ repeatCell: { range: { ...parseRange(t.range), sheetId }, cell: { userEnteredFormat: fmt }, fields: fields + ")" } });
    }

    // data validation: tick boxes, dropdown lists, and dropdowns fed by a range ("list_range")
    for (const v of tab.validations || []) {
      const condition = v.type === "checkbox"
        ? { type: "BOOLEAN" }
        : v.type === "list_range"
          ? { type: "ONE_OF_RANGE", values: [{ userEnteredValue: "=" + v.source }] }
          : { type: "ONE_OF_LIST", values: v.values.map((x) => ({ userEnteredValue: String(x) })) };
      reqs.push({ setDataValidation: { range: { ...parseRange(v.range), sheetId }, rule: { condition, strict: v.strict !== false, showCustomUi: true } } });
    }

    // conditional formats
    for (const cf of tab.conditional_formats || []) {
      const r = conditionalRequest(cf, sheetId);
      if (r) reqs.push(r);
    }

    // charts
    for (const ch of tab.charts || []) reqs.push(chartRequest(ch, sheetId, idByTitle, tab.name.slice(0, 99), theme.chart_palette));
  }

  for (let i = 0; i < reqs.length; i += 1500) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: ssId, requestBody: { requests: reqs.slice(i, i + 1500) } });
  }

  const url = `https://docs.google.com/spreadsheets/d/${ssId}/edit`;
  console.log("Built ✓  " + title);
  console.log(url);
  console.error(`  ${spec.tabs.length} tab(s), ${reqs.length} formatting request(s)`);
}

main().catch((e) => {
  const msg = (e.errors && e.errors[0] && e.errors[0].message) || e.message || String(e);
  console.error("Sheets build failed: " + msg);
  process.exit(1);
});
