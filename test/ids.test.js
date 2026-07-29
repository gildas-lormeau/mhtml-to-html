// A part with no Content-Location and no Content-ID gets a generated id. Those ids end up in the
// output, so they must be stable: the same input has to convert to the same bytes every time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "./helpers/lib.js";
import { concatBytes, encodeUtf8 } from "./helpers/mhtml.js";

const BOUNDARY = "----=_B";
const part = (headers, body) => [`--${BOUNDARY}`, ...headers, "", body].join("\r\n");
const build = parts => ["MIME-Version: 1.0", `Content-Type: multipart/related; boundary="${BOUNDARY}"`, "",
    ...parts, `--${BOUNDARY}--`, ""].join("\r\n");
const document = body => part(["Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: 8bit"], body);
const image = body => part(["Content-Type: image/png", "Content-Transfer-Encoding: 8bit"], body);
const idsOf = raw => Object.keys(parse(concatBytes(raw)).resources);

test("anonymous parts get sequential ids", () => {
    const raw = build([document("<html><body>a</body></html>"), image("P1"), image("P2")]);
    assert.deepEqual(idsOf(raw), ["_0", "_1", "_2"]);
});

test("repeated parses of the same input give identical ids", () => {
    const raw = build([document("<html><body>a</body></html>"), image("P")]);
    const runs = Array.from({ length: 5 }, () => idsOf(raw).join(","));
    assert.equal(new Set(runs).size, 1, `ids varied between runs: ${runs.join(" | ")}`);
});

test("a generated id never collides with a real Content-Location", () => {
    const raw = build([
        part(["Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: 8bit", "Content-Location: _0"],
            "<html><body>a</body></html>"),
        image("P")
    ]);
    const ids = idsOf(raw);
    assert.equal(ids.length, 2);
    assert.equal(new Set(ids).size, 2, `duplicate ids: ${ids.join(", ")}`);
    assert.ok(ids.includes("_0"), "the declared Content-Location was overwritten");
    assert.ok(!ids.includes(undefined));
});

test("many anonymous parts all stay unique", () => {
    const raw = build([document("<html><body>a</body></html>"), ...Array.from({ length: 50 }, (_, index) => image(`P${index}`))]);
    const ids = idsOf(raw);
    assert.equal(ids.length, 51);
    assert.equal(new Set(ids).size, 51);
});

test("string and Uint8Array input give the same ids", () => {
    const raw = build([document("<html><body>a</body></html>"), image("P")]);
    assert.deepEqual(Object.keys(parse(raw).resources), Object.keys(parse(encodeUtf8(raw)).resources));
});
