/* global URL */

import { decodeQuotedPrintable, encodeBase64, parseDOM, removeQuotes, decodeString } from "./util.js";
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

const mhtmlToHtml = {
    parse: mhtml => {
        const headers = {};
        const resources = {};
        const frames = {};
        let asset, transferEncoding, index, boundary, headerKey;
        let content = {};
        let state = MHTML_FSM.MHTML_HEADERS;
        let indexMhtml = 0;
        while (state !== MHTML_FSM.MHTML_END) {
            if (state === MHTML_FSM.MHTML_HEADERS) {
                let next = getLine();
                let nextString = decodeString(next);
                if (nextString && nextString !== "\n") {
                    splitHeaders(nextString, headers);
                } else {
                    const contentTypeParams = headers[CONTENT_TYPE_HEADER].split(";");
                    contentTypeParams.shift();
                    const boundaryParam = contentTypeParams.find(param => param.startsWith("boundary="));
                    boundary = removeQuotes(boundaryParam.substring(9));
                    trim();
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
                if (nextString && nextString !== "\n") {
                    splitHeaders(nextString, content);
                } else {
                    transferEncoding = content["Content-Transfer-Encoding"];
                    const contentType = content[CONTENT_TYPE_HEADER];
                    const contentId = content["Content-ID"];
                    const url = content["Content-Location"];
                    if (index === undefined) {
                        index = url;
                    }
                    asset = {
                        transferEncoding,
                        contentType,
                        data: [],
                        id: index,
                        url
                    };
                    if (contentId !== undefined) {
                        frames[contentId] = asset;
                    }
                    if (url !== undefined && !resources[url]) {
                        resources[url] = asset;
                    }
                    trim();
                    content = {};
                    state = MHTML_FSM.MHTML_DATA;
                }
            } else if (state === MHTML_FSM.MHTML_DATA) {
                let next = getLine(transferEncoding);
                let nextString = decodeString(next);
                while (!nextString.includes(boundary) && indexMhtml < mhtml.length - 1) {
                    if (asset.transferEncoding === QUOTED_PRINTABLE_ENCODING && asset.data.length) {
                        if (asset.data[asset.data.length - 1] === 0x3D) {
                            asset.data = asset.data.slice(0, asset.data.length - 1);
                        }
                    }
                    asset.data.splice(asset.data.length, 0, ...next);
                    next = getLine(transferEncoding);
                    nextString = decodeString(next);
                }
                asset.data = new Uint8Array(asset.data);
                let charset;
                const charsetMatch = asset.contentType.match(/charset=([^;]+)/);
                if (charsetMatch) {
                    charset = removeQuotes(charsetMatch[1]).toLowerCase();
                }
                try {
                    asset.data = decodeString(asset.data, charset);
                    if (asset.contentType === "text/css") {
                        const ast = cssTree.parse(asset.data);
                        try {
                            if (ast.children.first && ast.children.first.type === "Atrule" && ast.children.first.name === "charset") {
                                const charsetNode = ast.children.first;
                                const cssCharset = charsetNode.prelude.children.first.value.toLowerCase();
                                if (cssCharset !== UTF8_CHARSET) {
                                    if (cssCharset === charset) {
                                        ast.children.shift();
                                    } else {
                                        charset = cssCharset;
                                        asset.data = decodeString(asset.data, cssCharset);
                                    }
                                }
                            }
                        } catch (error) {
                            // eslint-disable-next-line no-console
                            console.warn(error);
                        }
                    }
                    if (asset.contentType === "text/html" || asset.contentType === "application/xhtml+xml") {
                        const dom = parseDOM(asset.data);
                        const documentElement = dom.document;
                        let htmlCharset;
                        const charserMetaElement = documentElement.querySelector("meta[charset]");
                        if (charserMetaElement) {
                            htmlCharset = charserMetaElement.getAttribute("charset").toLowerCase();
                            if (htmlCharset !== UTF8_CHARSET && htmlCharset !== charset) {
                                charset = htmlCharset;
                                asset.data = decodeString(asset.data, charset);
                            } else {
                                charserMetaElement.remove();
                            }
                        }
                        const metaElement = documentElement.querySelector("meta[http-equiv='Content-Type']");
                        if (metaElement) {
                            const metaContent = metaElement.getAttribute("content");
                            const metaCharsetMatch = metaContent.match(/charset=([^;]+)/);
                            if (metaCharsetMatch) {
                                const htmlCharset = removeQuotes(metaCharsetMatch[1].toLowerCase());
                                if (htmlCharset !== UTF8_CHARSET && htmlCharset !== charset) {
                                    charset = htmlCharset;
                                    asset.data = decodeString(asset.data, charset);
                                } else {
                                    metaElement.remove();
                                }
                            }
                        }
                    }
                } catch (error) {
                    if (asset.transferEncoding === QUOTED_PRINTABLE_ENCODING) {
                        // eslint-disable-next-line no-console
                        console.warn(error);
                        asset.data = decodeString(asset.data);
                    } else {
                        throw error;
                    }
                }
                state = (indexMhtml >= mhtml.length - 1 ? MHTML_FSM.MHTML_END : MHTML_FSM.MTHML_CONTENT);
            }
        }
        return { frames, resources, index };

        function trim() {
            while ((mhtml[indexMhtml] === 0x20 || mhtml[indexMhtml] === 0x0A || mhtml[indexMhtml] === 0x0D) && indexMhtml++ < mhtml.length - 1);
        }

        function getLine(transferEncoding) {
            const j = indexMhtml;
            while (mhtml[indexMhtml] !== 0x0A && indexMhtml++ < mhtml.length - 1);
            indexMhtml++;
            let line = mhtml.slice(j, indexMhtml);
            do {
                if (line[line.length - 1] === 0x0A) {
                    line = line.slice(0, line.length - 1);
                }
                if (line[line.length - 1] === 0x0D) {
                    line = line.slice(0, line.length - 1);
                }
            } while ((line[line.length - 1] === 0x0A || line[line.length - 1] === 0x0D) && indexMhtml < mhtml.length - 1);
            return transferEncoding === QUOTED_PRINTABLE_ENCODING ? new Uint8Array(decodeQuotedPrintable(line)) : line;
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
    },
    convert: ({ frames, resources, index }) => {
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
                                const iframe = mhtmlToHtml.convert({
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
};

export default mhtmlToHtml;

function replaceStyleSheetUrls(resources, base, asset) {
    let ast;
    try {
        ast = cssTree.parse(asset);
    } catch (error) {
        // eslint-disable-next-line no-console
        console.warn(error);
        return asset;
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

function getResourceURI(asset) {
    return `data:${asset.contentType};${BASE64_ENCODING},${asset.transferEncoding === BASE64_ENCODING ? asset.data : encodeBase64(asset.data)}`;
}
