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
 * Requires token.json (run authorize.js once). See SHEETS_SETUP.md.
 *
 * Known Sheets-API constraints (vs the .xlsx builder):
 *   - data_bar and icon_set conditional formats are NOT supported by the Sheets API → skipped with a warning.
 *   - pie/doughnut per-slice colors aren't settable via the API → Sheets auto-colors those (bar/line/column ARE themed).
 */
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const HERE = __dirname;
const TOKEN = path.join(HERE, "token.json");

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
const numFmtType = (p) => (/%/.test(p) ? "PERCENT" : /[ymd]/i.test(p) ? "DATE" : "NUMBER");

function loadAuth() {
  if (!fs.existsSync(TOKEN)) {
    console.error("No token.json — run `node authorize.js` first (see SHEETS_SETUP.md).");
    process.exit(1);
  }
  return google.auth.fromJSON(JSON.parse(fs.readFileSync(TOKEN, "utf8")));
}

// ---------- request builders ----------
function chartRequest(cfg, sheetId, idByTitle, defaultTitle, palette) {
  const kind = cfg.type || "bar";
  const dataGr = gridRange(cfg.data, idByTitle, defaultTitle);
  const catGr = cfg.categories ? gridRange(cfg.categories, idByTitle, defaultTitle) : null;
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
    const series = columnsOf(dataGr).map((s, i) => ({
      series: { sourceRange: { sources: [s] } },
      colorStyle: { rgbColor: hexToColor(colors[i % colors.length]) },
    }));
    spec = {
      basicChart: {
        chartType: kind === "line" ? "LINE" : kind === "barh" ? "BAR" : "COLUMN",
        legendPosition: "BOTTOM_LEGEND",
        headerCount: 1,
        domains: catGr ? [{ domain: { sourceRange: { sources: [catGr] } } }] : [],
        series,
      },
    };
  }
  if (cfg.title) spec.title = cfg.title;
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
    const f = Array.isArray(cf.formula) ? cf.formula[0] : cf.formula;
    condition = { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: f }] };
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
      properties: { title },
      sheets: spec.tabs.map((t) => ({
        properties: {
          title: t.name.slice(0, 99),
          gridProperties: { rowCount: 200, columnCount: 30, hideGridlines: !!t.hide_gridlines },
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
  if (valueData.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: ssId,
      requestBody: { valueInputOption: "USER_ENTERED", data: valueData },
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
      reqs.push({ updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 60 }, properties: { pixelSize: rowHeightPx(tab.row_height) }, fields: "pixelSize" } });

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
      reqs.push({ updateBorders: { range: { ...parseRange(b.range), sheetId }, top: side, bottom: side, left: side, right: side, innerHorizontal: side, innerVertical: side } });
    }

    // conditional formats
    for (const cf of tab.conditional_formats || []) {
      const r = conditionalRequest(cf, sheetId);
      if (r) reqs.push(r);
    }

    // charts
    for (const ch of tab.charts || []) reqs.push(chartRequest(ch, sheetId, idByTitle, tab.name.slice(0, 99), theme.chart_palette));
  }

  if (reqs.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId: ssId, requestBody: { requests: reqs } });

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
