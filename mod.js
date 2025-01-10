/* eslint-disable no-console */
/* global TextEncoder */

let expandGlob, isGlob, parse, convert, DOMParser, args, readTextFile, writeTextFile, exit;

function initDependencies(dependencies) {
    ({ expandGlob, isGlob, parse, convert, DOMParser, args, readTextFile, writeTextFile, exit } = dependencies);
}

async function main() {
    const config = { DOMParser };
    const positionals = args;
    if (positionals.length < 1 || positionals.includes("-h") || positionals.includes("--help")) {
        console.log("Usage: mhtml-to-html <input> [output] [options]");
        console.log(" Arguments:");
        console.log("  input: The input MHTML file, wildcards are supported (the output argument will be ignored)");
        console.log("  output: The output HTML file, if not specified, the input file will be used with the extension changed to .html");
        console.log(" Options:");
        console.log("  -h, --help: Show this help message");
        console.log("");
        exit(1);
    } else {
        if (isGlob(positionals[0])) {
            for await (const file of expandGlob(positionals[0])) {
                await process(file.path, null, config);
            }
        } else {
            await process(positionals[0], positionals[1], config);
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
        const doc = convert(mhtml, config);
        await writeTextFile(output, doc.serialize());
    } catch (error) {
        console.error(`Error processing ${input}: ${error.message}`);
        console.error(error.stack);
    }
}

export { initDependencies, main, process, parse, convert };