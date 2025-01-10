/* eslint-disable no-console */
/* global TextEncoder */

import { parse, convert } from "./src/mod.js";

let expandGlob, isGlob, DOMParser, args, readTextFile, writeTextFile, exit;

function initDependencies(dependencies) {
    ({ expandGlob, isGlob, DOMParser, args, readTextFile, writeTextFile, exit } = dependencies);
}

async function main() {
    const config = { DOMParser };
    const positionals = args;
    const values = positionals.filter(arg => arg !== "--output" && arg !== "--help" && arg !== "--enable-scripts");
    const help = positionals.includes("--help");
    const output = positionals.includes("--output") ? positionals[positionals.indexOf("--output") + 1] || "" : undefined;
    const input = values[0] || "";
    const enableScripts = positionals.includes("--enable-scripts");
    if (input === "" || output === "" || help) {
        console.log("Usage: mhtml-to-html <input>... [--output output] [--help] [--enable-scripts]");
        console.log(" Arguments:");
        console.log("  input: The input MHTML file, wildcards are supported (the output option will be ignored)");
        console.log(" Options:");
        console.log("  --output: The output HTML file (default: input file with .html extension)");
        console.log("  --enable-scripts: Enable scripts (default: disabled)");
        console.log("  --help: Show this help message");
        console.log("");
        exit(1);
    } else {
        config.enableScripts = enableScripts;
        if (isGlob(input)) {
            for await (const file of expandGlob(input)) {
                await process(file.path, null, config);
            }
        } else if (input && output) {
            await process(input, output, config);
        } else {
            for (const input of values) {
                await process(input, null, config);
            }
        }
    }
}

async function process(input, output, config) {
    output = output || input.replace(/\.[^.]+$/, ".html");
    if (!output.endsWith(".html")) {
        output += ".html";
    }
    try {
        const data = await readTextFile(input);
        const mhtml = parse(new TextEncoder().encode(data), config);
        const html = convert(mhtml, config);
        await writeTextFile(output, html);
    } catch (error) {
        console.error(`Error processing ${input}: ${error.message}`);
        console.error(error.stack);
    }
}

export { initDependencies, main, process, parse, convert };