// Imports the build matching the current runtime, so a single suite covers both Node.js and Deno.
const { parse, convert } = globalThis.Deno
    ? await import("../../lib/mod-deno.js")
    : await import("../../lib/mod-node.js");

export { parse, convert };
