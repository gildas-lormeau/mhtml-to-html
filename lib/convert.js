/* global globalThis, URL */

import {
    decodeMimeHeader,
    parseDOM,
    decodeBase64,
    getCharset,
    getResourceURI,
    resolvePath,
    EVENT_HANDLER_ATTRIBUTES
} from "./util.js";
import * as cssTree from "./vendor/csstree.esm.js";

const BASE64_ENCODING = "base64";
const HREF_ATTRIBUTE = "href";
const SRC_ATTRIBUTE = "src";
const SRCSET_ATTRIBUTE = "srcset";
const CONTENT_ATTRIBUTE = "content";
const STYLE_ATTRIBUTE = "style";
const MEDIA_ATTRIBUTE = "media";
const BACKGROUND_ATTRIBUTE = "background";
const REL_ATTRIBUTE = "rel";
const DATA_ATTRIBUTE = "data";
const TYPE_ATTRIBUTE = "type";
const STYLE_TAG = "style";
const STYLESHEET_CONTENT_TYPE = "text/css";
const CID_PROTOCOL = "cid:";
const DATA_PROTOCOL = "data:";
const AT_RULE = "Atrule";
const STYLESHEET_CONTEXT = "stylesheet";

export default convert;

function convert({ headers, frames, resources, index, id }, { DOMParser, enableScripts } = { DOMParser: globalThis.DOMParser, enableScripts: false }) {
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
            base = resolvePath(href, base);
        }
        baseElement.remove();
    }
    if (!enableScripts) {
        document.querySelectorAll("script").forEach(scriptElement => scriptElement.remove());
    }
    document.querySelectorAll("link[rel='stylesheet'][rel*=alternate][title]").forEach(element => element.remove());
    const canonicalLink = document.querySelector("link[rel='canonical']");
    if (!canonicalLink) {
        const linkElement = document.createElement("link");
        linkElement.setAttribute(REL_ATTRIBUTE, "canonical");
        linkElement.setAttribute(HREF_ATTRIBUTE, index);
        document.head.appendChild(linkElement);
    }
    document.querySelectorAll("meta[http-equiv='Content-Security-Policy']").forEach(element => element.remove());
    const metaCSP = document.createElement("meta");
    metaCSP.setAttribute("http-equiv", "Content-Security-Policy");
    let csp = "default-src 'none'; connect-src 'self' data:; font-src 'self' data:; img-src 'self' data:; style-src 'self' 'unsafe-inline' data:; frame-src 'self' data:; media-src 'self' data:; object-src 'self' data:;";
    if (enableScripts) {
        csp += " script-src 'self' 'unsafe-inline' data:;";
    } else {
        csp += " script-src 'none';";
    }
    metaCSP.setAttribute(CONTENT_ATTRIBUTE, csp);
    if (document.head.firstChild) {
        document.head.firstChild.before(metaCSP);
    } else {
        document.head.appendChild(metaCSP);
    }
    const replacedAttributeValue = document.querySelectorAll("link[rel~=preconnect], link[rel~=prerender], link[rel~=dns-prefetch], link[rel~=preload], link[rel~=manifest], link[rel~=prefetch], link[rel~=modulepreload]");
    replacedAttributeValue.forEach(element => {
        const relValue = element
            .getAttribute(REL_ATTRIBUTE)
            .replace(/(preconnect|prerender|dns-prefetch|preload|prefetch|manifest|modulepreload)/gi, "")
            .trim();
        if (relValue.length) {
            element.setAttribute(REL_ATTRIBUTE, relValue);
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
        pageInfoElement.setAttribute(TYPE_ATTRIBUTE, "application/ld+json");
        pageInfoElement.textContent = JSON.stringify(pageInfo, null, 2);
        if (document.head.firstChild) {
            document.head.firstChild.after(pageInfoElement);
        } else {
            document.head.appendChild(pageInfoElement);
        }
    }
    document.querySelectorAll("meta[http-equiv=refresh]").forEach(element => element.remove());
    document.querySelectorAll("[integrity]").forEach(element => element.removeAttribute("integrity"));
    const stylesheets = {};
    resource.used = true;
    while (nodes.length) {
        const childNode = nodes.shift();
        for (const child of childNode.childNodes) {
            let href, src;
            if (child.getAttribute) {
                href = child.getAttribute(HREF_ATTRIBUTE);
                if (href) {
                    href = resolvePath(href, base);
                }
                src = child.getAttribute(SRC_ATTRIBUTE);
                if (src) {
                    src = resolvePath(src, base);
                }
                const style = child.getAttribute(STYLE_ATTRIBUTE);
                if (style) {
                    child.setAttribute(STYLE_ATTRIBUTE, replaceStyleSheetUrls(resources, base, { data: style }, { context: "declarationList" }), stylesheets);
                }
            }
            if (!enableScripts && child.removeAttribute) {
                EVENT_HANDLER_ATTRIBUTES.forEach(attribute => child.removeAttribute(attribute));
            }
            if (child.tagName === "LINK") {
                resource = getResource(resources, href, child.getAttribute(HREF_ATTRIBUTE));
                let rel = child.getAttribute(REL_ATTRIBUTE);
                if (resource && rel) {
                    rel = rel.toLowerCase();
                    if (rel === "stylesheet") {
                        const styleElement = document.createElement(STYLE_TAG);
                        styleElement.type = STYLESHEET_CONTENT_TYPE;
                        const media = child.getAttribute(MEDIA_ATTRIBUTE);
                        if (media) {
                            styleElement.setAttribute(MEDIA_ATTRIBUTE, media);
                        }
                        let base = resource.id;
                        if (base.startsWith(CID_PROTOCOL)) {
                            if (index.startsWith("<") && index.endsWith(">")) {
                                base = id;
                            } else {
                                base = index;
                            }
                        }
                        resource.used = true;
                        resource.data = replaceStyleSheetUrls(resources, base, resource, { context: STYLESHEET_CONTEXT }, stylesheets);
                        styleElement.appendChild(document.createTextNode(resource.data));
                        childNode.replaceChild(styleElement, child);
                    } else if (rel.includes("icon")) {
                        resource.used = true;
                        try {
                            child.setAttribute(HREF_ATTRIBUTE, getResourceURI(resource));
                        } catch (_) {
                            // ignored
                        }
                    }
                }
            } else if (child.tagName === "STYLE") {
                const styleElement = document.createElement(STYLE_TAG);
                styleElement.type = STYLESHEET_CONTENT_TYPE;
                const media = child.getAttribute(MEDIA_ATTRIBUTE);
                if (media) {
                    styleElement.setAttribute(MEDIA_ATTRIBUTE, media);
                }
                styleElement.appendChild(document.createTextNode(replaceStyleSheetUrls(resources, index, { data: child.textContent }, { context: STYLESHEET_CONTEXT }, stylesheets)));
                childNode.replaceChild(styleElement, child);
            } else if (child.tagName === "IMG" || child.tagName === "AUDIO" || child.tagName === "VIDEO" || child.tagName === "SOURCE" || child.tagName === "SCRIPT") {
                resource = getResource(resources, src, child.getAttribute(SRC_ATTRIBUTE));
                if (resource) {
                    resource.used = true;
                    try {
                        child.setAttribute(SRC_ATTRIBUTE, getResourceURI(resource));
                    } catch (_) {
                        // ignored
                    }
                }
                if (child.tagName === "IMG") {
                    const srcset = child.getAttribute(SRCSET_ATTRIBUTE);
                    if (srcset) {
                        const sources = srcset.split(",").map(source => source.trim().split(" "));
                        sources.forEach(source => {
                            try {
                                if (!source[0].startsWith(DATA_PROTOCOL)) {
                                    const src = resolvePath(source[0], base);
                                    const resource = getResource(resources, src, source[0]);
                                    if (resource) {
                                        resource.used = true;
                                        source[0] = getResourceURI(resource);
                                    }
                                }
                            } catch (_) {
                                // ignored
                            }
                        });
                        child.setAttribute(SRCSET_ATTRIBUTE, sources.map(source => source.join(" ")).join(","));
                    }
                }
            } else if (child.tagName === "BODY" || child.tagName === "TABLE" || child.tagName === "TD" || child.tagName === "TH") {
                let background = child.getAttribute(BACKGROUND_ATTRIBUTE);
                if (background && !background.startsWith(DATA_PROTOCOL)) {
                    background = resolvePath(background, base);
                    resource = getResource(resources, background, child.getAttribute(BACKGROUND_ATTRIBUTE));
                    if (resource) {
                        resource.used = true;
                        try {
                            child.setAttribute(BACKGROUND_ATTRIBUTE, getResourceURI(resource));
                        } catch (_) {
                            // ignored
                        }
                    }
                }
            } else if (child.tagName === "INPUT") {
                const type = child.getAttribute(TYPE_ATTRIBUTE);
                if (type && type.toLowerCase() === "image") {
                    resource = getResource(resources, src, child.getAttribute(SRC_ATTRIBUTE));
                    if (resource) {
                        resource.used = true;
                        try {
                            child.setAttribute(SRC_ATTRIBUTE, getResourceURI(resource));
                        } catch (_) {
                            // ignored
                        }
                    }
                }
            } else if (child.tagName === "IFRAME" || child.tagName === "FRAME" || child.tagName === "EMBED" || child.tagName === "OBJECT") {
                let id, attribute;
                if (child.tagName === "OBJECT") {
                    attribute = DATA_ATTRIBUTE;
                    src = child.getAttribute(DATA_ATTRIBUTE);
                    if (src) {
                        src = resolvePath(src, base);
                    }
                } else {
                    attribute = SRC_ATTRIBUTE;
                }
                if (src) {
                    if (src.startsWith(CID_PROTOCOL)) {
                        id = `<${src.split(CID_PROTOCOL)[1]}>`;
                        resource = frames[id];
                    } else {
                        id = src;
                        resource = getResource(resources, src, child.getAttribute(attribute));
                    }
                    if (resource) {
                        if (child.tagName === "EMBED" || child.tagName === "OBJECT") {
                            try {
                                resource.used = true;
                                child.setAttribute(attribute, getResourceURI(resource));
                            } catch (_) {
                                // ignored
                            }
                        } else {
                            const html = convert({
                                resources: Object.assign({}, resources, { [id]: resource }),
                                frames: frames,
                                index: id,
                                id: resource.id
                            }, { DOMParser, enableScripts });
                            if (child.tagName === "IFRAME") {
                                child.removeAttribute(attribute);
                                child.setAttribute("srcdoc", html);
                            } else {
                                try {
                                    resource.used = true;
                                    child.setAttribute(attribute, `data:text/html,${encodeURIComponent(html)}`);
                                } catch (_) {
                                    // ignored
                                }
                            }
                        }
                    }
                }
            } else if (child.tagName === "A" || child.tagName === "AREA") {
                if (href) {
                    try {
                        const url = new URL(child.getAttribute(HREF_ATTRIBUTE), base);
                        const hash = url.hash;
                        url.hash = "";
                        if (url == base && hash) {
                            child.setAttribute(HREF_ATTRIBUTE, hash);
                        } else {
                            child.setAttribute(HREF_ATTRIBUTE, href);
                        }
                    } catch (_) {
                        child.setAttribute(HREF_ATTRIBUTE, href);
                    }
                }
                child.removeAttribute("ping");
            }
            nodes.push(child);
        }
    }
    return dom.serialize();
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
                if (!path.startsWith(DATA_PROTOCOL)) {
                    const id = resolvePath(path, base);
                    const resource = getResource(resources, id, path);
                    if (resource) {
                        resource.used = true;
                        resource.data = replaceStyleSheetUrls(resources, resource.id, resource, { context: STYLESHEET_CONTEXT }, stylesheets);
                        try {
                            node.value = getResourceURI(resource);
                        } catch (_) {
                            // ignored
                        }
                    }
                }
            } else if (node.type === AT_RULE && node.name === "import") {
                const path = node.prelude.children.first.value;
                if (!path.startsWith(DATA_PROTOCOL)) {
                    const id = resolvePath(path, base);
                    const resource = getResource(resources, id, path);
                    if (resource) {
                        resource.used = true;
                        resource.data = replaceStyleSheetUrls(resources, resource.id, resource, { context: STYLESHEET_CONTEXT }, stylesheets);
                        try {
                            node.prelude.children.first.value = getResourceURI(resource);
                        } catch (_) {
                            // ignored
                        }
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

function getResource(resources, id, rawId) {
    let resource = resources[id];
    if (!resource) {
        resource = resources[rawId];
    }
    return resource;
}
