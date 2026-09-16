"use strict";

/**
 * Password hashing. REQ-2.
 *
 * scrypt, from Node's built-in crypto module. It is a key-derivation function
 * designed for password storage: memory-hard, deliberately slow, and salted per
 * password. It needs no native compilation, which matters when four people have
 * to get this running on four different machines.
 *
 * Stored format (single text column, self-describing so the work factor can be
 * raised later without invalidating existing hashes):
 *
 *     scrypt$N$r$p$<salt base64>$<derived key base64>
 *
 * Nothing in this module ever returns, logs or accepts a plaintext password
 * beyond the boundary of the two exported functions.
 */

const crypto = require("crypto");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);

// Work factors. N=2^15 costs roughly 100 ms on a typical laptop, which is the
// right order of magnitude: slow enough to make offline guessing expensive,
// fast enough that a member signing in does not notice.
const PARAMS = { N: 32768, r: 8, p: 1, keyLength: 64, saltLength: 16 };

// scrypt needs maxmem above roughly 128 * N * r bytes, and Node's default is
// 32 MB, which 2^15 exceeds.
const MAX_MEM = 128 * PARAMS.N * PARAMS.r * 2;

/**
 * @param {string} plaintext
 * @returns {Promise<string>} the encoded hash, safe to store
 */
async function hashPassword(plaintext) {
    if (typeof plaintext !== "string" || plaintext.length === 0) {
        throw new Error("Password must be a non-empty string.");
    }
    const salt = crypto.randomBytes(PARAMS.saltLength);
    const derived = await scrypt(plaintext, salt, PARAMS.keyLength, {
        N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: MAX_MEM
    });
    return [
        "scrypt",
        PARAMS.N,
        PARAMS.r,
        PARAMS.p,
        salt.toString("base64"),
        derived.toString("base64")
    ].join("$");
}

/**
 * Constant-time verification.
 *
 * Returns false rather than throwing on a malformed stored hash, so that a
 * corrupt row is a failed login rather than a 500.
 *
 * @param {string} plaintext
 * @param {string} stored
 * @returns {Promise<boolean>}
 */
async function verifyPassword(plaintext, stored) {
    if (typeof plaintext !== "string" || typeof stored !== "string") return false;

    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;

    const [, nStr, rStr, pStr, saltB64, keyB64] = parts;
    const N = parseInt(nStr, 10);
    const r = parseInt(rStr, 10);
    const p = parseInt(pStr, 10);
    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

    let salt, expected;
    try {
        salt = Buffer.from(saltB64, "base64");
        expected = Buffer.from(keyB64, "base64");
    } catch {
        return false;
    }
    if (salt.length === 0 || expected.length === 0) return false;

    let actual;
    try {
        actual = await scrypt(plaintext, salt, expected.length, {
            N, r, p, maxmem: 128 * N * r * 2
        });
    } catch {
        return false;
    }

    // timingSafeEqual throws if the lengths differ, so check first.
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
}

/**
 * A dummy verification, used when no account matches the submitted username.
 *
 * Without this, a request for a non-existent user returns in about a
 * millisecond while a request for a real user takes about a hundred, and the
 * difference tells an attacker which phone numbers are registered. REQ-1
 * requires a message that does not disclose whether the username exists; a
 * timing channel discloses it just as effectively as the message would.
 */
const DUMMY_HASH = "scrypt$32768$8$1$" +
    "AAAAAAAAAAAAAAAAAAAAAA==$" +
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
    "AAAAAAAAAAAAAAAAAAAAAA==";

async function wasteTime() {
    await verifyPassword("not-a-real-password", DUMMY_HASH);
}

module.exports = { hashPassword, verifyPassword, wasteTime };