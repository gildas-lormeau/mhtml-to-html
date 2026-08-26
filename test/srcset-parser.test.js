// The srcset parser follows the WHATWG algorithm except where dropping data would lose part of the
// attribute being rewritten. srcset.test.js exercises it through a whole conversion; these tests pin
// down the parse and serialize contract directly, including the deviations.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, serialize } from "../lib/srcset-parser.js";

test("a lone URL parses to a candidate without descriptors", () => {
    assert.deepEqual(parse("image.png"), [{ url: "image.png" }]);
});

test("a width descriptor parses to w", () => {
    assert.deepEqual(parse("image.png 400w"), [{ url: "image.png", w: 400 }]);
});

test("a density descriptor parses to d", () => {
    assert.deepEqual(parse("image.png 2x"), [{ url: "image.png", d: 2 }]);
});

test("a floating-point density is parsed as a number", () => {
    assert.deepEqual(parse("image.png 1.5x"), [{ url: "image.png", d: 1.5 }]);
});

test("a density written with an exponent is parsed as a number", () => {
    assert.deepEqual(parse("image.png 1e2x"), [{ url: "image.png", d: 100 }]);
});

test("a density of zero is kept", () => {
    // the spec only rejects a density below zero
    assert.deepEqual(parse("image.png 0x"), [{ url: "image.png", d: 0 }]);
});

test("width and height descriptors parse together", () => {
    assert.deepEqual(parse("image.png 100w 50h"), [{ url: "image.png", w: 100, h: 50 }]);
});

test("every candidate of a list is parsed", () => {
    assert.deepEqual(parse("small.png 320w, medium.png 640w, large.png 1024w"), [
        { url: "small.png", w: 320 },
        { url: "medium.png", w: 640 },
        { url: "large.png", w: 1024 }
    ]);
});

test("candidates without descriptors split on the comma", () => {
    assert.deepEqual(parse("a.png, b.png"), [{ url: "a.png" }, { url: "b.png" }]);
});

test("surrounding and repeated whitespace is tolerated", () => {
    assert.deepEqual(parse("  a.png   1x  ,\n  b.png   2x  "), [
        { url: "a.png", d: 1 },
        { url: "b.png", d: 2 }
    ]);
});

test("an empty attribute parses to no candidates", () => {
    assert.deepEqual(parse(""), []);
    assert.deepEqual(parse("   "), []);
});

test("a width of zero is invalid and kept as written", () => {
    // the spec drops the whole candidate on a parse error; this parser rewrites attributes rather
    // than selecting an image, so the descriptors are carried through untouched instead
    assert.deepEqual(parse("image.png 0w"), [{ url: "image.png", descriptors: ["0w"] }]);
});

test("a negative density is invalid and kept as written", () => {
    assert.deepEqual(parse("image.png -1x"), [{ url: "image.png", descriptors: ["-1x"] }]);
});

test("an unknown unit is invalid and kept as written", () => {
    assert.deepEqual(parse("image.png 5q"), [{ url: "image.png", descriptors: ["5q"] }]);
});

test("a width combined with a density is invalid and kept as written", () => {
    assert.deepEqual(parse("image.png 100w 2x"), [{ url: "image.png", descriptors: ["100w", "2x"] }]);
});

test("a descriptor holding parentheses is tokenized whole", () => {
    assert.deepEqual(parse("image.png calc(1x + 1x)"), [{ url: "image.png", descriptors: ["calc(1x + 1x)"] }]);
});

test("serializing a candidate without descriptors writes the URL alone", () => {
    assert.equal(serialize([{ url: "image.png" }]), "image.png");
});

test("serializing writes width, height and density units back", () => {
    assert.equal(serialize([{ url: "image.png", w: 400 }]), "image.png 400w");
    assert.equal(serialize([{ url: "image.png", d: 2 }]), "image.png 2x");
    assert.equal(serialize([{ url: "image.png", d: 0 }]), "image.png 0x");
    assert.equal(serialize([{ url: "image.png", w: 100, h: 50 }]), "image.png 100w 50h");
});

test("serializing joins candidates with a comma", () => {
    assert.equal(serialize([{ url: "small.png", w: 320 }, { url: "large.png", w: 1024 }]), "small.png 320w, large.png 1024w");
});

test("serializing writes invalid descriptors back as written", () => {
    assert.equal(serialize([{ url: "image.png", descriptors: ["5q"] }]), "image.png 5q");
});

test("a well-formed attribute survives a parse and serialize round trip", () => {
    for (const input of [
        "small.png 320w, large.png 1024w",
        "low.png 1x, high.png 2x",
        "image.png 100w 50h",
        "image.png 0x",
        "a.png, b.png 2x, c.png"
    ]) {
        assert.equal(serialize(parse(input)), input);
    }
});

test("an attribute with invalid descriptors survives a round trip", () => {
    for (const input of [
        "image.png 5q",
        "image.png calc(1x + 1x)",
        "image.png 100w 2x"
    ]) {
        assert.equal(serialize(parse(input)), input);
    }
});
