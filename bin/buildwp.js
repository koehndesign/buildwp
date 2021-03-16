#!/usr/bin/env node
const tasks = require('./tasks');

const argv = require('yargs/yargs')(process.argv.slice(2))
  .command({
    command: 'setup',
    desc: 'scaffold a BuildWP project',
    handler: (argv) => tasks.setup(argv),
  })
  .command({
    command: 'dev [dest]',
    desc: 'build for development to --dest and watch files for changes',
    handler: (argv) => tasks.dev(argv),
  })
  .command({
    command: 'prod [dest]',
    desc: 'build for production to --dest',
    handler: (argv) => tasks.prod(argv),
  })
  .command({
    command: 'release',
    desc: 'build for production and zip for WP release',
    handler: (argv) => tasks.release(argv),
  })
  .help().argv;
