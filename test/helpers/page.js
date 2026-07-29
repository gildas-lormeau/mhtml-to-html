// A one-page document plus optional extra parts, which is the shape every network suite needs.
import { concatBytes } from "./mhtml.js";

const BOUNDARY = "----=_B";

export { ORIGIN, DOCUMENT_LOCATION, page, resource };

const ORIGIN = "https://example.com";
const DOCUMENT_LOCATION = `${ORIGIN}/`;

function resource(location, contentType, body) {
    return [`--${BOUNDARY}`, `Content-Type: ${contentType}`, "Content-Transfer-Encoding: 8bit",
        `Content-Location: ${location}`, "", body].join("\r\n");
}

// `head` and `body` are inserted into the document; `parts` are additional resources already present.
function page({ head = "", body = "", parts = [] } = {}) {
    const document = resource(DOCUMENT_LOCATION, "text/html; charset=utf-8",
        `<html><head>${head}</head><body>${body}</body></html>`);
    return concatBytes(["MIME-Version: 1.0", `Content-Type: multipart/related; boundary="${BOUNDARY}"`, "",
        document, ...parts, `--${BOUNDARY}--`, ""].join("\r\n"));
}
