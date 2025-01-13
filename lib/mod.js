/* global globalThis, URL */

import {
    decodeQuotedPrintable,
    decodeBinary,
    decodeMimeHeader,
    parseDOM,
    removeQuotes,
    decodeBase64,
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
    getResourceURI,
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
const BINARY_ENCODING = "binary";
const CONTENT_TYPE_HEADER = "Content-Type";
const CONTENT_TRANSFER_ENCODING_HEADER = "Content-Transfer-Encoding";
const CONTENT_ID_HEADER = "Content-ID";
const CONTENT_LOCATION_HEADER = "Content-Location";
const BASE64_ENCODING = "base64";
const UTF8_CHARSET = "utf-8";
const HREF_ATTRIBUTE = "href";
const SRC_ATTRIBUTE = "src";
const SRCSET_ATTRIBUTE = "srcset";
const CONTENT_ATTRIBUTE = "content";
const STYLE_ATTRIBUTE = "style";
const MEDIA_ATTRIBUTE = "media";
const BACKGROUND_ATTRIBUTE = "background";
const DATA_ATTRIBUTE = "data";
const STYLE_TAG = "style";
const STYLESHEET_CONTENT_TYPE = "text/css";
const META_CHARSET_SELECTOR = "meta[charset]";
const META_CONTENT_TYPE_SELECTOR = `meta[http-equiv='${CONTENT_TYPE_HEADER}']`;
const CID_PROTOCOL = "cid:";

export { parse, convert };

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
    while (state !== MHTML_FSM.MHTML_END && indexMhtml < mhtml.length - 1) {
        let next;
        if (state === MHTML_FSM.MHTML_HEADERS) {
            next = getLine();
            if (!isLineFeed(next)) {
                splitHeaders(next, headers);
            } else {
                boundary = getBoundary(headers[CONTENT_TYPE_HEADER]);
                if (boundary) {
                    while (indexOf(next, boundary) === -1 && indexMhtml < mhtml.length - 1) {
                        next = getLine();
                    }
                } else {
                    const previousIndex = indexMhtml;
                    next = getLine(transferEncoding);
                    if (!boundary && startsWithBoundary(next)) {
                        boundary = decodeString(next);
                    } else {
                        indexMhtml = previousIndex;
                    }
                }
                content = {};
                state = MHTML_FSM.MTHML_CONTENT;
            }
        } else if (state === MHTML_FSM.MTHML_CONTENT) {
            if (boundary) {
                if (indexStartEmbeddedMhtml === undefined) {
                    indexStartEmbeddedMhtml = indexMhtml;
                }
                next = getLine();
                if (!isLineFeed(next)) {
                    splitHeaders(next, content);
                } else {
                    initResource(content);
                    if (!isMultipartAlternative(resource.contentType)) {
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
    return { headers, frames, resources, index: context.index };

    function getLine(transferEncoding) {
        const indexStart = indexMhtml;
        while (!isLineFeed([mhtml[indexMhtml]]) && indexMhtml++ < mhtml.length - 1);
        indexMhtml++;
        const line = mhtml.slice(indexStart, indexMhtml);
        return transferEncoding === QUOTED_PRINTABLE_ENCODING ? decodeQuotedPrintable(line) : line;
    }

    function splitHeaders(line, obj) {
        const lineString = decodeString(line);
        const indexColumn = lineString.indexOf(":");
        if (indexColumn > -1) {
            headerKey = lineString.substring(0, indexColumn).trim();
            obj[headerKey] = lineString.substring(indexColumn + 1, lineString.length).trim();
        } else {
            obj[headerKey] += lineString.trim();
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
        let indexEndData, boundaryFound;
        while (!boundaryFound && indexMhtml < mhtml.length - 1) {
            indexEndData = indexMhtml;
            const indexBoundary = indexOf(next, boundary);
            if (indexBoundary !== -1) {
                indexEndData = indexEndData - next.length + indexBoundary - 2;
                next = next.slice(0, indexBoundary - 2);
                boundaryFound = true;
            }
            if (resource.transferEncoding === QUOTED_PRINTABLE_ENCODING && resource.data.length) {
                if (resource.data[resource.data.length - 3] === 0x3D && endsWithCRLF(next)) {
                    resource.data.splice(resource.data.length - 3, 3);
                } else if (resource.data[resource.data.length - 2] === 0x3D && endsWithLF(next)) {
                    resource.data.splice(resource.data.length - 2, 2);
                }
            } else if (resource.transferEncoding === BASE64_ENCODING) {
                if (endsWithCRLF(next)) {
                    next = next.slice(0, next.length - 2);
                } else if (endsWithLF(next)) {
                    next = next.slice(0, next.length - 1);
                }
            }
            resource.data.splice(resource.data.length, 0, ...next);
            if (!boundaryFound) {
                next = getLine(transferEncoding);
            }
        }
        return indexEndData;
    }

    function convertEmbeddedMhtml(indexEnd) {
        const context = { resources, frames };
        if (endsWithCRLF(mhtml)) {
            indexEnd -= 2;
        } else if (endsWithLF(mhtml)) {
            indexEnd--;
        }
        parse(mhtml.slice(indexStartEmbeddedMhtml, indexEnd), { DOMParser }, context);
        return context.index;
    }

    function processResource() {
        resource.data = resource.rawData = new Uint8Array(resource.data);
        const charset = getCharset(resource.contentType);
        if (resource.transferEncoding === BINARY_ENCODING && !isText(resource.contentType)) {
            resource.transferEncoding = BASE64_ENCODING;
            resource.data = decodeBinary(resource.data);
        } else {
            resource.data = decodeString(resource.data, charset);
        }
        resource.contentType = replaceCharset(resource.contentType, UTF8_CHARSET);
        if (isStylesheet(resource.contentType)) {
            processStyleSheetCharset(charset);
        } else if (isDocument(resource.contentType)) {
            processDocumentCharset(charset);
        }
        delete resource.rawData;
    }

    function processStyleSheetCharset(charset) {
        try {
            const ast = cssTree.parse(resource.data);
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

function convert({ headers, frames, resources, index }, { DOMParser, enableScripts } = { DOMParser: globalThis.DOMParser, enableScripts: false }) {
    let resource = resources[index];
    if (!resource) {
        throw new Error("Index page not found");
    }
    let base = resource.id;
    if (resource.transferEncoding === BASE64_ENCODING) {
        resource.data = decodeBase64(resource.data, getCharset(resource.contentType));
    }
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
    const canonicalLink = document.querySelector("link[rel='canonical']");
    if (!canonicalLink) {
        const linkElement = document.createElement("link");
        linkElement.setAttribute("rel", "canonical");
        linkElement.setAttribute(HREF_ATTRIBUTE, index);
        document.head.appendChild(linkElement);
    }
    document.querySelectorAll("meta[http-equiv='Content-Security-Policy']").forEach(element => element.remove());
    const metaCSP = document.createElement("meta");
    metaCSP.setAttribute("http-equiv", "Content-Security-Policy");
    metaCSP.setAttribute("content", "default-src 'none'; connect-src 'self' data:; font-src 'self' data:; img-src 'self' data:; style-src 'self' 'unsafe-inline' data:; frame-src 'self' data:; media-src 'self' data:; script-src 'self' 'unsafe-inline' data:; object-src 'self' data:;");
    if (document.head.firstChild) {
        document.head.firstChild.before(metaCSP);
    } else {
        document.head.appendChild(metaCSP);
    }
    const replacedAttributeValue = document.querySelectorAll("link[rel~=preconnect], link[rel~=prerender], link[rel~=dns-prefetch], link[rel~=preload], link[rel~=manifest], link[rel~=prefetch], link[rel~=modulepreload]");
    replacedAttributeValue.forEach(element => {
        const relValue = element
            .getAttribute("rel")
            .replace(/(preconnect|prerender|dns-prefetch|preload|prefetch|manifest|modulepreload)/g, "")
            .trim();
        if (relValue.length) {
            element.setAttribute("rel", relValue);
        } else {
            element.remove();
        }
    });
    if (headers) {
        const pageInfo = {
            "@context": "https://schema.org",
            "@type": "WebPage",
            "url": index,
            "name": decodeMimeHeader(headers["Subject"]),
            "dateCreated": headers["Date"],
            "additionalProperty": {
                "@type": "PropertyValue",
                "name": "savedBy",
                "value": decodeMimeHeader(headers["From"])
            }
        };
        const pageInfoElement = document.createElement("script");
        pageInfoElement.setAttribute("type", "application/ld+json");
        pageInfoElement.textContent = JSON.stringify(pageInfo, null, 2);
        if (document.head.firstChild) {
            document.head.firstChild.after(pageInfoElement);
        } else {
            document.head.appendChild(pageInfoElement);
        }
    }
    document.querySelectorAll("meta[http-equiv=refresh]").forEach(element => element.remove());
    const stylesheets = {};
    while (nodes.length) {
        const childNode = nodes.shift();
        for (const child of childNode.childNodes) {
            let href, src;
            if (child.getAttribute) {
                href = child.getAttribute(HREF_ATTRIBUTE);
                if (href) {
                    try {
                        href = new URL(href, base).href;
                    } catch (_) {
                        // ignored
                    }
                }
                src = child.getAttribute(SRC_ATTRIBUTE);
                if (src) {
                    try {
                        src = new URL(src, base).href;
                    } catch (_) {
                        // ignored
                    }
                }
                const style = child.getAttribute(STYLE_ATTRIBUTE);
                if (style) {
                    child.setAttribute(STYLE_ATTRIBUTE, replaceStyleSheetUrls(resources, base, { data: style }, { context: "declarationList" }), stylesheets);
                }
            }
            if (child.removeAttribute) {
                child.removeAttribute("integrity");
                if (!enableScripts) {
                    EVENT_HANDLER_ATTRIBUTES.forEach(attribute => child.removeAttribute(attribute));
                }
            }
            if (child.tagName == "LINK") {
                resource = getResource(resources, href, child.getAttribute(HREF_ATTRIBUTE));
                const rel = child.getAttribute("rel").toLowerCase();
                if (resource && isStylesheet(resource.contentType) && rel === "stylesheet") {
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
                    resource.data = replaceStyleSheetUrls(resources, resourceBase, resource, { context: "stylesheet" }, stylesheets);
                    styleElement.appendChild(document.createTextNode(resource.data));
                    childNode.replaceChild(styleElement, child);
                }
                if (resource && isImage(resource.contentType) && rel.includes("icon")) {
                    try {
                        child.setAttribute(HREF_ATTRIBUTE, getResourceURI(resource));
                    } catch (_) {
                        // ignored
                    }
                }
            } else if (child.tagName == "STYLE") {
                const styleElement = document.createElement(STYLE_TAG);
                styleElement.type = STYLESHEET_CONTENT_TYPE;
                const media = child.getAttribute(MEDIA_ATTRIBUTE);
                if (media) {
                    styleElement.setAttribute(MEDIA_ATTRIBUTE, media);
                }
                styleElement.appendChild(document.createTextNode(replaceStyleSheetUrls(resources, index, { data: child.textContent }, { context: "stylesheet" }, stylesheets)));
                childNode.replaceChild(styleElement, child);
            } else if (child.tagName == "IMG") {
                resource = getResource(resources, src, child.getAttribute(SRC_ATTRIBUTE));
                if (resource && isImage(resource.contentType)) {
                    try {
                        child.setAttribute(SRC_ATTRIBUTE, getResourceURI(resource));
                    } catch (_) {
                        // ignored
                    }
                }
                const srcset = child.getAttribute(SRCSET_ATTRIBUTE);
                if (srcset) {
                    const sources = srcset.split(",").map(source => source.trim().split(" "));
                    sources.forEach(source => {
                        try {
                            const src = new URL(source[0], base).href;
                            const resource = getResource(resources, src, source[0]);
                            if (resource && isImage(resource.contentType)) {
                                source[0] = getResourceURI(resource);
                            }
                        } catch (_) {
                            // ignored
                        }
                    });
                    child.setAttribute(SRCSET_ATTRIBUTE, sources.map(source => source.join(" ")).join(","));
                }
            } else if (child.tagName == "BODY" || child.tagName == "TABLE" || child.tagName == "TD" || child.tagName == "TH") {
                let background = child.getAttribute(BACKGROUND_ATTRIBUTE);
                if (background) {
                    try {
                        background = new URL(background, base).href;
                    } catch (_) {
                        // ignored
                    }
                    resource = getResource(resources, background, child.getAttribute(BACKGROUND_ATTRIBUTE));
                    if (resource && isImage(resource.contentType)) {
                        try {
                            child.setAttribute(BACKGROUND_ATTRIBUTE, getResourceURI(resource));
                        } catch (_) {
                            // ignored
                        }
                    }
                }
            } else if (child.tagName == "AUDIO") {
                resource = getResource(resources, src, child.getAttribute(SRC_ATTRIBUTE));
                if (resource && isAudio(resource.contentType)) {
                    try {
                        child.setAttribute(SRC_ATTRIBUTE, getResourceURI(resource));
                    } catch (_) {
                        // ignored
                    }
                }
            } else if (child.tagName == "VIDEO") {
                resource = getResource(resources, src, child.getAttribute(SRC_ATTRIBUTE));
                if (resource && isVideo(resource.contentType)) {
                    try {
                        child.setAttribute(SRC_ATTRIBUTE, getResourceURI(resource));
                    } catch (_) {
                        // ignored
                    }
                }
            } else if (child.tagName == "SOURCE") {
                resource = getResource(resources, src, child.getAttribute(SRC_ATTRIBUTE));
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
            } else if (child.tagName == "IFRAME") {
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
            } else if (child.tagName == "FRAME") {
                if (src) {
                    let id, frame;
                    if (src.startsWith(CID_PROTOCOL)) {
                        id = `<${src.split(CID_PROTOCOL)[1]}>`;
                        frame = frames[id];
                    } else {
                        frame = resources[src];
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
            } else if (child.tagName == "A" || child.tagName == "AREA") {
                if (href) {
                    child.setAttribute(HREF_ATTRIBUTE, href);
                }
                child.removeAttribute("ping");
            } else if (child.tagName == "SCRIPT") {
                if (src) {
                    resource = getResource(resources, src, child.getAttribute(SRC_ATTRIBUTE));
                    if (resource) {
                        try {
                            child.setAttribute(SRC_ATTRIBUTE, getResourceURI(resource));
                        } catch (_) {
                            // ignored
                        }
                    }
                }
            } else if (child.tagName == "OBJECT") {
                const data = child.getAttribute(DATA_ATTRIBUTE);
                if (data) {
                    if (data.startsWith(CID_PROTOCOL)) {
                        resource = frames[`<${data.split(CID_PROTOCOL)[1]}>`];
                    } else {
                        resource = getResource(resources, data, child.getAttribute(DATA_ATTRIBUTE));
                    }
                    if (resource) {
                        try {
                            child.setAttribute(DATA_ATTRIBUTE, getResourceURI(resource));
                        } catch (_) {
                            // ignored
                        }
                    }
                }
            } else if (child.tagName == "EMBED") {
                if (src) {
                    if (src.startsWith(CID_PROTOCOL)) {
                        resource = frames[`<${src.split(CID_PROTOCOL)[1]}>`];
                    } else {
                        resource = getResource(resources, src, child.getAttribute(SRC_ATTRIBUTE));
                    }
                    if (resource) {
                        try {
                            child.setAttribute(SRC_ATTRIBUTE, getResourceURI(resource));
                        } catch (_) {
                            // ignored
                        }
                    }
                }
            }
            nodes.push(child);
        }
    }
    return dom.serialize();
}

function getResource(resources, id, rawId) {
    let resource = resources[id];
    if (!resource) {
        resource = resources[rawId];
    }
    return resource;
}

function replaceStyleSheetUrls(resources, base, resource, options = {}, stylesheets) {
    let ast;
    try {
        if (resource.id !== undefined) {
            if (stylesheets[resource.id]) {
                return stylesheets[resource.id].data;
            } else {
                stylesheets[resource.id] = {};
            }
        }
        ast = cssTree.parse(resource.data, options);
    } catch (_) {
        // ignored
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
                const resource = getResource(resources, id, path);
                if (resource) {
                    if (isStylesheet(resource.contentType)) {
                        resource.data = replaceStyleSheetUrls(resources, resource.id, resource, { context: "stylesheet" }, stylesheets);
                    }
                    try {
                        node.value = getResourceURI(resource);
                    } catch (_) {
                        // ignored
                    }
                }
            } else if (node.type === "Atrule" && node.name === "import") {
                const path = node.prelude.children.first.value;
                let id;
                try {
                    id = new URL(removeQuotes(path), base).href;
                } catch (_) {
                    id = path;
                }
                let resource = resources[id];
                if (!resource) {
                    resource = resources[path];
                }
                if (resource) {
                    if (isStylesheet(resource.contentType)) {
                        resource.data = replaceStyleSheetUrls(resources, resource.id, resource, { context: "stylesheet" }, stylesheets);
                    }
                    try {
                        node.prelude.children.first.value = getResourceURI(resource);
                    } catch (_) {
                        // ignored
                    }
                }
            }
        });
        try {
            const result = cssTree.generate(ast);
            if (resource.id !== undefined) {
                stylesheets[resource.id].data = result;
            }
            return result;
        } catch (_) {
            return resource.data;
        }
    } else {
        return resource.data;
    }
}
