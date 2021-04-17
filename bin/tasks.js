// utils
const { promisify } = require('util');
const fse = require('fs-extra');
const path = require('path');
const _ = require('lodash');
// const glob = promisify(require('glob'));
const readdirp = require('readdirp');
const replace = require('replacestream');
const archiver = require('archiver');
const chalk = require('chalk');
const { performance, PerformanceObserver } = require('perf_hooks');
const execa = require('execa');
const chokidar = require('chokidar');
// config
const package = require(path.join(process.cwd(), 'package.json'));
const config = loadConfig('buildwp.config.js');
const esbuildrc = loadConfig('esbuild.config.js');
// const postcssrc = loadConfig('postcss.config.js');
// args
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const argv = yargs(hideBin(process.argv)).argv;
// js
const esbuild = require('esbuild');
// css
const postcss = require('postcss');
const postcssrc = require('postcss-load-config');

module.exports = {
  setup,
  dev,
  prod,
  release,
};

function loadConfig(file) {
  try {
    return require(path.join(process.cwd(), file));
  } catch (e) {
    console.log(
      chalk.yellow(
        `${file} not found or contains errors - loading defaults...`,
      ),
    );
    return require(`../defaults/scaffold/${file}`);
  }
}

// performance logging
function timeStamp() {
  const date = new Date();
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  const s = date.getSeconds().toString().padStart(2, '0');
  return `[${h}:${m}:${s}]`;
}
const observer = new PerformanceObserver((items) => {
  const stamp = timeStamp();
  items.getEntries().forEach((entry) => {
    let duration, unit;
    if (entry.duration >= 1000) {
      duration = (entry.duration / 1000).toFixed(2);
      unit = 's';
    } else {
      duration = entry.duration.toFixed();
      unit = 'ms';
    }
    console.log(
      `${stamp} finished: ` +
        chalk.green(`'${entry.name}' `) +
        `- ${duration} ${unit}`,
    );
  });
});
observer.observe({ entryTypes: ['measure'], buffer: true });

function startMark(name) {
  performance.mark(`${name}start`);
  console.log(`${timeStamp()} starting: ` + chalk.green(`'${name}'`));
}

function endMark(name) {
  performance.mark(`${name}end`);
  performance.measure(name, `${name}start`, `${name}end`);
  performance.clearMarks(`${name}start`);
  performance.clearMarks(`${name}end`);
}

// dynamic directories
let src = config.in.src;
let dest = (() => {
  if (argv.dest === 'local' && config.hasOwnProperty('out.local')) {
    return config.out.local;
  } else {
    return config.out.dist;
  }
})();

function watcher(input, task) {
  chokidar
    .watch(input.pattern, {
      ignored: input.ignore ?? null,
      ignoreInitial: true,
    })
    .on(
      'all',
      _.debounce(async (event, path) => {
        await task();
        const stamp = timeStamp();
        console.log(`${stamp} watching all files...`);
      }, 300),
    );
}

function watch() {
  console.log(config);
  watcher(config.glob.static, copyStatic);
  watcher(config.glob.js, buildJS);
  watcher(config.glob.css, buildCSS);
  const stamp = timeStamp();
  console.log(`${stamp} watching all files...`);
}

// composer dump autoload
async function dumpAutoload() {
  // requires composer in system path
  try {
    const { stdout, stderr } = await execa.command('composer dumpautoload');
    console.log(chalk.blue('>>> composer:dumpautoload'));
    if (stderr) console.log(chalk.red(stderr));
    if (stdout) console.log(chalk.blue(stdout));
    console.log(chalk.blue('<<< composer:dumpautoload'));
  } catch (error) {
    console.log(chalk.red(error));
  }
}

/**
 * copyStatic
 * runs composer scripts,
 * recursively copies files/directories under 'src' skipping compiled js and css directories,
 * and replaces strings in copied files with defined replacements,
 * then copies composer vendor folder from project root
 */
async function copyStatic() {
  startMark('copyStatic');
  // wait for composer to dump autoload
  // await dumpAutoload();
  // ensure output directory exists
  await fse.ensureDir(dest);
  // remove all static files and folders from dest
  for await (const entry of await fse.opendir(dest)) {
    // skip compiled dirs
    if (entry.name == config.out.js || entry.name == config.out.css) continue;
    // remove the entry
    await fse.remove(path.join(dest, entry.name));
  }
  // replacement string sets
  const replaceStrings = config.replace ?? [];
  // replacement string functions
  const replaceFunctions = replaceStrings.map((set) => {
    return () => replace(set[0], set[1]);
  });
  // stream the static dir
  for await (const entry of readdirp(src, {
    type: 'files_directories',
    directoryFilter: (entry) =>
      path.dirname(entry.path) != config.in.js &&
      path.dirname(entry.path) != config.in.css,
  })) {
    if (entry.dirent.isFile()) {
      // handle files
      const srcPath = path.join(src, entry.path);
      const outPath = path.join(dest, entry.path);
      // create output file
      await fse.ensureFile(outPath);
      // stream input file
      let stream = fse.createReadStream(srcPath);
      // loop through all replacements pipe functions
      for (const replaceFunction of replaceFunctions) {
        stream = stream.pipe(replaceFunction());
      }
      // write to output file
      stream.pipe(fse.createWriteStream(outPath));
    } else {
      // handle dirs
      await fse.ensureDir(path.join(dest, entry.path));
    }
  }
  // copy the vendor directory
  await fse.copy('vendor', path.join(dest, 'vendor'), { dereference: true });
  endMark('copyStatic');
}

// build js
async function buildJS() {
  startMark('buildJS');
  const outdir = path.join(dest, 'scripts');
  await fse.emptyDir(outdir);
  const entryPoints = await glob(`${src}/scripts/index/*.js`);
  await esbuild
    .build({
      entryPoints,
      bundle: true,
      outdir,
      plugins: esbuildrc.plugins,
      logLevel: 'info',
      define: {
        'process.env.NODE_ENV': `'${process.env.NODE_ENV}'`,
      },
      minify: process.env.NODE_ENV === 'production',
    })
    .catch(() => process.exit(1));
  endMark('buildJS');
  return;
}

async function buildCSS() {
  startMark('buildCSS');
  await fse.emptyDir(path.join(dest, config.out.css));
  for await (entry of readdirp(path.join(src, config.in.css, 'index'), {
    type: 'files_directories',
  })) {
    if (entry.dirent.isFile()) {
      // handle files
      const info = path.parse(entry.path);
      const srcPath = entry.fullPath;
      const outDir = path.join(dest, info.dir);
      const outPath = path.join(outDir, info.name + '.css');
      const content = await fse.readFile(srcPath);
      const { plugins } = await postcssrc();
      const processed = await postcss(plugins).process(content, {
        from: srcPath,
        to: outPath,
      });
      fse.writeFile(outPath, processed.css, () => true);
      if (processed.map) {
        const mapOutPath = path.join(outDir, info.name + '.css.map');
        fse.writeFile(mapOutPath, processed.map.css, () => true);
      }
    } else {
      // handle dirs
      await fse.ensureDir(path.join(dest, entry.path));
    }
  }

  // const entries = await glob(`${src}/styles/index/*.pcss`);
  // const { plugins } = await postcssrc();
  // const promises = [];
  // entries.forEach((entry) => {
  //   promises.push(
  //     (async (file) => {
  //       const name = path.parse(file).name;
  //       const outPath = `${outdir}/${name}.css`;
  //       const content = await fse.readFile(file);
  //       const result = await postcss(plugins).process(content, {
  //         from: file,
  //         to: outPath,
  //       });
  //       fse.writeFile(outPath, result.css, () => true);
  //       if (result.map) {
  //         fse.writeFile(
  //           `${outdir}/${name}.css.map`,
  //           result.map.toString(),
  //           () => true,
  //         );
  //       }
  //     })(entry),
  //   );
  // });
  // await Promise.all(promises);
  endMark('buildCSS');
  return;
}

// zip the dist folder
async function zip() {
  startMark('zip');
  await fse.mkdirs(config.dir.release);
  const output = fse.createWriteStream(
    `${config.dir.release}/${package.name}-${package.version}.zip`,
  );
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(output);
  archive.directory(config.dir.dist, package.name);
  archive.finalize();
  endMark('zip');
  return;
}

// TASK - scaffold WP project
async function setup() {
  startMark('setup');
  await fse.copy(
    path.join(path.dirname(require.main.path), 'defaults', 'scaffold'),
    './',
  );
  const scripts = {
    dev: 'cross-env NODE_ENV=development buildwp dev',
    'dev:local': 'cross-env NODE_ENV=development buildwp dev --dest=local',
    prod: 'cross-env NODE_ENV=production buildwp prod',
    'prod:local': 'cross-env NODE_ENV=production buildwp prod --dest=local',
    release: 'cross-env NODE_ENV=production buildwp release',
  };
  const file = path.join(process.cwd(), 'package.json');
  const data = require(file);
  data.scripts = { ...data.scripts, ...scripts };
  await fse.writeJSON(file, data, { spaces: 2 });
  endMark('setup');
}

// TASK - development build to output folder
async function dev() {
  startMark('dev');
  // await Promise.all([copyStatic(), buildJS(), buildCSS()]);
  await Promise.all([copyStatic(), buildCSS()]);
  endMark('dev');
  // watch();
  return;
}

// TASK - production build to output folder
async function prod() {
  startMark('prod');
  await Promise.all([copyStatic(), buildJS(), buildCSS()]);
  endMark('prod');
  return;
}

// TASK - production build then zip for release
async function release() {
  startMark('release');
  // override dest directory
  dest = config.dir.dist;
  await prod();
  await zip();
  endMark('release');
  return;
}
