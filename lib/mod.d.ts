/**
 * Module for converting MHTML to HTML and parsing MHTML data to a structured object representation.
 * 
 * @author Gildas Lormeau
 * @license MIT
 * 
 * @example
 * Convert MHTML to HTML
 * ```js
 * import { convert } from "mhtml-to-html"; // Node.js
 * // import { convert } from "@mhtml-to-html/mhtml-to-html"; // Deno via JSR
 * // import { convert } from "mhtml-to-html/deno"; // Deno via NPM
 * // import { convert } from "mhtml-to-html/browser"; // Browser
 * 
 * const mhtml = `...`; // or new Uint8Array([...])
 * const { data, title, favicons } = await convert(mhtml);
 * console.log(data); // HTML content
 * ```
 * 
 * @example
 * Parse MHTML data
 * ```js
 * import { parse, convert } from "mhtml-to-html"; // Node.js
 * // import { parse, convert } from "@mhtml-to-html/mhtml-to-html"; // Deno via JSR
 * // import { parse, convert } from "mhtml-to-html/deno"; // Deno via NPM
 * // import { parse, convert } from "mhtml-to-html/browser"; // Browser
 * 
 * const data = `...`; // or new Uint8Array([...])
 * const mhtml = parse(data);
 * console.log(mhtml); // { headers, frames, resources, index }
 * // convert mhtml to html
 * const { data, title, favicons } = await convert(mhtml);
 * console.log(data); // HTML content
 * ```
 * 
 * @module mhtml-to-html
 */

/**
 * Convert MHTML to HTML
 * 
 * @param mhtml the MHTML data to convert to HTML provided as a string or Uint8Array or MHTML object
 * @param config optional configuration object
 * @returns the converted HTML, the title of the page and the favicons
 */
export function convert(mhtml: MHTML | string | Uint8Array, config?: ConvertConfig): Promise<PageData>;

/**
 * Parse MHTML data
 * 
 * @param data the MHTML data to parse provided as a string or Uint8Array
 * @param config optional configuration object
 * @returns the parsed MHTML data
 */
export function parse(data: string | Uint8Array, config?: ParseConfig): MHTML;

/**
 * Configuration object for convert function
 */
export interface ConvertConfig {
    /**
     * DOMParser implementation to use for parsing HTML
     * 
     * @default globalThis.DOMParser
     */
    DOMParser?: DOMParser;
    /**
     * Enable scripts in the converted HTML
     * 
     * @default false
     */
    enableScripts?: boolean;
    /**
     * Fetch missing resources
     * 
     * @default false
     */
    fetchMissingResources?: boolean;
    /**
     * Fetch implementation to use for fetching resources
     * 
     * @default globalThis.fetch
     */
    fetch?: typeof fetch;
}

/**
 * Configuration object for parse function
 */
export interface ParseConfig {
    /**
     * DOMParser implementation to use for parsing HTML
     * 
     * @default globalThis.DOMParser
     */
    DOMParser?: DOMParser;
}

/**
 * MHTML data structure
 */
export interface MHTML {
    /**
     * Headers of the MHTML
     */
    headers: Record<string, string>;
    /**
     * Frames of the MHTML
     */
    frames: Record<string, Resource>;
    /**
     * Resources of the MHTML
     */
    resources: Record<string, Resource>;
    /**
     * Id of the index page
     */
    index: string;
}

/**
 * Resource data structure
 */
export interface Resource {
    /**
     * Id of the resource
     */
    id: string;
    /**
     * Content type of the resource
     */
    contentType: string;
    /**
     * Transfer encoding of the resource ("binary" resources are automatically converted to "base64")
     */
    transferEncoding?: "base64" | "quoted-printable" | "7bit" | "8bit";
    /**
     * Content of the resource as text or base64 encoded data
     */
    data: string;
}

/**
 * Page data structure
 */
export interface PageData {
    /**
     * HTML content of the page
     */
    data: string;
    /**
     * Title of the page
     */
    title?: string;
    /**
     * Favicons
     */
    favicons?: {
        /**
         * URL of the favicon
         */
        href: string,
        /**
         * Original URL of the favicon
         */
        originalHref?: string,
        /**
         * Media type of the favicon
         */
        media?: string,
        /**
         * Type of the favicon
         */
        type?: string,
        /**
         * Sizes of the favicon
         */
        sizes?: string
    }[];
}