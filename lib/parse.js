import {
    decodeQuotedPrintable,
    decodeBinary,
    parseDOM,
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
const RANDOM_ID_PREFIX = "_";
const LINE_FEED = 0x0A;
const EQUAL_SIGN = 0x3D;

export default parse;

function parse(mhtml, { DOMParser } = { DOMParser: globalThis.DOMParser }, context = { resources: {}, frames: {} }) {
    // deno-lint-ignore valid-typeof
    if (typeof mhtml === STRING_TYPE) {
        mhtml = encodeString(mhtml);
    }
    const headers = {};
    const { resources, frames } = context;
    let resource, transferEncoding, boundary, boundaryBytes, headerKey;
    let content = {};
    let state = MHTML_HEADERS;
    let indexMhtml = 0;
    let indexStartEmbeddedMhtml;
    while (state !== MHTML_END && indexMhtml < mhtml.length - 1) {
        let next;
        if (state === MHTML_HEADERS) {
            next = getLine();
            if (!isLineFeed(next)) {
                splitHeaders(next, headers);
            } else {
                if (headers[CONTENT_TYPE_HEADER]) {
                    setBoundary(getBoundary(headers[CONTENT_TYPE_HEADER]));
                }
                if (boundary) {
                    while (indexOf(next, boundaryBytes) === -1 && indexMhtml < mhtml.length - 1) {
                        next = getLine();
                    }
                } else {
                    const previousIndex = indexMhtml;
                    next = getLine(transferEncoding);
                    if (!boundary && startsWithBoundary(next)) {
                        setBoundary(decodeString(next));
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
        const lineString = decodeString(line);
        const indexColumn = lineString.indexOf(HEADER_SEPARATOR);
        if (indexColumn > -1) {
            headerKey = lineString.substring(0, indexColumn).trim().toLowerCase();
            obj[headerKey] = lineString.substring(indexColumn + 1, lineString.length).trim();
        } else if (headerKey !== undefined && obj[headerKey] !== undefined) {
            obj[headerKey] += lineString.trim();
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
                    id = RANDOM_ID_PREFIX + Math.random().toString(36).substring(2);
                } while (resources[id]);
            }
            resource.id = id;
        }
        if (context.index === undefined && isDocument(contentType)) {
            context.index = id;
        }
        if (contentId !== undefined) {
            frames[contentId] = resource;
        }
        if (!resources[id]) {
            resources[id] = resource;
        }
        content = {};
        headerKey = undefined;
    }

    function parseResourceData() {
        let next = getLine(transferEncoding);
        let indexEndData, boundaryFound;
        while (!boundaryFound && indexMhtml < mhtml.length - 1) {
            indexEndData = indexMhtml;
            const indexBoundary = indexOf(next, boundaryBytes);
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
                processDocumentCharset(charset);
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
        const contentType = resource.contentType.split(";")[0];
        let dom = parseDOM(resource.data, contentType, DOMParser);
        let charsetMetaElement = getMetaCharsetElement(dom.document.documentElement);
        if (charsetMetaElement) {
            let htmlCharset = charsetMetaElement.getAttribute(CHARSET_ATTRIBUTE);
            if (htmlCharset) {
                htmlCharset = htmlCharset.toLowerCase();
                if (htmlCharset !== UTF8_CHARSET && htmlCharset !== charset) {
                    resource.data = decodeString(resource.rawData, htmlCharset);
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
                dom = parseDOM(resource.data, contentType, DOMParser);
                metaElement = getMetaContentTypeElement(dom.document.documentElement);
            }
            if (metaElement) {
                metaElement.remove();
            }
            resource.data = dom.serialize();
        }
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

function getMetaCharsetElement(document) {
    const metaElements = document.getElementsByTagName(META_TAG);
    return Array.from(metaElements).find(metaElement => metaElement.getAttribute(CHARSET_ATTRIBUTE));
}

function getMetaContentTypeElement(document) {
    const metaElements = document.getElementsByTagName(META_TAG);
    return Array.from(metaElements).find(metaElement => metaElement.getAttribute(HTTP_EQUIV_ATTRIBUTE)
        && metaElement.getAttribute(HTTP_EQUIV_ATTRIBUTE).toLowerCase() === CONTENT_TYPE_HEADER.toLowerCase());
}
