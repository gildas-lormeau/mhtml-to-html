# MHTML-TO-HTML

JavaScript library and application for converting MHTML files to single HTML files

## Download

- Download the executable for your OS here: https://github.com/gildas-lormeau/mhtml-to-html/releases

- Rename the file to `mhtml-to-html` and make `mhtml-to-html` executable (Linux, Unix)

```sh
chmod +x mhtml-to-html
```
## Usage 

```
mhtml-to-html <input>... [--output <output>] [--help] [--enable-scripts] [--fetch-missing-resources] [--version]

 Arguments:
  <input>: The input MHTML file, wildcards are supported
 Options:
  --output <output>: The output HTML file (default: input file with .html extension), only used when a single 
                     input file is provided
  --help: Show this help message
  --enable-scripts: Enable scripts (default: disabled)
  --fetch-missing-resources: Fetch missing resources (default: disabled)
  --version: Show the version number
```

## Examples
```
 mhtml-to-html file.mht
 mhtml-to-html file1.mht file2.mht
 mhtml-to-html file.mht --output output_file.html
 mhtml-to-html *.mht
 mhtml-to-html *.mht *.mhtml
 mhtml-to-html *.mht --enable-scripts
```

## Convert MHTML Files Online

Use Mhtml Wizard to view and convert MHTML files online, see https://erwannlc.github.io/mhtml-wizard

## Install

  - Deno via JSR:
  
  ```sh
  deno add jsr:@mhtml-to-html/mhtml-to-html
  ```

  - Node.js/Deno via NPM:
  
  ```sh
  npm install mhtml-to-html
  ```

## Import

  - Deno via JSR:

  ```js
  import { convert } from "@mhtml-to-html/mhtml-to-html";
  ```

  - Deno via NPM:
  
  ```js
  import { convert } from "mhtml-to-html/deno";
  ```

  - Node.js:
  
  ```js
  import { convert } from "mhtml-to-html";
  ```

  - Client-side:

  ```js
  import { convert } from "mhtml-to-html/browser";
  ```

## Install from Source

- Install Git, see https://git-scm.com

- Clone the repository

```sh
git clone https://github.com/gildas-lormeau/mhtml-to-html.git
```

- Deno:

  - Install Deno, see https://deno.com

  - Make `mhtml-to-html` executable (Linux, Unix)

  ```sh
  chmod +x mhtml-to-html
  ```

- Node.js:

  - Install Node.js, see https://nodejs.org

  - Install the dependencies

  ```sh
  npm install
  ```

  - Linux, Unix:
  
    - Replace `mhtml-to-html` with `mhtml-to-html-node.js`
  
    ```sh
    mv mhtml-to-html-node.js mhtml-to-html
    ```
  
    - Make `mhtml-to-html` executable

    ```sh
    chmod +x mhtml-to-html
    ```

  - Windows:
  
    - Replace `mhtml-to-html.bat` with `mhtml-to-html-node.bat`
  
    ```sh
    move /Y mhtml-to-html-node.bat mhtml-to-html.bat
    ```

## Tests

The tests build the MHTML documents they need, so they run on a fresh clone without any sample file.

- Node.js:

```sh
npm test
```

- Deno:

```sh
deno task test
```

### Testing against your own files

Drop any `.mht`/`.mhtml` files into `test/files` and they are converted too. Because these files are
not part of the repository, the tests do not look at what is inside them: they check what must be
true of any document, then compare the result with the previous run.

That baseline is written to `test/snapshots.json` the first time, and compared afterwards. When a
change to the output is intended, record it again:

```sh
UPDATE_SNAPSHOTS=1 npm test
```

`test/files` and the baseline are ignored by Git.
