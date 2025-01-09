/* eslint-disable no-console */
/* global globalThis, Deno, TextEncoder */

import { expandGlob } from "jsr:@std/fs";
import { isGlob } from "jsr:@std/path";
import { parse, convert } from "./src/mod.js";

async function main(config = { DOMParser: globalThis.DOMParser }) {
    const positionals = Deno.args;
    if (positionals.length < 1 || positionals.includes("-h") || positionals.includes("--help")) {
        console.log("Usage: mhtml-to-html <input> [output]");
        console.log(" input: The input MHTML file, wildcards are supported");
        console.log(" output: The output HTML file, if not specified, the input file will be used with the extension changed to .html");
        console.log("");
        Deno.exit(1);
    } else {
        if (isGlob(positionals[0])) {
            for await (const file of expandGlob(positionals[0])) {
                process(file.path, null, config);
            }
        } else {
            process(positionals[0], positionals[1], config);
        }
    }
}

function process(input, output, config = { DOMParser: globalThis.DOMParser }) {
    output = output || input.replace(/\.[^.]+$/, ".html");
    if (!output.endsWith(".html")) {
        output += ".html";
    }
    try {
        const data = Deno.readTextFileSync(input);
        const mhtml = parse(new TextEncoder().encode(data), config);
        const doc = convert(mhtml, config);
        Deno.writeTextFileSync(output, doc.serialize());
    } catch (error) {
        console.error(`Error processing ${input}: ${error.message}`);
    }
}

export { parse, convert, process, main };