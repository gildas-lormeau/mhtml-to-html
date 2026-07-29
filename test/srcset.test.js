// srcset carries several candidates in one attribute, each with a descriptor that has to survive the
// round trip. The parser behind it is the largest piece of the library with no other coverage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { convert } from "./helpers/lib.js";
import { ORIGIN, page, resource } from "./helpers/page.js";

const SMALL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const LARGE = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9QzwAFjDAGACzOAv/QMkKYAAAAAElFTkSuQmCC";
const uri = data => `data:image/png;base64,${data}`;
const part = (name, data) => resource(`${ORIGIN}/${name}`, "image/png", data, "base64");

const srcsetOf = async (srcset, parts, tagName = "img") => {
    const body = tagName === "source"
        ? `<picture><source srcset="${srcset}"><img src="a.png"></picture>`
        : `<img srcset="${srcset}" src="a.png">`;
    const { data } = await convert(page({ body, parts }));
    // \s so that data-original-srcset, which ends with the same name, is not picked up instead
    return (data.match(new RegExp(`<${tagName}[^>]*\\ssrcset="([^"]*)"`)) || [])[1];
};

test("every candidate of a width-described srcset is inlined", async () => {
    const result = await srcsetOf("a.png 1w, b.png 2w", [part("a.png", SMALL), part("b.png", LARGE)]);
    assert.equal(result, `${uri(SMALL)} 1w, ${uri(LARGE)} 2w`);
});

test("density descriptors survive the round trip", async () => {
    const result = await srcsetOf("a.png 1x, b.png 2x", [part("a.png", SMALL), part("b.png", LARGE)]);
    assert.equal(result, `${uri(SMALL)} 1x, ${uri(LARGE)} 2x`);
});

test("a density of zero survives the round trip", async () => {
    // the spec only rejects a density below zero, and a falsy check used to drop the descriptor
    const result = await srcsetOf("a.png 0x, b.png 2x", [part("a.png", SMALL), part("b.png", LARGE)]);
    assert.equal(result, `${uri(SMALL)} 0x, ${uri(LARGE)} 2x`);
});

test("a candidate with no descriptor is kept without one", async () => {
    assert.equal(await srcsetOf("a.png", [part("a.png", SMALL)]), uri(SMALL));
});

test("a candidate with nothing behind it keeps its address", async () => {
    const result = await srcsetOf("a.png 1x, gone.png 2x", [part("a.png", SMALL)]);
    assert.equal(result, `${uri(SMALL)} 1x, ${ORIGIN}/gone.png 2x`);
});

test("a srcset on a source element is rewritten too", async () => {
    const result = await srcsetOf("a.png 1x", [part("a.png", SMALL)], "source");
    assert.equal(result, `${uri(SMALL)} 1x`);
});

test("the sizes attribute is left untouched", async () => {
    const { data } = await convert(page({
        body: "<img srcset=\"a.png 100w\" sizes=\"(max-width: 600px) 100vw, 50vw\" src=\"a.png\">",
        parts: [part("a.png", SMALL)]
    }));
    assert.ok(data.includes("sizes=\"(max-width: 600px) 100vw, 50vw\""), "the sizes attribute was altered");
});

test("a URL containing a comma is not mistaken for two candidates", async () => {
    const name = "a,b.png";
    const result = await srcsetOf(`${name} 1x`, [part(name, SMALL)]);
    assert.equal(result, `${uri(SMALL)} 1x`, "the candidate was split on the comma inside its URL");
});

test("extra whitespace between candidates is tolerated", async () => {
    const result = await srcsetOf("  a.png   1x  ,\n  b.png   2x  ", [part("a.png", SMALL), part("b.png", LARGE)]);
    assert.equal(result, `${uri(SMALL)} 1x, ${uri(LARGE)} 2x`);
});

test("the same candidate listed twice is inlined both times", async () => {
    const result = await srcsetOf("a.png 1x, a.png 2x", [part("a.png", SMALL)]);
    assert.equal(result, `${uri(SMALL)} 1x, ${uri(SMALL)} 2x`);
});
