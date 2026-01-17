/**
 * parse_local.cjs (NORMALIZED NUMBERS + FIRESTORE-STYLE TIMESTAMPS)
 *
 * - pdfjs-dist coordinate extraction -> stable logical lines
 * - Splits Accounts section into blocks anchored on "Last Updated"
 * - Extracts fields and normalizes:
 *    - Numbers: digits only (Number) for money fields
 *    - Dates: Firestore-style timestamp objects {seconds, nanoseconds}
 *      at midnight America/New_York for that date
 * - Payment history: ONE canonical field:
 *    paymentHistory: [{ bureau, year, month, code }, ...]
 */

const fs = require("fs");
const path = require("path");

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const TZ = "America/New_York";

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
  if (s === "–" || s === "-") return null;

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
   Normalization: numbers
========================= */

function parseMoneyToNumber(v) {
  v = cleanValue(v);
  if (!v) return null;

  // Handle parentheses negatives: ($1,234.56)
  let neg = false;
  if (/^\(.*\)$/.test(v)) {
    neg = true;
    v = v.slice(1, -1);
  }

  // Remove currency symbols/commas/spaces
  v = v.replace(/[$,\s]/g, "");

  // Some fields might be empty dashes already handled; if still not numeric, return null
  if (!/^-?\d+(\.\d+)?$/.test(v)) return null;

  const num = Number(v);
  if (!Number.isFinite(num)) return null;
  return neg ? -num : num;
}

/* =========================
   Normalization: Firestore-style timestamps
   - Convert MM/YYYY -> day=1
   - Convert MM/DD/YYYY -> given day
   - Store as {seconds, nanoseconds} at 00:00 local in America/New_York
========================= */

function tzOffsetMillisAt(utcMillis, timeZone) {
  const d = new Date(utcMillis);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(
    fmt.formatToParts(d)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value])
  );

  const ly = Number(parts.year);
  const lm = Number(parts.month);
  const ld = Number(parts.day);
  const lh = Number(parts.hour);
  const lmin = Number(parts.minute);
  const ls = Number(parts.second);

  // Interpret the local wall-clock parts as if they were UTC to get a comparable epoch
  const localAsUtc = Date.UTC(ly, lm - 1, ld, lh, lmin, ls);
  return localAsUtc - utcMillis; // offset such that: local = utc + offset
}

function zonedMidnightUtcMillis(y, m, d, timeZone) {
  const base = Date.UTC(y, m - 1, d, 0, 0, 0);

  // iterate twice for DST correctness
  let utc = base - tzOffsetMillisAt(base, timeZone);
  utc = base - tzOffsetMillisAt(utc, timeZone);
  return utc;
}

function parseDateToFsTimestamp(v) {
  v = cleanValue(v);
  if (!v) return null;

  // MM/YYYY
  let m = v.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mm = Number(m[1]);
    const yy = Number(m[2]);
    if (mm < 1 || mm > 12) return null;
    const utcMillis = zonedMidnightUtcMillis(yy, mm, 1, TZ);
    return { seconds: Math.floor(utcMillis / 1000), nanoseconds: 0 };
  }

  // MM/DD/YYYY
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mm = Number(m[1]);
    const dd = Number(m[2]);
    const yy = Number(m[3]);
    if (mm < 1 || mm > 12) return null;
    if (dd < 1 || dd > 31) return null;

    const utcMillis = zonedMidnightUtcMillis(yy, mm, dd, TZ);
    return { seconds: Math.floor(utcMillis / 1000), nanoseconds: 0 };
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
    for (let mm = 0; mm < 12; mm++) months[MONTHS[mm]] = tokens[mm] ?? null;

    out.push({ bureau, year, months });
    i += 1;
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
  // Section boundaries (EMPTY-SAFE)
  const accountsIdx = lines.findIndex((l) => cleanDashes(l) === "ACCOUNTS");

  // Prefer COLLECTIONS as the natural end of ACCOUNTS, but fall back to any later known section header.
  let collectionsIdx = -1;
  if (accountsIdx !== -1) {
    const endHeaders = new Set([
      "COLLECTIONS",
      "PUBLIC RECORDS",
      "INQUIRIES",
      "PERSONAL INFO",
      "NEXT STEPS",
    ]);

    for (let i = accountsIdx + 1; i < lines.length; i++) {
      const t = cleanDashes(lines[i]);
      if (endHeaders.has(t)) {
        collectionsIdx = i;
        break;
      }
    }

    // If we didn't find any known header after ACCOUNTS, fall back to end-of-doc.
    if (collectionsIdx === -1) collectionsIdx = lines.length;
  }

  console.log("accounts_idx:", accountsIdx, "page:", linePages[accountsIdx] ?? null);
  console.log("collections_idx:", collectionsIdx, "page:", linePages[collectionsIdx] ?? null);

  let blocks = [];
  if (accountsIdx === -1) {
    console.warn("WARN: ACCOUNTS header not found. Returning 0 accounts (empty-safe).");
  } else if (collectionsIdx <= accountsIdx + 1) {
    console.warn("WARN: Could not locate a valid end boundary after ACCOUNTS. Returning 0 accounts (empty-safe).");
  } else {
    blocks = buildAccountBlocks(lines, linePages, accountsIdx, collectionsIdx);
  }

  console.log("blocks:", blocks.length);

  const accounts = blocks.map((b, idx) => {
    const blockLines = b.lines.map(cleanDashes);
    const lender = b.lender || guessLenderFromBlock(blockLines);

    // Raw extracted strings
    const lastUpdatedRaw = extractLabelValue(blockLines, "Last Updated");

    let paymentStatusRaw = extractLabelValue(blockLines, "Payment Status");
    if (!paymentStatusRaw) paymentStatusRaw = extractFollowingLineAfterLabel(blockLines, "Payment Status");

    const worstDelinquencyRaw = extractLabelValue(blockLines, "Worst Delinquency");

    const balanceRaw = extractLabelValue(blockLines, "Balance");
    const creditLimitRaw = extractLabelValue(blockLines, "Credit Limit");

    const openDateRaw = extractLabelValue(blockLines, "Open Date");
    const closedDateRaw = extractLabelValue(blockLines, "Closed Date");
    const lastActivityRaw = extractLabelValue(blockLines, "Last Activity");

    const loanType = extractLabelValue(blockLines, "Loan Type");
    const responsibility = extractLabelValue(blockLines, "Responsibility");
    const companyName = extractLabelValue(blockLines, "Company Name");
    const accountNumber = extractLabelValue(blockLines, "Account Number");

    const highBalanceRaw = extractLabelValue(blockLines, "High Balance");

    let scheduledPaymentRaw = extractLabelValue(blockLines, "Scheduled Payment");
    if (!scheduledPaymentRaw) scheduledPaymentRaw = extractFollowingLineAfterLabel(blockLines, "Scheduled Payment");

    let terms = extractLabelValue(blockLines, "Terms");
    if (!terms) terms = extractFollowingLineAfterLabel(blockLines, "Terms");

    // NORMALIZED
    const lastUpdated = parseDateToFsTimestamp(lastUpdatedRaw);
    const openDate = parseDateToFsTimestamp(openDateRaw);
    const closedDate = parseDateToFsTimestamp(closedDateRaw);
    const lastActivity = parseDateToFsTimestamp(lastActivityRaw);

    const balance = parseMoneyToNumber(balanceRaw);
    const creditLimit = parseMoneyToNumber(creditLimitRaw);
    const highBalance = parseMoneyToNumber(highBalanceRaw);
    const scheduledPayment = parseMoneyToNumber(scheduledPaymentRaw);

    const paymentStatus = cleanValue(paymentStatusRaw);
    const worstDelinquency = cleanValue(worstDelinquencyRaw);
    terms = cleanValue(terms);

    // Payment history
    const paymentHistoryRows = parsePaymentHistoryRows(blockLines); // internal
    const paymentHistory = flattenPaymentHistory(paymentHistoryRows); // canonical

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

      // normalized timestamps
      lastUpdated,
      openDate,
      closedDate,
      lastActivity,

      // strings
      paymentStatus,
      worstDelinquency,
      loanType,
      responsibility,
      companyName,
      accountNumber,
      terms,

      // normalized numbers
      balance,
      creditLimit,
      highBalance,
      scheduledPayment,

      // canonical payment history
      paymentHistory,

      warnings,

      // debug only
      _blockLines: blockLines,
      _raw: {
        lastUpdatedRaw,
        openDateRaw,
        closedDateRaw,
        lastActivityRaw,
        balanceRaw,
        creditLimitRaw,
        highBalanceRaw,
        scheduledPaymentRaw,
      },
    };
  });

  console.log("\nSanity check lenders + paymentHistory months:");
  accounts.forEach((a) => console.log(`${a.index} ${a.lender} months:${a.paymentHistory?.length ?? 0} warnings:${a.warnings.length}`));

  // JSON payload (strip debug fields)
  console.log("\n--- JSON PAYLOAD (normalized; debug removed) ---");
  const payload = accounts.map(({ _blockLines, _raw, ...rest }) => rest);
  console.log(JSON.stringify(payload, null, 2));
})().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(99);
});
