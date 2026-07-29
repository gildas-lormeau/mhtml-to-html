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

// The CJK codepages are the other half of the archives still in circulation. They cannot be built
// with encodeSingleByteCharset, so the bytes are written out and the text they stand for with them.
// ISO-2022-JP matters most: it is stateful, and its escape sequences have to survive whatever
// transfer encoding carries them.
const MULTI_BYTE_CHARSETS = [
    { charset: "shift_jis", bytes: [0x93, 0xFA, 0x96, 0x7B, 0x8C, 0xEA], text: "日本語" },
    { charset: "euc-jp", bytes: [0xC6, 0xFC, 0xCB, 0xDC], text: "日本" },
    { charset: "gb2312", bytes: [0xD6, 0xD0, 0xCE, 0xC4], text: "中文" },
    { charset: "big5", bytes: [0xA4, 0xA4, 0xA4, 0xE5], text: "中文" },
    { charset: "euc-kr", bytes: [0xC7, 0xD1, 0xB1, 0xB9], text: "한국" },
    { charset: "iso-2022-jp", bytes: [0x1B, 0x24, 0x42, 0x46, 0x7C, 0x4B, 0x5C, 0x1B, 0x28, 0x42], text: "日本" }
];

for (const { charset, bytes, text } of MULTI_BYTE_CHARSETS) {
    for (const encoding of Object.keys(ENCODINGS)) {
        test(`${charset} carried as ${encoding}`, async () => {
            const document = concatBytes(
                "<html><head><title>", Uint8Array.from(bytes), "</title></head><body><p>",
                Uint8Array.from(bytes), "</p></body></html>");
            const raw = concatBytes(
                `MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="${BOUNDARY}"\r\n\r\n`,
                `--${BOUNDARY}\r\nContent-Type: text/html; charset="${charset}"\r\n`,
                `Content-Transfer-Encoding: ${encoding}\r\nContent-Location: ${LOCATION}\r\n\r\n`,
                ENCODINGS[encoding](document),
                `\r\n--${BOUNDARY}--\r\n`);
            const { data, title } = await convert(raw);
            assert.ok(data.includes(text), `the body was not decoded as ${charset}`);
            assert.equal(title, text, "the title was not decoded");
            assert.ok(!data.includes(REPLACEMENT_CHARACTER), "the content was decoded with the wrong charset");
        });
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

// A byte order mark is written by whatever produced the bytes, so it outranks every description of
// them added afterwards. Stylesheets are where it shows: a writer that saves them as UTF-16 declares
// no charset at all, and read as UTF-8 they come out with a NUL between every letter.
const NUL = "\u0000";

function encodeUtf16(value, littleEndian) {
    const bytes = new Uint8Array(value.length * 2 + 2);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, 0xFEFF, littleEndian);
    for (let index = 0; index < value.length; index++) {
        view.setUint16(index * 2 + 2, value.charCodeAt(index), littleEndian);
    }
    return bytes;
}

function pageLinkingStylesheet(stylesheetHeaders, stylesheetBody) {
    return concatBytes(
        `MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="${BOUNDARY}"\r\n\r\n`,
        `--${BOUNDARY}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n`,
        `Content-Location: ${LOCATION}\r\n\r\n`,
        "<html><head><link rel=\"stylesheet\" href=\"s.css\"></head><body>x</body></html>\r\n",
        `--${BOUNDARY}\r\n${stylesheetHeaders}\r\n`,
        "Content-Location: https://example.invalid/s.css\r\n\r\n",
        stylesheetBody,
        `\r\n--${BOUNDARY}--\r\n`
    );
}

for (const [name, littleEndian] of [["little-endian", true], ["big-endian", false]]) {
    test(`a ${name} UTF-16 stylesheet is decoded by its byte order mark`, async () => {
        const { data } = await convert(pageLinkingStylesheet("Content-Type: text/css",
            encodeUtf16("p{color:red}", littleEndian)));
        assert.ok(data.includes("p{color:red}"), "the stylesheet was not decoded with its byte order mark");
        assert.ok(!data.includes(REPLACEMENT_CHARACTER), "the mark itself was read as text");
        assert.ok(!data.includes(NUL), "the sheet was read one byte at a time");
    });
}

test("a byte order mark outranks the charset the part declares", async () => {
    // the header records what someone believed; the mark is the bytes saying what they are
    const { data } = await convert(pageLinkingStylesheet("Content-Type: text/css; charset=\"windows-1251\"",
        encodeUtf16("p{color:red}", true)));
    assert.ok(data.includes("p{color:red}"), "the declared charset was preferred over the mark");
});

test("a byte order mark outranks an @charset rule that disagrees", async () => {
    const { data } = await convert(pageLinkingStylesheet("Content-Type: text/css",
        encodeUtf16("@charset \"koi8-r\";p{color:red}", true)));
    assert.ok(data.includes("p{color:red}"), "the sheet was read again with the charset it named");
    assert.ok(!data.includes("@charset"), "the rule was left in the output");
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
