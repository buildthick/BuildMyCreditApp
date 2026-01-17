/**
 * parse_local.cjs (CLEAN - CANONICAL PAYMENT HISTORY)
 *
 * Local parser for myFICO 1-Bureau (Equifax) "Condensed" PDF
 *
 * - Uses pdfjs-dist (coordinate-aware) to reconstruct stable logical lines
 * - Splits Accounts section into account blocks anchored on "Last Updated"
 * - Extracts core and detail fields
 * - Payment history: stores ONE canonical field:
 *     paymentHistory: [{ bureau, year, month, code }, ...]
 *
 * Run:
 *   node parse_local.cjs
 *   node parse_local.cjs "/full/path/to/your.pdf"
 */

const fs = require("fs");
const path = require("path");

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/* =========================
   String cleanup helpers
========================= */

function norm(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function cleanDashes(s) {
  // Collapse common dash artifacts: "– –", "— —", "- -", etc.
  return norm(String(s || "").replace(/[\u2012\u2013\u2014\u2015-]\s*[\u2012\u2013\u2014\u2015-]+/g, " "));
}

function cleanValue(s) {
  s = cleanDashes(s);
  if (!s) return null;

  // Normalize common “empty” patterns
  if (/^–+$/.test(s)) return null;
  if (/^-\s*-\s*$/.test(s)) return null;
  if (/^(none|n\/a)$/i.test(s)) return null;
  if (s === "–") return null;
  if (s === "-") return null;

  return s;
}

function isJunkLine(s) {
  s = cleanDashes(s);
  if (!s) return true;

  // timestamps like "1/15/26, 1:25 PM ..."
  if (/^\d{1,2}\/\d{1,2}\/\d{2},\s*\d{1,2}:\d{2}\s*(AM|PM)\b/i.test(s)) return true;

  if (s.includes("myFICO")) return true;
  if (/^https?:\/\//i.test(s)) return true;

  // Bureau trio line, in various spacing/punct forms
  if (/Equifax\W*TransUnion\W*Experian/i.test(s)) return true;

  // Bureau-only lines aren’t lenders
  if (s === "Equifax" || s === "TransUnion" || s === "Experian") return true;

  return false;
}

/* =========================
   Lender extraction
========================= */

function findLenderAbove(lines, idx) {
  for (let j = idx - 1; j >= 0; j--) {
    const s = cleanDashes(lines[j]);
    if (isJunkLine(s)) continue;
    if (s === "CLOSED") continue; // closed accounts sometimes show this line
    return s;
  }
  return null;
}

function guessLenderFromBlock(blockLines) {
  for (let i = 0; i < blockLines.length; i++) {
    const ln = cleanDashes(blockLines[i]);
    if (/^Last Updated\b/i.test(ln)) {
      for (let j = i - 1; j >= 0; j--) {
        const s = cleanDashes(blockLines[j]);
        if (isJunkLine(s)) continue;
        if (s === "CLOSED") continue;
        return s;
      }
    }
  }
  return null;
}

/* =========================
   PDF.js extraction (stable lines)
========================= */

async function extractPdfPagesFromUint8(uint8) {
  // Dynamic import so we can keep this file as .cjs
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { getDocument } = pdfjs;

  const loadingTask = getDocument({
    data: uint8,
    disableWorker: true,
  });

  const pdf = await loadingTask.promise;
  const pages = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();

    const items = (tc.items || [])
      .map((it) => {
        const t = it.transform || [];
        const x = t[4];
        const y = t[5];
        const str = norm(it.str);
        if (!str) return null;
        return { str, x, y };
      })
      .filter(Boolean);

    // Group into logical lines by y
    const byY = new Map();
    for (const it of items) {
      const yKey = Math.round(it.y * 2) / 2; // 0.5 precision
      if (!byY.has(yKey)) byY.set(yKey, []);
      byY.get(yKey).push(it);
    }

    const lines = Array.from(byY.entries())
      .sort((a, b) => b[0] - a[0]) // top -> bottom
      .map(([, row]) => {
        row.sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
        return cleanDashes(row.map((r) => r.str).join(" "));
      })
      .filter(Boolean);

    pages.push({ pageNumber: p, lines });
  }

  return pages;
}

/* =========================
   Block segmentation (Accounts section)
========================= */

function buildAccountBlocks(lines, linePages, accountsIdx, collectionsIdx) {
  const slice = lines.slice(accountsIdx, collectionsIdx);
  const slicePages = linePages.slice(accountsIdx, collectionsIdx);

  const blocks = [];
  let cur = null;

  for (let idx = 0; idx < slice.length; idx++) {
    const ln = cleanDashes(slice[idx]);

    if (/^Last Updated\b/i.test(ln)) {
      if (cur) blocks.push(cur);

      const lender = findLenderAbove(slice, idx);
      const startPageNumber = slicePages[idx] ?? null;

      cur = { startPageNumber, lender, lines: [] };

      // keep lender line for debugging clarity (optional)
      if (lender) cur.lines.push(lender);
    }

    if (cur) cur.lines.push(ln);
  }

  if (cur) blocks.push(cur);
  return blocks;
}

/* =========================
   Field extraction
========================= */

function extractLabelValue(lines, label) {
  const lbl = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Case A: "Label Value"
  const reSpaced = new RegExp("^" + lbl + "\\s+(.*)$", "i");

  // Case B: "LabelValue" (no space)
  const reConcat = new RegExp("^" + lbl + "(.*)$", "i");

  for (const raw of lines) {
    const s = cleanDashes(raw);

    let m = s.match(reSpaced);
    if (m) return cleanValue(m[1]);

    m = s.match(reConcat);
    if (m) return cleanValue(m[1]);
  }
  return null;
}

function extractFollowingLineAfterLabel(lines, label) {
  const labelNorm = cleanDashes(label).toLowerCase();
  for (let i = 0; i < lines.length - 1; i++) {
    if (cleanDashes(lines[i]).toLowerCase() === labelNorm) {
      return cleanValue(lines[i + 1]);
    }
  }
  return null;
}

/* =========================
   Payment history
   Canonical output: paymentHistory (flat monthly list)
========================= */

function parsePaymentHistoryRows(blockLines) {
  const out = [];

  const startIdx = blockLines.findIndex((l) => /^2-YEAR PAYMENT HISTORY\b/i.test(cleanDashes(l)));
  if (startIdx === -1) return out;

  const endIdx = (() => {
    for (let i = startIdx + 1; i < blockLines.length; i++) {
      if (/^MORE DETAILS\b/i.test(cleanDashes(blockLines[i]))) return i;
    }
    return blockLines.length;
  })();

  const slice = blockLines.slice(startIdx + 1, endIdx).map(cleanDashes).filter(Boolean);

  // pattern:
  // 2025 Jan Feb ... Dec
  // Equifax OK OK ... OK
  for (let i = 0; i < slice.length - 1; i++) {
    const yearRow = slice[i];
    const bureauRow = slice[i + 1];

    const y = yearRow.match(/^(\d{4})\s+Jan\s+Feb\s+Mar\s+Apr\s+May\s+Jun\s+Jul\s+Aug\s+Sep\s+Oct\s+Nov\s+Dec\b/i);
    if (!y) continue;
    const year = parseInt(y[1], 10);

    const b = bureauRow.match(/^(Equifax|TransUnion|Experian)\s+(.+)$/i);
    if (!b) continue;

    const bureau = b[1];
    const tokens = cleanDashes(b[2]).split(/\s+/).filter(Boolean);
    if (tokens.length < 12) continue;

    const months = {};
    for (let m = 0; m < 12; m++) months[MONTHS[m]] = tokens[m] ?? null;

    out.push({ bureau, year, months });
    i += 1; // consume bureau row
  }

  return out;
}

function flattenPaymentHistory(rows) {
  const flat = [];
  for (const r of rows) {
    for (const m of MONTHS) {
      flat.push({
        bureau: r.bureau,
        year: r.year,
        month: m,
        code: r.months?.[m] ?? null,
      });
    }
  }
  return flat;
}

/* =========================
   Main
========================= */

const DEFAULT_PDF_PATH = path.resolve(__dirname, "26-01-15 - Noah G Gomez - Equifax - MyFico - Condensed.pdf");
const pdfPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_PDF_PATH;

(async () => {
  if (!fs.existsSync(pdfPath)) {
    console.error("PDF not found:", pdfPath);
    process.exit(1);
  }

  const buffer = fs.readFileSync(pdfPath);
  const uint8 = new Uint8Array(buffer);

  const pages = await extractPdfPagesFromUint8(uint8);

  // Flatten lines + map each line to its page number
  const lines = [];
  const linePages = [];
  for (const p of pages) {
    for (const l of p.lines) {
      lines.push(l);
      linePages.push(p.pageNumber);
    }
  }

  const accountsIdx = lines.findIndex((l) => cleanDashes(l) === "ACCOUNTS");
  const collectionsIdx = lines.findIndex((l, i) => i > accountsIdx && cleanDashes(l) === "COLLECTIONS");

  console.log("accounts_idx:", accountsIdx, "page:", linePages[accountsIdx] ?? null);
  console.log("collections_idx:", collectionsIdx, "page:", linePages[collectionsIdx] ?? null);

  if (accountsIdx === -1 || collectionsIdx === -1 || collectionsIdx <= accountsIdx) {
    console.error("Could not locate ACCOUNTS/COLLECTIONS section boundaries.");
    process.exit(2);
  }

  const blocks = buildAccountBlocks(lines, linePages, accountsIdx, collectionsIdx);
  console.log("blocks:", blocks.length);

  const accounts = blocks.map((b, idx) => {
    const blockLines = b.lines.map(cleanDashes);
    const lender = b.lender || guessLenderFromBlock(blockLines);

    // Core
    const lastUpdated = extractLabelValue(blockLines, "Last Updated");

    // Payment Status is header-only in this PDF: "Payment Status" then next line value
    let paymentStatus = extractLabelValue(blockLines, "Payment Status");
    if (!paymentStatus) paymentStatus = extractFollowingLineAfterLabel(blockLines, "Payment Status");
    paymentStatus = cleanValue(paymentStatus);

    const worstDelinquency = extractLabelValue(blockLines, "Worst Delinquency");

    const balance = extractLabelValue(blockLines, "Balance");
    const creditLimit = extractLabelValue(blockLines, "Credit Limit");

    const openDate = extractLabelValue(blockLines, "Open Date");
    const closedDate = extractLabelValue(blockLines, "Closed Date");
    const lastActivity = extractLabelValue(blockLines, "Last Activity");

    // Details
    const loanType = extractLabelValue(blockLines, "Loan Type");
    const responsibility = extractLabelValue(blockLines, "Responsibility");
    const companyName = extractLabelValue(blockLines, "Company Name");
    const accountNumber = extractLabelValue(blockLines, "Account Number");
    const highBalance = extractLabelValue(blockLines, "High Balance");

    // These are often "–" in your report, but keep them anyway
    let scheduledPayment = extractLabelValue(blockLines, "Scheduled Payment");
    if (!scheduledPayment) scheduledPayment = extractFollowingLineAfterLabel(blockLines, "Scheduled Payment");
    scheduledPayment = cleanValue(scheduledPayment);

    let terms = extractLabelValue(blockLines, "Terms");
    if (!terms) terms = extractFollowingLineAfterLabel(blockLines, "Terms");
    terms = cleanValue(terms);

    // Payment history (canonical flat months list)
    const paymentHistoryRows = parsePaymentHistoryRows(blockLines); // internal only
    const paymentHistory = flattenPaymentHistory(paymentHistoryRows); // output

    // Warnings
    const warnings = [];
    if (!lender) warnings.push("missing_lender");
    if (!lastUpdated) warnings.push("missing_lastUpdated");
    if (!paymentStatus) warnings.push("missing_paymentStatus");
    if (!worstDelinquency) warnings.push("missing_worstDelinquency");
    if (!loanType) warnings.push("missing_loanType");
    if (!paymentHistory.length) warnings.push("missing_paymentHistory");

    return {
      index: idx + 1,
      startPageNumber: b.startPageNumber,

      lender,

      lastUpdated,
      paymentStatus,
      worstDelinquency,

      balance,
      creditLimit,

      openDate,
      closedDate,
      lastActivity,

      loanType,
      responsibility,
      companyName,
      accountNumber,
      highBalance,
      scheduledPayment,
      terms,

      // CANONICAL
      paymentHistory,

      warnings,

      // debug only; remove before CF write
      _blockLines: blockLines,
    };
  });

  // Debug blocks
  console.log("\n--- DEBUG TRUIST BLOCK (first 160 lines) ---");
  const tr = accounts.find((a) => (a.lender || "").toLowerCase().includes("truist"));
  if (tr) console.log(tr._blockLines.slice(0, 160).join("\n"));

  console.log("\n--- DEBUG NELNET BLOCK (first 200 lines) ---");
  const nn = accounts.find((a) => (a.lender || "").toLowerCase().includes("nelnet"));
  if (nn) console.log(nn._blockLines.slice(0, 200).join("\n"));

  // Human-readable summary
  for (const a of accounts) {
    console.log("=".repeat(90));
    console.log(`${a.index}. ${a.lender} (page ${a.startPageNumber})`);
    console.log("Last Updated:", a.lastUpdated);
    console.log("Payment Status:", a.paymentStatus);
    console.log("Worst Delinquency:", a.worstDelinquency);
    console.log("Loan Type:", a.loanType);
    console.log("Balance:", a.balance);
    console.log("Credit Limit:", a.creditLimit);
    console.log("Open Date:", a.openDate);
    console.log("Closed Date:", a.closedDate);
    console.log("Last Activity:", a.lastActivity);
    console.log("Company Name:", a.companyName);
    console.log("Account Number:", a.accountNumber);
    console.log("High Balance:", a.highBalance);
    console.log("Scheduled Payment:", a.scheduledPayment);
    console.log("Terms:", a.terms);
    console.log("paymentHistory months:", a.paymentHistory?.length ?? 0);
    if (a.warnings.length) console.log("WARN:", a.warnings.join(", "));
  }

  console.log("\nSanity check lenders + paymentHistory months:");
  accounts.forEach((a) => console.log(`${a.index} ${a.lender} months:${a.paymentHistory?.length ?? 0}`));

  // JSON payload (strip _blockLines for clean output)
  console.log("\n--- JSON PAYLOAD (ready for Firestore later; _blockLines removed) ---");
  const payload = accounts.map(({ _blockLines, ...rest }) => rest);
  console.log(JSON.stringify(payload, null, 2));
})().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(99);
});
