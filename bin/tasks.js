// utils
const { promisify } = require('util');
const fse = require('fs-extra');
const path = require('path');
const _ = require('lodash');
const glob = promisify(require('glob'));
const replace = require('replacestream');
const archiver = require('archiver');
const chalk = require('chalk');
const { performance, PerformanceObserver } = require('perf_hooks');
const execa = require('execa');
const chokidar = require('chokidar');
// config
const package = require(path.join(process.cwd(), 'package.json'));
const config = (() => {
  try {
    return require(path.join(process.cwd(), 'buildwp.config.js'));
  } catch (e) {
    return require('../defaults/scaffold/buildwp.config');
  }
})();
// args
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const argv = yargs(hideBin(process.argv)).argv;
// js
const esbuild = require('esbuild');
const esbuildrc = (() => {
  try {
    return require(path.join(process.cwd(), 'esbuild.config.js'));
  } catch (e) {
    return require('../defaults/scaffold/esbuild.config');
  }
})();
// css
const postcss = require('postcss');
const postcssrc = require('postcss-load-config');

module.exports = {
  setup,
  dev,
  prod,
  release,
};

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
let src = config.sourceDir;
let dest = (() => {
  if (argv.dest === 'local' && config.hasOwnProperty('localDevDir')) {
    return config.localDevDir;
  } else {
    return config.distDir;
  }
})();

function watcher(input, task) {
  chokidar
    .watch(input, {
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
  watcher(`${src}/{!(scripts|styles)/**,*.*}`, copyStatic);
  watcher(`${src}/scripts/**/*.*`, buildJS);
  watcher(`${src}/styles/**/*.*`, buildCSS);
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

// copy static
async function copyStatic() {
  startMark('copyStatic');
  // wait for composer to dump autoload
  await dumpAutoload();
  const outdir = dest;
  await fse.ensureDir(dest);
  // remove all static files and folders from dest, leaving compiled folders 'scripts' & 'styles'
  await (async () => {
    const entries = await glob(`${dest}/{!(scripts|styles)/,*.*}`);
    const promises = [];
    entries.forEach((entry) => {
      promises.push(
        (async (entry) => {
          await fse.remove(entry);
        })(entry),
      );
    });
    await Promise.all(promises);
    return;
  })();
  // copy static files and replace placeholder strings
  await (async () => {
    const entries = await glob(`${src}/{!(scripts|styles)/**,*.*}`);
    const promises = [];
    entries.forEach((entry) => {
      promises.push(
        (async (entry) => {
          const outPath = entry.replace(src, outdir);
          const stat = await fse.stat(entry);
          if (stat.isFile()) {
            await fse.ensureFile(outPath);
            fse
              .createReadStream(entry)
              .pipe(replace('{_name_}', package.name))
              .pipe(replace('{_displayName_}', package.displayName))
              .pipe(replace('{_link_}', package.link))
              .pipe(replace('{_description_}', package.description))
              .pipe(replace('{_version_}', package.version))
              .pipe(replace('{_author_}', package.author))
              .pipe(replace('{_author_uri_}', package.authorURL))
              .pipe(replace('{_license_}', package.license))
              .pipe(replace('{_license_uri_}', package.licenseURL))
              .pipe(fse.createWriteStream(outPath));
          } else {
            await fse.ensureDir(outPath);
          }
        })(entry),
      );
    });
    await Promise.all(promises);
    return;
  })();
  // copy the vendor directory
  await fse.copy('./vendor', `${dest}/vendor`, { dereference: true });
  endMark('copyStatic');
  return;
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
  const outdir = path.join(dest, 'styles');
  await fse.emptyDir(outdir);
  const entries = await glob(`${src}/styles/index/*.pcss`);
  const { plugins } = await postcssrc();
  const promises = [];
  entries.forEach((entry) => {
    promises.push(
      (async (file) => {
        const name = path.parse(file).name;
        const outPath = `${outdir}/${name}.css`;
        const content = await fse.readFile(file);
        const result = await postcss(plugins).process(content, {
          from: file,
          to: outPath,
        });
        fse.writeFile(outPath, result.css, () => true);
        if (result.map) {
          fse.writeFile(
            `${outdir}/${name}.css.map`,
            result.map.toString(),
            () => true,
          );
        }
      })(entry),
    );
  });
  await Promise.all(promises);
  endMark('buildCSS');
  return;
}

// zip the dist folder
async function zip() {
  startMark('zip');
  await fse.mkdirs('./release');
  const output = fse.createWriteStream(
    `./release/${package.name}-${package.version}.zip`,
  );
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(output);
  archive.directory('./dist', package.name);
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
    devLocal: 'cross-env NODE_ENV=development buildwp dev --dest=local',
    prod: 'cross-env NODE_ENV=production buildwp prod',
    prodLocal: 'cross-env NODE_ENV=production buildwp prod --dest=local',
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
  await Promise.all([copyStatic(), buildJS(), buildCSS()]);
  endMark('dev');
  watch();
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
  dest = config.distDir;
  await prod();
  await zip();
  endMark('release');
  return;
}
