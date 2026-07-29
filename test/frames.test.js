// A frame does not always hold a document. A browser saves whatever an iframe was showing as a part
// of the archive, so a tracking pixel arrives as an image referenced by a cid: URL. Converting such
// a part as if it were markup parses its bytes as HTML and destroys them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { convert } from "./helpers/lib.js";
import { concatBytes, encodeBase64 } from "./helpers/mhtml.js";

const BOUNDARY = "----=_B";
const LOCATION = "https://example.invalid/";
const CONTENT_ID = "<frame-1@mhtml.blink>";
const FRAME_LOCATION = "https://example.invalid/frame";
// a 1x1 transparent GIF, the shape every tracking pixel has
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0xFF, 0x00, 0x3B]);

function build({ markup, contentType, body, transferEncoding = "8bit" }) {
    return concatBytes(
        `MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="${BOUNDARY}"\r\n\r\n`,
        `--${BOUNDARY}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n`,
        `Content-Location: ${LOCATION}\r\n\r\n<html><body>${markup}</body></html>\r\n`,
        `--${BOUNDARY}\r\n`,
        contentType === undefined ? "" : `Content-Type: ${contentType}\r\n`,
        `Content-Transfer-Encoding: ${transferEncoding}\r\nContent-ID: ${CONTENT_ID}\r\n`,
        `Content-Location: ${FRAME_LOCATION}\r\n\r\n`,
        body,
        `\r\n--${BOUNDARY}--\r\n`
    );
}

const iframe = `<iframe src="cid:${CONTENT_ID.slice(1, -1)}"></iframe>`;

test("a frame holding a document is inlined as srcdoc", async () => {
    const { data } = await convert(build({
        markup: iframe, contentType: "text/html", body: "<html><body><p>INNER</p></body></html>"
    }));
    assert.match(data, /srcdoc=/, "the frame was not inlined");
    assert.ok(data.includes("INNER"), "the content of the frame is missing");
});

test("a frame holding an image becomes a data URI instead of being parsed as markup", async () => {
    const { data } = await convert(build({
        markup: iframe, contentType: "image/gif", transferEncoding: "base64", body: encodeBase64(GIF)
    }));
    assert.ok(!data.includes("GIF89a"), "the bytes of the image were parsed as markup");
    assert.doesNotMatch(data, /srcdoc=/, "an image was inlined as a document");
    assert.ok(data.includes(`src="data:image/gif;base64,${encodeBase64(GIF, { lineLength: 0 })}"`),
        "the image was not inlined byte-exact");
});

test("the original URL of a diverted frame is kept", async () => {
    const { data } = await convert(build({
        markup: iframe, contentType: "image/gif", transferEncoding: "base64", body: encodeBase64(GIF)
    }));
    assert.ok(data.includes(`data-original-src="cid:${CONTENT_ID.slice(1, -1)}"`));
});

test("a frame holding a document mislabeled as a stream is still converted", async () => {
    // application/octet-stream is what a server sends when it does not know, and archives are full
    // of documents carrying it: only a type that cannot be markup may skip the conversion
    const { data } = await convert(build({
        markup: iframe, contentType: "application/octet-stream", body: "<html><body><p>INNER</p></body></html>"
    }));
    assert.match(data, /srcdoc=/, "a mislabeled document was inlined as raw data");
    assert.ok(data.includes("INNER"));
});

test("a frame with no content type at all is still converted as a document", async () => {
    // nothing says it is not markup, and treating it as a document is what the archive implies
    const { data } = await convert(build({ markup: iframe, body: "<html><body><p>INNER</p></body></html>" }));
    assert.match(data, /srcdoc=/);
    assert.ok(data.includes("INNER"));
});

test("an object referring to an image part is inlined as a data URI", async () => {
    const { data } = await convert(build({
        markup: `<object data="cid:${CONTENT_ID.slice(1, -1)}"></object>`,
        contentType: "image/gif", transferEncoding: "base64", body: encodeBase64(GIF)
    }));
    assert.ok(data.includes("data:image/gif;base64,"), "the object payload was not inlined");
    assert.ok(!data.includes("GIF89a"));
});
