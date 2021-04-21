#!/usr/bin/env node
const argv = require('yargs/yargs')(process.argv.slice(2))
  .command({
    command: 'setup',
    desc: 'scaffold a BuildWP project',
    handler: (argv) => require('./setup').setup(argv),
  })
  .command({
    command: 'dev [dest]',
    desc: 'build for development to --dest and watch files for changes',
    handler: (argv) => require('./tasks').dev(argv),
  })
  .command({
    command: 'prod [dest]',
    desc: 'build for production to --dest',
    handler: (argv) => require('./tasks').prod(argv),
  })
  .command({
    command: 'release',
    desc: 'build for production and zip for WP release',
    handler: (argv) => require('./tasks').release(argv),
  })
  .help().argv;
