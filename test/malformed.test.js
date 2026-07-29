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

test("a declared boundary that appears nowhere is reported, not crashed on", async () => {
    const raw = concatBytes(
        "MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary=\"----=_NEVER\"\r\n\r\n",
        `Content-Type: text/html\r\nContent-Location: ${LOCATION}\r\n\r\n${DOCUMENT}\r\n`);
    await assert.rejects(() => convert(raw), /Index page not found/);
});

test("an empty boundary parameter is reported, not crashed on", async () => {
    const raw = concatBytes(
        "MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary=\"\"\r\n\r\n",
        `--\r\nContent-Type: text/html\r\nContent-Location: ${LOCATION}\r\n\r\n${DOCUMENT}\r\n----\r\n`);
    await assert.rejects(() => convert(raw), /Index page not found/);
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
