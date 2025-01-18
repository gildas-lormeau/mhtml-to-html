/* global URL */

import {
    decodeMimeHeader,
    parseDOM,
    decodeBase64,
    decodeBinary,
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

export default fetchAndConvert;

async function fetchAndConvert(mhtml, config, failedResources = []) {
    if (config.fetchMissingResources) {
        let { fetch } = config;
        let missingResources = [];
        if (!fetch) {
            fetch = globalThis.fetch;
        }
        missingResources = convert(mhtml, config);
        missingResources = missingResources.filter(resource => !failedResources.includes(resource.id));
        if (missingResources.length) {
            await Promise.all(missingResources.map(async resource => {
                const { id, transferEncoding } = resource;
                try {
                    const response = await fetch(id);
                    if (response.ok) {
                        resource.contentType = response.headers.get("Content-Type") || "application/octet-stream";
                        if (transferEncoding === "base64") {
                            const bytes = await response.bytes();
                            resource.data = decodeBinary(bytes);
                        } else {
                            resource.data = await response.text();
                        }
                        mhtml.resources[id] = resource;
                    } else if (!failedResources.includes(id)) {
                        failedResources.push(id);
                    }
                    // eslint-disable-next-line no-unused-vars
                } catch (_) {
                    if (!failedResources.includes(id)) {
                        failedResources.push(id);
                    }
                }
            }));
            return fetchAndConvert(mhtml, config, failedResources);
        } else {
            return convert(mhtml, { ...config, fetchMissingResources: false });
        }
    } else {
        return convert(mhtml, config);
    }
}

function convert({ headers, frames, resources, index, id }, { DOMParser, enableScripts, fetchMissingResources } = { DOMParser: globalThis.DOMParser, enableScripts: false }) {
    let resource = resources[index];
    if (!resource) {
        throw new Error("Index page not found");
    }
    let base = resource.id;
    if (resource.transferEncoding === BASE64_ENCODING) {
        resource.transferEncoding = undefined;
        resource.data = decodeBase64(resource.data, getCharset(resource.contentType));
    }
    const dom = parseDOM(resource.data, DOMParser);
    const document = dom.document;
    const nodes = [document];
    if (!enableScripts) {
        document.querySelectorAll("script").forEach(scriptElement => scriptElement.remove());
    }
    const baseElement = document.querySelector("base");
    if (baseElement) {
        const href = baseElement.getAttribute(HREF_ATTRIBUTE);
        if (href) {
            base = resolvePath(".", base);
        }
        baseElement.remove();
    }
    if (!fetchMissingResources) {
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
        resource.used = true;
    }
    const stylesheets = {};
    const missingResources = [];
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
                    const declarations = replaceStyleSheetUrls(resources, base, { data: style }, { context: "declarationList" }, stylesheets, fetchMissingResources && missingResources);
                    if (!fetchMissingResources) {
                        child.setAttribute(STYLE_ATTRIBUTE, declarations);
                    }
                }
            }
            if (!enableScripts && child.removeAttribute) {
                EVENT_HANDLER_ATTRIBUTES.forEach(attribute => child.removeAttribute(attribute));
            }
            if (child.tagName === "LINK" && href) {
                let rel = child.getAttribute(REL_ATTRIBUTE);
                if (rel) {
                    rel = rel.toLowerCase();
                    if (rel === "stylesheet") {
                        resource = getResource(resources, href, child.getAttribute(HREF_ATTRIBUTE));
                        if (resource) {
                            let base = resource.id;
                            if (base.startsWith(CID_PROTOCOL)) {
                                if (index.startsWith("<") && index.endsWith(">")) {
                                    base = id;
                                } else {
                                    base = index;
                                }
                            }
                            const stylesheet = replaceStyleSheetUrls(resources, base, resource, { context: STYLESHEET_CONTEXT }, stylesheets, fetchMissingResources && missingResources);
                            if (!fetchMissingResources) {
                                const styleElement = document.createElement(STYLE_TAG);
                                styleElement.type = STYLESHEET_CONTENT_TYPE;
                                const media = child.getAttribute(MEDIA_ATTRIBUTE);
                                if (media) {
                                    styleElement.setAttribute(MEDIA_ATTRIBUTE, media);
                                }
                                resource.used = true;
                                resource.data = stylesheet;
                                styleElement.appendChild(document.createTextNode(resource.data));
                                childNode.replaceChild(styleElement, child);
                            }
                        } else if (fetchMissingResources) {
                            addMissingResource(missingResources, href);
                        }
                    } else if (rel.includes("icon")) {
                        resource = getResource(resources, href, child.getAttribute(HREF_ATTRIBUTE));
                        if (resource) {
                            if (!fetchMissingResources) {
                                resource.used = true;
                                setAttribute(child, HREF_ATTRIBUTE, getResourceURI(resource));
                            }
                        } else if (fetchMissingResources) {
                            addMissingResource(missingResources, href, BASE64_ENCODING);
                        }
                    }
                }
            } else if (child.tagName === "STYLE") {
                const style = replaceStyleSheetUrls(resources, base, { data: child.textContent }, { context: STYLESHEET_CONTEXT }, stylesheets, fetchMissingResources && missingResources);
                if (!fetchMissingResources) {
                    const styleElement = document.createElement(STYLE_TAG);
                    styleElement.type = STYLESHEET_CONTENT_TYPE;
                    const media = child.getAttribute(MEDIA_ATTRIBUTE);
                    if (media) {
                        styleElement.setAttribute(MEDIA_ATTRIBUTE, media);
                    }
                    styleElement.appendChild(document.createTextNode(style));
                    childNode.replaceChild(styleElement, child);
                }
            } else if (child.tagName === "IMG" || child.tagName === "AUDIO" || child.tagName === "VIDEO" || child.tagName === "SOURCE" || child.tagName === "SCRIPT") {
                if (src) {
                    resource = getResource(resources, src, child.getAttribute(SRC_ATTRIBUTE));
                    if (resource) {
                        if (!fetchMissingResources) {
                            resource.used = true;
                            setAttribute(child, SRC_ATTRIBUTE, getResourceURI(resource));
                        }
                    } else if (fetchMissingResources) {
                        addMissingResource(missingResources, src, BASE64_ENCODING);
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
                                        if (!fetchMissingResources) {
                                            resource.used = true;
                                            source[0] = getResourceURI(resource);
                                        }
                                    } else if (fetchMissingResources) {
                                        addMissingResource(missingResources, src, BASE64_ENCODING);
                                    }
                                }
                                // eslint-disable-next-line no-unused-vars
                            } catch (_) {
                                // ignored
                            }
                        });
                        setAttribute(child, SRCSET_ATTRIBUTE, sources.map(source => source.join(" ")).join(","));
                    }
                }
            } else if (child.tagName === "BODY" || child.tagName === "TABLE" || child.tagName === "TD" || child.tagName === "TH") {
                let background = child.getAttribute(BACKGROUND_ATTRIBUTE);
                if (background && !background.startsWith(DATA_PROTOCOL)) {
                    background = resolvePath(background, base);
                    resource = getResource(resources, background, child.getAttribute(BACKGROUND_ATTRIBUTE));
                    if (resource) {
                        if (!fetchMissingResources) {
                            resource.used = true;
                            setAttribute(child, BACKGROUND_ATTRIBUTE, getResourceURI(resource));
                        }
                    } else if (fetchMissingResources) {
                        addMissingResource(missingResources, background, BASE64_ENCODING);
                    }
                }
            } else if (child.tagName === "INPUT") {
                const type = child.getAttribute(TYPE_ATTRIBUTE);
                if (type && type.toLowerCase() === "image" && src) {
                    resource = getResource(resources, src, child.getAttribute(SRC_ATTRIBUTE));
                    if (resource) {
                        if (!fetchMissingResources) {
                            resource.used = true;
                            setAttribute(child, SRC_ATTRIBUTE, getResourceURI(resource));
                        }
                    } else if (fetchMissingResources) {
                        addMissingResource(missingResources, src, BASE64_ENCODING);
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
                            if (!fetchMissingResources) {
                                resource.used = true;
                                setAttribute(child, attribute, getResourceURI(resource));
                            }
                        } else {
                            const result = convert({
                                resources: Object.assign({}, resources, { [id]: resource }),
                                frames: frames,
                                index: id,
                                id: resource.id
                            }, { DOMParser, enableScripts, fetchMissingResources });
                            if (fetchMissingResources) {
                                for (const missingResource of result) {
                                    if (!missingResources.find(resource => resource.id === missingResource.id)) {
                                        missingResources.push(missingResource);
                                    }
                                }
                            } else {
                                resource.used = true;
                                if (child.tagName === "IFRAME") {
                                    setOriginalAttribute(child, "src");
                                    child.removeAttribute("src");
                                    child.setAttribute("srcdoc", result);
                                } else {
                                    setAttribute(child, attribute, `data:text/html,${encodeURIComponent(result)}`);
                                }
                            }
                        }
                    } else if (fetchMissingResources) {
                        addMissingResource(missingResources, src);
                    }
                }
            } else if (child.tagName === "A" || child.tagName === "AREA") {
                if (href) {
                    try {
                        const url = new URL(child.getAttribute(HREF_ATTRIBUTE), base);
                        const hash = url.hash;
                        url.hash = "";
                        if (url == base && hash) {
                            setAttribute(child, HREF_ATTRIBUTE, hash);
                        } else {
                            setAttribute(child, HREF_ATTRIBUTE, href);
                        }
                        // eslint-disable-next-line no-unused-vars
                    } catch (_) {
                        setAttribute(child, HREF_ATTRIBUTE, href);
                    }
                }
                child.removeAttribute("ping");
            }
            nodes.push(child);
        }
    }
    if (fetchMissingResources) {
        return missingResources;
    } else {
        return dom.serialize();
    }
}

function setAttribute(element, attribute, value, defaultValue) {
    try {
        setOriginalAttribute(element, attribute);
        element.setAttribute(attribute, value);
        // eslint-disable-next-line no-unused-vars
    } catch (_) {
        if (defaultValue !== undefined) {
            element.setAttribute(attribute, defaultValue);
        }
    }
}

function setOriginalAttribute(element, attribute) {
    const value = element.getAttribute(attribute);
    if (value !== undefined && !value.startsWith(DATA_PROTOCOL)) {
        element.setAttribute("data-original-" + attribute, element.getAttribute(attribute));
    }
}

function replaceStyleSheetUrls(resources, base, resource, options = {}, stylesheets, missingResources) {
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
        // eslint-disable-next-line no-unused-vars
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
                        if (!missingResources) {
                            resource.used = true;
                            resource.data = replaceStyleSheetUrls(resources, resource.id, resource, { context: STYLESHEET_CONTEXT }, stylesheets, missingResources);
                            try {
                                if (resource.id !== undefined && !resource.id.startsWith(DATA_PROTOCOL)) {
                                    node.value = "--mhtml-to-html-url(" + JSON.stringify(resource.id) + ") " + getResourceURI(resource);
                                } else {
                                    node.value = getResourceURI(resource);
                                }
                                // eslint-disable-next-line no-unused-vars
                            } catch (_) {
                                // ignored
                            }
                        }
                    } else {
                        addMissingResource(missingResources, id, BASE64_ENCODING);
                    }
                }
            } else if (node.type === AT_RULE && node.name.toLowerCase() === "import") {
                const path = node.prelude.children.first.value;
                if (!path.startsWith(DATA_PROTOCOL)) {
                    const id = resolvePath(path, base);
                    const resource = getResource(resources, id, path);
                    if (resource) {
                        resource.data = replaceStyleSheetUrls(resources, resource.id, resource, { context: STYLESHEET_CONTEXT }, stylesheets, missingResources);
                        if (!missingResources) {
                            resource.used = true;
                            try {
                                if (resource.id !== undefined && !resource.id.startsWith(DATA_PROTOCOL)) {
                                    node.prelude.children.first.value = "--mhtml-to-html-url(" + JSON.stringify(resource.id) + ") " + getResourceURI(resource);
                                } else {
                                    node.prelude.children.first.value = getResourceURI(resource);
                                }
                                // eslint-disable-next-line no-unused-vars
                            } catch (_) {
                                // ignored
                            }
                        }
                    } else {
                        addMissingResource(missingResources, id);
                    }
                }
            }
        });
        try {
            const result = cssTree.generate(ast);
            if (resource.id !== undefined) {
                stylesheets[resource.id].data = result;
            }
            return result.replace(/url\(--mhtml-to-html-url\\\(\\"(.*?)\\"\\\)\\ /g, "/* original URL: $1 */url(");
            // eslint-disable-next-line no-unused-vars
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

function addMissingResource(missingResources, id, transferEncoding) {
    if (missingResources) {
        if ((id.startsWith("http:") || id.startsWith("https:")) && !missingResources.find(resource => resource.id === id)) {
            missingResources.push({ id, transferEncoding });
        }
    }
}