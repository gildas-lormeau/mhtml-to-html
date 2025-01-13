#!/usr/bin/env bash

deno compile --allow-read --allow-write --ext=js --output=./dist/mhtml-to-html-aarch64-apple --target=aarch64-apple-darwin ./mhtml-to-html
deno compile --allow-read --allow-write --ext=js --output=./dist/mhtml-to-html-x86_64-apple --target=x86_64-apple-darwin ./mhtml-to-html
deno compile --allow-read --allow-write --ext=js --output=./dist/mhtml-to-html-x86_64-linux --target=x86_64-unknown-linux-gnu ./mhtml-to-html
deno compile --allow-read --allow-write --ext=js --output=./dist/mhtml-to-html-aarch64-linux --target=aarch64-unknown-linux-gnu ./mhtml-to-html
deno compile --allow-read --allow-write --ext=js --output=./dist/mhtml-to-html.exe --target=x86_64-pc-windows-msvc ./mhtml-to-html

dev_id=$(security find-identity -p codesigning -v | grep "Apple Development" | awk '{print $2}')
codesign -f -s $dev_id ./dist/mhtml-to-html-aarch64-apple
codesign -f -s $dev_id ./dist/mhtml-to-html-x86_64-apple