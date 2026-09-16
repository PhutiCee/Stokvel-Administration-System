/**
 * Presentation helpers.
 *
 * Currency convention is fixed here and nowhere else: R, a thin space as the
 * thousands separator, a dot for decimals, always two decimal places. SRS 3.1
 * leaves the separator open; this is the choice, and it is made once.
 *
 * Amounts arrive from the API as NUMERIC strings ("4400.00"), not numbers. They
 * are formatted as strings here and never converted to a JavaScript float on
 * the way, because the reason the server keeps them as strings is the same
 * reason the client should: 0.1 + 0.2 is not 0.3, and this is a book of
 * account.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const THIN_SPACE = "\u2009";
const MINUS = "\u2212"; // a true minus sign, which aligns with the digits

/**
 * "4400.00" -> "R4 400.00"     -1200 -> "−R1 200.00"
 * @param {string|number} amount
 * @param {{sign?: boolean}} [options] sign: show "+" on positive amounts
 */
export function money(amount, { sign = false } = {}) {
  const text = String(amount ?? "0");
  const negative = text.trim().startsWith("-");
  const [whole = "0", frac = "00"] = text.replace(/^-/, "").split(".");

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);
  const decimals = (frac + "00").slice(0, 2);
  const isZero = /^0+$/.test(whole) && /^0+$/.test(decimals);

  const prefix = negative ? MINUS : sign && !isZero ? "+" : "";
  return `${prefix}R${grouped}.${decimals}`;
}

/** True when a NUMERIC string represents zero, without parsing it as a float. */
export function isZeroAmount(amount) {
  return /^-?0*(\.0*)?$/.test(String(amount ?? "0").trim());
}

export function isNegativeAmount(amount) {
  return String(amount ?? "").trim().startsWith("-") && !isZeroAmount(amount);
}

const toDate = (v) => (v instanceof Date ? v : new Date(v));

/** 15 Sep 2026 */
export function fmtDate(v) {
  if (!v) return "—";
  const d = toDate(v);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** 15 Sep */
export function fmtDateShort(v) {
  if (!v) return "—";
  const d = toDate(v);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** 15 Sep 2026, 14:30 */
export function fmtDateTime(v) {
  if (!v) return "—";
  const d = toDate(v);
  return `${fmtDate(d)}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function relative(v) {
  if (!v) return "—";
  const d = toDate(v);
  const days = Math.round((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 0) return `In ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`;
  if (days < 30) return `${days} days ago`;
  return fmtDate(d);
}

/**
 * SRS 5.3: an identity number is masked to its final four digits except to the
 * member it belongs to and to the Secretary.
 */
export function maskId(idNumber, reveal = false) {
  if (!idNumber) return "—";
  if (reveal) return idNumber.replace(/(\d{6})(\d{4})(\d{3})/, "$1 $2 $3");
  return `${"\u2022".repeat(9)}${THIN_SPACE}${idNumber.slice(-4)}`;
}

/** 0824417788 -> 082 441 7788 */
export function fmtPhone(phone) {
  if (!phone) return "—";
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length !== 10) return phone;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}

export function initials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

export function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}