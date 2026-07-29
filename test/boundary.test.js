// RFC 2046 5.1.1: the line break in front of a boundary delimiter belongs to the delimiter, not to
// the body. Getting this wrong silently adds or removes bytes at the end of every single part.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "./helpers/lib.js";
import { concatBytes, decodeResourceData, DEFAULT_BOUNDARY as BOUNDARY } from "./helpers/mhtml.js";

const LOCATION = "https://example.invalid/r";

// Places `body` verbatim between the header separator and the closing delimiter.
function build(body, eol = "\r\n") {
    return concatBytes(
        `MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="${BOUNDARY}"\r\n\r\n`,
        `--${BOUNDARY}${eol}Content-Type: application/octet-stream${eol}`,
        `Content-Transfer-Encoding: 8bit${eol}Content-Location: ${LOCATION}${eol}${eol}`,
        body,
        `${eol}--${BOUNDARY}--${eol}`
    );
}

const bodies = [
    { name: "a body with no trailing line break", body: "AB", expected: "AB" },
    { name: "a body that really ends with CRLF", body: "AB\r\n", expected: "AB\r\n" },
    { name: "a body that really ends with two CRLF", body: "AB\r\n\r\n", expected: "AB\r\n\r\n" },
    { name: "a body with an interior blank line", body: "A\r\n\r\nB", expected: "A\r\n\r\nB" },
    { name: "a body that is a single line break", body: "\r\n", expected: "\r\n" },
    { name: "an empty body", body: "", expected: "" }
];

for (const { name, body, expected } of bodies) {
    test(name, () => {
        const resource = parse(build(body)).resources[LOCATION];
        assert.notEqual(resource, undefined, "the part was not found");
        assert.equal(decodeResourceData(resource), expected);
    });
}

test("an LF-only document keeps its body intact", () => {
    const resource = parse(build("AB", "\n")).resources[LOCATION];
    assert.equal(decodeResourceData(resource), "AB");
});

test("an LF-only document keeps a trailing LF that belongs to the body", () => {
    const resource = parse(build("AB\n", "\n")).resources[LOCATION];
    assert.equal(decodeResourceData(resource), "AB\n");
});

test("a longer line merely starting with the boundary is body, not a delimiter", () => {
    const body = `A\r\n--${BOUNDARY}xyz\r\nB`;
    const resource = parse(build(body)).resources[LOCATION];
    assert.equal(decodeResourceData(resource), body);
});
