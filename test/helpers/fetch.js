// Fetch doubles used by the network suites. They never touch the network: each one implements just
// enough of the Response interface for lib/convert.js, and records what was requested.

export { scriptedFetch, stubFetch, trackingFetch };

function response(body, contentType) {
    return {
        ok: true,
        status: 200,
        headers: { get: name => name.toLowerCase() === "content-type" ? contentType : undefined },
        text: async () => body,
        bytes: async () => new TextEncoder().encode(body)
    };
}

function notFound() {
    return { ok: false, status: 404, headers: { get: () => undefined } };
}

// `routes` maps a URL to { contentType, body }, to the string "throw", or is missing for a 404.
// `omitBytes` drops Response#bytes() so the arrayBuffer() fallback is exercised instead.
function stubFetch(routes, { omitBytes = false, omitContentType = false } = {}) {
    const log = [];
    const fetch = async url => {
        log.push(url);
        const route = routes[url];
        if (route === undefined || route === "404") {
            return notFound();
        }
        if (route === "throw") {
            throw new Error("network down");
        }
        const result = response(route.body, omitContentType ? undefined : route.contentType);
        if (omitBytes) {
            delete result.bytes;
            result.arrayBuffer = async () => new TextEncoder().encode(route.body).buffer;
        }
        return result;
    };
    return { fetch, log };
}

// `script` is the sequence of outcomes for successive attempts: a status number, "throw", "ok", or
// { status, retryAfter }. The last entry repeats once the script runs out.
function scriptedFetch(script) {
    const log = [];
    let index = 0;
    const fetch = async url => {
        log.push({ url, at: Date.now() });
        const step = script[Math.min(index++, script.length - 1)];
        if (step === "throw") {
            throw new TypeError("fetch failed");
        }
        if (typeof step === "number") {
            return { ok: false, status: step, headers: { get: () => undefined } };
        }
        if (step && step.status) {
            return {
                ok: false,
                status: step.status,
                headers: { get: name => name === "Retry-After" ? step.retryAfter : undefined }
            };
        }
        return response("OK", "image/png");
    };
    return { fetch, log };
}

// Records how many requests are in flight at once, which is what the concurrency cap must bound.
function trackingFetch({ holdMs = 5, fail = false } = {}) {
    const state = { peak: 0, inFlight: 0, calls: 0 };
    const fetch = async () => {
        state.calls++;
        state.inFlight++;
        state.peak = Math.max(state.peak, state.inFlight);
        await new Promise(resolve => setTimeout(resolve, holdMs));
        state.inFlight--;
        return fail ? { ok: false, status: 503, headers: { get: () => undefined } } : response("OK", "image/png");
    };
    return { fetch, state };
}
