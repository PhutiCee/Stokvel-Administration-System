"use strict";

/**
 * A temporary password for a newly registered member.
 *
 * REQ-43 reserves registration to the Secretary or the Chairperson, so there is
 * no self-service sign-up and somebody has to hand the new member a credential.
 * That credential will be read aloud across a table at a meeting, or sent in a
 * text message, or written on the back of a receipt. It therefore has to
 * survive being spoken and retyped.
 *
 * So: three short words and two digits, e.g. "river-maple-stone-47".
 *
 * There are no characters that are ambiguous when spoken or read (no l/1/I, no
 * o/0/O), no case to get wrong, and no punctuation to describe. The words are
 * common English nouns, avoiding anything that could be read as commentary on
 * the person receiving it.
 *
 * Entropy: 64^3 x 90 is roughly 2^24.5. That is weak for a permanent password
 * and entirely adequate for one that exists to get somebody through the door
 * once, on an account with a five-attempt lockout (REQ-6).
 */

const crypto = require("crypto");

const WORDS = [
    "river", "maple", "stone", "amber", "cedar", "delta", "ember", "frost",
    "grove", "haven", "ivory", "jade", "kite", "lemon", "marsh", "north",
    "ocean", "pearl", "quartz", "ridge", "sable", "thorn", "umber", "vine",
    "wheat", "yarn", "zebra", "anchor", "bramble", "cactus", "dune", "elm",
    "fern", "granite", "heron", "indigo", "juniper", "kestrel", "linen", "meadow",
    "nectar", "opal", "pebble", "quiver", "reed", "spruce", "tundra", "urchin",
    "velvet", "willow", "yonder", "zephyr", "basalt", "coral", "dusk", "flint",
    "gable", "hazel", "iris", "jasper", "kelp", "larch", "mesa", "nutmeg"
];

/** A uniformly random element, without modulo bias. */
function pick(array) {
    const limit = Math.floor(256 / array.length) * array.length;
    let byte;
    do {
        byte = crypto.randomBytes(1)[0];
    } while (byte >= limit);
    return array[byte % array.length];
}

function temporaryPassword() {
    const words = [pick(WORDS), pick(WORDS), pick(WORDS)];
    const digits = 10 + crypto.randomBytes(1)[0] % 90; // 10..99
    return `${words.join("-")}-${digits}`;
}

module.exports = { temporaryPassword };