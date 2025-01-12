/* global globalThis, TextDecoder, TextEncoder, btoa */

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

function decodeBinary(array) {
    let data = "";
    for (let indexData = 0; indexData < array.length; indexData++) {
        data += String.fromCharCode(array[indexData]);
    }
    return btoa(data);
}

function decodeMimeHeader(encodedSubject) {
    if (encodedSubject && encodedSubject.startsWith("=?") && encodedSubject.endsWith("?=")) {
        const encodedSubjectParts = [];
        let index = 0;
        while (index < encodedSubject.length) {
            const start = encodedSubject.indexOf("=?", index);
            if (start === -1) {
                return;
            }
            const endCharset = encodedSubject.indexOf("?", start + 2);
            const charset = encodedSubject.substring(start + 2, endCharset);
            const endEncoding = encodedSubject.indexOf("?", endCharset + 1);
            const encoding = encodedSubject.substring(endCharset + 1, endEncoding);
            const endValue = encodedSubject.indexOf("?=", endEncoding + 1);
            const value = encodedSubject.substring(endEncoding + 1, endValue);
            index = endValue + 2;
            if (encoding === "Q") {
                encodedSubjectParts.push(new TextDecoder(charset).decode(decodeQuotedPrintable(new TextEncoder().encode(value))));
            } else if (encoding === "B") {
                const decodedData = new Uint8Array(atob(value).split("").map(char => char.charCodeAt(0)));
                const decodedText = new TextDecoder(charset).decode(decodedData);
                encodedSubjectParts.push(decodedText);
            }
        }
        encodedSubject = encodedSubjectParts.join("");
    }
    return encodedSubject || "";
}

function parseDOM(asset, DOMParser = globalThis.DOMParser) {
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

function encodeString(string, charset) {
    return new TextEncoder(charset).encode(string);
}

function getCharset(contentType) {
    const charsetMatch = contentType.match(/charset=([^;]+)/);
    if (charsetMatch) {
        return removeQuotes(charsetMatch[1]).toLowerCase();
    }
}

function replaceCharset(contentType, charset) {
    return contentType.replace(/charset=([^;]+)/, `charset=${charset}`);
}

function isDocument(contentType) {
    return contentType.startsWith("text/html") || contentType.startsWith("application/xhtml+xml");
}

function isStylesheet(contentType) {
    return contentType.startsWith("text/css");
}

function isImage(contentType) {
    return contentType.startsWith("image/") || contentType.startsWith("application/octet-stream");
}

function isAudio(contentType) {
    return contentType.startsWith("audio/") || contentType.startsWith("application/octet-stream");
}

function isVideo(contentType) {
    return contentType.startsWith("video/") || contentType.startsWith("application/octet-stream");
}

function isText(contentType) {
    return contentType.startsWith("text/");
}

function isMultipartAlternative(contentType) {
    return contentType.startsWith("multipart/alternative");
}

function getBoundary(contentType) {
    const contentTypeParams = contentType.split(";");
    contentTypeParams.shift();
    const boundaryParam = contentTypeParams.find(param => param.startsWith("boundary="));
    if (boundaryParam) {
        return removeQuotes(boundaryParam.substring(9));
    }
}

function indexOf(array, string) {
    const stringBytes = new TextEncoder().encode(string);
    for (let i = 0; i < array.length; i++) {
        if (array[i] === stringBytes[0]) {
            let match = true;
            for (let j = 1; j < stringBytes.length; j++) {
                if (array[i + j] !== stringBytes[j]) {
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

function encodeStringToBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
}

export {
    EVENT_HANDLER_ATTRIBUTES,
    decodeQuotedPrintable,
    decodeBinary,
    decodeMimeHeader,
    parseDOM,
    removeQuotes,
    decodeString,
    encodeString,
    getCharset,
    replaceCharset,
    isDocument,
    isStylesheet,
    isImage,
    isAudio,
    isVideo,
    isText,
    isMultipartAlternative,
    getBoundary,
    indexOf,
    startsWithBoundary,
    isLineFeed,
    endsWithCRLF,
    endsWithLF,
    encodeStringToBase64
};