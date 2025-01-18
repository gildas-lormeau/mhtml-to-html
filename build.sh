#!/usr/bin/env bash

mv node_modules node_modules.bak
mv package.json package.json.bak
mv package-lock.json package-lock.json.bak

deno compile --allow-read --allow-write --allow-net --ext=js --output=./dist/mhtml-to-html-aarch64-apple --target=aarch64-apple-darwin ./mhtml-to-html
deno compile --allow-read --allow-write --allow-net --ext=js --output=./dist/mhtml-to-html-x86_64-apple --target=x86_64-apple-darwin ./mhtml-to-html
deno compile --allow-read --allow-write --allow-net --ext=js --output=./dist/mhtml-to-html-x86_64-linux --target=x86_64-unknown-linux-gnu ./mhtml-to-html
deno compile --allow-read --allow-write --allow-net --ext=js --output=./dist/mhtml-to-html-aarch64-linux --target=aarch64-unknown-linux-gnu ./mhtml-to-html
deno compile --allow-read --allow-write --allow-net --ext=js --output=./dist/mhtml-to-html.exe --target=x86_64-pc-windows-msvc ./mhtml-to-html

dev_id=$(security find-identity -p codesigning -v | grep "Apple Development" | awk '{print $2}')
codesign -f -s $dev_id ./dist/mhtml-to-html-aarch64-apple
codesign -f -s $dev_id ./dist/mhtml-to-html-x86_64-apple

mv node_modules.bak node_modules
mv package.json.bak package.json
mv package-lock.json.bak package-lock.json