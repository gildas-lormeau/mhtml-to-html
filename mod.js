/* global Deno, TextEncoder */

import mhtmlToHtml from "./src/mod.js";
const { parse, convert } = mhtmlToHtml;
import { isGlob } from "jsr:@std/path";
import { expandGlob } from "jsr:@std/fs";

async function main() {
    const positionals = Deno.args;
    if (positionals.length < 1) {
        // eslint-disable-next-line no-console
        console.log("Usage: mhtml-to-html <input> [output]");
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
    const mhtml = mhtmlToHtml.parse(new TextEncoder().encode(data));
    const doc = mhtmlToHtml.convert(mhtml);
    Deno.writeTextFileSync(output, doc.serialize());
}

export { parse, convert, main };