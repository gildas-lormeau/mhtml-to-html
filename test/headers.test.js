// RFC 5322 headers must be ASCII, but a localized writer emits raw bytes anyway — IE writes its
// "Saved by ..." marker in the system codepage. Those headers must be decoded with the charset of
// the document, not as UTF-8.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, convert } from "./helpers/lib.js";
import { concatBytes, encodeBase64, encodeQuotedPrintable, encodeSingleByteCharset, encodeUtf8 } from "./helpers/mhtml.js";

const BOUNDARY = "----=_NextPart_000_0000_01C654E0.7F0AD5A0";
const LOCATION = "http://example.invalid/p.htm";
const CHARSETS = ["koi8-r", "windows-1251"];
const SAVED = "Сохранено";
const TITLE = "Архитектура";
const REPLACEMENT_CHARACTER = "�";

const ENCODINGS = { "8bit": data => data, "quoted-printable": encodeQuotedPrintable, "base64": encodeBase64 };

function build({ charset, declaredIn = "the part", encoding = "8bit", asciiFrom = false, folded = false }) {
    const title = encodeSingleByteCharset(TITLE, charset);
    const meta = declaredIn === "a meta" ? `<META http-equiv="Content-Type" content="text/html; charset=${charset}">` : "";
    const document = concatBytes(`<html><head>${meta}<title>`, title, "</title></head><body><p>body</p></body></html>");
    const from = asciiFrom
        ? concatBytes("From: <Saved by Microsoft Internet Explorer 5>\r\n")
        : concatBytes("From: <", encodeSingleByteCharset(SAVED, charset),
            // a folded value continues on the next line, so the raw bytes span two lines
            folded ? " Microsoft\r\n\tInternet Explorer 5>\r\n" : " Microsoft Internet Explorer 5>\r\n");
    return concatBytes(
        from,
        `Subject: =?${charset}?B?${encodeBase64(title, { lineLength: 0 })}?=\r\n`,
        "Date: Fri, 31 Mar 2006 19:25:16 +0400\r\nMIME-Version: 1.0\r\n",
        `Content-Type: multipart/related;\r\n\tboundary="${BOUNDARY}";\r\n\ttype="text/html"\r\n\r\n`,
        `--${BOUNDARY}\r\nContent-Type: text/html`,
        declaredIn === "the part" ? `;\r\n\tcharset="${charset}"` : "",
        `\r\nContent-Transfer-Encoding: ${encoding}\r\nContent-Location: ${LOCATION}\r\n\r\n`,
        ENCODINGS[encoding](document),
        `\r\n--${BOUNDARY}--\r\n`
    );
}

const pageInfo = data => JSON.parse(data.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);

for (const charset of CHARSETS) {
    for (const declaredIn of ["the part", "a meta"]) {
        for (const encoding of Object.keys(ENCODINGS)) {
            test(`raw ${charset} header bytes are recovered when the charset comes from ${declaredIn} (${encoding})`, async () => {
                const { data } = await convert(build({ charset, declaredIn, encoding }));
                const info = pageInfo(data);
                assert.equal(info.additionalProperty.value, `<${SAVED} Microsoft Internet Explorer 5>`);
                assert.equal(info.name, TITLE, "the RFC 2047 encoded Subject was not decoded");
            });
        }
    }
}

test("a folded header carrying raw bytes is recovered as a whole", async () => {
    const { data } = await convert(build({ charset: "koi8-r", folded: true }));
    const value = pageInfo(data).additionalProperty.value;
    assert.ok(value.includes(SAVED), `lost the raw bytes: ${value}`);
    assert.ok(value.includes("Internet Explorer 5"), `lost the continuation line: ${value}`);
});

test("an ASCII header is left untouched", async () => {
    const info = pageInfo((await convert(build({ charset: "koi8-r", asciiFrom: true }))).data);
    assert.equal(info.additionalProperty.value, "<Saved by Microsoft Internet Explorer 5>");
    assert.equal(info.name, TITLE);
});

test("a UTF-8 document leaves the headers alone", async () => {
    const raw = concatBytes(
        "From: <Saved by Microsoft Internet Explorer 5>\r\nSubject: plain\r\nMIME-Version: 1.0\r\n",
        `Content-Type: multipart/related; boundary="${BOUNDARY}"\r\n\r\n`,
        `--${BOUNDARY}\r\nContent-Type: text/html; charset="utf-8"\r\nContent-Transfer-Encoding: 8bit\r\n`,
        `Content-Location: ${LOCATION}\r\n\r\n`,
        encodeUtf8(`<html><head><title>${TITLE}</title></head><body><p>body</p></body></html>`),
        `\r\n--${BOUNDARY}--\r\n`
    );
    const info = pageInfo((await convert(raw)).data);
    assert.equal(info.additionalProperty.value, "<Saved by Microsoft Internet Explorer 5>");
    assert.equal(info.name, "plain");
});

test("bytes that no charset can repair do not break the conversion", async () => {
    // 0x80 0x81 is invalid UTF-8 and the document declares UTF-8, so nothing can recover it
    const raw = concatBytes(
        "From: <", [0x80, 0x81], ">\r\nMIME-Version: 1.0\r\n",
        `Content-Type: multipart/related; boundary="${BOUNDARY}"\r\n\r\n`,
        `--${BOUNDARY}\r\nContent-Type: text/html; charset="utf-8"\r\nContent-Transfer-Encoding: 8bit\r\n`,
        `Content-Location: ${LOCATION}\r\n\r\n<html><body><p>body</p></body></html>\r\n--${BOUNDARY}--\r\n`
    );
    const info = pageInfo((await convert(raw)).data);
    assert.ok(info.additionalProperty.value.includes(REPLACEMENT_CHARACTER));
});

test("parse() exposes the documented shape with the headers decoded", () => {
    const parsed = parse(build({ charset: "koi8-r" }));
    for (const key of ["headers", "frames", "resources", "index"]) {
        assert.ok(key in parsed, `missing ${key}`);
    }
    assert.equal(typeof parsed.headers.from, "string");
    assert.ok(parsed.headers.from.includes(SAVED));
});
