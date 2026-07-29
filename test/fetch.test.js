// Resources a page references but the MHTML file does not contain can be fetched, when the caller
// opts in. Nothing here reaches the network: the fetch implementation is supplied by the test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, convert } from "./helpers/lib.js";
import { stubFetch } from "./helpers/fetch.js";
import { ORIGIN, page, resource } from "./helpers/page.js";

const inlined = body => `data:image/png;base64,${btoa(body)}`;

test("a missing image is fetched and inlined", async () => {
    const { fetch, log } = stubFetch({ [`${ORIGIN}/missing.png`]: { contentType: "image/png", body: "PNGBYTES" } });
    const { data } = await convert(page({ body: `<img src="missing.png">` }), { fetchMissingResources: true, fetch });
    assert.deepEqual(log, [`${ORIGIN}/missing.png`]);
    assert.ok(data.includes(inlined("PNGBYTES")), (data.match(/<img[^>]*>/) || [])[0]);
});

test("a fetched stylesheet has its own references followed", async () => {
    const { fetch, log } = stubFetch({
        [`${ORIGIN}/missing.css`]: { contentType: "text/css", body: `body{background:url("deep.png")}` },
        [`${ORIGIN}/deep.png`]: { contentType: "image/png", body: "DEEP" }
    });
    const { data } = await convert(page({ head: `<link rel="stylesheet" href="missing.css">`, body: "x" }),
        { fetchMissingResources: true, fetch });
    assert.ok(log.includes(`${ORIGIN}/missing.css`), log.join(","));
    assert.ok(log.includes(`${ORIGIN}/deep.png`), `the nested reference was not discovered: ${log.join(",")}`);
    assert.ok(data.includes(btoa("DEEP")));
});

test("an @import target inside an existing stylesheet is fetched", async () => {
    const { fetch, log } = stubFetch({ [`${ORIGIN}/missing-import.css`]: { contentType: "text/css", body: "p{color:blue}" } });
    const { data } = await convert(page({
        head: `<link rel="stylesheet" href="a.css">`,
        body: "x",
        parts: [resource(`${ORIGIN}/a.css`, "text/css", `@import url("missing-import.css");`)]
    }), { fetchMissingResources: true, fetch });
    assert.ok(log.includes(`${ORIGIN}/missing-import.css`), log.join(","));
    assert.ok(data.includes(btoa("p{color:blue}")));
});

test("every srcset candidate is fetched and inlined", async () => {
    const { fetch, log } = stubFetch({
        [`${ORIGIN}/a.png`]: { contentType: "image/png", body: "A" },
        [`${ORIGIN}/b.png`]: { contentType: "image/png", body: "B" }
    });
    const { data } = await convert(page({ body: `<img srcset="a.png 1x, b.png 2x">` }), { fetchMissingResources: true, fetch });
    assert.deepEqual(log.sort(), [`${ORIGIN}/a.png`, `${ORIGIN}/b.png`]);
    assert.ok(data.includes(btoa("A")) && data.includes(btoa("B")), (data.match(/srcset="[^"]*"/) || [])[0]);
});

test("a 404 is attempted once and leaves the original URL in place", async () => {
    const { fetch, log } = stubFetch({});
    const { data } = await convert(page({ body: `<img src="gone.png"><img src="alsogone.png">` }),
        { fetchMissingResources: true, fetch });
    assert.equal(log.length, 2, `retried a permanent failure: ${log.join(",")}`);
    assert.match(data, /src="(gone\.png|https:\/\/example\.com\/gone\.png)"/);
});

test("a throwing fetch is retried and then gives up without failing the conversion", async () => {
    const { fetch, log } = stubFetch({ [`${ORIGIN}/boom.png`]: "throw" });
    const { data } = await convert(page({ body: `<img src="boom.png">` }), { fetchMissingResources: true, fetch });
    assert.equal(typeof data, "string");
    assert.equal(log.length, 3, "expected the initial attempt plus two retries");
});

test("cid: and non-http URLs are never fetched", async () => {
    const { fetch, log } = stubFetch({});
    await convert(page({ body: `<img src="cid:abc123"><img src="ftp://example.com/x.png">` }),
        { fetchMissingResources: true, fetch });
    assert.deepEqual(log, []);
});

test("a urn: payload is unwrapped before fetching", async () => {
    const { fetch, log } = stubFetch({ "https://cdn.example.com/x.png": { contentType: "image/png", body: "URN" } });
    const { data } = await convert(page({ body: `<img src="urn:uuid:https://cdn.example.com/x.png">` }),
        { fetchMissingResources: true, fetch });
    assert.deepEqual(log, ["https://cdn.example.com/x.png"]);
    assert.ok(data.includes(btoa("URN")));
});

test("nothing is fetched unless fetchMissingResources is set", async () => {
    const { fetch, log } = stubFetch({ [`${ORIGIN}/missing.png`]: { contentType: "image/png", body: "X" } });
    await convert(page({ body: `<img src="missing.png">` }), { fetch });
    assert.deepEqual(log, []);
});

test("globalThis.fetch is used when no fetch is supplied", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
        calls++;
        return { ok: false, status: 404, headers: { get: () => undefined } };
    };
    try {
        await convert(parse(page({ body: `<img src="missing.png">` })), { fetchMissingResources: true });
    } finally {
        globalThis.fetch = original;
    }
    assert.equal(calls, 1);
});
