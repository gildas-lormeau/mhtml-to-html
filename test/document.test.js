// What the converter does to the document itself: every reference it rewrites, every element it
// removes and everything it adds to the head. None of this is reachable without a real archive, so
// it is the part of the library a fresh clone would otherwise never exercise.
import { test } from "node:test";
import assert from "node:assert/strict";
import { convert } from "./helpers/lib.js";
import { concatBytes } from "./helpers/mhtml.js";
import { ORIGIN, DOCUMENT_LOCATION, page, resource } from "./helpers/page.js";

// a 1x1 PNG, small enough to compare its data URI literally
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_URI = `data:image/png;base64,${PNG_BASE64}`;
const IMAGE_LOCATION = `${ORIGIN}/i.png`;
const imagePart = (location = IMAGE_LOCATION) => resource(location, "image/png", PNG_BASE64, "base64");

const convertPage = async options => convert(page(options));
const dataOf = async options => (await convertPage(options)).data;
const bodyOf = async options => (await dataOf(options)).match(/<body[^>]*>[\s\S]*<\/body>/)[0];
const headOf = async options => (await dataOf(options)).match(/<head[^>]*>[\s\S]*<\/head>/)[0];

test("an image is inlined and its original URL is kept", async () => {
    const body = await bodyOf({ body: "<img src=\"i.png\">", parts: [imagePart()] });
    assert.ok(body.includes(`src="${PNG_URI}"`), "the image was not inlined");
    assert.ok(body.includes(`data-original-src="i.png"`), "the original URL was dropped");
});

for (const tagName of ["audio", "video", "source"]) {
    test(`a ${tagName} element has its src inlined`, async () => {
        const body = await bodyOf({ body: `<${tagName} src="i.png"></${tagName}>`, parts: [imagePart()] });
        assert.ok(body.includes(PNG_URI), `the src of ${tagName} was not inlined`);
    });
}

test("the src of a script is inlined when scripts are enabled", async () => {
    const { data } = await convert(page({ body: "<script src=\"i.png\"></script>", parts: [imagePart()] }),
        { enableScripts: true });
    assert.ok(data.includes(PNG_URI), "the src of the script was not inlined");
});

test("an image input is inlined but a text input is left alone", async () => {
    const body = await bodyOf({
        body: "<input type=\"image\" src=\"i.png\"><input type=\"text\" src=\"i.png\">", parts: [imagePart()]
    });
    assert.equal(body.split(PNG_URI).length - 1, 1, "only the image input should be inlined");
});

for (const tagName of ["table", "td", "th"]) {
    test(`the background attribute of ${tagName} is inlined`, async () => {
        const markup = tagName === "table"
            ? "<table background=\"i.png\"><tr><td>x</td></tr></table>"
            : `<table><tr><${tagName} background="i.png">x</${tagName}></tr></table>`;
        assert.ok((await dataOf({ body: markup, parts: [imagePart()] })).includes(PNG_URI),
            `the background of ${tagName} was not inlined`);
    });
}

test("the background attribute of the body is inlined", async () => {
    const raw = concatBytes(
        "MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary=\"----=_B\"\r\n\r\n",
        resource(DOCUMENT_LOCATION, "text/html; charset=utf-8",
            "<html><head></head><body background=\"i.png\">x</body></html>"),
        "\r\n", imagePart(), "\r\n------=_B--\r\n");
    assert.ok((await convert(raw)).data.includes(PNG_URI), "the background of the body was not inlined");
});

test("a base element changes how references resolve and is removed", async () => {
    const data = await dataOf({
        head: "<base href=\"https://other.example/assets/\">",
        body: "<img src=\"i.png\">",
        parts: [imagePart("https://other.example/assets/i.png")]
    });
    assert.ok(data.includes(PNG_URI), "the reference did not resolve against the base");
    assert.doesNotMatch(data, /<base/i, "the base element was left in the document");
});

test("a reference with no matching part keeps an absolute URL", async () => {
    const body = await bodyOf({ body: "<img src=\"missing.png\">" });
    assert.ok(body.includes(`src="${ORIGIN}/missing.png"`), "the reference was not made absolute");
});

test("a data URI is left exactly as it is", async () => {
    const body = await bodyOf({ body: `<img src="${PNG_URI}">` });
    assert.ok(body.includes(`src="${PNG_URI}"`));
    assert.ok(!body.includes("data-original-src"), "a data URI does not need its original URL kept");
});

test("a link to the page itself keeps only its fragment", async () => {
    const body = await bodyOf({ body: `<a href="${DOCUMENT_LOCATION}#section">a</a><a href="/other">b</a>` });
    assert.ok(body.includes("href=\"#section\""), "the same-page link was not shortened");
    assert.ok(body.includes(`href="${ORIGIN}/other"`), "the other link was not made absolute");
});

test("tracking and integrity attributes are removed", async () => {
    const body = await bodyOf({
        body: "<a href=\"/x\" ping=\"https://tracker.example/p\">a</a>",
        head: "<link rel=\"stylesheet\" href=\"s.css\" integrity=\"sha384-abc\">",
        parts: [resource(`${ORIGIN}/s.css`, "text/css", "p{color:red}")]
    });
    assert.ok(!body.includes("ping="), "the ping attribute was kept");
    assert.ok(!(await dataOf({
        head: "<link rel=\"stylesheet\" href=\"s.css\" integrity=\"sha384-abc\">",
        parts: [resource(`${ORIGIN}/s.css`, "text/css", "p{color:red}")]
    })).includes("integrity"), "the integrity attribute was kept");
});

test("event handler attributes are removed unless scripts are enabled", async () => {
    const options = { body: "<p onclick=\"boom()\" onmouseover=\"boom()\">x</p>" };
    assert.ok(!(await bodyOf(options)).includes("onclick"), "an event handler survived");
    const enabled = (await convert(page(options), { enableScripts: true })).data;
    assert.ok(enabled.includes("onclick"), "an event handler was removed although scripts are enabled");
});

test("scripts are removed unless enabled, but JSON-LD always stays", async () => {
    const options = {
        head: "<script>boom()</script><script type=\"application/ld+json\">{\"@type\":\"Thing\"}</script>"
    };
    const removed = await dataOf(options);
    assert.ok(!removed.includes("boom()"), "a script survived");
    assert.ok(removed.includes("\"@type\":\"Thing\""), "the JSON-LD block was removed");
    const enabled = (await convert(page(options), { enableScripts: true })).data;
    assert.ok(enabled.includes("boom()"), "a script was removed although scripts are enabled");
});

test("a shadow root template is renamed and its content is converted", async () => {
    const data = await dataOf({
        body: "<div><template shadowmode=\"open\"><img src=\"i.png\"></template></div>",
        parts: [imagePart()]
    });
    assert.ok(data.includes("shadowrootmode=\"open\""), "the legacy attribute was not renamed");
    assert.ok(!data.includes("shadowmode=\"open\""), "the legacy attribute was kept");
    assert.ok(data.includes(PNG_URI), "a reference inside the template was not inlined");
});

test("a refresh and an existing policy are removed from the head", async () => {
    const head = await headOf({
        head: "<meta http-equiv=\"refresh\" content=\"0;url=https://elsewhere.example/\">" +
            "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src *\">"
    });
    assert.ok(!head.includes("refresh"), "the refresh was kept");
    assert.ok(!head.includes("default-src *"), "the original policy was kept");
});

test("a policy is added, and it allows scripts only when they are enabled", async () => {
    assert.match(await headOf({}), /content-security-policy/i);
    assert.ok((await dataOf({})).includes("script-src 'none'"), "scripts are not blocked by default");
    const enabled = (await convert(page({}), { enableScripts: true })).data;
    assert.ok(enabled.includes("script-src 'self' 'unsafe-inline' data:"), "scripts were not allowed");
});

test("the head starts with a utf-8 declaration", async () => {
    assert.match(await headOf({}), /^<head><meta charset="utf-8">/);
});

test("a canonical link is added when there is none and kept when there is one", async () => {
    assert.ok((await dataOf({})).includes(`rel="canonical" href="${DOCUMENT_LOCATION}"`),
        "no canonical link was added");
    const data = await dataOf({ head: "<link rel=\"canonical\" href=\"https://canonical.example/\">" });
    assert.equal(data.split("canonical").length - 1, 2, "the existing canonical link was duplicated");
    assert.ok(data.includes("https://canonical.example/"), "the existing canonical link was replaced");
});

test("the title comes from the head, and the first one wins", async () => {
    const { title } = await convertPage({ head: "<title>FIRST</title><title>SECOND</title>" });
    assert.equal(title, "FIRST");
});

test("a title outside the head is not reported", async () => {
    const { title } = await convertPage({ body: "<svg><title>NOT THE PAGE TITLE</title></svg>" });
    assert.equal(title, undefined);
});

test("favicons are reported with their attributes and inlined", async () => {
    const { favicons, data } = await convertPage({
        head: "<link rel=\"icon\" href=\"i.png\" type=\"image/png\" sizes=\"16x16\" media=\"(min-width: 0px)\">",
        parts: [imagePart()]
    });
    assert.equal(favicons.length, 1);
    assert.deepEqual(
        { href: favicons[0].href, type: favicons[0].type, sizes: favicons[0].sizes, originalHref: favicons[0].originalHref },
        { href: PNG_URI, type: "image/png", sizes: "16x16", originalHref: IMAGE_LOCATION });
    assert.ok(data.includes(PNG_URI));
});

test("a shortcut icon is reported too", async () => {
    const { favicons } = await convertPage({
        head: "<link rel=\"shortcut icon\" href=\"i.png\">", parts: [imagePart()]
    });
    assert.equal(favicons.length, 1);
});

test("hints that mean nothing offline are dropped, and a link that is only a hint goes with them", async () => {
    const head = await headOf({ head: "<link rel=\"preload prefetch\" href=\"/a\"><link rel=\"dns-prefetch\" href=\"/b\">" });
    assert.ok(!head.includes("preload"), "a preload hint was kept");
    assert.ok(!head.includes("dns-prefetch"), "a dns-prefetch hint was kept");
    assert.ok(!head.includes("/a") && !head.includes("/b"), "a link that was nothing but a hint was kept");
});

test("a stylesheet is recognized whatever the case of its rel", async () => {
    const head = await headOf({
        head: "<link rel=\"STYLESHEET\" href=\"s.css\">",
        parts: [resource(`${ORIGIN}/s.css`, "text/css", "p{color:red}")]
    });
    assert.ok(head.includes("<style"), "the stylesheet was not inlined");
});

test("a stylesheet declared with several rel values is left as a link", async () => {
    // current behaviour, not necessarily the desired one: the rel of a stylesheet is matched whole,
    // so "alternate stylesheet" is never inlined and stays pointing at a URL nothing can resolve
    const head = await headOf({
        head: "<link rel=\"alternate stylesheet\" title=\"Dark\" href=\"s.css\">",
        parts: [resource(`${ORIGIN}/s.css`, "text/css", "p{color:red}")]
    });
    assert.ok(!head.includes("<style"), "behaviour changed: multi-valued rel is now inlined");
    assert.match(head, /<link[^>]*s\.css/, "the link was removed without being inlined");
});

test("an archive with nothing that can be shown is rejected with a clear error", async () => {
    // an image or a text file would be presented as a document instead, see malformed.test.js
    const raw = concatBytes(
        "MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary=\"----=_B\"\r\n\r\n",
        "------=_B\r\nContent-Type: application/octet-stream\r\nContent-Transfer-Encoding: base64\r\n",
        `Content-Location: ${IMAGE_LOCATION}\r\n\r\n${PNG_BASE64}\r\n------=_B--\r\n`);
    await assert.rejects(() => convert(raw), /Index page not found/);
});
