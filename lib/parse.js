import {
    decodeQuotedPrintable,
    decodeBinary,
    decodeBase64Bytes,
    parseDOM,
    decodeString,
    encodeString,
    getCharset,
    replaceCharset,
    isDocument,
    isStylesheet,
    isText,
    isMultipartAlternative,
    normalizeLocation,
    getBoundary,
    indexOf,
    startsWithBoundary,
    isLineFeed,
    endsWithCRLF,
    endsWithLF
} from "./util.js";
import * as cssTree from "./vendor/csstree.esm.js";

const MHTML_HEADERS = 0;
const MHTML_CONTENT = 1;
const MHTML_DATA = 2;
const MHTML_END = 3;
const STRING_TYPE = "string";
const HEADER_SEPARATOR = ":";
const QUOTED_PRINTABLE_ENCODING = "quoted-printable";
const BINARY_ENCODING = "binary";
const CONTENT_TYPE_HEADER = "content-type";
const CONTENT_TRANSFER_ENCODING_HEADER = "content-transfer-encoding";
const CONTENT_ID_HEADER = "content-id";
const CONTENT_LOCATION_HEADER = "content-location";
const BASE64_ENCODING = "base64";
const UTF8_CHARSET = "utf-8";
const META_TAG = "META";
const CONTENT_ATTRIBUTE = "content";
const CHARSET_ATTRIBUTE = "charset";
const HTTP_EQUIV_ATTRIBUTE = "http-equiv";
const AT_RULE = "Atrule";
const CHARSET_IDENTIFIER = "charset";
const GENERATED_ID_PREFIX = "_";
const REPLACEMENT_CHARACTER = "�";
const LINE_FEED = 0x0A;
const CARRIAGE_RETURN = 0x0D;
const HYPHEN_MINUS = 0x2D;
const SPACE = 0x20;
const HORIZONTAL_TAB = 0x09;
const EQUAL_SIGN = 0x3D;

export default parse;

function parse(mhtml, { DOMParser } = { DOMParser: globalThis.DOMParser }, context = { resources: {}, frames: {} }) {
    // deno-lint-ignore valid-typeof
    if (typeof mhtml === STRING_TYPE) {
        mhtml = encodeString(mhtml);
    }
    const headers = {};
    // kept to decode again the headers a non-conforming writer emitted as raw bytes (see decodeRawHeaders)
    const rawHeaderLines = [];
    const { resources, frames } = context;
    let resource, transferEncoding, boundary, boundaryBytes, headerKey;
    let content = {};
    let state = MHTML_HEADERS;
    let indexMhtml = 0;
    let indexGeneratedId = 0;
    let indexStartEmbeddedMhtml;
    while (state !== MHTML_END && indexMhtml < mhtml.length - 1) {
        let next;
        if (state === MHTML_HEADERS) {
            next = getLine();
            if (!isLineFeed(next)) {
                rawHeaderLines.push(next);
                splitHeaders(next, headers);
            } else {
                if (headers[CONTENT_TYPE_HEADER]) {
                    setBoundary(getBoundary(headers[CONTENT_TYPE_HEADER]));
                }
                if (boundary) {
                    const indexStartBody = indexMhtml;
                    while (findBoundaryDelimiter(next, boundaryBytes) === -1 && indexMhtml < mhtml.length - 1) {
                        next = getLine();
                    }
                    // the declared boundary is not always the one the body uses: rather than read
                    // the whole file as a single part, go back and take the one it does use
                    if (findBoundaryDelimiter(next, boundaryBytes) === -1) {
                        indexMhtml = indexStartBody;
                        setBoundary(undefined);
                    }
                }
                if (!boundary) {
                    const previousIndex = indexMhtml;
                    next = getLine(transferEncoding);
                    if (startsWithBoundary(next)) {
                        setBoundary(decodeString(next).substring(2).trimEnd());
                    } else {
                        indexMhtml = previousIndex;
                    }
                }
                content = {};
                state = MHTML_CONTENT;
            }
        } else if (state === MHTML_CONTENT) {
            if (boundary) {
                if (indexStartEmbeddedMhtml === undefined) {
                    indexStartEmbeddedMhtml = indexMhtml;
                }
                next = getLine();
                if (!isLineFeed(next)) {
                    splitHeaders(next, content);
                } else {
                    initResource(content);
                    if (!resource.contentType || !isMultipartAlternative(resource.contentType)) {
                        indexStartEmbeddedMhtml = undefined;
                    }
                    state = MHTML_DATA;
                }
            } else {
                initResource(headers);
                state = MHTML_DATA;
            }
        } else if (state === MHTML_DATA) {
            const indexEndData = parseResourceData();
            if (indexStartEmbeddedMhtml !== undefined && indexEndData !== undefined) {
                resource.data = flattenData(resource.data);
                resource.used = true;
                context.index = convertEmbeddedMhtml(indexEndData);
            } else {
                processResource();
            }
            state = (indexMhtml >= mhtml.length - 1 ? MHTML_END : MHTML_CONTENT);
        }
    }
    return { headers, frames, resources, index: context.index };

    function setBoundary(value) {
        boundary = value;
        boundaryBytes = value === undefined ? undefined : encodeString(value);
    }

    function getLine(transferEncoding) {
        const indexStart = indexMhtml;
        while (mhtml[indexMhtml] !== LINE_FEED && indexMhtml++ < mhtml.length - 1);
        indexMhtml++;
        const line = mhtml.slice(indexStart, indexMhtml);
        return transferEncoding === QUOTED_PRINTABLE_ENCODING ? decodeQuotedPrintable(line) : line;
    }

    function splitHeaders(line, obj) {
        headerKey = parseHeaderLine(decodeString(line), obj, headerKey);
    }

    // RFC 5322 headers must be ASCII, but a localized writer can emit raw bytes in e.g. "From:" (IE
    // does it for the "Saved by ..." value). They are decoded as UTF-8 while the charset of the
    // document is still unknown, so decode them again once it is, and keep the ones that survived.
    function decodeRawHeaders(charset) {
        if (charset === undefined || charset === UTF8_CHARSET ||
            !Object.values(headers).some(value => value.includes(REPLACEMENT_CHARACTER))) {
            return;
        }
        const decodedHeaders = {};
        let decodedHeaderKey;
        for (const line of rawHeaderLines) {
            decodedHeaderKey = parseHeaderLine(decodeString(line, charset), decodedHeaders, decodedHeaderKey);
        }
        for (const [name, value] of Object.entries(headers)) {
            if (value.includes(REPLACEMENT_CHARACTER) && decodedHeaders[name] !== undefined) {
                headers[name] = decodedHeaders[name];
            }
        }
    }

    function initResource(resourceData) {
        transferEncoding = resourceData[CONTENT_TRANSFER_ENCODING_HEADER];
        const contentType = resourceData[CONTENT_TYPE_HEADER];
        const contentId = resourceData[CONTENT_ID_HEADER];
        let id = resourceData[CONTENT_LOCATION_HEADER];
        if (transferEncoding) {
            transferEncoding = transferEncoding.toLowerCase();
        }
        resource = {
            transferEncoding,
            contentType,
            data: { chunks: [], length: 0 },
            id
        };
        if (id === undefined) {
            if (contentId !== undefined) {
                id = contentId;
            } else {
                do {
                    id = GENERATED_ID_PREFIX + indexGeneratedId++;
                } while (resources[id]);
            }
        }
        const writtenId = id;
        id = normalizeLocation(id);
        resource.id = id;
        if (context.index === undefined && isDocument(contentType)) {
            context.index = id;
        }
        if (contentId !== undefined) {
            frames[contentId] = resource;
        }
        if (!resources[id]) {
            resources[id] = resource;
        }
        // the address as it was written stays reachable, for a reference that is never normalized
        if (writtenId !== id && !resources[writtenId]) {
            resources[writtenId] = resource;
        }
        content = {};
        headerKey = undefined;
    }

    function parseResourceData() {
        let next = getLine(transferEncoding);
        let indexEndData, boundaryFound;
        while (!boundaryFound && next.length) {
            indexEndData = indexMhtml;
            const indexBoundary = findBoundaryDelimiter(next, boundaryBytes);
            if (indexBoundary !== -1) {
                indexEndData = indexEndData - next.length + indexBoundary - 2;
                if (indexBoundary > 2) {
                    next = next.slice(0, indexBoundary - 2);
                } else {
                    next = [];
                }
                boundaryFound = true;
            }
            if (resource.transferEncoding === QUOTED_PRINTABLE_ENCODING) {
                if (resource.data.length > 2 && getDataByte(resource.data, 3) === EQUAL_SIGN && endsWithCRLF(next)) {
                    truncateData(resource.data, 3);
                } else if (resource.data.length > 1 && getDataByte(resource.data, 2) === EQUAL_SIGN && endsWithLF(next)) {
                    truncateData(resource.data, 2);
                }
            } else if (resource.transferEncoding === BASE64_ENCODING) {
                if (endsWithCRLF(next)) {
                    next = next.slice(0, next.length - 2);
                } else if (endsWithLF(next)) {
                    next = next.slice(0, next.length - 1);
                }
            }
            appendData(resource.data, next);
            if (!boundaryFound) {
                next = getLine(transferEncoding);
            }
        }
        truncateDataLineTerminator(resource.data);
        if (!boundaryFound && boundary) {
            indexEndData = indexMhtml;
        }
        return indexEndData;
    }

    function convertEmbeddedMhtml(indexEnd) {
        const context = { resources, frames };
        const embeddedMhtml = mhtml.subarray(indexStartEmbeddedMhtml, indexEnd);
        if (endsWithCRLF(embeddedMhtml)) {
            indexEnd -= 2;
        } else if (endsWithLF(embeddedMhtml)) {
            indexEnd--;
        }
        parse(mhtml.slice(indexStartEmbeddedMhtml, indexEnd), { DOMParser }, context);
        return context.index;
    }

    function processResource() {
        resource.data = resource.rawData = flattenData(resource.data);
        const charset = resource.contentType ? getCharset(resource.contentType) : undefined;
        // the main document and the stylesheets are inlined as text, so a base64 part must be decoded
        // here, otherwise the charset they declare cannot be detected and they are decoded as UTF-8.
        // other parts are kept encoded: they are inlined as data URIs and must stay byte-exact, even
        // when they are mislabeled as text (e.g. a font served as text/plain).
        if (resource.transferEncoding === BASE64_ENCODING && resource.contentType &&
            (resource.id === context.index || isStylesheet(resource.contentType))) {
            const decodedData = decodeBase64Bytes(decodeString(resource.data));
            if (decodedData !== undefined) {
                resource.transferEncoding = undefined;
                resource.data = resource.rawData = decodedData;
            }
        }
        if (resource.transferEncoding === BINARY_ENCODING && (!resource.contentType || !isText(resource.contentType))) {
            resource.transferEncoding = BASE64_ENCODING;
            resource.data = decodeBinary(resource.data);
        } else {
            resource.data = decodeString(resource.data, charset);
        }
        if (resource.contentType) {
            resource.contentType = replaceCharset(resource.contentType, UTF8_CHARSET);
            if (isStylesheet(resource.contentType)) {
                processStylesheetCharset(charset);
            } else if (isDocument(resource.contentType)) {
                const documentCharset = processDocumentCharset(charset);
                if (resource.id === context.index) {
                    decodeRawHeaders(documentCharset);
                }
            }
        }
        delete resource.rawData;
    }

    function processStylesheetCharset(charset) {
        try {
            let ast = cssTree.parse(resource.data);
            if (ast.children.first && ast.children.first.type === AT_RULE && ast.children.first.name.toLowerCase() === CHARSET_IDENTIFIER) {
                const charsetNode = ast.children.first;
                const cssCharset = charsetNode.prelude.children.first.value.toLowerCase();
                if (cssCharset !== UTF8_CHARSET && cssCharset !== charset) {
                    resource.data = decodeString(resource.rawData, cssCharset);
                    ast = cssTree.parse(resource.data);
                }
                ast.children.remove(ast.children.head);
                resource.data = cssTree.generate(ast);
            }
            // eslint-disable-next-line no-unused-vars
        } catch (_) {
            // ignored
        }
    }

    function processDocumentCharset(charset) {
        let documentCharset = charset;
        const contentType = resource.contentType.split(";")[0];
        let dom = parseDOM(resource.data, contentType, DOMParser);
        let charsetMetaElement = getMetaCharsetElement(dom.document.documentElement);
        if (charsetMetaElement) {
            let htmlCharset = charsetMetaElement.getAttribute(CHARSET_ATTRIBUTE);
            if (htmlCharset) {
                htmlCharset = htmlCharset.toLowerCase();
                if (htmlCharset !== UTF8_CHARSET && htmlCharset !== charset) {
                    resource.data = decodeString(resource.rawData, htmlCharset);
                    documentCharset = htmlCharset;
                    dom = parseDOM(resource.data, contentType, DOMParser);
                    charsetMetaElement = getMetaCharsetElement(dom.document.documentElement);
                }
            }
            if (charsetMetaElement) {
                charsetMetaElement.remove();
            }
            resource.data = dom.serialize();
        }
        let metaElement = getMetaContentTypeElement(dom.document.documentElement);
        if (metaElement) {
            const contentType = metaElement.getAttribute(CONTENT_ATTRIBUTE);
            const htmlCharset = getCharset(contentType);
            if (htmlCharset && htmlCharset !== UTF8_CHARSET && htmlCharset !== charset) {
                resource.data = decodeString(resource.rawData, htmlCharset);
                documentCharset = htmlCharset;
                dom = parseDOM(resource.data, contentType, DOMParser);
                metaElement = getMetaContentTypeElement(dom.document.documentElement);
            }
            if (metaElement) {
                metaElement.remove();
            }
            resource.data = dom.serialize();
        }
        return documentCharset;
    }
}

function appendData(data, chunk) {
    if (chunk.length) {
        data.chunks.push(chunk);
        data.length += chunk.length;
    }
}

function getDataByte(data, offsetFromEnd) {
    let offset = offsetFromEnd;
    for (let indexChunk = data.chunks.length - 1; indexChunk >= 0; indexChunk--) {
        const chunk = data.chunks[indexChunk];
        if (chunk.length >= offset) {
            return chunk[chunk.length - offset];
        }
        offset -= chunk.length;
    }
}

// the line terminator preceding a boundary delimiter belongs to the delimiter, not to the resource
// a delimiter line is "--" followed by the boundary, an optional "--" closing the multipart body,
// then only transport padding: a line merely starting with the boundary is not a delimiter
function findBoundaryDelimiter(line, boundaryBytes) {
    const indexBoundary = indexOf(line, boundaryBytes);
    if (indexBoundary >= 2 && line[indexBoundary - 2] === HYPHEN_MINUS && line[indexBoundary - 1] === HYPHEN_MINUS) {
        let index = indexBoundary + boundaryBytes.length;
        if (line[index] === HYPHEN_MINUS && line[index + 1] === HYPHEN_MINUS) {
            index += 2;
        }
        while (line[index] === SPACE || line[index] === HORIZONTAL_TAB) {
            index++;
        }
        if (index >= line.length || line[index] === CARRIAGE_RETURN || line[index] === LINE_FEED) {
            return indexBoundary;
        }
    }
    return -1;
}

function truncateDataLineTerminator(data) {
    if (data.length > 1 && getDataByte(data, 2) === CARRIAGE_RETURN && getDataByte(data, 1) === LINE_FEED) {
        truncateData(data, 2);
    } else if (data.length > 0 && getDataByte(data, 1) === LINE_FEED) {
        truncateData(data, 1);
    }
}

function truncateData(data, count) {
    data.length -= count;
    let remaining = count;
    while (remaining) {
        const chunk = data.chunks[data.chunks.length - 1];
        if (chunk.length > remaining) {
            data.chunks[data.chunks.length - 1] = chunk.subarray(0, chunk.length - remaining);
            remaining = 0;
        } else {
            data.chunks.pop();
            remaining -= chunk.length;
        }
    }
}

function flattenData(data) {
    const result = new Uint8Array(data.length);
    let offset = 0;
    for (const chunk of data.chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

function parseHeaderLine(lineString, obj, headerKey) {
    const indexColumn = lineString.indexOf(HEADER_SEPARATOR);
    if (indexColumn > -1) {
        headerKey = lineString.substring(0, indexColumn).trim().toLowerCase();
        obj[headerKey] = lineString.substring(indexColumn + 1, lineString.length).trim();
    } else if (headerKey !== undefined && obj[headerKey] !== undefined) {
        obj[headerKey] += lineString.trim();
    }
    return headerKey;
}

function getMetaCharsetElement(document) {
    const metaElements = document.getElementsByTagName(META_TAG);
    return Array.from(metaElements).find(metaElement => metaElement.getAttribute(CHARSET_ATTRIBUTE));
}

function getMetaContentTypeElement(document) {
    const metaElements = document.getElementsByTagName(META_TAG);
    return Array.from(metaElements).find(metaElement => metaElement.getAttribute(HTTP_EQUIV_ATTRIBUTE)
        && metaElement.getAttribute(HTTP_EQUIV_ATTRIBUTE).toLowerCase() === CONTENT_TYPE_HEADER.toLowerCase());
}
