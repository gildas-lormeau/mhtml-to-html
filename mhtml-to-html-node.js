#!/usr/bin/env -S node

// deno-lint-ignore-file no-process-globals

/* global process, fetch */

import { Glob, globSync } from "glob";
import { parse } from "node-html-parser";
import packageInfo from "./package.json" with { type: "json" };
import { readFile, writeFile } from "node:fs/promises";
import { initDependencies, main } from "./mod.js";

class DOMParser {
    parseFromString(html) {
        const documentElement = parse(html);
        let headElement, doctype;
        const nodes = [documentElement];
        while (nodes.length && !headElement) {
            const childNode = nodes.shift();
            for (let childIndex = 0; childIndex < childNode.childNodes.length && !headElement; childIndex++) {
                const child = childNode.childNodes[childIndex];
                if (child.tagName === "HEAD") {
                    headElement = child;
                }
                nodes.push(child);
            }
        }
        if (!headElement) {
            headElement = parse("<head></head>").childNodes[0];
            documentElement.childNodes.unshift(headElement);
        }
        if (documentElement.firstChild.nodeType === 3 && documentElement.firstChild.textContent.toLowerCase().startsWith("<!doctype")) {
            const textValue = documentElement.firstChild.textContent;
            const doctypeMatch = textValue.match(/^<!DOCTYPE\s+([^>\s]+)\s+(?:PUBLIC\s+"([^"]+)"\s+)?(?:\s+"([^"]+)")?\s*>|<!DOCTYPE\s+([^>\s]+)\s*>/i);
            if (doctypeMatch) {
                doctype = {
                    name: doctypeMatch[1] || doctypeMatch[4],
                    publicId: doctypeMatch[2],
                    systemId: doctypeMatch[3]
                };
            }
        }
        return {
            childNodes: [documentElement],
            documentElement,
            doctype,
            head: headElement,
            createElement(tagName) {
                return parse(`<${tagName}></${tagName}>`).childNodes[0];
            },
            createTextNode(text) {
                return parse(text);
            }
        };
    }
};
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

const args = process.argv.slice(2);

function writeTextFile(path, data) {
    return writeFile(path, data);
}

function exit(code) {
    process.exit(code);
}

initDependencies({ expandGlob, isGlob, DOMParser, args, readFile, writeTextFile, fetch, exit, moduleVersion: packageInfo.version });
await main();
