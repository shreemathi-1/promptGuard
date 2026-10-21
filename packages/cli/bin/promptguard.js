#!/usr/bin/env node
const { main } = require('../src/cli');

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (err) => {
    console.error(`promptguard: ${err.message}`);
    process.exitCode = 2;
  },
);
