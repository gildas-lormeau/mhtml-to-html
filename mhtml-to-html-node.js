#!/usr/bin/env -S node

/* global TextEncoder */
import process from "node:process";
import { readFile, writeFile } from "node:fs/promises";
import { Glob, globSync } from "glob";

import { convert } from "./lib/mod-node.js";
import packageInfo from "./package.json" with { type: "json" };

import { initDependencies, main } from "./mod.js";

const args = process.argv.slice(2);
const moduleVersion = packageInfo.version;
initDependencies({ expandGlob, isGlob, args, readFile, writeTextFile, exit, moduleVersion, convert });
await main();

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
    return writeFile(path, new TextEncoder().encode(data));
}

function exit(code) {
    process.exit(code);
}
