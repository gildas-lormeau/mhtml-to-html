// A document in a legacy codepage must survive conversion whatever transfer encoding carries it and
// wherever the charset is declared. Regression suite for
// https://github.com/gildas-lormeau/mhtml-to-html/issues/3
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, convert } from "./helpers/lib.js";
import {
    concatBytes, decodeResourceData, encodeBase64, encodeQuotedPrintable, encodeSingleByteCharset
} from "./helpers/mhtml.js";

const BOUNDARY = "----=_NextPart_000_0000_01C654E0.7F0AD5A0";
const LOCATION = "https://example.invalid/page.htm";
const CHARSETS = ["koi8-r", "windows-1251"];
const HELLO = "Привет";
const WORLD = "Мир";
const REPLACEMENT_CHARACTER = "�";

const ENCODINGS = {
    "8bit": data => data,
    "quoted-printable": encodeQuotedPrintable,
    "base64": encodeBase64,
    "binary": data => data
};

const DECLARATIONS = {
    "a meta http-equiv": charset => `<META http-equiv="Content-Type" content="text/html; charset=${charset}">`,
    "a meta charset": charset => `<meta charset="${charset}">`,
    "the part header alone": () => ""
};

function build({ charset, declaration, encoding }) {
    const document = concatBytes(
        "<!DOCTYPE html PUBLIC \"-//W3C//DTD HTML 4.0 Transitional//EN\">\r\n<HTML><HEAD><TITLE>",
        encodeSingleByteCharset(HELLO, charset),
        `</TITLE>\r\n${DECLARATIONS[declaration](charset)}\r\n</HEAD>\r\n<BODY><P>`,
        encodeSingleByteCharset(WORLD, charset),
        "</P></BODY></HTML>"
    );
    // with no meta in the document, the part header is the only place the charset can come from
    const partCharset = declaration === "the part header alone" ? `;\r\n\tcharset="${charset}"` : "";
    return concatBytes(
        `MIME-Version: 1.0\r\nContent-Type: multipart/related;\r\n\tboundary="${BOUNDARY}";\r\n\ttype="text/html"\r\n\r\n`,
        `--${BOUNDARY}\r\nContent-Type: text/html${partCharset}\r\n`,
        `Content-Transfer-Encoding: ${encoding}\r\nContent-Location: ${LOCATION}\r\n\r\n`,
        ENCODINGS[encoding](document),
        `\r\n--${BOUNDARY}--\r\n`
    );
}

for (const charset of CHARSETS) {
    for (const declaration of Object.keys(DECLARATIONS)) {
        for (const encoding of Object.keys(ENCODINGS)) {
            test(`${charset} declared by ${declaration}, carried as ${encoding}`, async () => {
                const { data } = await convert(build({ charset, declaration, encoding }));
                assert.ok(data.includes(HELLO), "the title was not decoded");
                assert.ok(data.includes(WORLD), "the body was not decoded");
                assert.ok(!data.includes(REPLACEMENT_CHARACTER), "the content was decoded with the wrong charset");
                assert.doesNotMatch(data, /charset=(koi8-r|windows-1251)/i, "a stale charset declaration was left behind");
            });
        }
    }
}

test("a base64 part mislabeled as text is left byte-exact", async () => {
    // some writers give every part a text/* type; decoding such a part as text would corrupt it
    const jpeg = Uint8Array.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0xFF, 0xDB]);
    const raw = concatBytes(
        `MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="${BOUNDARY}"\r\n\r\n`,
        `--${BOUNDARY}\r\nContent-Type: text/html\r\nContent-Transfer-Encoding: 8bit\r\n`,
        `Content-Location: ${LOCATION}\r\n\r\n<html><body><img src="photo.jpg"></body></html>\r\n`,
        `--${BOUNDARY}\r\nContent-Type: text/html; name=photo.jpg\r\nContent-Transfer-Encoding: base64\r\n`,
        "Content-Location: https://example.invalid/photo.jpg\r\n\r\n",
        encodeBase64(jpeg),
        `\r\n--${BOUNDARY}--\r\n`
    );
    const resource = parse(raw).resources["https://example.invalid/photo.jpg"];
    assert.equal(resource.transferEncoding, "base64", "a mislabeled binary part was decoded as text");
    assert.deepEqual(Uint8Array.from(decodeResourceData(resource), character => character.charCodeAt(0)), jpeg);
});

test("an unknown charset label falls back to UTF-8 instead of aborting", async () => {
    const raw = concatBytes(
        `MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="${BOUNDARY}"\r\n\r\n`,
        `--${BOUNDARY}\r\nContent-Type: text/html; charset="x-not-a-real-charset"\r\n`,
        `Content-Transfer-Encoding: 8bit\r\nContent-Location: ${LOCATION}\r\n\r\n`,
        `<html><body><p>plain ascii</p></body></html>\r\n--${BOUNDARY}--\r\n`
    );
    const { data } = await convert(raw);
    assert.ok(data.includes("plain ascii"));
});
