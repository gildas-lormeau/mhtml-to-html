// Whatever encoding carries a part, the bytes recovered must be exactly the bytes that were encoded
// — no trailing line break absorbed from the delimiter, no soft line break left behind.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "./helpers/lib.js";
import { concatBytes, decodeResourceData } from "./helpers/mhtml.js";

const BOUNDARY = "----=_B";

const cases = [
    { name: "7bit", encoding: "7bit", raw: "AB", expected: "AB" },
    { name: "8bit", encoding: "8bit", raw: "AB", expected: "AB" },
    { name: "binary", encoding: "binary", raw: "AB", expected: "AB" },
    { name: "base64", encoding: "base64", raw: "QUI=", expected: "AB" },
    { name: "quoted-printable", encoding: "quoted-printable", raw: "AB", expected: "AB" },
    { name: "8bit keeping an interior line break", encoding: "8bit", raw: "A\r\nB", expected: "A\r\nB" },
    { name: "quoted-printable resolving a soft line break", encoding: "quoted-printable", raw: "A=\r\nB", expected: "AB" },
    { name: "8bit carrying an empty body", encoding: "8bit", raw: "", expected: "" }
];

// All the cases share one document, so a bug in one part is also visible as damage to its neighbours.
const raw = concatBytes(
    `MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="${BOUNDARY}"\r\n\r\n`,
    ...cases.map(({ encoding, raw: body }, index) =>
        `--${BOUNDARY}\r\nContent-Type: application/octet-stream\r\n` +
        `Content-Transfer-Encoding: ${encoding}\r\nContent-Location: https://e/r${index}\r\n\r\n${body}\r\n`),
    `--${BOUNDARY}--\r\n`
);
const resources = parse(raw).resources;

for (const [index, { name, expected }] of cases.entries()) {
    test(`a part encoded as ${name} round-trips exactly`, () => {
        const resource = resources[`https://e/r${index}`];
        assert.notEqual(resource, undefined, "the part was not found");
        assert.equal(decodeResourceData(resource), expected);
    });
}
