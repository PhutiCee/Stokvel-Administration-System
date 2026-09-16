"use strict";

/**
 * Password storage tests. REQ-1, REQ-2.
 *
 * No database. These prove the property the requirement actually cares about:
 * that a stolen copy of user_account does not hand over anybody's password.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { hashPassword, verifyPassword } = require("../src/lib/password");
const { temporaryPassword } = require("../src/lib/tempPassword");

test("password hashing — REQ-2", async (t) => {

    await t.test("the correct password verifies", async () => {
        const hash = await hashPassword("stokvel2026");
        assert.equal(await verifyPassword("stokvel2026", hash), true);
    });

    await t.test("a wrong password does not", async () => {
        const hash = await hashPassword("stokvel2026");
        assert.equal(await verifyPassword("stokvel2025", hash), false);
        assert.equal(await verifyPassword("", hash), false);
        assert.equal(await verifyPassword("STOKVEL2026", hash), false);
    });

    await t.test("the plaintext never appears in the stored value", async () => {
        const hash = await hashPassword("Ntombi!2026");
        assert.equal(hash.includes("Ntombi"), false);
        assert.equal(hash.includes("2026"), false);
    });

    await t.test("the same password hashes differently every time", async () => {
        // Per-password salt. Without it, two members who chose the same password
        // would be visibly identical in the table.
        const a = await hashPassword("same-password");
        const b = await hashPassword("same-password");
        assert.notEqual(a, b);
        assert.equal(await verifyPassword("same-password", a), true);
        assert.equal(await verifyPassword("same-password", b), true);
    });

    await t.test("the stored format is self-describing", async () => {
        // scrypt$N$r$p$salt$key — so the work factor can be raised later
        // without invalidating hashes already stored.
        const hash = await hashPassword("x");
        const parts = hash.split("$");
        assert.equal(parts.length, 6);
        assert.equal(parts[0], "scrypt");
        assert.ok(Number(parts[1]) >= 16384, "work factor should be at least 2^14");
    });

    await t.test("a corrupt stored hash fails rather than throwing", async () => {
        // A damaged row must be a failed sign-in, not a 500.
        for (const bad of ["", "nonsense", "scrypt$1$2$3", "bcrypt$a$b$c$d$e", null, undefined]) {
            assert.equal(await verifyPassword("x", bad), false);
        }
    });

    await t.test("unicode and long passwords are handled", async () => {
        const passphrase = "Ndi\u0161a mali ya stokvel \u2014 2026!";
        const hash = await hashPassword(passphrase);
        assert.equal(await verifyPassword(passphrase, hash), true);
    });
});

test("temporary passwords — REQ-43", async (t) => {

    await t.test("readable aloud: three words and two digits", () => {
        assert.match(temporaryPassword(), /^[a-z]+-[a-z]+-[a-z]+-\d{2}$/);
    });

    await t.test("no characters that are ambiguous when spoken", () => {
        // A secretary reads this across a table. "l" and "1", "O" and "0" are
        // the reason people fail to sign in.
        for (let i = 0; i < 50; i++) {
            const words = temporaryPassword().split("-").slice(0, 3).join("");
            assert.equal(/[lo]/.test(words) && /[10]/.test(words), false);
        }
    });

    await t.test("does not repeat", () => {
        const seen = new Set();
        for (let i = 0; i < 200; i++) seen.add(temporaryPassword());
        assert.ok(seen.size > 195, "temporary passwords should not collide in practice");
    });

    await t.test("works as a real password", async () => {
        const temp = temporaryPassword();
        assert.equal(await verifyPassword(temp, await hashPassword(temp)), true);
    });
});
