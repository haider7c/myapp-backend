// backend/templates/whatsappReceiptTemplate.js
//
// Pure string-building module (no runtime deps) for the two WhatsApp
// bill/receipt image designs the owner can send to a customer: a
// "stormfiber" (blue) skin and a "nationalbroadband" (green) skin, each in
// an unpaid "bill" layout and a paid "receipt" layout. Developed and
// visually verified against the four reference designs the owner supplied,
// using Playwright in a sandbox, before being ported here -- rendered in
// this app by services/receiptImageService.js (puppeteer).
//
// This module only builds HTML from the `data` object it's given; it has
// no knowledge of Customer/BillStatus/AdditionalCharge -- that assembly
// lives in services/receiptDataBuilder.js so this file stays a pure,
// easily-testable template.

const BOLT_SVG = '<svg viewBox="0 0 24 24" style="width:30px;height:40px;vertical-align:-6px"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" fill="#F5A623" stroke="#F5A623" stroke-width="1"/></svg>';

const BRANDS = {
  stormfiber: {
    name: "stormfiber",
    nameStyled: `<span class="wordmark-dark">st</span><span class="bolt-icon">${BOLT_SVG}</span><span class="wordmark-dark">rm</span><span class="wordmark-light">fiber</span>`,
    tagline: "Reliable Internet for a Better Tomorrow",
    primary: "#0B2A6B",
    primaryDark: "#081F52",
    accent: "#1C7FE0",
    accentSoft: "#E8F2FD",
    heroFrom: "#0B2A6B",
    heroTo: "#1C7FE0",
  },
  nationalbroadband: {
    name: "nationalbroadband",
    nameStyled: `<span class="nbb-badge">NBB</span><span class="nbb-text">NATIONAL<br/>BROADBAND</span>`,
    tagline: "Connecting People, Building a Better Tomorrow",
    primary: "#0B5B34",
    primaryDark: "#07432770".slice(0, 7),
    accent: "#15803D",
    accentSoft: "#E6F6EC",
    heroFrom: "#0B5B34",
    heroTo: "#15803D",
  },
};

const ICONS = {
  doc: `<svg viewBox="0 0 24 24" fill="none"><rect x="5" y="2" width="14" height="20" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M3 9h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3.5 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  person: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.8"/><path d="M4 21c1.5-4.5 5-6 8-6s6.5 1.5 8 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  idcard: `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.8"/><circle cx="8.5" cy="11" r="2" stroke="currentColor" stroke-width="1.6"/><path d="M5.5 16c.6-1.6 1.8-2.3 3-2.3s2.4.7 3 2.3M14 10h4M14 13h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" fill="none"><path d="M6.6 10.8c1.2 2.4 3.2 4.4 5.6 5.6l1.9-1.9c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.5.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.5 21 3 13.5 3 4c0-.6.4-1 1-1h3.1c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.4 0 .8-.2 1L6.6 10.8z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 22s7-6.1 7-12a7 7 0 10-14 0c0 5.9 7 12 7 12z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.6" stroke="currentColor" stroke-width="1.6"/></svg>`,
  wifi: `<svg viewBox="0 0 24 24" fill="none"><path d="M3 8.5a15 15 0 0118 0M6.2 12.3a10.4 10.4 0 0111.6 0M9.6 16a5.6 5.6 0 014.8 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="19.2" r="1.3" fill="currentColor"/></svg>`,
  globe: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3C9.5 5.6 9.5 18.4 12 21" stroke="currentColor" stroke-width="1.6"/></svg>`,
  card: `<svg viewBox="0 0 24 24" fill="none"><rect x="2.5" y="5.5" width="19" height="13" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M2.5 9.5h19" stroke="currentColor" stroke-width="1.8"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none"><path d="M5 13l5 5L19 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  hourglass: `<svg viewBox="0 0 24 24" fill="none"><path d="M6 3h12M6 21h12M7 3c0 4 10 4 10 8s-10 4-10 8M17 3c0 4-10 4-10 8s10 4 10 8" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  cash: `<svg viewBox="0 0 24 24" fill="none"><rect x="2.5" y="6" width="19" height="12" rx="2" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/></svg>`,
  headset: `<svg viewBox="0 0 24 24" fill="none"><path d="M4 13v-1a8 8 0 0116 0v1" stroke="currentColor" stroke-width="1.8"/><rect x="3" y="13" width="4" height="6" rx="1.5" stroke="currentColor" stroke-width="1.6"/><rect x="17" y="13" width="4" height="6" rx="1.5" stroke="currentColor" stroke-width="1.6"/><path d="M20 19v1a3 3 0 01-3 3h-2" stroke="currentColor" stroke-width="1.6"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6l7-3z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8.8 12.2l2.2 2.2 4.2-4.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  people: `<svg viewBox="0 0 24 24" fill="none"><circle cx="8.5" cy="8.5" r="3" stroke="currentColor" stroke-width="1.6"/><circle cx="16.3" cy="9.3" r="2.4" stroke="currentColor" stroke-width="1.6"/><path d="M3 20c.8-3.4 3-5 5.5-5s4.7 1.6 5.5 5M14.8 20c.5-2.6 2-4 3.9-4.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  gauge: `<svg viewBox="0 0 24 24" fill="none"><path d="M4 16a8 8 0 0116 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 16l3.5-4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="16" r="1.2" fill="currentColor"/></svg>`,
  router: `<svg viewBox="0 0 24 24" fill="none"><rect x="2" y="13" width="20" height="7" rx="2" stroke="currentColor" stroke-width="1.7"/><circle cx="7" cy="16.5" r="1" fill="currentColor"/><circle cx="10.5" cy="16.5" r="1" fill="currentColor"/><path d="M8 13l1.5-5M14 13l-1-5M9 5c1.6-1.3 3.4-1.3 5 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
};

function money(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function iconCircle(key, bg, fg) {
  return `<span class="icon-circle" style="background:${bg};color:${fg}">${ICONS[key]}</span>`;
}

function infoRow(icon, label, value, color) {
  return `
    <div class="info-row">
      <span class="info-icon" style="color:${color}">${ICONS[icon]}</span>
      <span class="info-label">${label}</span>
      <span class="info-sep">:</span>
      <span class="info-value">${value}</span>
    </div>`;
}

function buildReceiptHtml({ brand = "stormfiber", kind = "bill", data = {} }) {
  const b = BRANDS[brand] || BRANDS.stormfiber;
  const isReceipt = kind === "receipt";

  const subtitle = isReceipt ? "THANK YOU FOR YOUR PAYMENT" : "MONTHLY BILLING STATEMENT";

  const statusKey = data.paymentStatus || (isReceipt ? "PAID" : "UNPAID");
  const statusIsPaid = statusKey === "PAID";
  const statusIsPartial = statusKey === "PARTIAL";
  const statusColor = statusIsPaid ? "#1F9154" : statusIsPartial ? "#B45309" : "#DC2626";
  const statusBg = statusIsPaid ? "#E7F7EE" : statusIsPartial ? "#FEF3E2" : "#FDE9E9";
  const statusIcon = statusIsPaid ? "check" : "hourglass";

  const docMetaRows = isReceipt
    ? [
        [ICONS.doc, "Receipt No:", data.docNumber],
        [ICONS.calendar, "Date:", data.docDate],
        [ICONS.clock, "Time:", data.docTime],
      ]
    : [
        [ICONS.doc, "Bill No:", data.docNumber],
        [ICONS.calendar, "Bill Date:", data.billDate],
        [ICONS.clock, "Due Date:", data.dueDateLabel],
        [ICONS.calendar, "Billing Period:", data.billingPeriodLabel],
      ];

  const accountBadge = data.accountStatus === "Active"
    ? `<span class="pill pill-green">Active</span>`
    : `<span class="pill pill-gray">${data.accountStatus || "Inactive"}</span>`;

  const billingRows = (data.billingRows || []).map(
    (r, i) => `
      <tr class="${i % 2 === 1 ? "alt" : ""}">
        <td class="num">${i + 1}</td>
        <td>${r.label}</td>
        <td class="amt">${money(r.amount)}</td>
      </tr>`
  ).join("");

  const showRemaining = !isReceipt || statusIsPartial;

  const paymentSummary = `
    <div class="panel">
      <div class="panel-head" style="background:${b.primary}">
        ${iconCircle("card", "rgba(255,255,255,.18)", "#fff")}
        <span>PAYMENT SUMMARY</span>
      </div>
      <div class="panel-body summary-body">
        <div class="sum-row"><span>Total Amount</span><strong>Rs. ${money(data.totalAmount)}</strong></div>
        <div class="sum-row sum-row-highlight"><span>Amount Paid</span><strong>Rs. ${money(data.amountPaid)}</strong></div>
        ${showRemaining ? `<div class="sum-row sum-row-remaining"><span>Remaining Balance</span><strong>Rs. ${money(data.remainingBalance)}</strong></div>` : ""}
      </div>
    </div>`;

  const statusPanel = `
    <div class="status-card" style="background:${statusBg}">
      <span class="status-icon" style="background:${statusColor}">${ICONS[statusIcon]}</span>
      <div class="status-label" style="color:${statusColor}">PAYMENT STATUS</div>
      <div class="status-value" style="color:${statusColor}">${statusIsPartial ? "PARTIALLY PAID" : statusKey}</div>
      ${isReceipt
        ? `<div class="status-divider"></div><div class="status-method"><span class="status-method-value">${iconCircle("cash", statusColor, "#fff")}${data.paymentMethod || "Cash"}</span></div>`
        : `<div class="status-note">Please pay your bill before the due date to avoid service suspension.</div>`}
    </div>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin:0; padding:0; }
  body {
    width: 1024px;
    font-family: 'Segoe UI', Arial, sans-serif;
    background: #fff; color: #1a1a1a;
  }
  .page { width: 1024px; padding: 40px 56px 40px 56px; }
  .icon-circle { display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px; border-radius:50%; margin-right:8px; }
  .icon-circle svg { width:18px; height:18px; }

  /* ---------- HEADER ---------- */
  .hero { position: relative; display:flex; justify-content:space-between; align-items:flex-start; padding-bottom: 14px; border-bottom: 3px solid ${b.accent}22; margin-bottom: 18px; overflow:hidden; }
  .hero-left { padding-top: 6px; z-index:2; }
  .wordmark { font-size: 46px; font-weight: 800; letter-spacing: -1px; }
  .wordmark-dark { color: ${b.primary}; }
  .wordmark-light { color: ${b.accent}; }
  .nbb-badge { display:inline-flex; align-items:center; justify-content:center; width:56px; height:56px; border-radius:50%; border:4px solid ${b.primary}; color:${b.primary}; font-weight:800; font-size:17px; margin-right:12px; vertical-align:middle; }
  .nbb-text { font-size:30px; font-weight:800; color:${b.primary}; line-height:1.05; vertical-align:middle; display:inline-block; }
  .powered-row { display:flex; align-items:center; gap:8px; margin-top:6px; }
  .powered-label { font-size:13px; color:#555; }
  .powered-badge { background:#C8102E; color:#fff; font-weight:800; font-size:13px; padding:3px 10px; border-radius:4px; letter-spacing:.5px; }
  .tagline-strip { margin-top:10px; font-size:11px; letter-spacing:2px; color:#6b7280; font-weight:600; }
  .hero-right { position:relative; width:380px; height:140px; border-radius: 0 0 0 60px; background: linear-gradient(135deg, ${b.heroFrom}, ${b.heroTo}); color:#fff; padding:18px 24px; z-index:1; }
  .hero-right .headline { font-size:15px; font-weight:700; line-height:1.3; max-width:190px; }

  /* ---------- TITLE + META ---------- */
  .title-row { display:flex; justify-content:space-between; align-items:flex-end; margin-bottom: 22px; }
  .title-main { font-size: 40px; font-weight: 900; }
  .title-main .t1 { color: ${b.primary}; }
  .title-main .t2 { color: ${b.accent}; }
  .title-sub { font-size: 13px; letter-spacing: 3px; font-weight:700; color:#555; margin-top:4px; }
  .meta-box { background:#f4f6f9; border-radius:10px; padding:14px 18px; min-width:280px; }
  .meta-row { display:flex; align-items:center; gap:8px; font-size:13px; padding:3px 0; color:#333; }
  .meta-row svg { width:15px; height:15px; color:${b.accent}; }
  .meta-row b { margin-left:auto; font-size:14px; }

  /* ---------- SECTION PANEL ---------- */
  .panel { border-radius:12px; overflow:hidden; border:1px solid #e7e9ee; margin-bottom:20px; }
  .panel-head { color:#fff; font-weight:800; font-size:14px; letter-spacing:.5px; padding:12px 18px; display:flex; align-items:center; }
  .panel-body { padding: 18px 22px; background:#fff; }

  .details-grid { display:flex; gap:30px; }
  .details-col { flex:1; }
  .info-row { display:flex; align-items:center; font-size:13.5px; padding:7px 0; gap:6px; color:#222; }
  .info-icon svg { width:16px; height:16px; display:block; }
  .info-label { color:#555; width:118px; flex-shrink:0; }
  .info-sep { color:#999; margin-right:4px; }
  .info-value { font-weight:700; color:#111; }
  .pill { display:inline-block; padding:3px 12px; border-radius:20px; font-size:12px; font-weight:800; }
  .pill-green { background:#1F9154; color:#fff; }
  .pill-gray { background:#9ca3af; color:#fff; }

  table.bill-table { width:100%; border-collapse:collapse; font-size:13.5px; }
  table.bill-table th { background:#eef1f6; text-align:left; padding:10px 14px; font-size:12px; color:#333; text-transform:uppercase; letter-spacing:.5px; }
  table.bill-table th.amt, table.bill-table td.amt { text-align:right; }
  table.bill-table td { padding:11px 14px; border-bottom:1px solid #f0f1f4; }
  table.bill-table tr.alt { background:#fafbfc; }
  td.num { color:#888; width:30px; }

  .two-col { display:flex; gap:22px; margin-bottom: 22px; align-items:stretch; }
  .two-col .panel { flex:1.15; margin-bottom:0; }
  .summary-body .sum-row { display:flex; justify-content:space-between; padding:9px 0; font-size:14px; border-bottom:1px solid #f0f1f4; }
  .summary-body .sum-row strong { font-size:16px; }
  .summary-body .sum-row-highlight { background:${b.accentSoft}; margin:0 -22px; padding:9px 22px; }
  .summary-body .sum-row-remaining { color:#DC2626; }
  .summary-body .sum-row-remaining strong { color:#DC2626; }

  .status-card { flex:0.85; border-radius:12px; padding:22px; display:flex; flex-direction:column; align-items:center; text-align:center; }
  .status-icon { width:52px; height:52px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; margin-bottom:10px; }
  .status-icon svg { width:26px; height:26px; }
  .status-label { font-size:12px; font-weight:800; letter-spacing:1px; }
  .status-value { font-size:26px; font-weight:900; margin-top:2px; }
  .status-divider { width:100%; height:1px; background:rgba(0,0,0,.08); margin:14px 0 10px; }
  .status-method { display:flex; align-items:center; justify-content:center; gap:6px; font-size:13px; color:#333; font-weight:700; }
  .status-note { font-size:12px; color:#555; margin-top:10px; line-height:1.5; }

  .thankyou-strip { display:flex; background:${b.accentSoft}; border-radius:14px; padding:22px 26px; margin-bottom:20px; gap:26px; align-items:center; }
  .thankyou-left { flex:1.3; }
  .thankyou-left .ty-label { font-size:14px; color:#444; margin-bottom:4px; }
  .thankyou-left .ty-brand { font-size:24px; font-weight:800; }
  .thankyou-left p { font-size:12px; color:#555; margin-top:8px; line-height:1.5; max-width:460px; }
  .thankyou-right { flex:0.8; display:flex; flex-direction:column; gap:10px; border-left:1px solid rgba(0,0,0,.08); padding-left:22px; }
  .feature { display:flex; align-items:center; gap:10px; font-size:12.5px; font-weight:700; color:#333; }
  .feature svg { width:20px; height:20px; color:${b.primary}; }

  .contact-bar { background:${b.primary}; color:#fff; display:flex; justify-content:space-between; padding:20px 56px; margin:0 -56px; }
  .contact-col { display:flex; align-items:flex-start; gap:10px; font-size:12.5px; }
  .contact-col svg { width:18px; height:18px; margin-top:2px; }
  .contact-col b { display:block; font-size:13px; }
  .contact-col div.lines { line-height:1.5; }
</style>
</head>
<body>
<div class="page">

  <div class="hero">
    <div class="hero-left">
      <div class="wordmark">${b.nameStyled}</div>
      <div class="powered-row">
        <span class="powered-label">powered by</span>
        <span class="powered-badge">CYBERNET</span>
      </div>
      <div class="tagline-strip">FAST &nbsp;|&nbsp; STABLE &nbsp;|&nbsp; SECURE &nbsp;|&nbsp; ALWAYS CONNECTED</div>
    </div>
    <div class="hero-right">
      <div class="headline">${b.tagline}</div>
    </div>
  </div>

  <div class="title-row">
    <div>
      <div class="title-main">${isReceipt ? `<span class="t1">PAYMENT</span> <span class="t2">RECEIPT</span>` : `<span class="t1">INTERNET</span> <span class="t2">BILL</span>`}</div>
      <div class="title-sub">${subtitle}</div>
    </div>
    <div class="meta-box">
      ${docMetaRows.map(([icon, label, value]) => `<div class="meta-row">${icon}<span>${label}</span><b>${value}</b></div>`).join("")}
    </div>
  </div>

  <div class="panel">
    <div class="panel-head" style="background:${b.primary}">${iconCircle("person", "rgba(255,255,255,.18)", "#fff")}<span>CUSTOMER DETAILS</span></div>
    <div class="panel-body">
      <div class="details-grid">
        <div class="details-col">
          ${infoRow("person", "Customer Name", data.customerName, b.accent)}
          ${infoRow("idcard", "Customer ID", data.customerId, b.accent)}
          ${infoRow("idcard", "CNIC", data.cnic || "-", b.accent)}
          ${infoRow("phone", "Contact No", data.phone || "-", b.accent)}
          ${infoRow("pin", "Address", data.address || "-", b.accent)}
        </div>
        <div class="details-col">
          ${infoRow("wifi", "Package Speed", data.packageSpeed || "-", b.accent)}
          ${infoRow("globe", "Connection Type", data.connectionType || "Fiber / PPPoE", b.accent)}
          ${infoRow("calendar", "Billing Period", data.billingPeriodShort, b.accent)}
          ${infoRow("calendar", isReceipt ? "Next Due Date" : "Due Date", isReceipt ? data.nextDueDateLabel : data.dueDateLabel, b.accent)}
          <div class="info-row"><span class="info-icon" style="color:${b.accent}">${ICONS.check}</span><span class="info-label">Account Status</span><span class="info-sep">:</span>${accountBadge}</div>
        </div>
      </div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-head" style="background:${b.primary}">${iconCircle("doc", "rgba(255,255,255,.18)", "#fff")}<span>BILLING DETAILS</span></div>
    <div class="panel-body" style="padding:0">
      <table class="bill-table">
        <thead><tr><th>#</th><th>Description</th><th class="amt">Amount (Rs.)</th></tr></thead>
        <tbody>${billingRows}</tbody>
      </table>
    </div>
  </div>

  <div class="two-col">
    ${paymentSummary}
    ${statusPanel}
  </div>

  <div class="thankyou-strip">
    <div class="thankyou-left">
      <div class="ty-label">Thank you for choosing</div>
      <div class="ty-brand">${b.nameStyled}</div>
      <p>Your trust keeps us connected. We are committed to providing you with fast, stable and reliable internet services.</p>
    </div>
    <div class="thankyou-right">
      <div class="feature">${ICONS.gauge}<span>High Speed Internet</span></div>
      <div class="feature">${ICONS.shield}<span>Reliable Connection</span></div>
      <div class="feature">${ICONS.people}<span>Better Community</span></div>
    </div>
  </div>

  <div class="contact-bar">
    <div class="contact-col">${ICONS.phone}<div class="lines"><b>Support &amp; Helpline</b>${data.company?.phone1 || ""}<br/>${data.company?.phone2 || ""}</div></div>
    <div class="contact-col">${ICONS.pin}<div class="lines"><b>Office Address</b>${data.company?.address || ""}</div></div>
    <div class="contact-col">${ICONS.headset}<div class="lines"><b>Support Number</b>${data.company?.supportNumber || ""}<br/>(Call / WhatsApp)</div></div>
  </div>

</div>
</body>
</html>`;
}

module.exports = { buildReceiptHtml, BRANDS };
