#!/usr/bin/env node
const { dev, prod, release } = require('./tasks');
const { setup } = require('./setup');

const argv = require('yargs/yargs')(process.argv.slice(2))
  .command({
    command: 'setup',
    desc: 'scaffold a BuildWP project',
    handler: (argv) => setup(argv),
  })
  .command({
    command: 'dev [dest]',
    desc: 'build for development to --dest and watch files for changes',
    handler: (argv) => dev(argv),
  })
  .command({
    command: 'prod [dest]',
    desc: 'build for production to --dest',
    handler: (argv) => prod(argv),
  })
  .command({
    command: 'release',
    desc: 'build for production and zip for WP release',
    handler: (argv) => release(argv),
  })
  .help().argv;
