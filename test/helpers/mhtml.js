// Builders producing MHTML documents in memory, so the suite needs no fixture files on disk.
// Everything is bytes: a test can place any byte sequence in a header or a body, which is what
// distinguishes a transfer-encoding bug from a charset bug.

const CRLF = "\r\n";
const DEFAULT_BOUNDARY = "----=_NextPart_000_0000_01C654E0.7F0AD5A0";
const HEADER_SEPARATOR = ": ";
const EQUAL_SIGN = 0x3D;
const TILDE = 0x7E;
const BASE64_LINE_LENGTH = 76;

const textEncoder = new TextEncoder();
const singleByteCharsets = new Map();

export {
    CRLF,
    DEFAULT_BOUNDARY,
    concatBytes,
    decodeResourceData,
    encodeBase64,
    encodeLatin1,
    encodeQuotedPrintable,
    encodeSingleByteCharset,
    encodeUtf8,
    mhtml,
    part
};

// one byte per code unit, so a test can write bytes 0x80-0xFF literally
function encodeLatin1(value) {
    return Uint8Array.from(value, character => character.charCodeAt(0) & 0xFF);
}

function encodeUtf8(value) {
    return textEncoder.encode(value);
}

// Encodes text in any single-byte charset, by inverting the decoder the platform already provides.
// Building the table from TextDecoder keeps the tests honest: they exercise the same mapping the
// library will use, instead of a hand-copied one that could disagree with it.
function encodeSingleByteCharset(value, charset) {
    let table = singleByteCharsets.get(charset);
    if (table === undefined) {
        const textDecoder = new TextDecoder(charset);
        table = new Map();
        for (let byte = 0; byte < 0x100; byte++) {
            table.set(textDecoder.decode(new Uint8Array([byte])), byte);
        }
        singleByteCharsets.set(charset, table);
    }
    return Uint8Array.from(value, character => {
        const byte = table.get(character);
        if (byte === undefined) {
            throw new Error(`"${character}" cannot be encoded in ${charset}`);
        }
        return byte;
    });
}

// Accepts strings (encoded as Latin-1), byte arrays and arrays of byte values.
function concatBytes(...values) {
    const parts = values.map(value => {
        if (typeof value === "string") {
            return encodeLatin1(value);
        }
        return value instanceof Uint8Array ? value : Uint8Array.from(value);
    });
    const result = new Uint8Array(parts.reduce((total, item) => total + item.length, 0));
    let offset = 0;
    for (const item of parts) {
        result.set(item, offset);
        offset += item.length;
    }
    return result;
}

function encodeBase64(data, { lineLength = BASE64_LINE_LENGTH } = {}) {
    const bytes = concatBytes(data);
    let binaryString = "";
    for (const byte of bytes) {
        binaryString += String.fromCharCode(byte);
    }
    const encoded = btoa(binaryString);
    return lineLength ? encoded.replace(new RegExp(`(.{${lineLength}})`, "g"), `$1${CRLF}`) : encoded;
}

function encodeQuotedPrintable(data) {
    let result = "";
    for (const byte of concatBytes(data)) {
        result += byte === EQUAL_SIGN || byte > TILDE
            ? `=${byte.toString(16).toUpperCase().padStart(2, "0")}`
            : String.fromCharCode(byte);
    }
    return result;
}

// Builds one part. `body` may be a string or bytes; `encode` is applied to it when given, which is
// how a test asks for the body to be carried as base64 or quoted-printable.
function part({ contentType, transferEncoding, location, contentId, headers = {}, body = "", encode, eol = CRLF, boundary = DEFAULT_BOUNDARY } = {}) {
    const headerLines = [];
    if (contentType !== undefined) {
        headerLines.push(`Content-Type${HEADER_SEPARATOR}${contentType}`);
    }
    if (transferEncoding !== undefined) {
        headerLines.push(`Content-Transfer-Encoding${HEADER_SEPARATOR}${transferEncoding}`);
    }
    if (location !== undefined) {
        headerLines.push(`Content-Location${HEADER_SEPARATOR}${location}`);
    }
    if (contentId !== undefined) {
        headerLines.push(`Content-ID${HEADER_SEPARATOR}${contentId}`);
    }
    for (const [name, value] of Object.entries(headers)) {
        headerLines.push(`${name}${HEADER_SEPARATOR}${value}`);
    }
    return concatBytes(
        `--${boundary}${eol}`,
        headerLines.length ? headerLines.join(eol) + eol : "",
        eol,
        encode ? encode(body) : body
    );
}

// Builds a whole document. `parts` are the already-built parts; `headers` become the top-level
// headers and may carry raw bytes, which is what a localized MHTML writer emits.
function mhtml({ headers, parts = [], boundary = DEFAULT_BOUNDARY, preamble, closing = true, eol = CRLF, contentType } = {}) {
    const defaultContentType = `multipart/related;${eol}\tboundary="${boundary}";${eol}\ttype="text/html"`;
    const headerBytes = headers === undefined
        ? concatBytes(`MIME-Version: 1.0${eol}Content-Type${HEADER_SEPARATOR}${contentType || defaultContentType}${eol}`)
        : concatBytes(headers);
    return concatBytes(
        headerBytes,
        eol,
        preamble === undefined ? "" : concatBytes(preamble, eol, eol),
        ...parts.flatMap(item => [item, eol]),
        closing ? `--${boundary}--${eol}` : ""
    );
}

// A parsed resource is either a decoded string or, for binary content, a base64 string.
// Returns the bytes as a Latin-1 string either way, so a test can compare exact bytes.
function decodeResourceData(resource) {
    const data = String(resource.data);
    return resource.transferEncoding === "base64" ? atob(data) : data;
}
