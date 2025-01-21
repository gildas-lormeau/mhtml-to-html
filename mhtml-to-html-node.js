#!/usr/bin/env -S node

// deno-lint-ignore-file no-process-globals

/* global process, fetch */

import { readFile, writeFile } from "node:fs/promises";
import { Glob, globSync } from "glob";
import { parse, parseFragment } from "parse5";

import packageInfo from "./package.json" with { type: "json" };
import { initDependencies, main } from "./mod.js";

const SELF_CLOSED_TAG_NAMES = ["AREA", "BASE", "BASEFONT", "BGSOUND", "BR", "COL", "COMMAND", "EMBED", "FRAME", "HR", "IMG", "INPUT", "KEYGEN", "LINK", "META", "PARAM", "SOURCE", "TRACK", "WBR"];
const args = process.argv.slice(2);

class DOMParser {
    parseFromString(html) {
        const document = parse(html);
        document.documentElement = document.childNodes.find(node => node.nodeName === "html");
        document.head = document.documentElement.childNodes.find(node => node.nodeName === "head");
        if (!document.head) {
            document.head = document.createElement("head");
            document.documentElement.prepend(document.head);
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
        const nodeProto = Object.getPrototypeOf(document.documentElement);
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
                            html += this.attrs.map(({ name, value }) => {
                                if (!name.match(/["'>/=]/)) {
                                    value = value.replace(/&/g, "&amp;");
                                    value = value.replace(/"/g, "&quot;");
                                    return ` ${name.toLowerCase()}="${value}"`;
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

function expandGlob(pattern) {
    const glob = new Glob(pattern, {});
    const iterator = glob.iterate();
    return {
        [Symbol.asyncIterator]: () => ({
            next: async () => {
                const { done, value } = await iterator.next();
                return { done, value: value ? { path: value } : undefined };
            }
        })
    };
}

function isGlob(pattern) {
    const files = globSync(pattern);
    return files.length > 1 || (files.length === 1 && files[0] !== pattern);
}

function writeTextFile(path, data) {
    return writeFile(path, data);
}

function exit(code) {
    process.exit(code);
}

initDependencies({ expandGlob, isGlob, DOMParser, args, readFile, writeTextFile, fetch, exit, moduleVersion: packageInfo.version });
await main();
