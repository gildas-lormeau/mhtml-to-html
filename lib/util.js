/* global URL, TextDecoder, TextEncoder, btoa, atob */

const EVENT_HANDLER_ATTRIBUTES = [
    "onafterprint",
    "onbeforeprint",
    "onbeforeunload",
    "onhashchange",
    "onlanguagechange",
    "onmessage",
    "onmessageerror",
    "onoffline",
    "ononline",
    "onpagehide",
    "onpageshow",
    "onpopstate",
    "onrejectionhandled",
    "onstorage",
    "onunhandledrejection",
    "onunload",
    "ongamepadconnected",
    "ongamepaddisconnected",
    "onabort",
    "onblur",
    "onfocus",
    "oncancel",
    "onauxclick",
    "onbeforeinput",
    "onbeforetoggle",
    "oncanplay",
    "oncanplaythrough",
    "onchange",
    "onclick",
    "onclose",
    "oncontentvisibilityautostatechange",
    "oncontextlost",
    "oncontextmenu",
    "oncontextrestored",
    "oncopy",
    "oncuechange",
    "oncut",
    "ondblclick",
    "ondrag",
    "ondragend",
    "ondragenter",
    "ondragleave",
    "ondragover",
    "ondragstart",
    "ondrop",
    "ondurationchange",
    "onemptied",
    "onended",
    "onformdata",
    "oninput",
    "oninvalid",
    "onkeydown",
    "onkeypress",
    "onkeyup",
    "onload",
    "onloadeddata",
    "onloadedmetadata",
    "onloadstart",
    "onmousedown",
    "onmouseenter",
    "onmouseleave",
    "onmousemove",
    "onmouseout",
    "onmouseover",
    "onmouseup",
    "onwheel",
    "onpaste",
    "onpause",
    "onplay",
    "onplaying",
    "onprogress",
    "onratechange",
    "onreset",
    "onresize",
    "onscroll",
    "onscrollend",
    "onsecuritypolicyviolation",
    "onseeked",
    "onseeking",
    "onselect",
    "onslotchange",
    "onstalled",
    "onsubmit",
    "onsuspend",
    "ontimeupdate",
    "onvolumechange",
    "onwaiting",
    "onselectstart",
    "onselectionchange",
    "ontoggle",
    "onpointercancel",
    "onpointerdown",
    "onpointerup",
    "onpointermove",
    "onpointerout",
    "onpointerover",
    "onpointerenter",
    "onpointerleave",
    "ongotpointercapture",
    "onlostpointercapture",
    "onanimationcancel",
    "onanimationend",
    "onanimationiteration",
    "onanimationstart",
    "ontransitioncancel",
    "ontransitionend",
    "ontransitionrun",
    "ontransitionstart",
    "onerror",
    "onfullscreenchange",
    "onfullscreenerror"
];
const CHUNK_SIZE = 8192;
const textEncoder = new TextEncoder();
const textDecoders = new Map();
const ENCODED_WORD_START = "=?";
const ENCODED_WORD_END = "?=";
const ENCODED_WORD_SEPARATOR = "?";
const QUOTED_PRINTABLE_LETTER = "q";
const BASE64_LETTER = "b";
const UNDERSCORE_REGEXP = /_/g;
// parameter names are case-insensitive
const CHARSET_REGEXP = /charset=([^;]+)/i;

export {
    EVENT_HANDLER_ATTRIBUTES,
    decodeQuotedPrintable,
    decodeBinary,
    decodeMimeHeader,
    parseDOM,
    decodeBase64,
    decodeString,
    encodeString,
    getCharset,
    replaceCharset,
    isDocument,
    isStylesheet,
    isText,
    isMultipartAlternative,
    getBoundary,
    indexOf,
    startsWithBoundary,
    isLineFeed,
    endsWithCRLF,
    endsWithLF,
    getResourceURI,
    resolvePath
};

function decodeQuotedPrintable(array) {
    const result = [];
    for (let i = 0; i < array.length; i++) {
        if (array[i] === 0x3D) {
            if (isHex(array[i + 1]) && isHex(array[i + 2])) {
                const hex = parseInt(String.fromCharCode(array[i + 1], array[i + 2]), 16);
                result.push(hex);
                i += 2;
            } else {
                result.push(array[i]);
            }
        } else {
            result.push(array[i]);
        }
    }
    return new Uint8Array(result);

    function isHex(value) {
        return value >= 0x30 && value <= 0x39 || value >= 0x41 && value <= 0x46 || value >= 0x61 && value <= 0x66;
    }
}

function decodeBinary(array) {
    const parts = [];
    for (let i = 0; i < array.length; i += CHUNK_SIZE) {
        parts.push(String.fromCharCode.apply(null, array.subarray(i, Math.min(i + CHUNK_SIZE, array.length))));
    }
    return btoa(parts.join(""));
}

function decodeBase64(value, charset) {
    try {
        const binaryString = atob(value);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return new TextDecoder(charset).decode(bytes);
        // eslint-disable-next-line no-unused-vars
    } catch (_) {
        return value;
    }
}

// RFC 2047: decode the "=?charset?encoding?value?=" words of a header, keeping the text around them.
function decodeMimeHeader(header) {
    if (!header) {
        return "";
    }
    const parts = [];
    let index = 0;
    let previousWordDecoded = false;
    while (index < header.length) {
        const start = header.indexOf(ENCODED_WORD_START, index);
        if (start === -1) {
            parts.push(header.substring(index));
            break;
        }
        const encodedWord = decodeEncodedWord(header, start);
        if (encodedWord === undefined) {
            parts.push(header.substring(index, start + ENCODED_WORD_START.length));
            index = start + ENCODED_WORD_START.length;
            previousWordDecoded = false;
        } else {
            const text = header.substring(index, start);
            // linear whitespace separating two adjacent encoded words is ignored
            if (text && !(previousWordDecoded && !text.trim())) {
                parts.push(text);
            }
            parts.push(encodedWord.value);
            index = encodedWord.end;
            previousWordDecoded = true;
        }
    }
    return parts.join("");
}

function decodeEncodedWord(header, start) {
    const endCharset = header.indexOf(ENCODED_WORD_SEPARATOR, start + ENCODED_WORD_START.length);
    if (endCharset === -1) {
        return;
    }
    const endEncoding = header.indexOf(ENCODED_WORD_SEPARATOR, endCharset + 1);
    if (endEncoding === -1) {
        return;
    }
    const endValue = header.indexOf(ENCODED_WORD_END, endEncoding + 1);
    if (endValue === -1) {
        return;
    }
    const charset = header.substring(start + ENCODED_WORD_START.length, endCharset);
    const encoding = header.substring(endCharset + 1, endEncoding).toLowerCase();
    const value = header.substring(endEncoding + 1, endValue);
    const end = endValue + ENCODED_WORD_END.length;
    if (encoding === QUOTED_PRINTABLE_LETTER) {
        // in encoded words, "_" stands for a space
        return { value: decodeString(decodeQuotedPrintable(encodeString(value.replace(UNDERSCORE_REGEXP, " "))), charset), end };
    } else if (encoding === BASE64_LETTER) {
        return { value: decodeBase64(value, charset), end };
    }
}

function parseDOM(asset, contentType = "text/html", DOMParser = globalThis.DOMParser) {
    let document;
    try {
        document = new DOMParser().parseFromString(asset, contentType);
        // eslint-disable-next-line no-unused-vars
    } catch (_) {
        document = new DOMParser().parseFromString(asset, "text/html");
    }
    return {
        document,
        serialize() {
            let result = "";
            if (this.document.doctype) {
                result += serializeDocType(this.document.doctype) + "\n";
            }
            result += this.document.documentElement.outerHTML;
            return result;
        }
    };
}

function serializeDocType(doctype) {
    return `<!DOCTYPE ${doctype.name}${(doctype.publicId ? ` PUBLIC "${doctype.publicId}"` : "")}${(doctype.systemId ? ` "${doctype.systemId}"` : "")}>`;
}

function decodeString(array, charset) {
    let textDecoder = textDecoders.get(charset);
    if (!textDecoder) {
        textDecoder = new TextDecoder(charset);
        textDecoders.set(charset, textDecoder);
    }
    return textDecoder.decode(array);
}

function encodeString(string) {
    return textEncoder.encode(string);
}

function getCharset(contentType) {
    const charsetMatch = contentType.match(CHARSET_REGEXP);
    if (charsetMatch) {
        return removeQuotes(charsetMatch[1]).toLowerCase();
    }
}

function removeQuotes(value) {
    return value.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1").trim();
}

function replaceCharset(contentType, charset) {
    return contentType.replace(CHARSET_REGEXP, `charset=${charset}`);
}

function isDocument(contentType) {
    return testContentType(contentType, "text/html") || testContentType(contentType, "application/xhtml+xml");
}

function isStylesheet(contentType) {
    return testContentType(contentType, "text/css");
}

function isText(contentType) {
    return testContentType(contentType, "text/");
}

function isMultipartAlternative(contentType) {
    return testContentType(contentType, "multipart/alternative");
}

// media types are case-insensitive, and a part may have no content type at all
function testContentType(contentType, type) {
    return Boolean(contentType) && contentType.toLowerCase().startsWith(type);
}

function getBoundary(contentType) {
    const contentTypeParams = contentType.split(";");
    contentTypeParams.shift();
    const boundaryParam = contentTypeParams.map(param => param.trim()).find(param => param.startsWith("boundary="));
    if (boundaryParam) {
        return removeQuotes(boundaryParam.substring(9));
    }
}

function indexOf(array, subarray) {
    if (!subarray || !subarray.length) {
        return -1;
    }
    const lastIndex = array.length - subarray.length;
    for (let i = 0; i <= lastIndex; i++) {
        if (array[i] === subarray[0]) {
            let match = true;
            for (let j = 1; j < subarray.length; j++) {
                if (array[i + j] !== subarray[j]) {
                    match = false;
                    break;
                }
            }
            if (match) {
                // return index
                return i;
            }
        }
    }
    return -1;
}

function isLineFeed(array) {
    return array.length == 2 ? array[0] == 0x0D && array[1] == 0x0A : array.length == 1 ? array[0] == 0x0A : false;
}

function endsWithCRLF(array) {
    return array.length >= 2 ? array[array.length - 2] == 0x0D && array[array.length - 1] == 0x0A : array.length >= 1 ? array[array.length - 1] == 0x0D : false;
}

function endsWithLF(array) {
    return array.length >= 1 ? array[array.length - 1] == 0x0A : false;
}

function startsWithBoundary(array) {
    return array.length >= 2 ? array[0] == 0x2D && array[1] == 0x2D : false;
}

function getResourceURI({ contentType, transferEncoding, data }) {
    return `data:${getMediaType(contentType)};base64,${transferEncoding === "base64" ? data : decodeBinary(encodeString(data))}`;
}

// the media type of a data URI cannot contain whitespace (RFC 2397)
function getMediaType(contentType) {
    return contentType ? contentType.split(";").map(parameter => parameter.trim()).join(";") : contentType;
}

function resolvePath(path, base) {
    if (base && !path.startsWith("data:")) {
        try {
            return new URL(path, base).href;
            // eslint-disable-next-line no-unused-vars
        } catch (_) {
            if (path.startsWith("//")) {
                const protocol = base.match(/^[^:]+/);
                if (protocol) {
                    return `${protocol[0]}:${path}`;
                } else {
                    return path;
                }
            } else {
                return path;
            }
        }
    } else {
        return path;
    }
}
