// A transient failure is worth retrying, a permanent one is not, and neither may hang the
// conversion. The timing assertions use wide windows so they stay reliable on a loaded machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { convert } from "./helpers/lib.js";
import { scriptedFetch } from "./helpers/fetch.js";
import { page } from "./helpers/page.js";

const onePng = page({ body: `<img src="x.png">` });
const isInlined = data => data.includes(`data:image/png;base64,${btoa("OK")}`);
const gap = log => log[1].at - log[0].at;

test("a 503 is retried and the retry succeeds", async () => {
    const { fetch, log } = scriptedFetch([503, "ok"]);
    const { data } = await convert(onePng, { fetchMissingResources: true, fetch });
    assert.equal(log.length, 2);
    assert.ok(isInlined(data));
    assert.ok(gap(log) >= 400, `the retry was not delayed: ${gap(log)}ms`);
});

test("a 429 is retried and the retry succeeds", async () => {
    const { fetch, log } = scriptedFetch([429, "ok"]);
    const { data } = await convert(onePng, { fetchMissingResources: true, fetch });
    assert.equal(log.length, 2);
    assert.ok(isInlined(data));
});

test("a network error is retried and the retry succeeds", async () => {
    const { fetch, log } = scriptedFetch(["throw", "ok"]);
    const { data } = await convert(onePng, { fetchMissingResources: true, fetch });
    assert.equal(log.length, 2);
    assert.ok(isInlined(data));
});

test("a 404 is not retried", async () => {
    const { fetch, log } = scriptedFetch([404, "ok"]);
    const { data } = await convert(onePng, { fetchMissingResources: true, fetch });
    assert.equal(log.length, 1);
    assert.ok(!isInlined(data));
});

test("a permanently failing resource stops after maxRetries + 1 attempts", async () => {
    const { fetch, log } = scriptedFetch([503]);
    const start = Date.now();
    const { data } = await convert(onePng, { fetchMissingResources: true, fetch });
    assert.equal(log.length, 3);
    assert.equal(typeof data, "string", "exhausted retries must not reject the conversion");
    assert.ok(Date.now() - start >= 1400, "the backoff between attempts did not grow");
});

test("maxRetries: 0 disables retrying", async () => {
    const { fetch, log } = scriptedFetch([503]);
    await convert(onePng, { fetchMissingResources: true, fetch, maxRetries: 0 });
    assert.equal(log.length, 1);
});

test("maxRetries: 4 allows five attempts", async () => {
    const { fetch, log } = scriptedFetch(["throw"]);
    await convert(onePng, { fetchMissingResources: true, fetch, maxRetries: 4 });
    assert.equal(log.length, 5);
});

test("Retry-After in seconds is honored", async () => {
    const { fetch, log } = scriptedFetch([{ status: 429, retryAfter: "1" }, "ok"]);
    const { data } = await convert(onePng, { fetchMissingResources: true, fetch });
    assert.equal(log.length, 2);
    assert.ok(isInlined(data));
    assert.ok(gap(log) >= 900 && gap(log) < 1600, `waited ${gap(log)}ms instead of about 1000ms`);
});

test("Retry-After as an HTTP date is honored", async () => {
    // an HTTP date has a one second resolution, so the wait can be up to a second short
    const { fetch, log } = scriptedFetch([{ status: 503, retryAfter: new Date(Date.now() + 2000).toUTCString() }, "ok"]);
    const { data } = await convert(onePng, { fetchMissingResources: true, fetch });
    assert.equal(log.length, 2);
    assert.ok(isInlined(data));
    assert.ok(gap(log) >= 900 && gap(log) < 2500, `waited ${gap(log)}ms instead of about 2000ms`);
});

test("a Retry-After beyond the cap gives up at once instead of waiting", async () => {
    const { fetch, log } = scriptedFetch([{ status: 503, retryAfter: "3600" }, "ok"]);
    const start = Date.now();
    await convert(onePng, { fetchMissingResources: true, fetch });
    assert.equal(log.length, 1);
    assert.ok(Date.now() - start < 500, "waited for an unreasonable Retry-After");
});

test("a failed URL is not attempted again in later rounds", async () => {
    const { fetch, log } = scriptedFetch([503]);
    await convert(page({ body: `<img src="x.png"><img src="y.png">` }), { fetchMissingResources: true, fetch });
    const attempts = {};
    for (const { url } of log) {
        attempts[url] = (attempts[url] || 0) + 1;
    }
    assert.ok(Object.values(attempts).every(count => count <= 3), JSON.stringify(attempts));
});
