import { decodeQuotedPrintable, encodeBase64, parseDOM, removeQuotes, decodeString } from "./util.js";

function replaceReferences(media, base, asset) {
    const CSS_URL_RULE = "url(";
    let reference, i;
    for (i = 0; (i = asset.indexOf(CSS_URL_RULE, i)) > 0; i += reference.length) {
        i += CSS_URL_RULE.length;
        reference = asset.substring(i, asset.indexOf(")", i));
        let mediaUrl;
        try {
            mediaUrl = new URL(removeQuotes(reference), base).href;
        } catch (error) {
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
    return `data:${asset.mediaType};base64,${asset.encoding === "base64" ? asset.data : encodeBase64(asset.data)}`;
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
                    next = getLine();
                    let nextString = decodeString(next);
                    if (nextString != 0 && nextString != "\n") {
                        splitHeaders(nextString, headers);
                    } else {
                        const contentTypeParams = headers["Content-Type"].split(";");
                        contentTypeParams.shift();
                        const boundaryParam = contentTypeParams.find(param => param.startsWith("boundary="));
                        boundary = removeQuotes(boundaryParam.substring("boundary=".length));
                        trim();
                        while (!nextString.includes(boundary)) {
                            // TODO: store content before first boundary
                            next = getLine();
                            nextString = decodeString(next);
                        }
                        content = {};
                        state = MHTML_FSM.MTHML_CONTENT;
                    }
                    break;
                }
                case MHTML_FSM.MTHML_CONTENT: {
                    next = getLine();
                    const nextString = decodeString(next);
                    if (nextString != 0 && nextString != "\n") {
                        splitHeaders(nextString, content);
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
                            id: index,
                            url: location
                        };
                        if (typeof id !== "undefined") {
                            frames[id] = asset;
                        }
                        if (typeof location !== "undefined" && !media[location]) {
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
                    nextString = decodeString(next);
                    while (!nextString.includes(boundary)) {
                        if (asset.encoding === "quoted-printable" && asset.data.length) {
                            if (asset.data[asset.data.length - 1] === 0x3D) {
                                asset.data = asset.data.slice(0, asset.data.length - 1);
                            }
                        }
                        asset.data.splice(asset.data.length, 0, ...next);
                        next = getLine(encoding);
                        nextString = decodeString(next);
                    }
                    asset.data = new Uint8Array(asset.data);
                    let charset;
                    const charsetMatch = asset.mediaType.match(/charset=([^;]+)/);
                    if (charsetMatch) {
                        charset = removeQuotes(charsetMatch[1]);
                    }
                    try {
                        asset.data = decodeString(asset.data, charset);
                    } catch (error) {
                        if (asset.encoding === "quoted-printable") {
                            console.warn(error);
                            asset.data = decodeString(asset.data);
                        } else {
                            throw error;
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
            do {
                if (line[line.length - 1] === 0x0A) {
                    line = line.slice(0, line.length - 1);
                }
                if (line[line.length - 1] === 0x0D) {
                    line = line.slice(0, line.length - 1);
                }
            } while (line[line.length - 1] === 0x0A || line[line.length - 1] === 0x0D);
            return encoding === "quoted-printable" ? new Uint8Array(decodeQuotedPrintable(line)) : line;
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
        let href, src, title;
        if (mhtml instanceof Uint8Array) {
            mhtml = mhtmlToHtml.parse(mhtml);
        }
        const frames = mhtml.frames;
        const media = mhtml.media;
        const index = mhtml.index;
        const url = media[index].url || media[index].id;
        const dom = parseDOM(media[index].data);
        const documentElement = dom.document;
        const nodes = [documentElement];
        while (nodes.length) {
            const childNode = nodes.shift();
            childNode.childNodes.forEach(child => {
                if (child.getAttribute) {
                    href = new URL(child.getAttribute("href"), url).href;
                    src = new URL(child.getAttribute("src"), url).href;
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
                    case "BASE":
                        base.remove();
                        break;
                    case "LINK":
                        if (media[href] && media[href].mediaType.startsWith("text/css")) {
                            if (title) {
                                child.remove();
                            } else {
                                const style = documentElement.createElement("style");
                                style.type = "text/css";
                                const mediaAttribute = child.getAttribute("media");
                                if (mediaAttribute) {
                                    style.setAttribute("media", mediaAttribute);
                                }
                                media[href].data = replaceReferences(media, href, media[href].data);
                                style.appendChild(documentElement.createTextNode(media[href].data));
                                childNode.replaceChild(style, child);
                            }
                        }
                        break;
                    case "STYLE":
                        if (title) {
                            child.remove();
                        } else {
                            const style = documentElement.createElement("style");
                            style.type = "text/css";
                            const mediaAttribute = child.getAttribute("media");
                            if (mediaAttribute) {
                                style.setAttribute("media", mediaAttribute);
                            }
                            style.appendChild(documentElement.createTextNode(replaceReferences(media, index, child.innerHTML)));
                            childNode.replaceChild(style, child);
                        }
                        break;
                    case "IMG":
                        if (media[src] && media[src].mediaType.startsWith("image/")) {
                            try {
                                child.setAttribute("src", convertAssetToDataURI(media[src]));
                            } catch (error) {
                                console.warn(error);
                            }
                        }
                        break;
                    case "AUDIO":
                        if (media[src] && media[src].mediaType.startsWith("audio/")) {
                            try {
                                child.setAttribute("src", convertAssetToDataURI(media[src]));
                            } catch (error) {
                                console.warn(error);
                            }
                        }
                        break;
                    case "VIDEO":
                        if (media[src].mediaType.startsWith("video/")) {
                            try {
                                child.setAttribute("src", convertAssetToDataURI(media[src]));
                            } catch (error) {
                                console.warn(error);
                            }
                        }
                        break;
                    case "SOURCE":
                        if (media[src] && media[src].mediaType.startsWith("image/") || media[src].mediaType.startsWith("video/") || media[src].mediaType.startsWith("audio/")) {
                            try {
                                child.setAttribute("src", convertAssetToDataURI(media[src]));
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
                            if (frame && (frame.mediaType.startsWith("text/html") || frame.mediaType.startsWith("application/xhtml+xml"))) {
                                const iframe = mhtmlToHtml.convert({
                                    media: Object.assign({}, media, { [id]: frame }),
                                    frames: frames,
                                    index: id,
                                    location: frame.location
                                });
                                child.removeAttribute("src");
                                child.setAttribute("srcdoc", iframe.serialize());
                            }
                        }
                        break;
                    default:
                        break;
                }
                nodes.push(child);
            });
        }
        const base = documentElement.createElement("base");
        base.setAttribute("target", "_parent");
        base.setAttribute("href", url);
        if (documentElement.head.firstChild) {
            documentElement.head.insertBefore(base, documentElement.head.firstChild);
        } else {
            documentElement.head.appendChild(base);
        }
        return dom;
    }
};

export default mhtmlToHtml;
