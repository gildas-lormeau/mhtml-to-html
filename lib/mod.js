/* global globalThis, URL */

import {
    decodeQuotedPrintable,
    encodeBase64,
    parseDOM,
    removeQuotes,
    decodeString,
    encodeString,
    getCharset,
    isDocument,
    isStylesheet,
    isImage,
    isAudio,
    isVideo,
    EVENT_HANDLER_ATTRIBUTES
} from "./util.js";
import * as cssTree from "./vendor/csstree.esm.js";

const MHTML_FSM = {
    MHTML_HEADERS: 0,
    MTHML_CONTENT: 1,
    MHTML_DATA: 2,
    MHTML_END: 3
};

const QUOTED_PRINTABLE_ENCODING = "quoted-printable";
const CONTENT_TYPE_HEADER = "Content-Type";
const CONTENT_TRANSFER_ENCODING_HEADER = "Content-Transfer-Encoding";
const CONTENT_ID_HEADER = "Content-ID";
const CONTENT_LOCATION_HEADER = "Content-Location";
const BASE64_ENCODING = "base64";
const UTF8_CHARSET = "utf-8";
const CRLF = "\r\n";
const LF = "\n";
const CR_CODE = 0x0D;
const LF_CODE = 0x0A;
const HREF_ATTRIBUTE = "href";
const SRC_ATTRIBUTE = "src";
const SRCSET_ATTRIBUTE = "srcset";
const CONTENT_ATTRIBUTE = "content";
const STYLE_ATTRIBUTE = "style";
const MEDIA_ATTRIBUTE = "media";
const STYLE_TAG = "style";
const STYLESHEET_CONTENT_TYPE = "text/css";
const META_CHARSET_SELECTOR = "meta[charset]";
const META_CONTENT_TYPE_SELECTOR = `meta[http-equiv='${CONTENT_TYPE_HEADER}']`;
const CID_PROTOCOL = "cid:";

function parse(mhtml, { DOMParser } = { DOMParser: globalThis.DOMParser }, context = { resources: {}, frames: {} }) {
    if (typeof mhtml === "string") {
        mhtml = encodeString(mhtml);
    }
    const headers = {};
    const { resources, frames } = context;
    let resource, transferEncoding, boundary, headerKey;
    let content = {};
    let state = MHTML_FSM.MHTML_HEADERS;
    let indexMhtml = 0;
    let indexStartEmbeddedMhtml;
    while (state !== MHTML_FSM.MHTML_END) {
        let next, nextString;
        if (state === MHTML_FSM.MHTML_HEADERS) {
            next = getLine();
            nextString = decodeString(next);
            if (nextString !== CRLF && nextString !== LF) {
                splitHeaders(nextString, headers);
            } else {
                const contentTypeParams = headers[CONTENT_TYPE_HEADER].split(";");
                contentTypeParams.shift();
                const boundaryParam = contentTypeParams.find(param => param.startsWith("boundary="));
                if (boundaryParam) {
                    boundary = removeQuotes(boundaryParam.substring(9));
                    while (!nextString.includes(boundary) && indexMhtml < mhtml.length - 1) {
                        next = getLine();
                        nextString = decodeString(next);
                    }
                } else {
                    const previousIndex = indexMhtml;
                    next = getLine(transferEncoding);
                    nextString = decodeString(next);
                    if (!boundary && nextString.startsWith("--")) {
                        boundary = nextString;
                    } else {
                        indexMhtml = previousIndex;
                    }
                }
                content = {};
                headerKey = null;
                state = MHTML_FSM.MTHML_CONTENT;
            }
        } else if (state === MHTML_FSM.MTHML_CONTENT) {
            if (boundary) {
                if (indexStartEmbeddedMhtml === undefined) {
                    indexStartEmbeddedMhtml = indexMhtml;
                }
                next = getLine();
                nextString = decodeString(next);
                if (nextString !== CRLF && nextString !== LF) {
                    splitHeaders(nextString, content);
                } else {
                    initResource(content);
                    if (!resource.contentType.startsWith("multipart/alternative;")) {
                        indexStartEmbeddedMhtml = undefined;
                    }
                    state = MHTML_FSM.MHTML_DATA;
                }
            } else {
                initResource(headers);
                state = MHTML_FSM.MHTML_DATA;
            }
        } else if (state === MHTML_FSM.MHTML_DATA) {
            const indexEndData = parseResourceData();
            if (indexStartEmbeddedMhtml !== undefined && indexEndData !== undefined) {
                context.index = convertEmbeddedMhtml(indexEndData);
            } else {
                processResource();
            }
            state = (indexMhtml >= mhtml.length - 1 ? MHTML_FSM.MHTML_END : MHTML_FSM.MTHML_CONTENT);
        }
    }
    return { frames, resources, index: context.index };

    function getLine(transferEncoding) {
        const indexStart = indexMhtml;
        while (mhtml[indexMhtml] !== LF_CODE && indexMhtml++ < mhtml.length - 1);
        indexMhtml++;
        const line = mhtml.slice(indexStart, indexMhtml);
        return transferEncoding === QUOTED_PRINTABLE_ENCODING ? decodeQuotedPrintable(line) : line;
    }

    function splitHeaders(line, obj) {
        const indexColumn = line.indexOf(":");
        if (indexColumn > -1) {
            headerKey = line.substring(0, indexColumn).trim();
            obj[headerKey] = line.substring(indexColumn + 1, line.length).trim();
        } else {
            obj[headerKey] += line.trim();
        }
    }

    function initResource(resourceData) {
        transferEncoding = resourceData[CONTENT_TRANSFER_ENCODING_HEADER];
        const contentType = resourceData[CONTENT_TYPE_HEADER];
        const contentId = resourceData[CONTENT_ID_HEADER];
        let id = resourceData[CONTENT_LOCATION_HEADER];
        resource = {
            transferEncoding,
            contentType,
            data: [],
            id
        };
        if (id === undefined) {
            do {
                id = "_" + Math.random().toString(36).substring(2);
            } while (resources[id]);
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
    }

    function parseResourceData() {
        let next = getLine(transferEncoding);
        let nextString = decodeString(next);
        let indexEndData;
        while ((!boundary || !nextString.includes(boundary)) && indexMhtml < mhtml.length - 1) {
            indexEndData = indexMhtml;
            if (resource.transferEncoding === QUOTED_PRINTABLE_ENCODING && resource.data.length) {
                if (resource.data[resource.data.length - 3] === 0x3D && resource.data[resource.data.length - 2] === CR_CODE && resource.data[resource.data.length - 1] === LF_CODE) {
                    resource.data.splice(resource.data.length - 3, 3);
                } else if (resource.data[resource.data.length - 2] === 0x3D && resource.data[resource.data.length - 1] === LF_CODE) {
                    resource.data.splice(resource.data.length - 2, 2);
                }
            }
            resource.data.splice(resource.data.length, 0, ...next);
            next = getLine(transferEncoding);
            nextString = decodeString(next);
        }
        if (resource.transferEncoding === BASE64_ENCODING) {
            resource.data = resource.data.filter(byte => byte !== CR_CODE && byte !== LF_CODE);
        }
        return indexEndData;
    }

    function convertEmbeddedMhtml(indexEnd) {
        const context = { resources, frames };
        if (mhtml[indexEnd - 1] === LF_CODE) {
            indexEnd--;
            if (mhtml[indexEnd - 2] === CR_CODE) {
                indexEnd--;
            }
        }
        parse(mhtml.slice(indexStartEmbeddedMhtml, indexEnd), { DOMParser }, context);
        return context.index;
    }

    function processResource() {
        resource.data = resource.rawData = new Uint8Array(resource.data);
        const charset = getCharset(resource.contentType);
        resource.data = decodeString(resource.data, charset);
        resource.contentType = resource.contentType.replace(/charset=[^;]+/i, `charset=${UTF8_CHARSET}`);
        if (isStylesheet(resource.contentType)) {
            processStyleSheetCharset(charset);
        } else if (isDocument(resource.contentType)) {
            processDocumentCharset(charset);
        }
    }

    function processStyleSheetCharset(charset) {
        const ast = cssTree.parse(resource.data);
        try {
            if (ast.children.first && ast.children.first.type === "Atrule" && ast.children.first.name === "charset") {
                const charsetNode = ast.children.first;
                const cssCharset = charsetNode.prelude.children.first.value.toLowerCase();
                if (cssCharset !== UTF8_CHARSET && cssCharset !== charset) {
                    resource.data = decodeString(resource.rawData, cssCharset);
                    const ast = cssTree.parse(resource.data);
                    ast.children.shift();
                    resource.data = cssTree.generate(ast);
                }
            }
        } catch (_) {
            // ignored
        }
    }

    function processDocumentCharset(charset) {
        let dom = parseDOM(resource.data, DOMParser);
        const documentElement = dom.document;
        let charserMetaElement = documentElement.querySelector(META_CHARSET_SELECTOR);
        try {
            if (charserMetaElement) {
                const htmlCharset = charserMetaElement.getAttribute("charset").toLowerCase();
                if (htmlCharset && htmlCharset !== UTF8_CHARSET && htmlCharset !== charset) {
                    resource.data = decodeString(resource.rawData, charset);
                    dom = parseDOM(resource.data, DOMParser);
                    charserMetaElement = dom.document.documentElement.querySelector(META_CHARSET_SELECTOR);
                }
                charserMetaElement.remove();
                resource.data = dom.serialize();
            }
            let metaElement = documentElement.querySelector(META_CONTENT_TYPE_SELECTOR);
            if (metaElement) {
                const contentType = metaElement.getAttribute(CONTENT_ATTRIBUTE);
                const htmlCharset = getCharset(contentType);
                if (htmlCharset && htmlCharset !== UTF8_CHARSET && htmlCharset !== charset) {
                    resource.data = decodeString(resource.rawData, htmlCharset);
                    dom = parseDOM(resource.data, DOMParser);
                    metaElement = dom.document.documentElement.querySelector(META_CONTENT_TYPE_SELECTOR);
                }
                metaElement.remove();
                resource.data = dom.serialize();
            }
        } catch (_) {
            // ignored
        }
    }
}

function convert({ frames, resources, index }, { DOMParser, enableScripts } = { DOMParser: globalThis.DOMParser, enableScripts: false }) {
    let resource = resources[index];
    let base = resource.id;
    const dom = parseDOM(resource.data, DOMParser);
    const document = dom.document;
    const nodes = [document];
    const baseElement = document.querySelector("base");
    if (baseElement) {
        const href = baseElement.getAttribute(HREF_ATTRIBUTE);
        if (href) {
            try {
                base = new URL(baseElement.getAttribute(HREF_ATTRIBUTE), base).href;
            } catch (_) {
                // ignored
            }
        }
        baseElement.remove();
    }
    if (!enableScripts) {
        document.querySelectorAll("script").forEach(scriptElement => scriptElement.remove());
    }
    document.querySelectorAll("link[rel='stylesheet'][title], style[title]").forEach(element => element.remove());
    while (nodes.length) {
        const childNode = nodes.shift();
        let srcset, href, src;
        childNode.childNodes.forEach(child => {
            if (child.getAttribute) {
                try {
                    href = new URL(child.getAttribute(HREF_ATTRIBUTE), base).href;
                } catch (_) {
                    href = child.getAttribute(HREF_ATTRIBUTE);
                }
                try {
                    src = new URL(child.getAttribute(SRC_ATTRIBUTE), base).href;
                } catch (_) {
                    src = child.getAttribute(SRC_ATTRIBUTE);
                }
                const style = child.getAttribute(STYLE_ATTRIBUTE);
                if (style) {
                    child.setAttribute(STYLE_ATTRIBUTE, replaceStyleSheetUrls(resources, base, style, { context: "declarationList" }));
                }
            }
            if (child.removeAttribute) {
                child.removeAttribute("integrity");
                if (!enableScripts) {
                    EVENT_HANDLER_ATTRIBUTES.forEach(attribute => child.removeAttribute(attribute));
                }
            }
            switch (child.tagName) {
                case "LINK":
                    resource = resources[href];
                    if (resource && isStylesheet(resource.contentType)) {
                        const styleElement = document.createElement(STYLE_TAG);
                        styleElement.type = STYLESHEET_CONTENT_TYPE;
                        const media = child.getAttribute(MEDIA_ATTRIBUTE);
                        if (media) {
                            styleElement.setAttribute(MEDIA_ATTRIBUTE, media);
                        }
                        let resourceBase = resource.id;
                        if (resourceBase.startsWith(CID_PROTOCOL)) {
                            resourceBase = index;
                        }
                        resource.data = replaceStyleSheetUrls(resources, resourceBase, resource.data);
                        styleElement.appendChild(document.createTextNode(resource.data));
                        childNode.replaceChild(styleElement, child);
                    }
                    break;
                case "STYLE":
                    {
                        const styleElement = document.createElement(STYLE_TAG);
                        styleElement.type = STYLESHEET_CONTENT_TYPE;
                        const media = child.getAttribute(MEDIA_ATTRIBUTE);
                        if (media) {
                            styleElement.setAttribute(MEDIA_ATTRIBUTE, media);
                        }
                        styleElement.appendChild(document.createTextNode(replaceStyleSheetUrls(resources, index, child.textContent)));
                        childNode.replaceChild(styleElement, child);
                    }
                    break;
                case "IMG":
                    resource = resources[src];
                    if (resource && isImage(resource.contentType)) {
                        try {
                            child.setAttribute(SRC_ATTRIBUTE, getResourceURI(resource));
                        } catch (_) {
                            // ignored
                        }
                    }
                    srcset = child.getAttribute(SRCSET_ATTRIBUTE);
                    if (srcset) {
                        const sources = srcset.split(",").map(source => source.trim().split(" "));
                        sources.forEach(source => {
                            try {
                                const src = new URL(source[0], base).href;
                                const resource = resources[src];
                                if (resource && isImage(resource.contentType)) {
                                    source[0] = getResourceURI(resource);
                                }
                            } catch (_) {
                                // ignored
                            }
                        });
                        child.setAttribute(SRCSET_ATTRIBUTE, sources.map(source => source.join(" ")).join(","));
                    }
                    break;
                case "BODY":
                case "TABLE":
                case "TD":
                case "TH":
                    if (child.getAttribute("background")) {
                        resource = resources[child.getAttribute("background")];
                        if (resource && isImage(resource.contentType)) {
                            try {
                                child.setAttribute("background", getResourceURI(resource));
                            } catch (_) {
                                // ignored
                            }
                        }
                    }
                    break;
                case "AUDIO":
                    resource = resources[src];
                    if (resource && isAudio(resource.contentType)) {
                        try {
                            child.setAttribute(SRC_ATTRIBUTE, getResourceURI(resource));
                        } catch (_) {
                            // ignored
                        }
                    }
                    break;
                case "VIDEO":
                    resource = resources[src];
                    if (resource && isVideo(resource.contentType)) {
                        try {
                            child.setAttribute(SRC_ATTRIBUTE, getResourceURI(resource));
                        } catch (_) {
                            // ignored
                        }
                    }
                    break;
                case "SOURCE":
                    resource = resources[src];
                    if (resource && (
                        (child.parentNode.tagName === "AUDIO" && isAudio(resource.contentType)) ||
                        (child.parentNode.tagName === "VIDEO" && isVideo(resource.contentType)) ||
                        (child.parentNode.tagName === "PICTURE") && isImage(resource.contentType))) {
                        try {
                            child.setAttribute(SRC_ATTRIBUTE, getResourceURI(resource));
                        } catch (_) {
                            // ignored
                        }
                    }
                    break;
                case "IFRAME":
                    if (src) {
                        let id, frame;
                        if (src.startsWith(CID_PROTOCOL)) {
                            id = `<${src.split(CID_PROTOCOL)[1]}>`;
                            frame = frames[id];
                        } else {
                            id = src;
                            frame = resources[id];
                        }
                        if (frame) {
                            const html = convert({
                                resources: Object.assign({}, resources, { [id]: frame }),
                                frames: frames,
                                index: id
                            }, { DOMParser, enableScripts });
                            child.removeAttribute(SRC_ATTRIBUTE);
                            child.setAttribute("srcdoc", html);
                        }
                    }
                    break;
                case "FRAME":
                    if (src) {
                        let id, frame;
                        if (src.startsWith(CID_PROTOCOL)) {
                            id = `<${src.split(CID_PROTOCOL)[1]}>`;
                            frame = frames[id];
                        } else {
                            id = new URL(src, base).href;
                            frame = resources[id];
                        }
                        if (frame) {
                            const html = convert({
                                resources: Object.assign({}, resources, { [id]: frame }),
                                frames: frames,
                                index: id
                            }, { DOMParser, enableScripts });
                            child.setAttribute(SRC_ATTRIBUTE, `data:text/html,${encodeURIComponent(html)}`);
                        }
                    }
                    break;
                case "A":
                case "AREA":
                    if (href) {
                        child.setAttribute(HREF_ATTRIBUTE, href);
                    }
                    child.removeAttribute("ping");
                    break;
                case "SCRIPT":
                    if (src) {
                        resource = resources[src];
                        if (resource) {
                            try {
                                child.setAttribute(SRC_ATTRIBUTE, getResourceURI(resource));
                            } catch (_) {
                                // ignored
                            }
                        }
                    }
                    break;
                default:
                    break;
            }
            nodes.push(child);
        });
    }
    return dom.serialize();
}

export { parse, convert };

function replaceStyleSheetUrls(resources, base, resource, options = {}) {
    let ast;
    try {
        ast = cssTree.parse(resource, options);
    } catch (_) {
        // ignored
        return resource;
    }
    if (ast) {
        cssTree.walk(ast, node => {
            if (node.type === "Url") {
                const path = node.value;
                let id;
                try {
                    id = new URL(removeQuotes(path), base).href;
                } catch (_) {
                    id = path;
                }
                const resource = resources[id];
                if (resource) {
                    if (isStylesheet(resource.contentType)) {
                        resource.data = replaceStyleSheetUrls(resources, resource.id, resource.data);
                    }
                    try {
                        node.value = getResourceURI(resource);
                    } catch (_) {
                        // ignored
                    }
                }
            }
        });
        return cssTree.generate(ast);
    }
}

function getResourceURI({ contentType, transferEncoding, data }) {
    return `data:${contentType};${BASE64_ENCODING},${transferEncoding === BASE64_ENCODING ? data : encodeBase64(data)}`;
}
