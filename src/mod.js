import { DOMParser } from "jsr:@b-fuze/deno-dom";

function decodeQuotedPrintable(array) {
    const result = [];
    for (let i = 0; i < array.length; i++) {
        if (array[i] === 0x3D) {
            if (array[i + 1] === 0x0D || array[i + 1] === 0x0A) {
                i++;
                continue;
            }
            if (isHex(array, i + 1) && isHex(array, i + 2)) {
                const hex = parseInt(String.fromCharCode(array[i + 1], array[i + 2]), 16);
                result.push(hex);
                i += 2;
            } else {
                result.push(array[i]);
            }
        } else {
            result.push(array[i]);
        }
    }
    return result;

    function isHex(array, i) {
        return array[i] >= 0x30 && array[i] <= 0x39 || array[i] >= 0x41 && array[i] <= 0x46;
    }
}

function encodeBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
}

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
        let mediaUrl;
        try {
            mediaUrl = new URL(reference.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1").trim(), base).href;
        } catch (_) {
            console.warn(error);
        }
        if (media[mediaUrl]) {
            if (media[mediaUrl].mediaType.startsWith("text/css")) {
                media[mediaUrl].data = replaceReferences(media, mediaUrl, media[mediaUrl].data);
            }
            try {
                const embeddedAsset = JSON.stringify(`data:${media[mediaUrl].mediaType};base64,${(
                    media[mediaUrl].encoding === "base64" ?
                        media[mediaUrl].data :
                        encodeBase64(media[mediaUrl].data)
                )}`);
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
            return `data:${asset.mediaType};utf8,${escape(decodeQuotedPrintable(asset.data))}`;
        case "base64":
            return `data:${asset.mediaType};base64,${asset.data}`;
        default:
            return `data:${asset.mediaType};base64,${encodeBase64(asset.data)}`;
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
        let state, key, next, nextString, index, i, l;
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
                    next = getLineString();
                    if (next != 0 && next != "\n") {
                        splitHeaders(next, headers);
                    } else {
                        const contentTypeParams = headers["Content-Type"].split(";");
                        contentTypeParams.shift();
                        const boundaryParam = contentTypeParams.find(param => param.startsWith("boundary="));
                        boundary = boundaryParam.substring("boundary=".length).replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1").trim();
                        trim();
                        while (!next.includes(boundary)) {
                            // TODO: store content before first boundary
                            next = getLineString();
                        }
                        content = {};
                        state = MHTML_FSM.MTHML_CONTENT;
                    }
                    break;
                }
                case MHTML_FSM.MTHML_CONTENT: {
                    next = getLineString();
                    if (next != 0 && next != "\n") {
                        splitHeaders(next, content);
                    } else {
                        encoding = content["Content-Transfer-Encoding"];
                        const mediaType = content["Content-Type"];
                        const id = content["Content-ID"];
                        location = content["Content-Location"];
                        if (typeof index === "undefined") {
                            index = location;
                        }
                        asset = {
                            encoding,
                            mediaType,
                            data: [],
                            id
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
                    nextString = new TextDecoder().decode(new Uint8Array(next));
                    while (!nextString.includes(boundary)) {
                        if (asset.encoding === "quoted-printable" && asset.data.length) {
                            if (asset.data[asset.data.length - 1] === 0x3D) {
                                asset.data = asset.data.slice(0, asset.data.length - 1);
                            }
                        }
                        asset.data.splice(asset.data.length, 0, ...next);
                        next = getLine(encoding);
                        nextString = new TextDecoder().decode(new Uint8Array(next));
                    }
                    asset.data = new Uint8Array(asset.data);
                    if (asset.encoding === "base64") {
                        try {
                            asset.data = new TextDecoder().decode(asset.data);
                        } catch (error) {
                            console.warn(error);
                        }
                    }
                    if (asset.encoding === "quoted-printable") {
                        let charset;
                        const charsetMatch = asset.mediaType.match(/charset=([^;]+)/);
                        if (charsetMatch) {
                            charset = charsetMatch[1].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1").trim();
                        }
                        try {
                            asset.data = new TextDecoder(charset).decode(asset.data);
                        } catch (error) {
                            console.warn(error);
                            asset.data = new TextDecoder().decode(asset.data);
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
            while (i < mhtml.length - 1 && (mhtml[i] === 0x20 || mhtml[i] === 0x0A || mhtml[i] === 0x0D)) {
                if (mhtml[++i] == 0x0A) {
                    l++;
                }
            }
        }

        function getLine(encoding) {
            const j = i;
            while (mhtml[i] !== 0x0A && i++ < mhtml.length - 1);
            i++; l++;
            let line = mhtml.slice(j, i);
            if (encoding === "quoted-printable") {
                do {
                    if (line[line.length - 1] === 0x0A) {
                        line = line.slice(0, line.length - 1);
                    }
                    if (line[line.length - 1] === 0x0D) {
                        line = line.slice(0, line.length - 1);
                    }
                } while (line[line.length - 1] === 0x0A || line[line.length - 1] === 0x0D);
                return decodeQuotedPrintable(line);
            }
            if (encoding === "base64") {
                do {
                    if (line[line.length - 1] === 0x0A) {
                        line = line.slice(0, line.length - 1);
                    }
                    if (line[line.length - 1] === 0x0D) {
                        line = line.slice(0, line.length - 1);
                    }
                } while (line[line.length - 1] === 0x0A || line[line.length - 1] === 0x0D);
                return line;
            }
            return line;
        }

        function getLineString() {
            const j = i;
            while (mhtml[i] !== 0x0A && i++ < mhtml.length - 1);
            i++; l++;
            const line = mhtml.slice(j, i);
            return new TextDecoder().decode(line).trim();
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
                        if (typeof media[href] !== "undefined" && media[href].mediaType.startsWith("text/css")) {
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
                        if (typeof media[src] !== "undefined" && media[src].mediaType.startsWith("image/")) {
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
                        if (typeof media[src] !== "undefined" && media[src].mediaType.startsWith("image/")) {
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
                            if (frame && frame.mediaType.startsWith("text/html")) {
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
