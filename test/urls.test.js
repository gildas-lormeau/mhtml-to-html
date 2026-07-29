// How a reference in the document is matched against a part of the archive. A Content-Location is
// written by hand and a reference is resolved with the URL parser, so the two only meet if the
// archive stores addresses the same way references will be resolved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, convert } from "./helpers/lib.js";
import { encodeUtf8 } from "./helpers/mhtml.js";

const BOUNDARY = "----=_B";
const DOCUMENT_LOCATION = "https://e/dir/page.html";
const PNG = "iVBORw0KGgo=";
const PNG_URI = `data:image/png;base64,${PNG}`;

// Everything is encoded as UTF-8, so a header can carry a non-ASCII address the way a writer emits it.
function build({ reference, location, contentId, documentLocation = DOCUMENT_LOCATION, parts = [] }) {
    const image = [
        `--${BOUNDARY}`, "Content-Type: image/png", "Content-Transfer-Encoding: base64",
        ...(location === undefined ? [] : [`Content-Location: ${location}`]),
        ...(contentId === undefined ? [] : [`Content-ID: ${contentId}`]), "", PNG
    ].join("\r\n");
    return encodeUtf8([
        "MIME-Version: 1.0", `Content-Type: multipart/related; boundary="${BOUNDARY}"`, "",
        `--${BOUNDARY}`, "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: 8bit",
        `Content-Location: ${documentLocation}`, "",
        `<html><body><img src="${reference}"></body></html>`,
        image, ...parts, `--${BOUNDARY}--`, ""
    ].join("\r\n"));
}

const matches = async options => (await convert(build(options))).data.includes(PNG_URI);

const MATCHING = [
    ["a plain relative reference", "i.png", "https://e/dir/i.png"],
    ["a relative Content-Location", "i.png", "i.png"],
    ["dot segments in the Content-Location", "i.png", "https://e/dir/sub/../i.png"],
    ["dot segments in the reference", "sub/../i.png", "https://e/dir/i.png"],
    ["an explicit default port", "i.png", "https://e:443/dir/i.png"],
    ["an upper case host", "i.png", "https://E/dir/i.png"],
    ["a space encoded on both sides", "my%20image.png", "https://e/dir/my%20image.png"],
    ["a space written raw in the Content-Location", "my%20image.png", "https://e/dir/my image.png"],
    ["a space written raw on both sides", "my image.png", "https://e/dir/my image.png"],
    ["a non-ASCII address written raw on both sides", "café.png", "https://e/dir/café.png"],
    ["a non-ASCII address encoded in the reference only", "caf%C3%A9.png", "https://e/dir/café.png"],
    ["Cyrillic encoded in the reference only", "%D1%84.png", "https://e/dir/ф.png"],
    ["the same query on both sides", "i.png?v=2", "https://e/dir/i.png?v=2"]
];

for (const [name, reference, location] of MATCHING) {
    test(`a reference is matched through ${name}`, async () => {
        assert.equal(await matches({ reference, location }), true, `${reference} did not find ${location}`);
    });
}

const NOT_MATCHING = [
    // a fragment selects a place inside a resource: an SVG sprite is addressed as sprite.svg#icon
    // once per icon, and matching it would inline the whole sheet every time and lose the fragment
    ["a fragment the part does not carry", "i.png#icon", "https://e/dir/i.png"],
    // a query is part of the address: nothing says the two answer with the same bytes
    ["a query the part does not carry", "i.png?v=2", "https://e/dir/i.png"],
    // percent escapes are case insensitive in RFC 3986, but the URL parser does not normalize them
    ["escapes differing only in case", "a%2Fb.png", "https://e/dir/a%2fb.png"]
];

for (const [name, reference, location] of NOT_MATCHING) {
    test(`a reference is deliberately not matched through ${name}`, async () => {
        assert.equal(await matches({ reference, location }), false, "behaviour changed for " + reference);
    });
}

test("a cid: reference outside a frame finds the part by its Content-ID", async () => {
    assert.equal(await matches({ reference: "cid:x@y", contentId: "<x@y>" }), true);
});

test("a cid: reference inside a stylesheet finds the part too", async () => {
    const raw = encodeUtf8([
        "MIME-Version: 1.0", `Content-Type: multipart/related; boundary="${BOUNDARY}"`, "",
        `--${BOUNDARY}`, "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: 8bit",
        `Content-Location: ${DOCUMENT_LOCATION}`, "",
        "<html><head><style>p{background:url(cid:x@y)}</style></head><body><p>x</p></body></html>",
        `--${BOUNDARY}`, "Content-Type: image/png", "Content-Transfer-Encoding: base64",
        "Content-ID: <x@y>", "", PNG, `--${BOUNDARY}--`, ""
    ].join("\r\n"));
    assert.ok((await convert(raw)).data.includes(PNG_URI), "the stylesheet reference was not resolved");
});

test("a Content-Location is what identifies a part, even when it also has a Content-ID", async () => {
    const { resources } = parse(build({ reference: "i.png", location: "https://e/dir/i.png", contentId: "<x@y>" }));
    assert.ok(resources["https://e/dir/i.png"], "the part is not keyed by its location");
    assert.ok(resources["<x@y>"], "the part is not reachable by its Content-ID");
    assert.equal(resources["https://e/dir/i.png"], resources["<x@y>"], "the two addresses gave different parts");
    assert.equal(resources["https://e/dir/i.png"].id, "https://e/dir/i.png", "the location is not the identity");
});

test("an address is stored the way a reference to it resolves", () => {
    const { resources } = parse(build({ reference: "i.png", location: "https://E:443/dir/sub/../i.png" }));
    assert.ok(resources["https://e/dir/i.png"], "the address was not normalized");
    assert.ok(resources["https://E:443/dir/sub/../i.png"], "the address as written is no longer reachable");
});

test("of two parts sharing an address, the first one wins", async () => {
    const raw = encodeUtf8([
        "MIME-Version: 1.0", `Content-Type: multipart/related; boundary="${BOUNDARY}"`, "",
        `--${BOUNDARY}`, "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: 8bit",
        `Content-Location: ${DOCUMENT_LOCATION}`, "", "<html><body><img src=\"i.png\"></body></html>",
        `--${BOUNDARY}`, "Content-Type: text/plain", "Content-Transfer-Encoding: 8bit",
        "Content-Location: https://e/dir/i.png", "", "FIRST",
        `--${BOUNDARY}`, "Content-Type: text/plain", "Content-Transfer-Encoding: 8bit",
        "Content-Location: https://e/dir/i.png", "", "SECOND", `--${BOUNDARY}--`, ""
    ].join("\r\n"));
    const { resources } = parse(raw);
    assert.equal(resources["https://e/dir/i.png"].data, "FIRST");
    assert.ok((await convert(raw)).data.includes(btoa("FIRST")), "the second part was inlined instead");
});
