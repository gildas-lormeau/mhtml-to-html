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
import * as srcsetParser from "./srcset-parser.js";

const BASE64_ENCODING = "base64";
const HREF_ATTRIBUTE = "href";
const SRC_ATTRIBUTE = "src";
const SRCSET_ATTRIBUTE = "srcset";
const SRCDOC_ATTRIBUTE = "srcdoc";
const CONTENT_ATTRIBUTE = "content";
const STYLE_ATTRIBUTE = "style";
const MEDIA_ATTRIBUTE = "media";
const BACKGROUND_ATTRIBUTE = "background";
const REL_ATTRIBUTE = "rel";
const DATA_ATTRIBUTE = "data";
const TYPE_ATTRIBUTE = "type";
const PING_ATTRIBUTE = "ping";
const HTTP_EQUIV_ATTRIBUTE = "http-equiv";
const INTEGRITY_ATTRIBUTE = "integrity";
const STYLESHEET_CONTENT_TYPE = "text/css";
const CID_PROTOCOL = "cid:";
const DATA_PROTOCOL = "data:";
const AT_RULE = "Atrule";
const STYLESHEET_CONTEXT = "stylesheet";
const BASE_TAG = "BASE";
const LINK_TAG = "LINK";
const STYLE_TAG = "STYLE";
const IMG_TAG = "IMG";
const AUDIO_TAG = "AUDIO";
const VIDEO_TAG = "VIDEO";
const SOURCE_TAG = "SOURCE";
const SCRIPT_TAG = "SCRIPT";
const BODY_TAG = "BODY";
const TABLE_TAG = "TABLE";
const TD_TAG = "TD";
const TH_TAG = "TH";
const INPUT_TAG = "INPUT";
const IFRAME_TAG = "IFRAME";
const FRAME_TAG = "FRAME";
const EMBED_TAG = "EMBED";
const OBJECT_TAG = "OBJECT";
const A_TAG = "A";
const AREA_TAG = "AREA";
const META_TAG = "META";
const ORIGINAL_URL_FUNCTION_NAME = "--mhtml-to-html-url";

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
                        if (transferEncoding === BASE64_ENCODING) {
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

function convert({ headers, frames, resources, index, id }, { DOMParser, enableScripts, fetchMissingResources } = { DOMParser: globalThis.DOMParser }) {
    let resource = resources[index];
    if (!resource) {
        throw new Error("Index page not found");
    }
    let base = resource.id;
    if (resource.transferEncoding === BASE64_ENCODING) {
        resource.transferEncoding = undefined;
        resource.data = decodeBase64(resource.data, getCharset(resource.contentType));
    }
    const contentType = resource.contentType.split(";")[0];
    const dom = parseDOM(resource.data, contentType, DOMParser);
    const document = dom.document;
    let nodes = [document];
    let baseElement;
    while (nodes.length && !baseElement) {
        const childNode = nodes.shift();
        if (childNode.childNodes) {
            for (let childIndex = 0; childIndex < childNode.childNodes.length && !baseElement; childIndex++) {
                const child = childNode.childNodes[childIndex];
                if (child.tagName && child.tagName.toUpperCase() === BASE_TAG) {
                    baseElement = child;
                }
                nodes.push(child);
            }
        }
    }
    if (baseElement) {
        const href = baseElement.getAttribute(HREF_ATTRIBUTE);
        if (href) {
            base = resolvePath(href, base);
        }
        baseElement.remove();
    }
    if (!fetchMissingResources) {
        resource.used = true;
    }
    nodes = [document];
    let canonicalLinkElement;
    const stylesheets = {};
    const missingResources = [];
    while (nodes.length) {
        const childNode = nodes.shift();
        if (childNode.childNodes) {
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
                    const integrity = child.getAttribute(INTEGRITY_ATTRIBUTE);
                    if (integrity) {
                        child.removeAttribute(INTEGRITY_ATTRIBUTE);
                    }
                }
                if (!enableScripts && child.removeAttribute) {
                    EVENT_HANDLER_ATTRIBUTES.forEach(attribute => child.removeAttribute(attribute));
                }
                if (child.tagName && child.tagName.toUpperCase() === LINK_TAG && href) {
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
                                    child.replaceWith(styleElement);
                                }
                            } else if (fetchMissingResources) {
                                addMissingResource(missingResources, href);
                            } else {
                                setAttribute(child, HREF_ATTRIBUTE, href);
                            }
                            if (!fetchMissingResources) {
                                const title = child.getAttribute("title");
                                if (title && rel.includes("alternate")) {
                                    child.remove();
                                }
                                const relValue = rel
                                    .replace(/(preconnect|prerender|dns-prefetch|preload|prefetch|manifest|modulepreload)/gi, "")
                                    .trim();
                                if (relValue.length) {
                                    child.setAttribute(REL_ATTRIBUTE, relValue);
                                } else {
                                    child.remove();
                                }
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
                            } else {
                                setAttribute(child, HREF_ATTRIBUTE, href);
                            }
                        } else if (rel == "canonical" && !fetchMissingResources) {
                            canonicalLinkElement = child;
                        }
                    }
                } else if (child.tagName && child.tagName.toUpperCase() === STYLE_TAG) {
                    const style = replaceStyleSheetUrls(resources, base, { data: child.textContent }, { context: STYLESHEET_CONTEXT }, stylesheets, fetchMissingResources && missingResources);
                    if (!fetchMissingResources) {
                        const styleElement = document.createElement(STYLE_TAG);
                        styleElement.type = STYLESHEET_CONTENT_TYPE;
                        const media = child.getAttribute(MEDIA_ATTRIBUTE);
                        if (media) {
                            styleElement.setAttribute(MEDIA_ATTRIBUTE, media);
                        }
                        styleElement.appendChild(document.createTextNode(style));
                        child.replaceWith(styleElement);
                    }
                } else if (child.tagName && child.tagName.toUpperCase() === IMG_TAG || child.tagName && child.tagName.toUpperCase() === AUDIO_TAG || child.tagName && child.tagName.toUpperCase() === VIDEO_TAG || child.tagName && child.tagName.toUpperCase() === SOURCE_TAG || child.tagName && child.tagName.toUpperCase() === SCRIPT_TAG) {
                    if (src) {
                        resource = getResource(resources, src, child.getAttribute(SRC_ATTRIBUTE));
                        if (resource) {
                            if (!fetchMissingResources) {
                                resource.used = true;
                                setAttribute(child, SRC_ATTRIBUTE, getResourceURI(resource));
                            }
                        } else if (fetchMissingResources) {
                            addMissingResource(missingResources, src, BASE64_ENCODING);
                        } else {
                            setAttribute(child, SRC_ATTRIBUTE, src);
                        }
                    }
                    if (child.tagName && child.tagName.toUpperCase() === IMG_TAG || child.tagName && child.tagName.toUpperCase() === SOURCE_TAG) {
                        const srcset = child.getAttribute(SRCSET_ATTRIBUTE);
                        if (srcset) {
                            const srcsetData = srcsetParser.parse(srcset).map(data => {
                                const src = resolvePath(data.url, base);
                                const resource = getResource(resources, src, data.url);
                                if (resource) {
                                    if (!fetchMissingResources) {
                                        resource.used = true;
                                        data.url = getResourceURI(resource);
                                    }
                                } else if (fetchMissingResources) {
                                    addMissingResource(missingResources, src, BASE64_ENCODING);
                                } else {
                                    data.url = src;
                                }
                                return data;
                            });
                            if (!fetchMissingResources) {
                                setAttribute(child, SRCSET_ATTRIBUTE, srcsetParser.serialize(srcsetData));
                            }
                        }
                    } else if (child.tagName && child.tagName.toUpperCase() === SCRIPT_TAG && !fetchMissingResources) {
                        let type = child.getAttribute(TYPE_ATTRIBUTE);
                        if (type) {
                            type = type.toLowerCase();
                        }
                        if (!enableScripts && (!type || type !== "application/ld+json")) {
                            child.remove();
                        }
                    }
                } else if (child.tagName && child.tagName.toUpperCase() === BODY_TAG || child.tagName && child.tagName.toUpperCase() === TABLE_TAG || child.tagName && child.tagName.toUpperCase() === TD_TAG || child.tagName && child.tagName.toUpperCase() === TH_TAG) {
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
                        } else {
                            setAttribute(child, BACKGROUND_ATTRIBUTE, background);
                        }
                    }
                } else if (child.tagName && child.tagName.toUpperCase() === INPUT_TAG) {
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
                        } else {
                            setAttribute(child, SRC_ATTRIBUTE, src);
                        }
                    }
                } else if (child.tagName && child.tagName.toUpperCase() === IFRAME_TAG || child.tagName && child.tagName.toUpperCase() === FRAME_TAG || child.tagName && child.tagName.toUpperCase() === EMBED_TAG || child.tagName && child.tagName.toUpperCase() === OBJECT_TAG) {
                    let id, attribute;
                    if (child.tagName && child.tagName.toUpperCase() === OBJECT_TAG) {
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
                            if (child.tagName && child.tagName.toUpperCase() === EMBED_TAG || child.tagName && child.tagName.toUpperCase() === OBJECT_TAG) {
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
                                    if (child.tagName && child.tagName.toUpperCase() === IFRAME_TAG) {
                                        setOriginalAttribute(child, SRC_ATTRIBUTE);
                                        child.removeAttribute(SRC_ATTRIBUTE);
                                        child.setAttribute(SRCDOC_ATTRIBUTE, result);
                                    } else {
                                        setAttribute(child, attribute, `data:text/html,${encodeURIComponent(result)}`);
                                    }
                                }
                            }
                        } else if (fetchMissingResources) {
                            addMissingResource(missingResources, src);
                        } else {
                            setAttribute(child, attribute, src);
                        }
                    }
                } else if ((child.tagName && child.tagName.toUpperCase() === A_TAG || child.tagName && child.tagName.toUpperCase() === AREA_TAG) && !fetchMissingResources) {
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
                    child.removeAttribute(PING_ATTRIBUTE);
                } else if (child.tagName && child.tagName.toUpperCase() === META_TAG && !fetchMissingResources) {
                    let httpEquiv = child.getAttribute(HTTP_EQUIV_ATTRIBUTE);
                    if (httpEquiv) {
                        httpEquiv = httpEquiv.toLowerCase();
                        if (httpEquiv === "refresh" || httpEquiv === "content-security-policy") {
                            child.remove();
                        }
                    }
                }
                nodes.push(child);
            }
        }
    }
    if (fetchMissingResources) {
        return missingResources;
    } else {
        if (!canonicalLinkElement) {
            const linkElement = document.createElement(LINK_TAG);
            linkElement.setAttribute(REL_ATTRIBUTE, "canonical");
            linkElement.setAttribute(HREF_ATTRIBUTE, index);
            document.head.appendChild(linkElement);
        }
        const metaElement = document.createElement(META_TAG);
        metaElement.setAttribute(HTTP_EQUIV_ATTRIBUTE, "content-security-policy");
        let csp = "default-src 'none'; connect-src 'self' data:; font-src 'self' data:; img-src 'self' data:; style-src 'self' 'unsafe-inline' data:; frame-src 'self' data:; media-src 'self' data:; object-src 'self' data:;";
        if (enableScripts) {
            csp += " script-src 'self' 'unsafe-inline' data:;";
        } else {
            csp += " script-src 'none';";
        }
        metaElement.setAttribute(CONTENT_ATTRIBUTE, csp);
        if (document.head.firstChild) {
            document.head.prepend(metaElement);
        } else {
            document.head.appendChild(metaElement);
        }
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
            const pageInfoElement = document.createElement(SCRIPT_TAG);
            pageInfoElement.setAttribute(TYPE_ATTRIBUTE, "application/ld+json");
            pageInfoElement.appendChild(document.createTextNode(JSON.stringify(pageInfo, null, 2)));
            if (document.head.firstChild) {
                document.head.firstChild.after(pageInfoElement);
            } else {
                document.head.appendChild(pageInfoElement);
            }
        }
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
                if (!path.startsWith(DATA_PROTOCOL) && !path.startsWith(ORIGINAL_URL_FUNCTION_NAME)) {
                    const id = resolvePath(path, base);
                    const resource = getResource(resources, id, path);
                    if (resource) {
                        if (!missingResources) {
                            resource.used = true;
                            if (resource.contentType.startsWith(STYLESHEET_CONTENT_TYPE)) {
                                resource.data = replaceStyleSheetUrls(resources, resource.id, resource, { context: STYLESHEET_CONTEXT }, stylesheets, missingResources);
                            }
                            node.value = ORIGINAL_URL_FUNCTION_NAME + "(" + JSON.stringify(id) + ") " + getResourceURI(resource);
                        }
                    } else if (missingResources) {
                        addMissingResource(missingResources, id, BASE64_ENCODING);
                    } else {
                        node.value = ORIGINAL_URL_FUNCTION_NAME + "(" + JSON.stringify(id) + ") " + id;
                    }
                }
            } else if (node.type === AT_RULE && node.name.toLowerCase() === "import") {
                const path = node.prelude.children.first.value;
                if (!path.startsWith(DATA_PROTOCOL) && !path.startsWith(ORIGINAL_URL_FUNCTION_NAME)) {
                    const id = resolvePath(path, base);
                    const resource = getResource(resources, id, path);
                    if (resource) {
                        resource.data = replaceStyleSheetUrls(resources, resource.id, resource, { context: STYLESHEET_CONTEXT }, stylesheets, missingResources);
                        if (!missingResources) {
                            resource.used = true;
                            node.prelude.children.first.value = ORIGINAL_URL_FUNCTION_NAME + "(" + JSON.stringify(id) + ") " + getResourceURI(resource);
                        }
                    } else if (missingResources) {
                        addMissingResource(missingResources, id);
                    } else {
                        node.prelude.children.first.value = ORIGINAL_URL_FUNCTION_NAME + "(" + JSON.stringify(id) + ") " + id;
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
    if ((id.startsWith("http:") || id.startsWith("https:")) && !missingResources.find(resource => resource.id === id)) {
        missingResources.push({ id, transferEncoding });
    }
}
