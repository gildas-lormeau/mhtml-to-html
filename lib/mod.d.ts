/// <reference lib="dom" />

/**
 * Convert MHTML to HTML
 * 
 * @param mhtml the MHTML data to convert to HTML provided as a string or Uint8Array or MHTML object
 * @param config optional configuration object
 * @returns the converted HTML
 */
export function convert(mhtml: MHTML | string | Uint8Array, config?: ConvertConfig): Promise<string>;

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
     * Transfer encoding of the resource
     */
    transferEncoding?: "base64" | "quoted-printable" | "7bit" | "8bit" | "binary";
    /**
     * Content of the resource as text or base64 encoded data
     */
    data: string;
}