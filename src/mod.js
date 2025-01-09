/* global URL */

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

function parse(mhtml) {
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
            if (nextString !== CRLF) {
                splitHeaders(nextString, headers);
            } else {
                const contentTypeParams = headers[CONTENT_TYPE_HEADER].split(";");
                contentTypeParams.shift();
                const boundaryParam = contentTypeParams.find(param => param.startsWith("boundary="));
                boundary = removeQuotes(boundaryParam.substring(9));
                while (!nextString.includes(boundary) && indexMhtml < mhtml.length - 1) {
                    next = getLine();
                    nextString = decodeString(next);
                }
                content = {};
                headerKey = null;
                state = MHTML_FSM.MTHML_CONTENT;
            }
        } else if (state === MHTML_FSM.MTHML_CONTENT) {
            const next = getLine();
            const nextString = decodeString(next);
            if (nextString !== CRLF) {
                splitHeaders(nextString, content);
            } else {
                transferEncoding = content["Content-Transfer-Encoding"];
                const contentType = content[CONTENT_TYPE_HEADER];
                const contentId = content["Content-ID"];
                const url = content["Content-Location"];
                if (index === undefined) {
                    index = url;
                }
                resource = {
                    transferEncoding,
                    contentType,
                    data: [],
                    id: index,
                    url
                };
                if (contentId !== undefined) {
                    frames[contentId] = resource;
                }
                if (url !== undefined && !resources[url]) {
                    resources[url] = resource;
                }
                content = {};
                state = MHTML_FSM.MHTML_DATA;
            }
        } else if (state === MHTML_FSM.MHTML_DATA) {
            let next = getLine(transferEncoding);
            let nextString = decodeString(next);
            while (!nextString.includes(boundary) && indexMhtml < mhtml.length - 1) {
                if (resource.transferEncoding === QUOTED_PRINTABLE_ENCODING && resource.data.length) {
                    if (resource.data[resource.data.length - 3] === 0x3D) {
                        resource.data = resource.data.slice(0, resource.data.length - 3);
                    }
                }
                resource.data.splice(resource.data.length, 0, ...next);
                next = getLine(transferEncoding);
                nextString = decodeString(next);
            }
            resource.data = resource.rawData = new Uint8Array(resource.data);
            let charset = getCharset(resource.contentType);
            try {
                resource.data = decodeString(resource.data, charset);
                if (resource.contentType === "text/css") {
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
                if (resource.contentType === "text/html" || resource.contentType === "application/xhtml+xml") {
                    const dom = parseDOM(resource.data);
                    const documentElement = dom.document;
                    const charserMetaElement = documentElement.querySelector("meta[charset]");
                    if (charserMetaElement) {
                        const htmlCharset = charserMetaElement.getAttribute("charset").toLowerCase();
                        if (charset && htmlCharset && htmlCharset !== charset) {
                            charset = htmlCharset;
                            charserMetaElement.remove();
                            resource.data = decodeString(resource.data, charset);
                        } else {
                            charserMetaElement.remove();
                        }
                    }
                    const metaElement = documentElement.querySelector("meta[http-equiv='Content-Type']");
                    if (metaElement) {
                        resource.contentType = metaElement.getAttribute("content");
                        const htmlCharset = getCharset(resource.contentType.toLowerCase());
                        if (charset && htmlCharset) {
                            if (htmlCharset !== charset) {
                                metaElement.setAttribute("content", resource.contentType.replace(/charset=[^;]+/, `charset=${UTF8_CHARSET}`));
                                charset = htmlCharset;
                                resource.data = decodeString(resource.rawData, charset);
                            } else {
                                metaElement.remove();
                            }
                        }
                    }
                }
            } catch (error) {
                if (resource.transferEncoding === QUOTED_PRINTABLE_ENCODING) {
                    // eslint-disable-next-line no-console
                    console.warn(error);
                    resource.data = decodeString(resource.rawData);
                } else {
                    throw error;
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
}

function convert({ frames, resources, index }) {
    let resource = resources[index];
    const url = resource.url || resource.id;
    const dom = parseDOM(resource.data);
    const documentElement = dom.document;
    const nodes = [documentElement];
    let href, src, title;
    while (nodes.length) {
        const childNode = nodes.shift();
        childNode.childNodes.forEach(child => {
            if (child.getAttribute) {
                href = new URL(child.getAttribute("href"), url).href;
                src = new URL(child.getAttribute("src"), url).href;
                title = child.getAttribute("title");
                const style = child.getAttribute("style");
                if (style) {
                    child.setAttribute("style", replaceStyleSheetUrls(resources, index, style));
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
                            const styleElement = documentElement.createElement("style");
                            styleElement.type = "text/css";
                            const media = child.getAttribute("media");
                            if (media) {
                                styleElement.setAttribute("media", media);
                            }
                            resource.data = replaceStyleSheetUrls(resources, href, resource.data);
                            styleElement.appendChild(documentElement.createTextNode(resource.data));
                            childNode.replaceChild(styleElement, child);
                        }
                    }
                    break;
                case "STYLE":
                    if (title) {
                        child.remove();
                    } else {
                        const styleElement = documentElement.createElement("style");
                        styleElement.type = "text/css";
                        const media = child.getAttribute("media");
                        if (media) {
                            styleElement.setAttribute("media", media);
                        }
                        styleElement.appendChild(documentElement.createTextNode(replaceStyleSheetUrls(resources, index, child.textContent)));
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
                    if (resource && resource.contentType.startsWith("image/") || resource.contentType.startsWith("video/") || resource.contentType.startsWith("audio/")) {
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
                            });
                            child.removeAttribute("src");
                            child.setAttribute("srcdoc", iframe.serialize());
                        }
                    }
                    break;
                case "A":
                case "AREA":
                    if (href && !href.startsWith("#") && !href.match(/^[^:]+:/)) {
                        try {
                            child.setAttribute("href", new URL(href, url).href);
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
    const baseElement = documentElement.createElement("base");
    baseElement.setAttribute("href", url);
    if (documentElement.head.firstChild) {
        documentElement.head.insertBefore(baseElement, documentElement.head.firstChild);
    } else {
        documentElement.head.appendChild(baseElement);
    }
    return dom;
}

export { parse, convert };

function replaceStyleSheetUrls(resources, base, resource) {
    let ast;
    try {
        ast = cssTree.parse(resource);
    } catch (error) {
        // eslint-disable-next-line no-console
        console.warn(error);
        return resource;
    }
    if (ast) {
        cssTree.walk(ast, node => {
            if (node.type === "Url") {
                const path = node.value;
                const url = new URL(removeQuotes(path), base).href;
                const resource = resources[url];
                if (resource) {
                    if (resource.contentType.startsWith("text/css")) {
                        resource.data = replaceStyleSheetUrls(resources, url, resource.data);
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
