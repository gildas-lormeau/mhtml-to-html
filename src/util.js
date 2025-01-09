/* global TextDecoder, btoa */

import { DOMParser } from "jsr:@b-fuze/deno-dom";

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
        return value >= 0x30 && value <= 0x39 || value >= 0x41 && value <= 0x46;
    }
}

function encodeBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
}

function parseDOM(asset) {
    return {
        document: new DOMParser().parseFromString(asset, "text/html"),
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

function removeQuotes(value) {
    return value.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1").trim();
}

function decodeString(array, charset) {
    return new TextDecoder(charset).decode(array);
}

function getCharset(contentType) {
    const charsetMatch = contentType.match(/charset=([^;]+)/);
    if (charsetMatch) {
        return removeQuotes(charsetMatch[1]);
    }
}

export { decodeQuotedPrintable, encodeBase64, parseDOM, removeQuotes, decodeString, getCharset };