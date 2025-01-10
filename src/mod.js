/* global globalThis, URL */

import { decodeQuotedPrintable, encodeBase64, parseDOM, removeQuotes, decodeString, getCharset, isDocument, isStylesheet, isImage, isAudio, isVideo } from "./util.js";
import * as cssTree from "./lib/csstree.esm.js";

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
const HREF_ATTRIBUTE = "href";
const SRC_ATTRIBUTE = "src";
const CONTENT_ATTRIBUTE = "content";
const STYLE_ATTRIBUTE = "style";
const MEDIA_ATTRIBUTE = "media";
const STYLE_TAG = "style";
const STYLESHEET_CONTENT_TYPE = "text/css";
const META_CHARSET_SELECTOR = "meta[charset]";
const META_CONTENT_TYPE_SELECTOR = `meta[http-equiv='${CONTENT_TYPE_HEADER}']`;

function parse(mhtml, { DOMParser } = { DOMParser: globalThis.DOMParser }, context = { resources: {}, frames: {} }) {
    const headers = {};
    const { resources, frames } = context;
    let resource, transferEncoding, boundary, headerKey;
    let content = {};
    let state = MHTML_FSM.MHTML_HEADERS;
    let indexMhtml = 0;
    let indexStartEmbeddedMhtml;
    while (state !== MHTML_FSM.MHTML_END) {
        if (state === MHTML_FSM.MHTML_HEADERS) {
            let next = getLine();
            let nextString = decodeString(next);
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
                const next = getLine();
                const nextString = decodeString(next);
                if (nextString !== CRLF && nextString !== LF) {
                    splitHeaders(nextString, content);
                } else {
                    transferEncoding = content[CONTENT_TRANSFER_ENCODING_HEADER];
                    const contentType = content[CONTENT_TYPE_HEADER];
                    const contentId = content[CONTENT_ID_HEADER];
                    const id = content[CONTENT_LOCATION_HEADER];
                    if (!contentType.startsWith("multipart/alternative;")) {
                        indexStartEmbeddedMhtml = undefined;
                    }
                    initResource(contentType, contentId, id);
                    state = MHTML_FSM.MHTML_DATA;
                }
            } else {
                transferEncoding = headers[CONTENT_TRANSFER_ENCODING_HEADER];
                const contentType = headers[CONTENT_TYPE_HEADER];
                const contentId = headers[CONTENT_ID_HEADER];
                const id = headers[CONTENT_LOCATION_HEADER];
                initResource(contentType, contentId, id);
                state = MHTML_FSM.MHTML_DATA;
            }
        } else if (state === MHTML_FSM.MHTML_DATA) {
            let next = getLine(transferEncoding);
            let nextString = decodeString(next);
            let indexEndEmbeddedMhtml;
            while ((!boundary || !nextString.includes(boundary)) && indexMhtml < mhtml.length - 1) {
                indexEndEmbeddedMhtml = indexMhtml;
                if (resource.transferEncoding === QUOTED_PRINTABLE_ENCODING && resource.data.length) {
                    if (resource.data[resource.data.length - 3] === 0x3D && resource.data[resource.data.length - 2] === 0x0D && resource.data[resource.data.length - 1] === 0x0A) {
                        resource.data.splice(resource.data.length - 3, 3);
                    } else if (resource.data[resource.data.length - 2] === 0x3D && resource.data[resource.data.length - 1] === 0x0A) {
                        resource.data.splice(resource.data.length - 2, 2);
                    }
                }
                resource.data.splice(resource.data.length, 0, ...next);
                if (resource.transferEncoding === BASE64_ENCODING) {
                    resource.data = resource.data.filter(byte => byte !== 0x0D && byte !== 0x0A);
                }
                next = getLine(transferEncoding);
                nextString = decodeString(next);
            }
            if (indexStartEmbeddedMhtml !== undefined && indexEndEmbeddedMhtml !== undefined) {
                const contextEmbeddedMhtml = { resources, frames };
                if (mhtml[indexEndEmbeddedMhtml - 1] === 0x0A) {
                    indexEndEmbeddedMhtml--;
                    if (mhtml[indexEndEmbeddedMhtml - 2] === 0x0D) {
                        indexEndEmbeddedMhtml--;
                    }
                }
                parse(mhtml.slice(indexStartEmbeddedMhtml, indexEndEmbeddedMhtml), { DOMParser }, contextEmbeddedMhtml);
                context.index = contextEmbeddedMhtml.index;
            } else {
                resource.data = resource.rawData = new Uint8Array(resource.data);
                const charset = getCharset(resource.contentType);
                resource.data = decodeString(resource.data, charset);
                if (isStylesheet(resource.contentType)) {
                    processStyleSheetCharset(charset);
                } else if (isDocument(resource.contentType)) {
                    processDocumentCharset(charset);
                }
            }
            state = (indexMhtml >= mhtml.length - 1 ? MHTML_FSM.MHTML_END : MHTML_FSM.MTHML_CONTENT);
        }
    }
    return { frames, resources, index: context.index };

    function getLine(transferEncoding) {
        const indexStart = indexMhtml;
        while (mhtml[indexMhtml] !== 0x0A && indexMhtml++ < mhtml.length - 1);
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

    function initResource(contentType, contentId, id) {
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
        } catch (error) {
            // eslint-disable-next-line no-console
            console.warn(error);
        }
    }

    function processDocumentCharset(charset) {
        const dom = parseDOM(resource.data, DOMParser);
        const documentElement = dom.document;
        let charserMetaElement = documentElement.querySelector(META_CHARSET_SELECTOR);
        try {
            if (charserMetaElement) {
                const htmlCharset = charserMetaElement.getAttribute("charset").toLowerCase();
                if (htmlCharset && htmlCharset !== UTF8_CHARSET && htmlCharset !== charset) {
                    resource.data = decodeString(resource.rawData, charset);
                    const dom = parseDOM(resource.data, DOMParser);
                    charserMetaElement = dom.document.documentElement.querySelector(META_CHARSET_SELECTOR);
                }
                charserMetaElement.remove();
                resource.data = dom.serialize();
            }
            let metaElement = documentElement.querySelector(META_CONTENT_TYPE_SELECTOR);
            if (metaElement) {
                resource.contentType = metaElement.getAttribute(CONTENT_ATTRIBUTE);
                const htmlCharset = getCharset(resource.contentType);
                if (htmlCharset && htmlCharset !== UTF8_CHARSET && htmlCharset !== charset) {
                    resource.data = decodeString(resource.rawData, htmlCharset);
                    const dom = parseDOM(resource.data, DOMParser);
                    metaElement = dom.document.documentElement.querySelector(META_CONTENT_TYPE_SELECTOR);
                }
                metaElement.remove();
                resource.data = dom.serialize();
            }
        } catch (error) {
            // eslint-disable-next-line no-console
            console.warn(error);
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
    while (nodes.length) {
        const childNode = nodes.shift();
        let srcset, href, src, title;
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
                title = child.getAttribute("title");
                const style = child.getAttribute(STYLE_ATTRIBUTE);
                if (style) {
                    child.setAttribute(STYLE_ATTRIBUTE, replaceStyleSheetUrls(resources, base, style, { context: "declarationList" }));
                }
            }
            if (child.removeAttribute) {
                child.removeAttribute("integrity");
            }
            switch (child.tagName) {
                case "BASE":
                    child.remove();
                    break;
                case "LINK":
                    resource = resources[href];
                    if (resource && isStylesheet(resource.contentType)) {
                        if (title) {
                            child.remove();
                        } else {
                            const styleElement = document.createElement(STYLE_TAG);
                            styleElement.type = STYLESHEET_CONTENT_TYPE;
                            const media = child.getAttribute(MEDIA_ATTRIBUTE);
                            if (media) {
                                styleElement.setAttribute(MEDIA_ATTRIBUTE, media);
                            }
                            let resourceBase = resource.id;
                            if (resourceBase.startsWith("cid:")) {
                                resourceBase = index;
                            }
                            resource.data = replaceStyleSheetUrls(resources, resourceBase, resource.data);
                            styleElement.appendChild(document.createTextNode(resource.data));
                            childNode.replaceChild(styleElement, child);
                        }
                    }
                    break;
                case "STYLE":
                    if (title) {
                        child.remove();
                    } else {
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
                        } catch (error) {
                            // eslint-disable-next-line no-console
                            console.warn(error);
                        }
                    }
                    srcset = child.getAttribute("srcset");
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
                        child.setAttribute("srcset", sources.map(source => source.join(" ")).join(","));
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
                            } catch (error) {
                                // eslint-disable-next-line no-console
                                console.warn(error);
                            }
                        }
                    }
                    break;
                case "AUDIO":
                    resource = resources[src];
                    if (resource && isAudio(resource.contentType)) {
                        try {
                            child.setAttribute(SRC_ATTRIBUTE, getResourceURI(resource));
                        } catch (error) {
                            // eslint-disable-next-line no-console
                            console.warn(error);
                        }
                    }
                    break;
                case "VIDEO":
                    resource = resources[src];
                    if (resource && isVideo(resource.contentType)) {
                        try {
                            child.setAttribute(SRC_ATTRIBUTE, getResourceURI(resource));
                        } catch (error) {
                            // eslint-disable-next-line no-console
                            console.warn(error);
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
                        } catch (error) {
                            // eslint-disable-next-line no-console
                            console.warn(error);
                        }
                    }
                    break;
                case "IFRAME":
                    if (src) {
                        let id, frame;
                        if (src.startsWith("cid:")) {
                            id = `<${src.split("cid:")[1]}>`;
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
                            }, { DOMParser });
                            child.removeAttribute(SRC_ATTRIBUTE);
                            child.setAttribute("srcdoc", html);
                        }
                    }
                    break;
                case "FRAME":
                    if (src) {
                        let id, frame;
                        if (src.startsWith("cid:")) {
                            id = `<${src.split("cid:")[1]}>`;
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
                            }, { DOMParser });
                            child.setAttribute("src", `data:text/html,${encodeURIComponent(html)}`);
                        }
                    }
                    break;
                case "A":
                case "AREA":
                    if (href) {
                        child.setAttribute(HREF_ATTRIBUTE, href);
                    }
                    break;
                case "SCRIPT":
                    if (enableScripts) {
                        if (src) {
                            resource = resources[src];
                            if (resource) {
                                try {
                                    child.setAttribute(SRC_ATTRIBUTE, getResourceURI(resource));
                                } catch (error) {
                                    // eslint-disable-next-line no-console
                                    console.warn(error);
                                }
                            }
                        }
                    } else {
                        child.remove();
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
    } catch (error) {
        // eslint-disable-next-line no-console
        console.warn(error);
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
                    } catch (error) {
                        // eslint-disable-next-line no-console
                        console.warn(error);
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
