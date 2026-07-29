// Fetching is iterative: a fetched stylesheet can reveal more missing resources, which are fetched
// in the next round. The loop has to terminate, never fetch the same URL twice, and reach the same
// result as if every resource had been present in the file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { convert } from "./helpers/lib.js";
import { stubFetch } from "./helpers/fetch.js";
import { ORIGIN, page, resource } from "./helpers/page.js";

// Follows the chain of nested data:text/css URIs and returns how deep it goes.
function inlineStylesheet(data) {
    const match = data.match(/<style[^>]*>([\s\S]*?)<\/style>/);
    return match ? match[1] : "";
}

function importDepth(data) {
    let css = inlineStylesheet(data);
    let depth = 0;
    for (; ;) {
        const match = css.match(/url\(data:text\/css;base64,([^)]*)\)/);
        if (!match) {
            return depth;
        }
        css = atob(match[1]);
        depth++;
    }
}

test("a resource behind a nested @import is discovered and matches an all-present build", async () => {
    const styles = { a: `@import url("b.css");`, b: `p{background:url("img.png")}` };
    const parts = [resource(`${ORIGIN}/a.css`, "text/css", styles.a), resource(`${ORIGIN}/b.css`, "text/css", styles.b)];
    const head = `<link rel="stylesheet" href="a.css">`;
    const { fetch, log } = stubFetch({ [`${ORIGIN}/img.png`]: { contentType: "image/png", body: "IMG" } });
    const fetched = await convert(page({ head, body: "x", parts }), { fetchMissingResources: true, fetch });
    const allPresent = await convert(page({ head, body: "x", parts: [...parts, resource(`${ORIGIN}/img.png`, "image/png", "IMG")] }));
    assert.ok(log.includes(`${ORIGIN}/img.png`), log.join(","));
    // a part read from the file keeps the line break that separated it from the delimiter, a fetched
    // one has no such context, so compare the inlined stylesheet with that one difference normalized
    const innerStyle = ({ data }) => {
        const style = inlineStylesheet(data);
        const match = style.match(/url\(data:text\/css;base64,([^)]*)\)/);
        return (match ? atob(match[1]) : style).replace(/base64,SU1H(DQo=)?/, "base64,IMG");
    };
    assert.equal(innerStyle(fetched), innerStyle(allPresent));
});

test("each URL is fetched exactly once however often it is referenced", async () => {
    const { fetch, log } = stubFetch({
        [`${ORIGIN}/x.png`]: { contentType: "image/png", body: "X" },
        [`${ORIGIN}/y.png`]: { contentType: "image/png", body: "Y" }
    });
    await convert(page({ body: `<img src="x.png"><img src="x.png"><img src="y.png">` }),
        { fetchMissingResources: true, fetch });
    assert.equal(log.length, 2, `duplicate requests: ${log.join(",")}`);
    assert.equal(new Set(log).size, 2);
});

test("a self-importing fetched stylesheet terminates", async () => {
    const { fetch, log } = stubFetch({
        [`${ORIGIN}/loop.css`]: { contentType: "text/css", body: `@import url("loop.css");p{color:red}` }
    });
    const { data } = await convert(page({ head: `<link rel="stylesheet" href="loop.css">`, body: "x" }),
        { fetchMissingResources: true, fetch });
    assert.equal(typeof data, "string");
    assert.equal(log.length, 1);
});

test("a six-deep @import chain is fully resolved", async () => {
    const routes = {};
    for (let index = 1; index < 6; index++) {
        routes[`${ORIGIN}/c${index}.css`] = { contentType: "text/css", body: `@import url("c${index + 1}.css");` };
    }
    routes[`${ORIGIN}/c6.css`] = { contentType: "text/css", body: "p{color:green}" };
    const { fetch, log } = stubFetch(routes);
    const { data } = await convert(page({ head: `<link rel="stylesheet" href="c1.css">`, body: "x" }),
        { fetchMissingResources: true, fetch });
    assert.equal(log.length, 6, `stopped early: ${log.join(",")}`);
    assert.equal(importDepth(data), 5);
});

test("a response without bytes() falls back to arrayBuffer()", async () => {
    const { fetch } = stubFetch({ [`${ORIGIN}/x.png`]: { contentType: "image/png", body: "X" } }, { omitBytes: true });
    const { data } = await convert(page({ body: `<img src="x.png">` }), { fetchMissingResources: true, fetch });
    assert.ok(data.includes(btoa("X")), (data.match(/<img[^>]*>/) || [])[0]);
});

test("a stylesheet fetched without a Content-Type is still treated as CSS", async () => {
    const { fetch } = stubFetch({ [`${ORIGIN}/x.css`]: { contentType: "text/css", body: `p{background:url("z.png")}` } },
        { omitContentType: true });
    const { data } = await convert(page({ head: `<link rel="stylesheet" href="x.css">`, body: "y" }),
        { fetchMissingResources: true, fetch });
    assert.ok(!data.includes("application/octet-stream") || data.includes("z.png"),
        (data.match(/<style[^>]*>[\s\S]*?<\/style>|<link[^>]*>/) || [])[0]);
});
