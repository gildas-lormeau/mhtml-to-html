// Runs the converter over whatever real files sit in test/files. Those files are not distributed
// with the repository, so nothing here may depend on their content: the checks are either
// invariants true of any MHTML document, or a comparison against a baseline generated locally.
//
// The baseline lives in test/snapshots.json (ignored by git). It is written on the first run and
// compared afterwards; run with UPDATE_SNAPSHOTS=1 to accept a change.
//
// The whole file skips when test/files is missing or empty, so a fresh clone stays green.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "node:process";
import { parse, convert } from "./helpers/lib.js";

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const FILES_DIRECTORY = join(TEST_DIRECTORY, "files");
// Node.js and Deno serialize the DOM differently, so each keeps its own baseline
const SNAPSHOT_PATH = join(TEST_DIRECTORY, globalThis.Deno ? "snapshots.deno.json" : "snapshots.json");
const MHTML_EXTENSION = /\.mht(ml)?$/i;
// a file that is not MHTML at all must fail in a way the library recognizes, never with a crash
const EXPECTED_ERRORS = ["Index page not found"];
const INTERNAL_URL_MARKER = "--mhtml-to-html-url";
const UNDEFINED_RESOURCE = `base64,${btoa("undefined")}`;
const META_CONTENT_TYPE = /<meta[^>]+http-equiv=["']?content-type["']?[^>]*>/gi;
const SAMPLE_SIZE = 5;

const updating = env.UPDATE_SNAPSHOTS === "1";
const fileNames = existsSync(FILES_DIRECTORY) ? listArchives(FILES_DIRECTORY) : [];

// the corpus may be organized in sub-directories, one per producer for instance. A file is known by
// its path relative to test/files, so the baseline and the test names say where it came from.
function listArchives(directory, prefix = "") {
    const names = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            names.push(...listArchives(join(directory, entry.name), `${prefix}${entry.name}/`));
        } else if (MHTML_EXTENSION.test(entry.name)) {
            names.push(prefix + entry.name);
        }
    }
    return names.sort();
}

if (!fileNames.length) {
    test("the corpus is checked when test/files contains MHTML documents", { skip: "test/files is empty" }, () => { });
} else {
    const baseline = existsSync(SNAPSHOT_PATH) ? JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) : undefined;
    const recorded = {};

    for (const [index, name] of fileNames.entries()) {
        test(name, async () => {
            const bytes = new Uint8Array(readFileSync(join(FILES_DIRECTORY, name)));
            let result;
            try {
                result = await convert(parse(bytes));
            } catch (error) {
                assert.ok(EXPECTED_ERRORS.includes(error.message),
                    `failed with an unrecognized error: ${error.message}`);
                recorded[name] = { error: error.message };
                compareWithBaseline(name, recorded[name]);
                return;
            }
            assertInvariants(name, result);
            recorded[name] = {
                hash: await hash(result.data),
                length: result.data.length,
                resources: Object.keys(parse(bytes).resources).length
            };
            compareWithBaseline(name, recorded[name]);
            // repeating the work is expensive, so only a sample checks it
            if (index < SAMPLE_SIZE) {
                const again = await convert(parse(bytes));
                assert.equal(again.data, result.data, "converting the same file twice gave different output");
                const fromString = await convert(parse(new TextDecoder().decode(bytes)));
                assert.equal(fromString.data.length > 0, true);
            }
        });
    }

    test("the baseline is written", () => {
        if (baseline === undefined || updating) {
            writeFileSync(SNAPSHOT_PATH, JSON.stringify(recorded, null, 1));
        }
        const missing = baseline === undefined || updating
            ? []
            : Object.keys(baseline).filter(name => !(name in recorded));
        assert.deepEqual(missing, [], "the baseline refers to files that are no longer present; " +
            "run again with UPDATE_SNAPSHOTS=1 to accept");
    });

    function compareWithBaseline(name, entry) {
        const previous = baseline && baseline[name];
        if (previous === undefined || updating) {
            return;
        }
        assert.deepEqual(entry, previous,
            "the output changed since the baseline was recorded; run with UPDATE_SNAPSHOTS=1 to accept");
    }
}

function assertInvariants(name, { data, title, favicons }) {
    assert.equal(typeof data, "string", `${name}: no HTML was produced`);
    assert.ok(data.length > 0, `${name}: the output is empty`);
    assert.match(data, /<html/i, `${name}: the output has no html element`);
    assert.ok(!data.includes(INTERNAL_URL_MARKER), `${name}: an internal url() marker leaked into the output`);
    assert.ok(!data.includes(UNDEFINED_RESOURCE), `${name}: a resource was inlined as the string "undefined"`);
    for (const element of data.match(META_CONTENT_TYPE) || []) {
        const charset = (element.match(/charset\s*=\s*["']?([\w-]+)/i) || [])[1];
        assert.ok(charset === undefined || charset.toLowerCase() === "utf-8",
            `${name}: a stale ${charset} declaration survived in ${element}`);
    }
    assert.ok(title === undefined || typeof title === "string", `${name}: title is not a string`);
    assert.ok(favicons === undefined || Array.isArray(favicons), `${name}: favicons is not an array`);
}

async function hash(value) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
