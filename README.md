# MHTML-TO-HTML

JavaScript library and application for converting MHTML files to single HTML files

## Install

- Download the executable for your OS here: https://github.com/gildas-lormeau/mhtml-to-html/releases

- Rename the file to `mhtml-to-html` (Linux, Unix)

- Make `mhtml-to-html` executable (Linux, Unix)
```sh
chmod +x mhtml-to-html
```

## Install from source

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
mhtml-to-html <input>... [--output <output>] [--help] [--enable-scripts] [--version]

 Arguments:
  <input>: The input MHTML file, wildcards are supported
 Options:
  --output <output>: The output HTML file (default: input file with .html extension), only
                     used when a single input file is provided
  --help: Show this help message
  --enable-scripts: Enable scripts (default: disabled)
  --version: Show the version number
```

## Examples
```
 mhtml-to-html file.mht
 mhtml-to-html file1.mht file2.mht
 mhtml-to-html file.mht --output output_file.html
 mhtml-to-html *.mht
 mhtml-to-html *.mht --enable-scripts
```
