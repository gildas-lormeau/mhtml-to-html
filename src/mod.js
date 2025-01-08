import { decodeQuotedPrintable, encodeBase64, parseDOM, removeQuotes, decodeString } from "./util.js";
import * as cssTree from "./lib/csstree.esm.js";

const MHTML_FSM = {
    MHTML_HEADERS: 0,
    MTHML_CONTENT: 1,
    MHTML_DATA: 2,
    MHTML_END: 3
};

const mhtmlToHtml = {
    parse: mhtml => {
        const headers = {};
        const resources = {};
        const frames = {};
        let asset, transferEncoding, index, boundary, headerKey;
        let content = {};
        let state = MHTML_FSM.MHTML_HEADERS;
        let indexMhtml = 0;
        while (state != MHTML_FSM.MHTML_END) {
            if (state == MHTML_FSM.MHTML_HEADERS) {
                let next = getLine();
                let nextString = decodeString(next);
                if (nextString && nextString != "\n") {
                    splitHeaders(nextString, headers);
                } else {
                    const contentTypeParams = headers["Content-Type"].split(";");
                    contentTypeParams.shift();
                    const boundaryParam = contentTypeParams.find(param => param.startsWith("boundary="));
                    boundary = removeQuotes(boundaryParam.substring("boundary=".length));
                    trim();
                    while (!nextString.includes(boundary) && indexMhtml < mhtml.length - 1) {
                        next = getLine();
                        nextString = decodeString(next);
                    }
                    content = {};
                    headerKey = null;
                    state = MHTML_FSM.MTHML_CONTENT;
                }
            } else if (state == MHTML_FSM.MTHML_CONTENT) {
                const next = getLine();
                const nextString = decodeString(next);
                if (nextString && nextString != "\n") {
                    splitHeaders(nextString, content);
                } else {
                    transferEncoding = content["Content-Transfer-Encoding"];
                    const contentType = content["Content-Type"];
                    const contentId = content["Content-ID"];
                    const url = content["Content-Location"];
                    if (typeof index === "undefined") {
                        index = url;
                    }
                    asset = {
                        transferEncoding,
                        contentType,
                        data: [],
                        id: index,
                        url
                    };
                    if (typeof contentId !== "undefined") {
                        frames[contentId] = asset;
                    }
                    if (typeof url !== "undefined" && !resources[url]) {
                        resources[url] = asset;
                    }
                    trim();
                    content = {};
                    state = MHTML_FSM.MHTML_DATA;
                }
            } else if (state == MHTML_FSM.MHTML_DATA) {
                let next = getLine(transferEncoding);
                let nextString = decodeString(next);
                while (!nextString.includes(boundary) && indexMhtml < mhtml.length - 1) {
                    if (asset.transferEncoding === "quoted-printable" && asset.data.length) {
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
                    charset = removeQuotes(charsetMatch[1]);
                }
                try {
                    asset.data = decodeString(asset.data, charset);
                } catch (error) {
                    if (asset.transferEncoding === "quoted-printable") {
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
            return transferEncoding === "quoted-printable" ? new Uint8Array(decodeQuotedPrintable(line)) : line;
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
                                const mediaAttribute = child.getAttribute("media");
                                if (mediaAttribute) {
                                    styleElement.setAttribute("media", mediaAttribute);
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
                            const mediaAttribute = child.getAttribute("media");
                            if (mediaAttribute) {
                                styleElement.setAttribute("media", mediaAttribute);
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
                                console.warn(error);
                            }
                        }
                        break;
                    case "VIDEO":
                        if (resource.contentType.startsWith("video/")) {
                            try {
                                child.setAttribute("src", getResourceURI(resource));
                            } catch (error) {
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
                        console.warn(error);
                    }
                }
            }
        });
        return cssTree.generate(ast);
    }
}

function getResourceURI(asset) {
    return `data:${asset.contentType};base64,${asset.transferEncoding === "base64" ? asset.data : encodeBase64(asset.data)}`;
}
