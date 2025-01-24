/// <reference types="./mod.d.ts" />

import { DOMParser } from "@b-fuze/deno-dom";
import { convert as nativeConvert, parse as nativeParse } from "./mod.js";

function convert(mhtml, config = {}) {
    config.DOMParser = DOMParser;
    return nativeConvert(mhtml, config);
}

function parse(data, config = {}) {
    config.DOMParser = DOMParser;
    return nativeParse(data, config);
}

export { convert, parse };
