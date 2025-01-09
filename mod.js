/* eslint-disable no-console */
/* global Deno, TextEncoder */

import { parse, convert } from "./src/mod.js";
import { isGlob } from "jsr:@std/path";
import { expandGlob } from "jsr:@std/fs";

async function main() {
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
                process(file.path);
            }
        } else {
            process(positionals[0], positionals[1]);
        }
    }
}

function process(input, output) {
    output = output || input.replace(/\.[^.]+$/, ".html");
    if (!output.endsWith(".html")) {
        output += ".html";
    }
    const data = Deno.readTextFileSync(input);
    const mhtml = parse(new TextEncoder().encode(data));
    const doc = convert(mhtml);
    Deno.writeTextFileSync(output, doc.serialize());
}

export { parse, convert, main };