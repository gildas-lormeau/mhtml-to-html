import { DOMParser } from "jsr:@b-fuze/deno-dom";

const QuotedPrintable = {
    decode(input) {
        return input
            .replace(/[\t\x20]$/gm, "")
            .replace(/=(?:\r\n?|\n|$)/g, "")
            .replace(/=([a-fA-F0-9]{2})/g, (_, $1) => {
                const codePoint = parseInt($1, 16);
                return String.fromCharCode(codePoint);
            });
    }
};

const Base64 = {
    encode(str) {
        return btoa(unescape(encodeURIComponent(str)));
    },
    decode(str) {
        return decodeURIComponent(escape(str));
    }
};

function defaultDOMParser(asset) {
    return {
        window: {
            document: new DOMParser().parseFromString(asset, "text/html")
        },
        serialize() {
            let result = "";
            if (this.window.document.doctype) {
                result += serializeDocType(this.window.document.doctype) + "\n";
            }
            result += this.window.document.documentElement.outerHTML;
            return result;
        }
    };
}

function serializeDocType(doctype) {
    return `<!DOCTYPE ${doctype.name}${(doctype.publicId ? ` PUBLIC "${doctype.publicId}"` : "")}${(doctype.systemId ? ` "${doctype.systemId}"` : "")}>`;
}

function replaceReferences(media, base, asset) {
    const CSS_URL_RULE = "url(";
    let reference, i;
    for (i = 0; (i = asset.indexOf(CSS_URL_RULE, i)) > 0; i += reference.length) {
        i += CSS_URL_RULE.length;
        reference = asset.substring(i, asset.indexOf(")", i));
        const path = new URL(reference.replace(/(\"|\")/g, ""), base).href;
        if (media[path] != null) {
            if (media[path].type === "text/css") {
                media[path].data = replaceReferences(media, base, media[path].data);
            }
            try {
                const embeddedAsset = `"data:${media[path].type};base64,${(
                    media[path].encoding === "base64" ?
                        media[path].data :
                        Base64.encode(media[path].data)
                )}"`;
                asset = `${asset.substring(0, i)}${embeddedAsset}${asset.substring(i + reference.length)}`;
            } catch (error) {
                console.warn(error);
            }
        }
    }
    return asset;
}

function convertAssetToDataURI(asset) {
    switch (asset.encoding) {
        case "quoted-printable":
            return `data:${asset.type};utf8,${escape(QuotedPrintable.decode(asset.data))}`;
        case "base64":
            return `data:${asset.type};base64,${asset.data}`;
        default:
            return `data:${asset.type};base64,${Base64.encode(asset.data)}`;
    }
}

const mhtmlToHtml = {
    parse: mhtml => {
        const MHTML_FSM = {
            MHTML_HEADERS: 0,
            MTHML_CONTENT: 1,
            MHTML_DATA: 2,
            MHTML_END: 3
        };
        let asset, content;
        let location, encoding;
        let state, key, next, index, i, l;
        let boundary;
        const headers = {};
        content = {};
        const media = {};
        const frames = {};
        state = MHTML_FSM.MHTML_HEADERS;
        i = l = 0;
        while (state != MHTML_FSM.MHTML_END) {
            switch (state) {
                case MHTML_FSM.MHTML_HEADERS: {
                    next = getLine();
                    if (next != 0 && next != "\n") {
                        splitHeaders(next, headers);
                    } else {
                        const contentTypeParams = headers["Content-Type"].split(";");
                        contentTypeParams.shift();
                        const boundaryParam = contentTypeParams.find(param => param.startsWith("boundary="));
                        boundary = boundaryParam.substring("boundary=".length).replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
                        trim();
                        while (!next.includes(boundary)) {
                            // TODO: store content before first boundary
                            next = getLine();
                        }
                        content = {};
                        state = MHTML_FSM.MTHML_CONTENT;
                    }
                    break;
                }
                case MHTML_FSM.MTHML_CONTENT: {
                    next = getLine();
                    if (next != 0 && next != "\n") {
                        splitHeaders(next, content);
                    } else {
                        let charset = "utf-8";
                        encoding = content["Content-Transfer-Encoding"];
                        let [type, mediaTypeParams] = content["Content-Type"].split(";").map((s) => s.toLowerCase().trim());
                        if (mediaTypeParams) {
                            mediaTypeParams = mediaTypeParams.split(";").map(param => param.split("=").map(s => s.trim()));
                            charset = mediaTypeParams.find(param => param[0] === "charset");
                            if (charset) {
                                charset = charset[1].replace(/^"(.*?)"$/, "$1").replace(/^'(.*?)'$/, "$1");
                            }
                        }
                        const id = content["Content-ID"];
                        location = content["Content-Location"];
                        if (typeof index === "undefined") {
                            index = location;
                        }
                        asset = {
                            encoding: encoding,
                            charset,
                            type: type,
                            data: "",
                            id: id
                        };
                        if (typeof id !== "undefined") {
                            frames[id] = asset;
                        }
                        if (typeof location !== "undefined" && typeof media[location] === "undefined") {
                            media[location] = asset;
                        }
                        trim();
                        content = {};
                        state = MHTML_FSM.MHTML_DATA;
                    }
                    break;
                }
                case MHTML_FSM.MHTML_DATA: {
                    next = getLine(encoding);
                    while (!next.includes(boundary)) {
                        asset.data += next;
                        next = getLine(encoding);
                    }
                    if (asset.encoding === "base64") {
                        try {
                            asset.data = Base64.decode(asset.data);
                        } catch (error) {
                            console.warn(error);
                        }
                    }
                    state = (i >= mhtml.length - 1 ? MHTML_FSM.MHTML_END : MHTML_FSM.MTHML_CONTENT);
                    break;
                }
            }
        }
        return {
            frames: frames,
            media: media,
            index: index
        };

        function trim() {
            while (i < mhtml.length - 1 && /\s/.test(mhtml[i])) {
                if (mhtml[++i] == "\n") { l++; }
            }
        }

        function getLine(encoding) {
            const j = i;
            while (mhtml[i] !== "\n" && i++ < mhtml.length - 1);
            i++; l++;
            const line = mhtml.substring(j, i);
            if (encoding === "quoted-printable") {
                return QuotedPrintable.decode(line);
            }
            if (encoding === "base64") {
                return line.trim();
            }
            return line;
        }

        function splitHeaders(line, obj) {
            const m = line.indexOf(":");
            if (m > -1) {
                key = line.substring(0, m).trim();
                obj[key] = line.substring(m + 1, line.length).trim();
            } else {
                obj[key] += line.trim();
            }
        }
    },
    convert: mhtml => {
        const parseDOM = defaultDOMParser;
        let base, img;
        let href, src, title;
        mhtml = mhtmlToHtml.parse(mhtml);
        const frames = mhtml.frames;
        const media = mhtml.media;
        const index = mhtml.index;
        const dom = parseDOM(media[index].data);
        const documentElem = dom.window.document;
        const nodes = [documentElem];
        while (nodes.length) {
            const childNode = nodes.shift();
            childNode.childNodes.forEach(child => {
                if (child.getAttribute) {
                    href = new URL(child.getAttribute("href"), index).href;
                    src = new URL(child.getAttribute("src"), index).href;
                    title = child.getAttribute("title");
                    const style = child.getAttribute("style");
                    if (style) {
                        child.setAttribute("style", replaceReferences(media, index, style));
                    }
                }
                if (child.removeAttribute) {
                    child.removeAttribute("integrity");
                }
                switch (child.tagName) {
                    case "HEAD":
                        base = documentElem.createElement("base");
                        base.setAttribute("target", "_parent");
                        child.insertBefore(base, child.firstChild);
                        break;
                    case "LINK":
                        if (typeof media[href] !== "undefined" && media[href].type === "text/css") {
                            if (title) {
                                child.remove();
                            } else {
                                const style = documentElem.createElement("style");
                                style.type = "text/css";
                                const mediaAttribute = child.getAttribute("media");
                                if (mediaAttribute) {
                                    style.setAttribute("media", mediaAttribute);
                                }
                                media[href].data = replaceReferences(media, href, media[href].data);
                                style.appendChild(documentElem.createTextNode(media[href].data));
                                childNode.replaceChild(style, child);
                            }
                        }
                        break;
                    case "STYLE":
                        if (title) {
                            child.remove();
                        } else {
                            const style = documentElem.createElement("style");
                            style.type = "text/css";
                            const mediaAttribute = child.getAttribute("media");
                            if (mediaAttribute) {
                                style.setAttribute("media", mediaAttribute);
                            }
                            style.appendChild(documentElem.createTextNode(replaceReferences(media, index, child.innerHTML)));
                            childNode.replaceChild(style, child);
                        }
                        break;
                    case "IMG":
                        img = null;
                        if (typeof media[src] !== "undefined" && media[src].type.includes("image")) {
                            try {
                                img = convertAssetToDataURI(media[src]);
                            } catch (error) {
                                console.warn(error);
                            }
                            if (img !== null) {
                                child.setAttribute("src", img);
                            }
                        }
                        break;
                    case "SOURCE":
                        if (typeof media[src] !== "undefined" && media[src].type.includes("image")) {
                            try {
                                img = convertAssetToDataURI(media[src]);
                            } catch (error) {
                                console.warn(error);
                            }
                            if (img !== null) {
                                child.setAttribute("src", img);
                            }
                        }
                        break;
                    case "IFRAME":
                        if (src) {
                            const id = `<${src.split("cid:")[1]}>`;
                            const frame = frames[id];
                            if (frame && frame.type === "text/html") {
                                const iframe = mhtmlToHtml.convert({
                                    media: Object.assign({}, media, { [id]: frame }),
                                    frames: frames,
                                    index: id,
                                });
                                child.src = `data:text/html;charset=utf-8,${encodeURIComponent(
                                    iframe.window.document.documentElement.outerHTML
                                )}`;
                            }
                        }
                        break;
                    default:
                        break;
                }
                nodes.push(child);
            });
        }
        return dom;
    }
};

export default mhtmlToHtml;
