import { parse, defaultTreeAdapter } from "parse5";

const SELF_CLOSED_TAG_NAMES = ["AREA", "BASE", "BASEFONT", "BGSOUND", "BR", "COL", "COMMAND", "EMBED", "FRAME", "HR", "IMG", "INPUT", "KEYGEN", "LINK", "META", "PARAM", "SOURCE", "TRACK", "WBR"];
const TEXT_NODE_TAGS = ["STYLE", "SCRIPT", "XMP", "IFRAME", "NOEMBED", "NOFRAMES", "PLAINTEXT", "NOSCRIPT"];

const treeAdapter = {
    ...defaultTreeAdapter,
    createDocument() {
        const document = defaultTreeAdapter.createDocument();
        document.createElement = function (tagName) {
            return treeAdapter.createElement(tagName, undefined, []);
        };
        document.createTextNode = function (data) {
            return treeAdapter.createTextNode(data);
        };
        Object.defineProperty(document, "documentElement", {
            get() {
                return document.childNodes.find(node => node.nodeName === "html");
            }
        });
        Object.defineProperty(document, "head", {
            get() {
                return document.documentElement.childNodes.find(node => node.nodeName === "head");
            }
        });
        Object.defineProperty(document, "doctype", {
            get() {
                const firstChild = treeAdapter.getFirstChild(document);
                if (firstChild && firstChild.nodeName === "#documentType") {
                    return firstChild;
                } else {
                    return undefined;
                }
            }
        });
        return document;
    },
    createElement(tagName, namespaceURI, attrs) {
        const element = defaultTreeAdapter.createElement(tagName, namespaceURI, attrs);
        element.setAttribute = setAttribute;
        element.getAttribute = getAttribute;
        element.removeAttribute = removeAttribute;
        element.appendChild = appendChild;
        element.remove = remove;
        element.replaceWith = replaceWith;
        element.prepend = prepend;
        element.after = after;
        Object.defineProperty(element, "firstChild", {
            get() {
                return treeAdapter.getFirstChild(this);
            }
        });
        Object.defineProperty(element, "textContent", {
            get() {
                return this.childNodes.map(node => treeAdapter.getTextNodeContent(node)).join("");
            }
        });
        Object.defineProperty(element, "outerHTML", {
            get() {
                return serialize(element);
            }
        });
        return element;
    }
};

export class DOMParser {
    parseFromString(html) {
        const document = parse(html, { treeAdapter });
        if (!document.head) {
            const head = document.createElement("head");
            document.documentElement.prepend(head);
        }
        return document;
    }
}

function setAttribute(name, value) {
    const indexAttribute = this.attrs.findIndex(attr => attr.name.toLowerCase() === name.toLowerCase());
    if (indexAttribute === -1) {
        this.attrs.push({ name, value });
    } else {
        this.attrs[indexAttribute].value = value;
    }
}

function getAttribute(name) {
    const attribute = this.attrs.find(attr => attr.name.toLowerCase() === name.toLowerCase());
    if (attribute !== undefined) {
        return attribute.value;
    }
}

function removeAttribute(name) {
    const index = this.attrs.findIndex(attr => attr.name === name);
    if (index !== -1) {
        this.attrs.splice(index, 1);
    }
}

function appendChild(child) {
    return treeAdapter.appendChild(this, child);
}

function remove() {
    if (this.parentNode !== undefined) {
        const index = this.parentNode.childNodes.indexOf(this);
        if (index !== -1) {
            this.parentNode.childNodes.splice(index, 1);
            this.parentNode = undefined;
        }
    }
}

function replaceWith(...nodes) {
    if (this.parentNode !== undefined) {
        const index = this.parentNode.childNodes.indexOf(this);
        if (index !== -1) {
            const oldNodes = this.parentNode.childNodes.splice(index, 1, ...nodes);
            nodes.forEach(node => node.parentNode = this.parentNode);
            oldNodes.forEach(node => node.parentNode = undefined);
        }
    }
}

function prepend(...nodes) {
    this.childNodes.unshift(...nodes);
    nodes.forEach(node => node.parentNode = this);
}

function after(...nodes) {
    if (this.parentNode !== undefined) {
        const index = this.parentNode.childNodes.indexOf(this);
        if (index !== -1) {
            this.parentNode.childNodes.splice(index + 1, 0, ...nodes);
            nodes.forEach(node => node.parentNode = this.parentNode);
        }
    }
};

function serialize(node) {
    if (node.nodeName === "#text") {
        return serializeTextNode(node);
    } else if (node.nodeName === "#comment") {
        return serializeCommentNode(node);
    } else {
        return serializeElement(node);
    }
}

function serializeTextNode(textNode) {
    const parentNode = textNode.parentNode;
    let parentTagName = parentNode.tagName;
    if (parentTagName !== undefined) {
        parentTagName = parentTagName.toUpperCase();
    }
    const parentType = parentNode.getAttribute("type");
    if (!parentTagName || TEXT_NODE_TAGS.includes(parentTagName)) {
        if ((parentTagName === "SCRIPT" && (!parentType || parentType === "text/javascript")) || parentTagName === "STYLE") {
            return textNode.value.replace(/<\//gi, "<\\/").replace(/\/>/gi, "\\/>");
        } else {
            return textNode.value;
        }
    } else {
        return textNode.value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\u00a0/g, "&nbsp;").replace(/>/g, "&gt;");
    }
}

function serializeCommentNode(commentNode) {
    return `<!--${commentNode.data}-->`;
}

function serializeElement(element) {
    let html = "";
    html += `<${element.tagName.toLowerCase()}`;
    html += serializeAttributes(element);
    html += ">";
    html += element.childNodes.map(node => serialize(node)).join("");
    if (!SELF_CLOSED_TAG_NAMES.includes(element.tagName.toUpperCase())) {
        html += `</${element.tagName.toLowerCase()}>`;
    }
    return html;
}

function serializeAttributes(element) {
    return element.attrs.map(({ name, value, prefix, namespace }) => {
        if (!name.match(/["'>/=]/)) {
            value = value.replace(/&/g, "&amp;");
            value = value.replace(/"/g, "&quot;");
            value = value.replace(/\u00a0/g, "&nbsp;");
            if (namespace) {
                if (namespace === "http://www.w3.org/1999/xlink") {
                    return ` xlink:${name}="${value}"`;
                } else if (namespace === "http://www.w3.org/2000/xmlns") {
                    if (name === "xmlns") {
                        return ` ${name}="${value}"`;
                    } else {
                        return ` xmlns:${name}="${value}"`;
                    }
                } else if (namespace === "http://www.w3.org/XML/1998/namespace") {
                    return ` xml:${name}="${value}"`;
                } else {
                    if (prefix === "") {
                        return ` ${name}="${value}"`;
                    } else {
                        return ` ${prefix}:${name}="${value}"`;
                    }
                }
            } else {
                return ` ${name}="${value}"`;
            }
        }
    }).join("");
}