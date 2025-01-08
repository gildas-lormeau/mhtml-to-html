/* global Deno */

import mhtmlToHtml from "./src/mod.js";

function main() {
    const positionals = Deno.args;
    if (positionals.length < 1) {
        console.log("Usage: mhtml-to-html <input> [output]");
        Deno.exit(1);
    } else {
        const input = positionals[0];
        const output = positionals[1] || input.replace(/\.[^.]+$/, ".html");
        const data = Deno.readTextFileSync(input);
        const doc = mhtmlToHtml.convert(data);
        Deno.writeTextFileSync(output, doc.serialize());
    }
}

export default main;