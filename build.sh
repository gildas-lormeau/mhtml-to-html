#!/usr/bin/env bash

# --node-modules-dir=none keeps deno compile from vendoring node_modules into the executables
# (the npm packages only serve the Node.js build); without it each binary grows by ~28 MB
compile() {
    deno compile --node-modules-dir=none --allow-read --allow-write --allow-net --ext=js "$@" ./mhtml-to-html
}

compile --output=./dist/mhtml-to-html-aarch64-apple --target=aarch64-apple-darwin
compile --output=./dist/mhtml-to-html-x86_64-apple --target=x86_64-apple-darwin
compile --output=./dist/mhtml-to-html-x86_64-linux --target=x86_64-unknown-linux-gnu
compile --output=./dist/mhtml-to-html-aarch64-linux --target=aarch64-unknown-linux-gnu
compile --output=./dist/mhtml-to-html.exe --target=x86_64-pc-windows-msvc

dev_id=$(security find-identity -p codesigning -v | grep "Apple Development" | awk '{print $2}')
if [ -n "$dev_id" ]; then
    codesign -f -s "$dev_id" ./dist/mhtml-to-html-aarch64-apple
    codesign -f -s "$dev_id" ./dist/mhtml-to-html-x86_64-apple
fi
