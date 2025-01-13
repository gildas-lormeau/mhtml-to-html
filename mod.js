/* eslint-disable no-console */

import { parse, convert } from "./lib/mod.js";

let expandGlob, isGlob, DOMParser, args, readFile, writeTextFile, exit, moduleVersion;

export { initDependencies, main };

function initDependencies(dependencies) {
    ({ expandGlob, isGlob, DOMParser, args, readFile, writeTextFile, exit, moduleVersion } = dependencies);
}

async function main() {
    const config = { DOMParser };
    const positionals = args;
    const inputValues = positionals.filter(arg => arg !== "--output" && arg !== "--enable-scripts");
    const input = inputValues[0] || "";
    const output = positionals.includes("--output") ? positionals[positionals.indexOf("--output") + 1] || "" : undefined;
    const enableScripts = positionals.includes("--enable-scripts");
    const version = positionals.includes("--version");
    const help = positionals.includes("--help");
    if (input === "" || output === "" || help) {
        console.log("Usage: mhtml-to-html <input>... [--output <output>] [--help] [--enable-scripts] [--version]");
        console.log(" Arguments:");
        console.log("  <input>: The input MHTML file, wildcards are supported");
        console.log(" Options:");
        console.log("  --output <output>: The output HTML file (default: input file with .html extension),");
        console.log("                     only used when a single input file is provided");
        console.log("  --help: Show this help message");
        console.log("  --enable-scripts: Enable scripts (default: disabled)");
        console.log("  --version: Show the version number");
        console.log("");
        console.log("Examples:");
        console.log(" mhtml-to-html file.mht");
        console.log(" mhtml-to-html file1.mht file2.mht");
        console.log(" mhtml-to-html file.mht --output output_file.html");
        console.log(" mhtml-to-html *.mht");
        console.log(" mhtml-to-html *.mht *.mhtml");
        console.log(" mhtml-to-html *.mht --enable-scripts");
        exit(1);
    } else if (version) {
        console.log(moduleVersion);
    } else {
        config.enableScripts = enableScripts;
        if (input && !isGlob(input) && output) {
            await convertFile(input, output, config);
        } else {
            for (const input of inputValues) {
                if (isGlob(input)) {
                    for await (const file of expandGlob(input)) {
                        await convertFile(file.path, null, config);
                    }
                } else {
                    await convertFile(input, null, config);
                }
            }
        }
    }
}

async function convertFile(input, output, config) {
    output = output || input.replace(/\.[^.]+$/, ".html");
    if (!output.endsWith(".html")) {
        output += ".html";
    }
    try {
        const data = await readFile(input);
        const mhtml = parse(data, config);
        const html = convert(mhtml, config);
        await writeTextFile(output, html);
    } catch (error) {
        console.error(`Error processing ${input}: ${error.message}`);
        console.error(error.stack);
    }
}
