// Fetching is bounded by a worker pool: a page referencing hundreds of missing resources must not
// open hundreds of connections at once, and no configuration may stall the pool.
import { test } from "node:test";
import assert from "node:assert/strict";
import { convert } from "./helpers/lib.js";
import { trackingFetch } from "./helpers/fetch.js";
import { page } from "./helpers/page.js";

const images = count => page({ body: Array.from({ length: count }, (_, index) => `<img src="i${index}.png">`).join("") });
const countInlined = data => (data.match(/data:image\/png;base64,/g) || []).length;

test("the default cap saturates at 16 parallel requests", async () => {
    const { fetch, state } = trackingFetch();
    const { data } = await convert(images(200), { fetchMissingResources: true, fetch });
    assert.equal(state.peak, 16, `peak ${state.peak}`);
    assert.equal(state.calls, 200);
    assert.equal(countInlined(data), 200, "some resources were dropped under the cap");
});

for (const maxParallelRequests of [1, 4, 32]) {
    test(`maxParallelRequests: ${maxParallelRequests} is respected exactly`, async () => {
        const { fetch, state } = trackingFetch();
        const { data } = await convert(images(100), { fetchMissingResources: true, fetch, maxParallelRequests });
        assert.equal(state.peak, maxParallelRequests, `peak ${state.peak}`);
        assert.equal(countInlined(data), 100);
    });
}

test("a cap larger than the workload fetches everything at once", async () => {
    const { fetch, state } = trackingFetch();
    const { data } = await convert(images(3), { fetchMissingResources: true, fetch, maxParallelRequests: 100 });
    assert.equal(state.peak, 3);
    assert.equal(countInlined(data), 3);
});

for (const maxParallelRequests of [0, -5]) {
    test(`maxParallelRequests: ${maxParallelRequests} falls back to one worker instead of stalling`, async () => {
        const { fetch, state } = trackingFetch();
        const result = await Promise.race([
            convert(images(5), { fetchMissingResources: true, fetch, maxParallelRequests }),
            new Promise(resolve => setTimeout(() => resolve("TIMEOUT"), 5000))
        ]);
        assert.notEqual(result, "TIMEOUT", "the worker pool stalled");
        assert.equal(state.peak, 1);
        assert.equal(countInlined(result.data), 5);
    });
}

test("the cap still holds while resources are retrying", async () => {
    const { fetch, state } = trackingFetch({ fail: true });
    await convert(images(50), { fetchMissingResources: true, fetch, maxParallelRequests: 4, maxRetries: 1 });
    assert.ok(state.peak <= 4, `peak ${state.peak}`);
    assert.equal(state.calls, 100, "50 resources should be attempted twice each");
});

test("work is spread across the pool rather than serialized", async () => {
    const { fetch } = trackingFetch({ holdMs: 20 });
    const start = Date.now();
    await convert(images(64), { fetchMissingResources: true, fetch, maxParallelRequests: 16 });
    const elapsed = Date.now() - start;
    // 64 requests at 16 in flight is four rounds of 20ms; serialized it would be 64 rounds
    assert.ok(elapsed >= 60 && elapsed < 700, `${elapsed}ms for four rounds of 20ms`);
});
