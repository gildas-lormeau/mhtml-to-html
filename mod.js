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
    const version = positionals.includes("--version");
    if (input === "" || output === "" || help) {
        console.log("Usage: mhtml-to-html <input>... [--output <output>] [--help] [--enable-scripts] [--version]");
        console.log(" Arguments:");
        console.log("  <input>: The input MHTML file, wildcards are supported");
        console.log(" Options:");
        console.log("  --output <output>: The output HTML file (default: input file with .html extension), only used when a single input file is provided");
        console.log("  --enable-scripts: Enable scripts (default: disabled)");
        console.log("  --help: Show this help message");
        console.log("  --version: Show the version number");
        console.log("");
        console.log("Examples:");
        console.log(" mhtml-to-html file.mht");
        console.log(" mhtml-to-html file.mht --output file.html");
        console.log(" mhtml-to-html *.mht");
        console.log(" mhtml-to-html *.mht --enable-scripts");
        exit(1);
    } else if (version) {
        console.log("1.0.0");
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