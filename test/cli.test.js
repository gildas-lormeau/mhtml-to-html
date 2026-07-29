// The command line layer: which arguments select which files, where the output goes, and what the
// options turn into. It takes all of its dependencies from the caller, so none of this touches the
// disk — the fakes below record what the real ones would have been asked to do.
import { test } from "node:test";
import assert from "node:assert/strict";
import { initDependencies, main } from "../mod.js";

const VERSION = "9.9.9";
const HTML = "<html><body>converted</body></html>";

// Runs main() with the given arguments and reports everything it did.
async function run(args, { files = {}, failing = [] } = {}) {
    const written = {};
    const read = [];
    const printed = [];
    const errors = [];
    const configs = [];
    let exitCode;
    const console = globalThis.console;
    const log = console.log;
    const error = console.error;
    console.log = message => printed.push(String(message));
    console.error = message => errors.push(String(message));
    try {
        initDependencies({
            args,
            isGlob: value => value.includes("*"),
            expandGlob: function* (pattern) {
                const prefix = pattern.split("*")[0];
                const suffix = pattern.split("*").pop();
                for (const path of Object.keys(files)) {
                    if (path.startsWith(prefix) && path.endsWith(suffix)) {
                        yield { path };
                    }
                }
            },
            readFile: path => {
                read.push(path);
                if (failing.includes(path)) {
                    throw new Error("Index page not found");
                }
                return files[path] === undefined ? "" : files[path];
            },
            writeTextFile: (path, data) => {
                written[path] = data;
            },
            exit: code => {
                exitCode = code;
            },
            moduleVersion: VERSION,
            convert: (mhtml, config) => {
                configs.push(config);
                return { data: HTML };
            }
        });
        await main();
    } finally {
        console.log = log;
        console.error = error;
    }
    return { written, read, printed, errors, configs, exitCode };
}

test("the version is printed on its own", async () => {
    const { printed, written } = await run(["--version"]);
    assert.deepEqual(printed, [VERSION]);
    assert.deepEqual(written, {}, "nothing should be converted");
});

test("the usage is printed when there is nothing to do", async () => {
    for (const args of [[], ["--help"], ["file.mht", "--output"]]) {
        const { printed, exitCode } = await run(args);
        assert.match(printed[0], /^Usage: mhtml-to-html/, `no usage for ${JSON.stringify(args)}`);
        assert.equal(exitCode, 1, `wrong exit code for ${JSON.stringify(args)}`);
    }
});

test("a single file is written next to itself with an html extension", async () => {
    const { written } = await run(["page.mht"], { files: { "page.mht": "raw" } });
    assert.deepEqual(written, { "page.html": HTML });
});

test("an output name is used as given", async () => {
    const { written } = await run(["page.mht", "--output", "result.html"], { files: { "page.mht": "raw" } });
    assert.deepEqual(Object.keys(written), ["result.html"]);
});

test("an output name without an extension gets one", async () => {
    const { written } = await run(["page.mht", "--output", "result"], { files: { "page.mht": "raw" } });
    assert.deepEqual(Object.keys(written), ["result.html"]);
});

test("several files are each converted next to themselves", async () => {
    const { written } = await run(["a.mht", "b.mhtml"], { files: { "a.mht": "raw", "b.mhtml": "raw" } });
    assert.deepEqual(Object.keys(written).sort(), ["a.html", "b.html"]);
});

test("a wildcard is expanded", async () => {
    const { written, read } = await run(["*.mht"], { files: { "a.mht": "raw", "b.mht": "raw", "c.txt": "raw" } });
    assert.deepEqual(read.sort(), ["a.mht", "b.mht"], "the wildcard matched the wrong files");
    assert.deepEqual(Object.keys(written).sort(), ["a.html", "b.html"]);
});

test("the options are handed to the converter", async () => {
    const { configs } = await run(["page.mht", "--enable-scripts", "--fetch-missing-resources"],
        { files: { "page.mht": "raw" } });
    assert.deepEqual(configs, [{ enableScripts: true, fetchMissingResources: true }]);
});

test("the options are off unless asked for", async () => {
    const { configs } = await run(["page.mht"], { files: { "page.mht": "raw" } });
    assert.deepEqual(configs, [{ enableScripts: false, fetchMissingResources: false }]);
});

test("an option is not mistaken for a file name", async () => {
    const { read } = await run(["--enable-scripts", "page.mht"], { files: { "page.mht": "raw" } });
    assert.deepEqual(read, ["page.mht"]);
});

test("a file that cannot be converted is reported and the others still are", async () => {
    const { written, errors } = await run(["broken.mht", "fine.mht"],
        { files: { "broken.mht": "raw", "fine.mht": "raw" }, failing: ["broken.mht"] });
    assert.deepEqual(Object.keys(written), ["fine.html"], "the good file was not converted");
    assert.ok(errors.some(message => message.includes("broken.mht")), "the failure was not reported");
});
