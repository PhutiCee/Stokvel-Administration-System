"use strict";

/**
 * Calendar dates as plain text.
 *
 * A DATE column holds a day, not a moment. It has no time of day and no time
 * zone. Passing it around as a JavaScript Date invents both: node-postgres
 * builds the Date at local midnight, and toISOString() then converts to UTC.
 * On a server running in South Africa (UTC+2) that turns 2026-09-20 into
 * 2026-09-19. The rules engine compares dates against constitution effective
 * dates, so a shift of one day can select the wrong version.
 *
 * Code that resolves rules by date therefore handles dates as "YYYY-MM-DD"
 * strings from the database to the comparison, and never as Date objects.
 * Queries that feed it select the column cast to text (effective_date::text).
 *
 * Pure functions. No database.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written YYYY-MM-DD. 2026-02-30 is not one. */
function isIsoDate(value) {
    if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
    const d = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function assertIsoDate(value, label = "date") {
    if (!isIsoDate(value)) {
        throw new TypeError(`${label} must be a calendar date written YYYY-MM-DD.`);
    }
    return value;
}

/**
 * Today as a South African calendar date, whatever zone the server runs in.
 * A club in Limpopo that acts at 01:00 on the 21st is acting on the 21st, even
 * if the server (or the Supabase host) is still on the 20th in UTC.
 */
function todayIso(now = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Africa/Johannesburg",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(now);
}

function addDays(value, days) {
    assertIsoDate(value);
    const d = new Date(`${value}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/**
 * Adds calendar months, keeping the day of the month where it exists and
 * falling back to the last day of the month where it does not, so that
 * 31 January plus one month is 28 (or 29) February and not 3 March.
 */
function addMonths(value, months) {
    assertIsoDate(value);
    const [y, m, d] = value.split("-").map(Number);
    const target = new Date(Date.UTC(y, m - 1 + months, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(d, lastDay));
    return target.toISOString().slice(0, 10);
}

/**
 * The date n cycles after a date, for a cycle frequency from the constitution.
 * Weekly and Fortnightly are fixed lengths. Monthly moves by calendar month.
 */
function addCycles(value, count, frequency) {
    switch (frequency) {
        case "Weekly":      return addDays(value, 7 * count);
        case "Fortnightly": return addDays(value, 14 * count);
        case "Monthly":     return addMonths(value, count);
        default:
            throw new TypeError(`Unknown cycle frequency: ${frequency}`);
    }
}

/**
 * REQ-79: the year-end date is a month and day, recurring every year. The day
 * is clamped to the last valid day of that month in that year (29 February in
 * a leap year, 28 in any other), the same clamping addMonths() already uses,
 * so a constitution naming 31 as the day is coherent in every month rather
 * than only in some of them.
 */
function yearEndDateFor(year, month, day) {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const d = Math.min(day, lastDay);
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * The next year-end date strictly after a given date. "Strictly after" so that
 * a distribution already computed up to and including a year-end date moves on
 * to the next one, rather than being offered the same date again.
 */
function nextYearEndAfter(afterDate, month, day) {
    assertIsoDate(afterDate);
    const year = Number(afterDate.slice(0, 4));
    let candidate = yearEndDateFor(year, month, day);
    if (compareIso(candidate, afterDate) <= 0) {
        candidate = yearEndDateFor(year + 1, month, day);
    }
    return candidate;
}

/** -1, 0 or 1. ISO dates sort correctly as text. */
function compareIso(a, b) {
    assertIsoDate(a, "first date");
    assertIsoDate(b, "second date");
    return a < b ? -1 : a > b ? 1 : 0;
}

module.exports = { isIsoDate, assertIsoDate, todayIso, addDays, addMonths, addCycles, yearEndDateFor, nextYearEndAfter, compareIso };