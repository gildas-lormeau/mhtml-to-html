/* global globalThis, URL */

import { decodeQuotedPrintable, encodeBase64, parseDOM, removeQuotes, decodeString, getCharset } from "./util.js";
import * as cssTree from "./lib/csstree.esm.js";

const MHTML_FSM = {
    MHTML_HEADERS: 0,
    MTHML_CONTENT: 1,
    MHTML_DATA: 2,
    MHTML_END: 3
};

const QUOTED_PRINTABLE_ENCODING = "quoted-printable";
const CONTENT_TYPE_HEADER = "Content-Type";
const BASE64_ENCODING = "base64";
const UTF8_CHARSET = "utf-8";
const CRLF = "\r\n";
const LF = "\n";

function parse(mhtml, { DOMParser } = { DOMParser: globalThis.DOMParser }) {
    const headers = {};
    const resources = {};
    const frames = {};
    let resource, transferEncoding, index, boundary, headerKey;
    let content = {};
    let state = MHTML_FSM.MHTML_HEADERS;
    let indexMhtml = 0;
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
                const next = getLine();
                const nextString = decodeString(next);
                if (nextString !== CRLF && nextString !== LF) {
                    splitHeaders(nextString, content);
                } else {
                    transferEncoding = content["Content-Transfer-Encoding"];
                    const contentType = content[CONTENT_TYPE_HEADER];
                    const contentId = content["Content-ID"];
                    const id = content["Content-Location"];
                    initResource(contentType, contentId, id);
                    state = MHTML_FSM.MHTML_DATA;
                }
            } else {
                transferEncoding = headers["Content-Transfer-Encoding"];
                const contentType = headers[CONTENT_TYPE_HEADER];
                const contentId = headers["Content-ID"];
                const id = headers["Content-Location"];
                initResource(contentType, contentId, id);
                state = MHTML_FSM.MHTML_DATA;
            }
        } else if (state === MHTML_FSM.MHTML_DATA) {
            let next = getLine(transferEncoding);
            let nextString = decodeString(next);
            while ((!boundary || !nextString.includes(boundary)) && indexMhtml < mhtml.length - 1) {
                if (resource.transferEncoding === QUOTED_PRINTABLE_ENCODING && resource.data.length) {
                    if (resource.data[resource.data.length - 3] === 0x3D && resource.data[resource.data.length - 2] === 0x0D && resource.data[resource.data.length - 1] === 0x0A) {
                        resource.data.splice(resource.data.length - 3, 3);
                    } else if (resource.data[resource.data.length - 2] === 0x3D && resource.data[resource.data.length - 1] === 0x0A) {
                        resource.data.splice(resource.data.length - 2, 2);
                    }
                }
                resource.data.splice(resource.data.length, 0, ...next);
                next = getLine(transferEncoding);
                nextString = decodeString(next);
            }
            resource.data = resource.rawData = new Uint8Array(resource.data);
            let charset = getCharset(resource.contentType);
            resource.data = decodeString(resource.data, charset);
            if (resource.contentType.startsWith("text/css")) {
                const ast = cssTree.parse(resource.data);
                try {
                    if (ast.children.first && ast.children.first.type === "Atrule" && ast.children.first.name === "charset") {
                        const charsetNode = ast.children.first;
                        const cssCharset = charsetNode.prelude.children.first.value.toLowerCase();
                        if (cssCharset !== UTF8_CHARSET) {
                            if (cssCharset === charset) {
                                ast.children.shift();
                            } else {
                                charset = cssCharset;
                                resource.data = decodeString(resource.data, cssCharset);
                            }
                        }
                    }
                } catch (error) {
                    // eslint-disable-next-line no-console
                    console.warn(error);
                }
            }
            if (resource.contentType.startsWith("text/html") || resource.contentType.startsWith("application/xhtml+xml")) {
                const dom = parseDOM(resource.data, DOMParser);
                const documentElement = dom.document;
                const charserMetaElement = documentElement.querySelector("meta[charset]");
                if (charserMetaElement) {
                    const htmlCharset = charserMetaElement.getAttribute("charset").toLowerCase();
                    if (htmlCharset && htmlCharset !== charset) {
                        resource.data = decodeString(resource.data, charset);
                        const dom = parseDOM(resource.data, DOMParser);
                        const charserMetaElement = dom.document.documentElement.querySelector("meta[charset]");
                        charserMetaElement.remove();
                        resource.data = dom.serialize();
                    } else {
                        charserMetaElement.remove();
                        resource.data = dom.serialize();
                    }
                }
                const metaElement = documentElement.querySelector("meta[http-equiv='Content-Type']");
                if (metaElement) {
                    resource.contentType = metaElement.getAttribute("content");
                    const htmlCharset = getCharset(resource.contentType);
                    if (htmlCharset) {
                        if (htmlCharset !== charset) {
                            resource.data = decodeString(resource.rawData, htmlCharset);
                        }
                        const dom = parseDOM(resource.data, DOMParser);
                        const metaElement = dom.document.documentElement.querySelector("meta[http-equiv='Content-Type']");
                        resource.contentType = resource.contentType.replace(/charset=[^;]+/, `charset=${UTF8_CHARSET}`);
                        metaElement.setAttribute("content", resource.contentType);
                        resource.data = dom.serialize();
                    }
                }
            }
            state = (indexMhtml >= mhtml.length - 1 ? MHTML_FSM.MHTML_END : MHTML_FSM.MTHML_CONTENT);
        }
    }
    return { frames, resources, index };

    function getLine(transferEncoding) {
        const j = indexMhtml;
        while (mhtml[indexMhtml] !== 0x0A && indexMhtml++ < mhtml.length - 1);
        indexMhtml++;
        const line = mhtml.slice(j, indexMhtml);
        return transferEncoding === QUOTED_PRINTABLE_ENCODING ? decodeQuotedPrintable(line) : line;
    }

    function splitHeaders(line, obj) {
        const m = line.indexOf(":");
        if (m > -1) {
            headerKey = line.substring(0, m).trim();
            obj[headerKey] = line.substring(m + 1, line.length).trim();
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
        if (index === undefined && (contentType.startsWith("text/html") || contentType.startsWith("application/xhtml+xml"))) {
            index = id;
        }
        if (contentId !== undefined) {
            frames[contentId] = resource;
        }
        if (id !== undefined && !resources[id]) {
            resources[id] = resource;
        }
        content = {};
    }
}

function convert({ frames, resources, index }, { DOMParser } = { DOMParser: globalThis.DOMParser }) {
    let resource = resources[index];
    let base = resource.id;
    const dom = parseDOM(resource.data, DOMParser);
    const document = dom.document;
    const nodes = [document];
    let href, src, title;
    let baseElement = document.querySelector("base");
    if (baseElement) {
        const href = baseElement.getAttribute("href");
        if (href) {
            try {
                base = new URL(baseElement.getAttribute("href"), base).href;
            } catch (_) {
                // ignored
            }
        }
    }
    while (nodes.length) {
        const childNode = nodes.shift();
        childNode.childNodes.forEach(child => {
            if (child.getAttribute) {
                try {
                    href = new URL(child.getAttribute("href"), base).href;
                } catch (_) {
                    href = child.getAttribute("href");
                }
                try {
                    src = new URL(child.getAttribute("src"), base).href;
                } catch (_) {
                    src = child.getAttribute("src");
                }
                title = child.getAttribute("title");
                const style = child.getAttribute("style");
                if (style) {
                    child.setAttribute("style", replaceStyleSheetUrls(resources, base, style, { context: "declarationList" }));
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
                    if (resource && resource.contentType.startsWith("text/css")) {
                        if (title) {
                            child.remove();
                        } else {
                            const styleElement = document.createElement("style");
                            styleElement.type = "text/css";
                            const media = child.getAttribute("media");
                            if (media) {
                                styleElement.setAttribute("media", media);
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
                        const styleElement = document.createElement("style");
                        styleElement.type = "text/css";
                        const media = child.getAttribute("media");
                        if (media) {
                            styleElement.setAttribute("media", media);
                        }
                        styleElement.appendChild(document.createTextNode(replaceStyleSheetUrls(resources, index, child.textContent)));
                        childNode.replaceChild(styleElement, child);
                    }
                    break;
                case "IMG":
                    resource = resources[src];
                    if (resource && resource.contentType.startsWith("image/")) {
                        try {
                            child.setAttribute("src", getResourceURI(resource));
                        } catch (error) {
                            // eslint-disable-next-line no-console
                            console.warn(error);
                        }
                    }
                    break;
                case "AUDIO":
                    resource = resources[src];
                    if (resource && resource.contentType.startsWith("audio/")) {
                        try {
                            child.setAttribute("src", getResourceURI(resource));
                        } catch (error) {
                            // eslint-disable-next-line no-console
                            console.warn(error);
                        }
                    }
                    break;
                case "VIDEO":
                    if (resource.contentType.startsWith("video/")) {
                        try {
                            child.setAttribute("src", getResourceURI(resource));
                        } catch (error) {
                            // eslint-disable-next-line no-console
                            console.warn(error);
                        }
                    }
                    break;
                case "SOURCE":
                    resource = resources[src];
                    if (resource && (resource.contentType.startsWith("image/") || resource.contentType.startsWith("video/") || resource.contentType.startsWith("audio/"))) {
                        try {
                            child.setAttribute("src", getResourceURI(resource));
                        } catch (error) {
                            // eslint-disable-next-line no-console
                            console.warn(error);
                        }
                    }
                    break;
                case "FRAME":
                case "IFRAME":
                    if (src) {
                        const id = `<${src.split("cid:")[1]}>`;
                        const frame = frames[id];
                        if (frame && (frame.contentType.startsWith("text/html") || frame.contentType.startsWith("application/xhtml+xml"))) {
                            const iframe = convert({
                                resources: Object.assign({}, resources, { [id]: frame }),
                                frames: frames,
                                index: id
                            }, { DOMParser });
                            child.removeAttribute("src");
                            child.setAttribute("srcdoc", iframe.serialize());
                        }
                    }
                    break;
                case "A":
                case "AREA":
                    if (href && !href.startsWith("#") && !href.match(/^[^:]+:/)) {
                        try {
                            child.setAttribute("href", new URL(href, base).href);
                        } catch (_) {
                            // ignored
                        }
                    }
                    break;
                default:
                    break;
            }
            nodes.push(child);
        });
    }
    baseElement = document.createElement("base");
    try {
        baseElement.setAttribute("href", new URL(base).href);
    } catch (_) {
        // ignored
    }
    if (document.head.firstChild) {
        document.head.insertBefore(baseElement, document.head.firstChild);
    } else {
        document.head.appendChild(baseElement);
    }
    return dom;
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
                    if (resource.contentType.startsWith("text/css")) {
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
