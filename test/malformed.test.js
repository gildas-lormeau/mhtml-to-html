// Archives that break the rules. None of these may crash: either the file is recovered, or it is
// rejected with the one error the library is allowed to raise.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, convert } from "./helpers/lib.js";
import { concatBytes } from "./helpers/mhtml.js";

const LOCATION = "https://example.invalid/a";
const DOCUMENT = "<html><body><p>RECOVERED</p></body></html>";

const document = (boundary, location = LOCATION) =>
    `--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n` +
    `Content-Location: ${location}\r\n\r\n${DOCUMENT}\r\n`;

const build = (declared, used = declared, { closing = true } = {}) => concatBytes(
    `MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="${declared}"\r\n\r\n`,
    document(used),
    closing ? `--${used}--\r\n` : ""
);

test("a boundary that is not the one the body uses is recovered", async () => {
    // a writer can rewrite the parts without updating the header it already emitted
    const { data } = await convert(build("----=_DECLARED", "----=_ACTUAL"));
    assert.ok(data.includes("RECOVERED"), "the document was lost");
});

// When the delimiters a multipart document promised never turn up, what follows the top-level
// headers is all there is. The container type says nothing about it, so the body speaks for itself:
// it is either the headers of the one part left, or its content already.
const noBoundary = body => concatBytes(
    "MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary=\"----=_NEVER\"\r\n\r\n", body);

test("a declared boundary that appears nowhere leaves a body that is read on its own", async () => {
    const { data } = await convert(noBoundary(
        `Content-Type: text/html\r\nContent-Location: ${LOCATION}\r\n\r\n${DOCUMENT}\r\n`));
    assert.ok(data.includes("RECOVERED"), "the part left behind was lost");
});

test("a body that is markup with no headers at all is read as the document", async () => {
    const { data } = await convert(noBoundary(DOCUMENT));
    assert.ok(data.includes("RECOVERED"));
});

test("a folded header in the body left behind is still understood", async () => {
    const { data } = await convert(noBoundary(
        `Content-Type: text/html;\r\n\tcharset="utf-8"\r\nContent-Location: ${LOCATION}\r\n\r\n${DOCUMENT}\r\n`));
    assert.ok(data.includes("RECOVERED"));
});

test("a body left behind that is not a document is still presented", async () => {
    const { data } = await convert(noBoundary(
        "Content-Type: image/png\r\nContent-Transfer-Encoding: base64\r\n\r\niVBORw0KGgo=\r\n"));
    assert.ok(data.includes("<img src=\"data:image/png;base64,iVBORw0KGgo=\">"));
});

test("a body that is neither markup nor headers is still reported", async () => {
    await assert.rejects(() => convert(noBoundary(concatBytes([0x00, 0x01, 0x02], " rubbish\r\n"))),
        /Index page not found/);
});

test("a single-part archive still takes its type from the top-level headers", async () => {
    // no boundary is declared at all here, and the headers do describe the body
    const { data } = await convert(concatBytes(
        `MIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\nContent-Location: ${LOCATION}\r\n\r\n`,
        DOCUMENT));
    assert.ok(data.includes("RECOVERED"));
});

test("an empty boundary parameter still gives up its document", async () => {
    // nothing can be recognized as a delimiter, so the closing one is left behind as text; that is
    // a blemish on a file no writer should have produced, and better than losing it altogether
    const raw = concatBytes(
        "MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary=\"\"\r\n\r\n",
        `--\r\nContent-Type: text/html\r\nContent-Location: ${LOCATION}\r\n\r\n${DOCUMENT}\r\n----\r\n`);
    const { data } = await convert(raw);
    assert.ok(data.includes("RECOVERED"), "the document was lost");
});

test("a boundary made of regular expression characters is matched literally", async () => {
    const { data } = await convert(build("a.*b[c]+d"));
    assert.ok(data.includes("RECOVERED"));
});

test("a boundary at the maximum length is handled", async () => {
    const { data } = await convert(build("a".repeat(70)));
    assert.ok(data.includes("RECOVERED"));
});

test("a file cut off in the middle of a part keeps what it had", async () => {
    const raw = concatBytes(
        "MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary=\"----=_B\"\r\n\r\n",
        "------=_B\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n",
        `Content-Location: ${LOCATION}\r\n\r\n<html><body><p>TRUNCATED`);
    const { data } = await convert(raw);
    assert.ok(data.includes("TRUNCATED"), "the truncated document was discarded");
});

// An archive does not have to hold a page. A browser saves a standalone image or text file the same
// way and presents it as a document built around that one resource, and a .mht file is not always an
// archive at all — Word writes plain HTML under the same extension.
const PNG = "iVBORw0KGgo=";

const singlePart = (contentType, body, transferEncoding = "8bit") => concatBytes(
    "MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary=\"----=_B\"\r\n\r\n",
    `------=_B\r\nContent-Type: ${contentType}\r\nContent-Transfer-Encoding: ${transferEncoding}\r\n`,
    `Content-Location: https://e/thing\r\n\r\n${body}\r\n------=_B--\r\n`);

test("an archive holding only an image becomes a page showing it", async () => {
    const { data } = await convert(singlePart("image/png", PNG, "base64"));
    assert.ok(data.includes(`<img src="data:image/png;base64,${PNG}">`), "the image was not presented");
});

test("an archive holding only plain text becomes a page showing it", async () => {
    const { data } = await convert(singlePart("text/plain", "Hello World"));
    assert.ok(data.includes("<pre>Hello World</pre>"), "the text was not presented");
});

test("text that looks like markup is shown, not interpreted", async () => {
    const { data } = await convert(singlePart("text/plain", "a <b>&amp; c"));
    assert.ok(data.includes("&lt;b&gt;"), "a tag in the text was left to be parsed");
    assert.ok(!data.includes("<b>"), "the text was interpreted as markup");
});

test("an archive holding nothing presentable is still rejected", async () => {
    await assert.rejects(() => convert(singlePart("application/octet-stream", "AQID")), /Index page not found/);
});

test("a real document is preferred over anything built around a resource", async () => {
    const raw = concatBytes(
        "MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary=\"----=_B\"\r\n\r\n",
        "------=_B\r\nContent-Type: image/png\r\nContent-Transfer-Encoding: base64\r\n",
        `Content-Location: https://e/i.png\r\n\r\n${PNG}\r\n`,
        "------=_B\r\nContent-Type: text/html\r\nContent-Transfer-Encoding: 8bit\r\n",
        `Content-Location: https://e/\r\n\r\n${DOCUMENT}\r\n------=_B--\r\n`);
    const { data } = await convert(raw);
    assert.ok(data.includes("RECOVERED"), "the page was passed over for the image");
});

test("a file that is plain HTML rather than an archive is converted as a document", async () => {
    const { data } = await convert(concatBytes(
        "<html xmlns:o=\"urn:schemas-microsoft-com:office:office\"><head>\r\n",
        "<meta http-equiv=\"Content-Type\" content=\"text/html; charset=windows-1252\">\r\n",
        "<title>PLAIN</title></head><body><p>RECOVERED</p></body></html>\r\n"));
    assert.ok(data.includes("RECOVERED"), "the document was lost");
    assert.doesNotMatch(data, /charset=windows-1252/i, "a stale charset declaration was left behind");
});

test("a plain HTML file is reported with its title", async () => {
    const { title } = await convert(concatBytes("<html><head><title>PLAIN</title></head><body>x</body></html>"));
    assert.equal(title, "PLAIN");
});

test("leading whitespace does not hide a plain HTML file", async () => {
    const { data } = await convert(concatBytes("\r\n  \r\n<html><body><p>RECOVERED</p></body></html>"));
    assert.ok(data.includes("RECOVERED"));
});

test("a file that is neither markup nor an archive is still reported", async () => {
    // an AppleDouble sidecar, which macOS leaves next to a file copied off its own filesystem
    await assert.rejects(() => convert(concatBytes([0x00, 0x05, 0x16, 0x07, 0x00, 0x02, 0x00, 0x00],
        "Mac OS X        ", [0x00, 0x02, 0x00, 0x00])), /Index page not found/);
});

test("a part with no headers at all is still given an id", () => {
    const raw = concatBytes(
        "MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary=\"----=_B\"\r\n\r\n",
        "------=_B\r\nContent-Type: text/html\r\nContent-Location: " + LOCATION + "\r\n\r\n" + DOCUMENT + "\r\n",
        "------=_B\r\n\r\nno headers here\r\n------=_B--\r\n");
    const { resources } = parse(raw);
    assert.equal(Object.keys(resources).length, 2, "the headerless part was lost");
});

test("two parts sharing a Content-ID resolve consistently", async () => {
    // frames are keyed by Content-ID and resources by location: both must pick the same part, and
    // whichever it is has to stay the same from one run to the next
    const raw = concatBytes(
        "MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary=\"----=_B\"\r\n\r\n",
        "------=_B\r\nContent-Type: text/html\r\nContent-Location: https://e/index\r\n\r\n",
        "<html><body><iframe src=\"cid:dup\"></iframe></body></html>\r\n",
        "------=_B\r\nContent-Type: text/html\r\nContent-ID: <dup>\r\nContent-Location: https://e/one\r\n\r\n",
        "<html><body>FIRST</body></html>\r\n",
        "------=_B\r\nContent-Type: text/html\r\nContent-ID: <dup>\r\nContent-Location: https://e/two\r\n\r\n",
        "<html><body>SECOND</body></html>\r\n------=_B--\r\n");
    const first = (await convert(parse(raw))).data;
    const second = (await convert(parse(raw))).data;
    assert.equal(first, second, "the same archive converted differently twice");
    assert.equal(first.includes("FIRST") || first.includes("SECOND"), true, "neither part was used");
});

test("a part addressed both by cid: and by location is reachable either way", async () => {
    const raw = concatBytes(
        "MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary=\"----=_B\"\r\n\r\n",
        "------=_B\r\nContent-Type: text/html\r\nContent-Location: https://e/index\r\n\r\n",
        "<html><body><img src=\"https://e/p.png\"><iframe src=\"cid:both\"></iframe></body></html>\r\n",
        "------=_B\r\nContent-Type: image/png\r\nContent-Transfer-Encoding: base64\r\n",
        "Content-ID: <both>\r\nContent-Location: https://e/p.png\r\n\r\niVBORw0KGgo=\r\n------=_B--\r\n");
    const { data } = await convert(raw);
    assert.equal(data.split("data:image/png;base64,iVBORw0KGgo=").length - 1, 2,
        "the part was not reached by both of its addresses");
});
