// Archives that break the rules. None of these may crash: either the file is recovered, or it is
// rejected with the one error the library is allowed to raise.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, convert } from "./helpers/lib.js";
import { concatBytes, encodeBase64, encodeSingleByteCharset } from "./helpers/mhtml.js";

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

// An archive can end on the blank line that closes a part's headers, leaving that part with no body
// at all — a file truncated exactly there, which is how MimeOLE's own test fixture is shaped. The
// line terminator matters: a bare LF makes that last line one byte long, and a parser that stops a
// byte short of the end drops the part, and with it the page. These use LF throughout, as the
// writers that produce this shape do.
test("a file that ends on the blank line closing a part's headers keeps the part", async () => {
    const raw = concatBytes(
        "MIME-Version: 1.0\nContent-Type: multipart/related; boundary=\"----=_B\"\n\n",
        `------=_B\nContent-Type: text/html\nContent-Location: ${LOCATION}\n\n`);
    assert.equal(Object.keys(parse(raw).resources).length, 1, "the part was dropped");
    assert.match((await convert(raw)).data, /<html/i, "no document was produced");
});

test("a nested multipart is read even when the file stops right after its headers", async () => {
    // multipart/alternative inside multipart/related, as MimeOLE writes it, cut off where the
    // innermost body would have started
    const raw = concatBytes(
        "MIME-Version: 1.0\nContent-Type: multipart/related;\n\tboundary=\"----=_OUTER\"\n\n",
        "------=_OUTER\nContent-Type: multipart/alternative;\n\tboundary=\"----=_INNER\"\n\n",
        "------=_INNER\nContent-Type: text/html;\n\tcharset=\"x-user-defined\"\n",
        "Content-Transfer-Encoding: quoted-printable\n\n");
    assert.match((await convert(raw)).data, /<html/i, "the innermost part was lost");
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

test("plain text carried as base64 is decoded before being shown", async () => {
    // only documents and stylesheets are decoded at parse time; the base64 used to reach the page
    const { data } = await convert(singlePart("text/plain", encodeBase64("Hello World"), "base64"));
    assert.ok(data.includes("<pre>Hello World</pre>"), "the base64 was shown instead of the text");
});

test("base64 plain text declaring a charset is decoded with it", async () => {
    const { data } = await convert(singlePart("text/plain; charset=windows-1251",
        encodeBase64(encodeSingleByteCharset("Привет", "windows-1251")), "base64"));
    assert.ok(data.includes("<pre>Привет</pre>"), "the text was not decoded with its charset");
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

test("a byte order mark does not hide a plain HTML file", async () => {
    // the mark says only how the text is encoded; it used to make the markup pass for an archive
    const { data } = await convert(concatBytes([0xEF, 0xBB, 0xBF],
        "<html><body><p>RECOVERED</p></body></html>"));
    assert.ok(data.includes("RECOVERED"), "the document was lost behind its byte order mark");
});

for (const [name, littleEndian] of [["little-endian", true], ["big-endian", false]]) {
    test(`a ${name} UTF-16 plain HTML file is recognized and decoded by its byte order mark`, async () => {
        const text = "<html><body><p>RECOVERED</p></body></html>";
        const bytes = new Uint8Array(text.length * 2 + 2);
        const view = new DataView(bytes.buffer);
        view.setUint16(0, 0xFEFF, littleEndian);
        for (let index = 0; index < text.length; index++) {
            view.setUint16(index * 2 + 2, text.charCodeAt(index), littleEndian);
        }
        const { data } = await convert(bytes);
        assert.ok(data.includes("RECOVERED"), "the document was lost behind its byte order mark");
    });
}

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
