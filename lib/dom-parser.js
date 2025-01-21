import { parse, parseFragment } from "parse5";

const SELF_CLOSED_TAG_NAMES = ["AREA", "BASE", "BASEFONT", "BGSOUND", "BR", "COL", "COMMAND", "EMBED", "FRAME", "HR", "IMG", "INPUT", "KEYGEN", "LINK", "META", "PARAM", "SOURCE", "TRACK", "WBR"];

export default class DOMParser {
    parseFromString(html) {
        const document = parse(html);
        const documentElement = document.documentElement = document.childNodes.find(node => node.nodeName === "html");
        document.head = documentElement.childNodes.find(node => node.nodeName === "head");
        if (!document.head) {
            document.head = document.createElement("head");
            documentElement.prepend(document.head);
        }
        document.createElement = (tagName) => {
            return parseFragment(`<${tagName}></${tagName}>`).childNodes[0];
        };
        document.createTextNode = (data) => {
            data = data.replace(/</g, "&lt;");
            data = data.replace(/>/g, "&gt;");
            return parseFragment(data);
        };
        Object.defineProperty(document, "doctype", {
            get() {
                return this.childNodes.find(node => node.nodeName === "#documentType");
            }
        });
        const nodeProto = Object.getPrototypeOf(documentElement);
        if (Object.getOwnPropertyDescriptor(nodeProto, "firstChild") === undefined) {
            nodeProto.setAttribute = function (name, value) {
                const indexAttribute = this.attrs.findIndex(attr => attr.name.toLowerCase() === name.toLowerCase());
                if (indexAttribute === -1) {
                    this.attrs.push({ name, value });
                } else {
                    this.attrs[indexAttribute].value = value;
                }
            };
            nodeProto.getAttribute = function (name) {
                return this.attrs !== undefined ? this.attrs.find(attr => attr.name.toLowerCase() === name.toLowerCase())?.value : undefined;
            };
            nodeProto.removeAttribute = function (name) {
                if (this.attrs !== undefined) {
                    const index = this.attrs.findIndex(attr => attr.name === name);
                    if (index !== -1) {
                        this.attrs.splice(index, 1);
                    }
                }
            };
            nodeProto.appendChild = function (child) {
                this.childNodes.push(child);
                child.parentNode = this;
            };
            nodeProto.remove = function () {
                if (this.parentNode !== undefined) {
                    const index = this.parentNode.childNodes.indexOf(this);
                    if (index !== -1) {
                        this.parentNode.childNodes.splice(index, 1);
                        this.parentNode = undefined;
                    }
                }
            };
            nodeProto.replaceWith = function (...nodes) {
                if (this.parentNode !== undefined) {
                    const index = this.parentNode.childNodes.indexOf(this);
                    if (index !== -1) {
                        const oldNodes = this.parentNode.childNodes.splice(index, 1, ...nodes);
                        nodes.forEach(node => node.parentNode = this.parentNode);
                        oldNodes.forEach(node => node.parentNode = undefined);
                    }
                }
            };
            nodeProto.prepend = function (...nodes) {
                this.childNodes.unshift(...nodes);
                nodes.forEach(node => node.parentNode = this);
            };
            nodeProto.after = function (...nodes) {
                if (this.parentNode !== undefined) {
                    const index = this.parentNode.childNodes.indexOf(this);
                    if (index !== -1) {
                        this.parentNode.childNodes.splice(index + 1, 0, ...nodes);
                        nodes.forEach(node => node.parentNode = this.parentNode);
                    }
                }
            };
            Object.defineProperty(nodeProto, "firstChild", {
                get() {
                    return this.childNodes !== undefined ? this.childNodes[0] : undefined;
                }
            });
            Object.defineProperty(nodeProto, "textContent", {
                get() {
                    if (this.childNodes !== undefined) {
                        return this.childNodes.map(node => node.textContent).join("");
                    } else {
                        return this.value;
                    }
                },
                set(value) {
                    this.childNodes = [{ nodeName: "#text", value }];
                }
            });
            Object.defineProperty(nodeProto, "outerHTML", {
                get() {
                    let html = "";
                    if (this.tagName !== undefined) {
                        html += `<${this.tagName.toLowerCase()}`;
                        if (this.attrs !== undefined) {
                            html += this.attrs.map(({ name, value, prefix, namespace }) => {
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
                        html += ">";
                    }
                    if (this.childNodes !== undefined) {
                        html += this.childNodes.map(node => node.outerHTML).join("");
                    } else if (this.nodeName === "#comment") {
                        html += `<!--${this.textContent === undefined ? "" : this.textContent}-->`;
                    } else if (this.nodeName === "#text") {
                        if (this.textContent !== undefined) {
                            let textContent = this.textContent;
                            textContent = textContent.replace(/</g, "&lt;");
                            textContent = textContent.replace(/>/g, "&gt;");
                            html += textContent;
                        }
                    }
                    if (this.tagName !== undefined) {
                        if (!SELF_CLOSED_TAG_NAMES.includes(this.tagName.toUpperCase())) {
                            html += `</${this.tagName.toLowerCase()}>`;
                        }
                    }
                    return html;
                }
            });
        }
        return document;
    }
}
