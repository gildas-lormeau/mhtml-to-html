# MHTML-TO-HTML

Deno library for converting MHTML files to single HTML files

## Install

- Install Deno, see https://deno.com

- Install Git, see https://git-scm.com

- Clone the repository

```sh
git clone https://github.com/gildas-lormeau/mhtml-to-html.git
```

- Make `mhtml-to-html` executable (Linux, Unix)
```sh
chmod +x mhtml-to-html
```

## Usage 

```
Usage: mhtml-to-html <input>... [--output <output>] [--help] [--enable-scripts]
 Arguments:
  <input>: The input MHTML file, wildcards are supported
 Options:
  --output <output>: The output HTML file (default: input file with .html extension), only used when a single input file is provided
  --enable-scripts: Enable scripts (default: disabled)
  --help: Show this help message
```