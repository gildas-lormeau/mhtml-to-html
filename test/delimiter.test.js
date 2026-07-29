// Which lines count as a boundary delimiter. Being too strict drops parts; being too lax truncates
// a part as soon as its content happens to mention the boundary.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "./helpers/lib.js";
import { concatBytes, decodeResourceData } from "./helpers/mhtml.js";

const BOUNDARY = "----=_P";
const resourcesOf = raw => parse(concatBytes(raw)).resources;

const header = (boundary, eol = "\r\n") =>
    `MIME-Version: 1.0${eol}Content-Type: multipart/related; boundary="${boundary}"${eol}${eol}`;
const part = (boundary, location, body, eol = "\r\n") =>
    `--${boundary}${eol}Content-Type: application/octet-stream${eol}Content-Transfer-Encoding: 8bit${eol}` +
    `Content-Location: ${location}${eol}${eol}${body}${eol}`;
const document = (boundary, parts, closing = `--${boundary}--\r\n`, eol = "\r\n") =>
    header(boundary, eol) + parts.join("") + closing;

function bodyOf(resources, location) {
    const resource = resources[location];
    assert.notEqual(resource, undefined, `the part ${location} was not found`);
    return decodeResourceData(resource);
}

test("a delimiter followed by transport padding is recognized", () => {
    // RFC 2046 allows trailing whitespace ("transport padding") after a delimiter
    const resources = resourcesOf(header(BOUNDARY) +
        `--${BOUNDARY}  \t\r\nContent-Type: application/octet-stream\r\nContent-Transfer-Encoding: 8bit\r\n` +
        `Content-Location: https://e/a\r\n\r\nA\r\n--${BOUNDARY}--  \r\n`);
    assert.equal(bodyOf(resources, "https://e/a"), "A");
});

test("an inner boundary extending the outer one does not truncate the outer part", () => {
    const outer = "----=_A";
    const inner = "----=_A_1";
    const resources = resourcesOf(document(outer, [
        part(outer, "https://e/first", "FIRST"),
        `--${outer}\r\nContent-Type: multipart/alternative; boundary="${inner}"\r\n\r\n` +
        part(inner, "https://e/inner", "INNER") + `--${inner}--\r\n`,
        part(outer, "https://e/last", "LAST")
    ]));
    assert.equal(bodyOf(resources, "https://e/first"), "FIRST");
    assert.equal(bodyOf(resources, "https://e/last"), "LAST", "parts after a nested multipart are lost");
});

test("content containing --boundary<suffix> is kept intact", () => {
    const body = `X\r\n--${BOUNDARY}suffix\r\nY`;
    const resources = resourcesOf(document(BOUNDARY, [part(BOUNDARY, "https://e/a", body)]));
    assert.equal(bodyOf(resources, "https://e/a"), body);
});

test("the boundary appearing mid-line is content, not a delimiter", () => {
    const body = `X --${BOUNDARY} Y`;
    const resources = resourcesOf(document(BOUNDARY, [part(BOUNDARY, "https://e/a", body)]));
    assert.equal(bodyOf(resources, "https://e/a"), body);
});

test("a short boundary does not match longer look-alike lines", () => {
    const body = "----AB\r\n---A\r\nZ";
    const resources = resourcesOf(document("--A", [part("--A", "https://e/a", body)]));
    assert.equal(bodyOf(resources, "https://e/a"), body);
});

test("LF-only delimiters are recognized", () => {
    const resources = resourcesOf(document(BOUNDARY, [part(BOUNDARY, "https://e/a", "A", "\n")], `--${BOUNDARY}--\n`, "\n"));
    assert.equal(bodyOf(resources, "https://e/a"), "A");
});

test("every part of a plain multipart document is found", () => {
    const resources = resourcesOf(document(BOUNDARY, [
        part(BOUNDARY, "https://e/a", "A"),
        part(BOUNDARY, "https://e/b", "B"),
        part(BOUNDARY, "https://e/c", "C")
    ]));
    assert.deepEqual(["a", "b", "c"].map(name => bodyOf(resources, `https://e/${name}`)), ["A", "B", "C"]);
});

test("a delimiter glued to the content without a line break still splits the parts", () => {
    // WebKit writes the delimiter immediately after the markup, with nothing in between
    const resources = resourcesOf(header(BOUNDARY) +
        `--${BOUNDARY}\r\nContent-Type: application/octet-stream\r\nContent-Transfer-Encoding: 8bit\r\n` +
        `Content-Location: https://e/a\r\n\r\n<p>A</p>--${BOUNDARY}\r\n` +
        `Content-Type: application/octet-stream\r\nContent-Transfer-Encoding: 8bit\r\n` +
        `Content-Location: https://e/b\r\n\r\n<p>B</p>--${BOUNDARY}--\r\n`);
    assert.equal(bodyOf(resources, "https://e/a"), "<p>A</p>");
    assert.equal(bodyOf(resources, "https://e/b"), "<p>B</p>");
});

const lastPartHeader = header(BOUNDARY) +
    `--${BOUNDARY}\r\nContent-Type: application/octet-stream\r\nContent-Transfer-Encoding: 8bit\r\n` +
    `Content-Location: https://e/a\r\n\r\n`;

const endings = [
    { name: "a closing delimiter on its own line", raw: `LAST\r\n--${BOUNDARY}--\r\n` },
    { name: "a closing delimiter with no trailing line break", raw: `LAST\r\n--${BOUNDARY}--` },
    { name: "no closing delimiter at all", raw: "LAST\r\n" },
    { name: "no closing delimiter and no trailing line break", raw: "LAST" }
];

for (const { name, raw } of endings) {
    test(`the last part is parsed with ${name}`, () => {
        assert.equal(bodyOf(resourcesOf(lastPartHeader + raw), "https://e/a"), "LAST");
    });
}
