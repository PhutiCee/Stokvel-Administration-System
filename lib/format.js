// Presentation helpers. Currency convention fixed here: R + space thousands separator
// + dot decimal, always two decimals (SRS 3.1 leaves the separator ambiguous; we chose one).

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function money(amount, { sign = false } = {}) {
  const n = Number(amount || 0);
  const abs = Math.abs(n);
  const [whole, frac] = abs.toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, "\u2009");
  const prefix = n < 0 ? "\u2212" : sign && n > 0 ? "+" : "";
  return `${prefix}R${grouped}.${frac}`;
}

export function toDate(v) { return v instanceof Date ? v : new Date(v); }

export function fmtDate(v) {
  const d = toDate(v);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtDateShort(v) {
  const d = toDate(v);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function fmtMonth(v) {
  const d = toDate(v);
  return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}

export function fmtDateTime(v) {
  const d = toDate(v);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${fmtDate(d)}, ${hh}:${mm}`;
}

export function relative(v) {
  const d = toDate(v);
  const days = Math.round((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 0) return `In ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`;
  if (days < 30) return `${days} days ago`;
  return fmtDate(d);
}

// SRS 5.3: identity numbers masked to the final four digits except to the member
// concerned and to the Secretary.
export function maskId(idNumber, reveal = false) {
  if (!idNumber) return "—";
  if (reveal) return idNumber.replace(/(\d{6})(\d{4})(\d{3})/, "$1 $2 $3");
  return `${"\u2022".repeat(9)} ${idNumber.slice(-4)}`;
}

export function initials(name = "") {
  return name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
}

export function addDays(date, days) {
  const d = toDate(date); const c = new Date(d); c.setDate(c.getDate() + days); return c;
}
export function addMonths(date, months) {
  const d = toDate(date); const c = new Date(d); c.setMonth(c.getMonth() + months); return c;
}
export function startOfMonth(date) {
  const d = toDate(date); return new Date(d.getFullYear(), d.getMonth(), 1);
}
export function daysBetween(a, b) {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);
}
export function cx(...parts) { return parts.filter(Boolean).join(" "); }
