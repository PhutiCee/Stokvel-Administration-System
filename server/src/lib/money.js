"use strict";

/**
 * Money.
 *
 * The database stores NUMERIC(12,2) and node-postgres hands it back as a
 * string. Every calculation in this system converts to integer cents, works
 * there, and converts back. Nothing ever adds two rands as JavaScript numbers.
 *
 *     0.1 + 0.2 === 0.30000000000000004
 *
 * That is a rounding error in a savings club's book of account. It is exactly
 * why SDD 5.2.1 specifies a fixed-precision decimal type, and the application
 * has to honour that choice rather than undo it in memory.
 */

/**
 * "500.00" | 500 | 500.5  ->  50000 | 50050  (integer cents)
 */
function toCents(value) {
  if (value === null || value === undefined || value === "") return 0;

  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error(`Not a finite amount: ${value}`);
    return Math.round(value * 100);
  }

  const text = String(value).trim().replace(/\s/g, "").replace(/^R/i, "");
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    throw new Error(`Not a valid amount: ${JSON.stringify(value)}`);
  }

  const negative = text.startsWith("-");
  const [whole, frac = ""] = text.replace("-", "").split(".");
  const cents = BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
  // Round the third decimal if one was supplied.
  const rounded = frac.length > 2 && Number(frac[2]) >= 5 ? cents + 1n : cents;
  const result = Number(negative ? -rounded : rounded);

  if (!Number.isSafeInteger(result))
    throw new Error(`Amount out of range: ${value}`);
  return result;
}

/**
 * 50000 -> "500.00"   — the form to send back to PostgreSQL.
 */
function toNumeric(cents) {
  if (!Number.isInteger(cents))
    throw new Error(`Cents must be an integer: ${cents}`);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return negative ? `-${text}` : text;
}

/**
 * 50000 -> "R500.00"  — display only. The web app has its own formatter; this
 * one exists for log lines and refusal messages composed on the server.
 */
function format(cents) {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = String(Math.floor(abs / 100)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    "\u2009",
  );
  const frac = String(abs % 100).padStart(2, "0");
  return `${negative ? "\u2212" : ""}R${whole}.${frac}`;
}

const sum = (...amounts) => amounts.reduce((a, c) => a + toCents(c), 0);

module.exports = { toCents, toNumeric, format, sum };
