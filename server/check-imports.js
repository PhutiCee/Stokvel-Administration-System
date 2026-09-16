"use strict";

/**
 * Checks that every relative require() in server/src actually resolves.
 *
 *     node server/check-imports.js
 *
 * A wrong relative path only shows up when Node reaches that line, so a broken
 * require in a module that loads late can sit unnoticed until a particular
 * route is called. This walks every file and resolves every path up front.
 *
 * The usual mistake: a file in modules/<name>/ needs "../../" to reach anything
 * in src/, because it has to climb out of its own folder AND out of modules/.
 * A file directly in middleware/, rules/ or db/ needs a single "../".
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "src");
const REQUIRE = /require\(\s*["'](\.[^"']+)["']\s*\)/g;

function walk(dir, files = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, files);
        else if (entry.name.endsWith(".js")) files.push(full);
    }
    return files;
}

function resolves(fromFile, spec) {
    const base = path.resolve(path.dirname(fromFile), spec);
    return [base, `${base}.js`, `${base}.json`, path.join(base, "index.js")]
        .some((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

/** How many "../" a file at this depth needs to reach src/. */
function suggest(fromFile, spec) {
    const target = spec.replace(/^(\.\.\/)+/, "");
    const depth = path.relative(ROOT, path.dirname(fromFile)).split(path.sep).filter(Boolean).length;
    const correct = "../".repeat(depth) + target;
    return resolves(fromFile, correct) ? correct : null;
}

if (!fs.existsSync(ROOT)) {
    console.error(`\n  No src directory at ${ROOT}.`);
    console.error("  Run this from the repository root: node server/check-imports.js\n");
    process.exit(1);
}

const files = walk(ROOT);
let broken = 0;
let checked = 0;

for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const rel = path.relative(process.cwd(), file);

    for (const match of source.matchAll(REQUIRE)) {
        const spec = match[1];
        checked += 1;
        if (resolves(file, spec)) continue;

        broken += 1;
        const line = source.slice(0, match.index).split("\n").length;
        console.error(`\n  BROKEN  ${rel}:${line}`);
        console.error(`          require("${spec}")`);

        const fix = suggest(file, spec);
        if (fix) console.error(`          should be "${fix}"`);
        else console.error(`          target does not exist anywhere — is the file missing?`);
    }
}

console.log(`\n  ${checked} relative imports checked across ${files.length} files.`);
if (broken === 0) {
    console.log("  All resolve.\n");
} else {
    console.error(`  ${broken} broken.\n`);
    process.exit(1);
}