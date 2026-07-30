// Stylesheets are the only resource the converter rewrites rather than inlines, so every URL inside
// them goes through css-tree and comes back out as a data URI plus a comment recording where it came
// from. The comment only survives inside url(), which is why the shape of each rule matters.
import { test } from "node:test";
import assert from "node:assert/strict";
import { convert } from "./helpers/lib.js";
import { concatBytes, encodeSingleByteCharset } from "./helpers/mhtml.js";
import { ORIGIN, page, resource } from "./helpers/page.js";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_URI = `data:image/png;base64,${PNG_BASE64}`;
const imagePart = resource(`${ORIGIN}/i.png`, "image/png", PNG_BASE64, "base64");
const stylesheet = (body, location = `${ORIGIN}/s.css`) => resource(location, "text/css", body);

const styleOf = async options => {
    const { data } = await convert(page(options));
    return (data.match(/<style[^>]*>([\s\S]*?)<\/style>/) || [])[1];
};
const headOf = async options => (await convert(page(options))).data.match(/<head[^>]*>[\s\S]*<\/head>/)[0];

const LINK = "<link rel=\"stylesheet\" href=\"s.css\">";

test("a linked stylesheet becomes a style element holding its rules", async () => {
    assert.equal(await styleOf({ head: LINK, parts: [stylesheet("p{color:red}")] }), "p{color:red}");
});

test("the media of a linked stylesheet is carried over", async () => {
    const head = await headOf({
        head: "<link rel=\"stylesheet\" media=\"print\" href=\"s.css\">", parts: [stylesheet("p{color:red}")]
    });
    assert.match(head, /<style[^>]*media="print"/);
});

test("the URL a stylesheet came from is recorded", async () => {
    const head = await headOf({ head: LINK, parts: [stylesheet("p{color:red}")] });
    assert.ok(head.includes(`data-original-href="${ORIGIN}/s.css"`));
});

test("a url() is inlined and the original URL is kept as a comment", async () => {
    const style = await styleOf({
        head: LINK, parts: [stylesheet("p{background:url(i.png)}"), imagePart]
    });
    assert.ok(style.includes(PNG_URI), "the image was not inlined");
    assert.ok(style.includes(`/* original URL: ${ORIGIN}/i.png */`), "the original URL was not recorded");
});

test("a url() with nothing behind it keeps its address", async () => {
    const style = await styleOf({ head: LINK, parts: [stylesheet("p{background:url(gone.png)}")] });
    assert.ok(style.includes(`${ORIGIN}/gone.png`), "the address was lost");
    assert.ok(!style.includes("--mhtml-to-html-url"), "the internal marker leaked");
});

for (const [name, rule] of [
    ["url()", "@import url(other.css);"],
    ["a bare string", "@import \"other.css\";"],
    ["a string with a media query", "@import \"other.css\" screen;"]
]) {
    test(`an @import written with ${name} is inlined`, async () => {
        const style = await styleOf({
            head: LINK,
            parts: [stylesheet(rule), stylesheet("p{color:blue}", `${ORIGIN}/other.css`)]
        });
        assert.ok(style.includes("data:text/css;base64,"), "the imported sheet was not inlined");
        assert.ok(!style.includes("--mhtml-to-html-url"), "the internal marker leaked into the output");
    });
}

test("an @import with nothing behind it keeps its address", async () => {
    const style = await styleOf({ head: LINK, parts: [stylesheet("@import \"gone.css\";")] });
    assert.ok(style.includes(`${ORIGIN}/gone.css`));
    assert.ok(!style.includes("--mhtml-to-html-url"), "the internal marker leaked");
});

test("a chain of imports is followed to the end", async () => {
    const style = await styleOf({
        head: LINK,
        parts: [
            stylesheet("@import url(a.css);"),
            stylesheet("@import url(b.css);", `${ORIGIN}/a.css`),
            stylesheet("p{color:green}", `${ORIGIN}/b.css`)
        ]
    });
    assert.ok(style.includes("data:text/css;base64,"), "the chain was not followed");
});

test("a stylesheet that imports itself does not loop forever", async () => {
    const style = await styleOf({ head: LINK, parts: [stylesheet("@import url(s.css);p{color:red}")] });
    assert.ok(typeof style === "string" && style.length > 0);
});

test("a url() in a style attribute is rewritten too", async () => {
    const { data } = await convert(page({
        body: "<p style=\"background:url(i.png)\">x</p>", parts: [imagePart]
    }));
    assert.ok(data.includes(PNG_URI), "the style attribute was not rewritten");
});

test("a data URI inside a stylesheet is left alone", async () => {
    const style = await styleOf({
        head: LINK, parts: [stylesheet(`p{background:url("${PNG_URI}")}`)]
    });
    assert.ok(style.includes(PNG_URI));
    assert.ok(!style.includes("original URL"), "a data URI has no original URL to record");
});

test("an inline style element is rewritten in place", async () => {
    const style = await styleOf({
        head: "<style>p{background:url(i.png)}</style>", parts: [imagePart]
    });
    assert.ok(style.includes(PNG_URI));
});

for (const rule of ["@import;", "@import foo;"]) {
    test(`a broken "${rule}" does not take the conversion down`, async () => {
        // such a rule has no prelude, or one holding neither a url nor a string; reading a url out
        // of it used to crash the whole conversion
        const style = await styleOf({ head: `<style>${rule}p{color:red}</style>` });
        assert.ok(style.includes("color:red"), "the rules after the broken import were lost");
    });
}

test("a broken @charset rule leaves the sheet as it is", async () => {
    const style = await styleOf({ head: LINK, parts: [stylesheet("@charset ;p{color:red}")] });
    assert.ok(style.includes("color:red"), "the sheet was dropped with its broken rule");
});

test("a stylesheet the parser cannot make sense of is passed through", async () => {
    const style = await styleOf({ head: LINK, parts: [stylesheet("p{color:red") ] });
    assert.ok(typeof style === "string" && style.includes("color"), "the broken sheet was dropped");
});

// HTML gives a linked stylesheet three states. A persistent one (no title) always applies and can
// safely become a style element. A preferred one (titled) and an alternate one (titled, off until
// the reader picks it) belong to a set the reader switches between, and a style element would apply
// them whatever the choice — so they stay links and only the address changes.
test("a stylesheet named by several rel keywords is recognized", async () => {
    const head = await headOf({
        head: "<link rel=\"stylesheet dns-prefetch\" href=\"s.css\">", parts: [stylesheet("p{color:red}")]
    });
    assert.ok(head.includes("<style"), "the stylesheet was not recognized among the other keywords");
});

test("an alternate stylesheet stays a link so that it stays switched off", async () => {
    const head = await headOf({
        head: "<link rel=\"alternate stylesheet\" title=\"Dark\" href=\"s.css\">",
        parts: [stylesheet("p{color:red}")]
    });
    assert.ok(!head.includes("<style"), "the alternate sheet was applied unconditionally");
    assert.match(head, /<link[^>]*href="data:text\/css[^"]*"/, "the alternate sheet was not inlined");
    assert.match(head, /<link[^>]*title="Dark"/, "the name of the set was lost");
    assert.match(head, /<link[^>]*rel="alternate stylesheet"/, "the sheet is no longer an alternate");
});

test("a preferred stylesheet stays a link so the set keeps working", async () => {
    const head = await headOf({
        head: "<link rel=\"stylesheet\" title=\"Light\" href=\"s.css\">", parts: [stylesheet("p{color:red}")]
    });
    assert.ok(!head.includes("<style"), "a member of a style set was welded on");
    assert.match(head, /<link[^>]*href="data:text\/css[^"]*"/);
    assert.match(head, /<link[^>]*title="Light"/);
});

test("a stylesheet with no title is still inlined as a style element", async () => {
    const head = await headOf({ head: LINK, parts: [stylesheet("p{color:red}")] });
    assert.ok(head.includes("<style"), "the common case changed");
    assert.ok(!/<link[^>]*href="data:text\/css/.test(head), "a persistent sheet was left as a link");
});

test("a titled style element keeps its title so the set keeps working", async () => {
    // an inline style element carrying a title belongs to a style set exactly like a titled link
    const head = await headOf({
        head: "<style title=\"Light\">p{color:red}</style>"
    });
    assert.match(head, /<style[^>]*title="Light"/, "the name of the set was lost");
});

test("the url() references of a stylesheet kept as a link are still rewritten", async () => {
    const head = await headOf({
        head: "<link rel=\"alternate stylesheet\" title=\"Dark\" href=\"s.css\">",
        parts: [stylesheet("p{background:url(i.png)}"), imagePart]
    });
    const href = head.match(/<link[^>]*href="(data:text\/css[^"]*)"/)[1];
    const css = atob(href.substring(href.indexOf("base64,") + 7));
    assert.ok(css.includes(PNG_URI), "the image inside the alternate sheet was not inlined");
});

test("a stylesheet declaring its own charset is decoded with it and the rule is removed", async () => {
    const CYRILLIC = "Привет";
    const css = concatBytes("@charset \"windows-1251\";\r\n.a::after{content:\"",
        encodeSingleByteCharset(CYRILLIC, "windows-1251"), "\"}");
    const boundary = "----=_B";
    const raw = concatBytes(
        `MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="${boundary}"\r\n\r\n`,
        `--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n`,
        `Content-Location: ${ORIGIN}/\r\n\r\n<html><head>${LINK}</head><body>x</body></html>\r\n`,
        `--${boundary}\r\nContent-Type: text/css\r\nContent-Transfer-Encoding: 8bit\r\n`,
        `Content-Location: ${ORIGIN}/s.css\r\n\r\n`, css, `\r\n--${boundary}--\r\n`);
    const { data } = await convert(raw);
    const style = data.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
    assert.ok(style.includes(CYRILLIC), `the stylesheet was decoded with the wrong charset: ${style}`);
    assert.ok(!style.includes("@charset"), "the charset rule was left in the output");
});
