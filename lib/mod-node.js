/// <reference types="./mod.d.ts" />

import { DOMParser } from "./dom-parser-node.js";
import { convert as nativeConvert, parse as nativeParse } from "./mod.js";

export { convert, parse };

function convert(mhtml, config = {}) {
    config.DOMParser = DOMParser;
    return nativeConvert(mhtml, config);
}

function parse(data, config = {}) {
    config.DOMParser = DOMParser;
    return nativeParse(data, config);
}
