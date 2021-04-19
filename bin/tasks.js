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

// performance logging utils
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

// task wrapper
async function task(name, func) {
  // start performance and log to console
  performance.mark(`${name}start`);
  console.log(`${timeStamp()} starting: ` + chalk.green(`'${name}'`));
  // run the task function
  await func();
  // stop performance and log to console
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

// watcher function
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
        console.log(`${timeStamp()} watching all files...`);
      }, 300),
    );
}

// watch all files
function watch() {
  const jsPath = path.join(config.in.src, config.in.js);
  const cssPath = path.join(config.in.src, config.in.css);
  const inputs = {
    static: {
      pattern: config.in.src,
      ignore: [jsPath, cssPath],
    },
    js: {
      pattern: jsPath,
    },
    css: {
      pattern: cssPath,
    },
  };
  watcher(inputs.static, copyStatic);
  watcher(inputs.js, buildJS);
  watcher(inputs.css, buildCSS);
  console.log(`${timeStamp()} watching all files...`);
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

// TASK - copy static files
const copyStatic = () =>
  task('copyStatic', async () => {
    // wait for composer to dump autoload
    await dumpAutoload();
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
        entry.path != config.in.js && entry.path != config.in.css,
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
  });

// TASK - build js
const buildJS = () =>
  task('buildJS', async () => {
    const outdir = path.join(dest, config.out.js);
    await fse.emptyDir(outdir);
    const entryPoints = [];
    for await (entry of readdirp(path.join(src, config.in.js, 'index'))) {
      entryPoints.push(path.join('./', src, config.in.js, 'index', entry.path));
    }
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
  });

// TASK - build css
const buildCSS = () =>
  task('buildCSS', async () => {
    await fse.emptyDir(path.join(dest, config.out.css));
    for await (entry of readdirp(path.join(src, config.in.css, 'index'), {
      type: 'files_directories',
    })) {
      if (entry.dirent.isFile()) {
        // handle files
        const info = path.parse(entry.path);
        const srcPath = entry.fullPath;
        const outDir = path.join(dest, config.out.css, info.dir);
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
        await fse.ensureDir(path.join(dest, config.out.css, entry.path));
      }
    }
  });

// TASK - zip the dist folder
const zip = () =>
  task('zip', async () => {
    await fse.mkdirs(config.out.release);
    const output = fse.createWriteStream(
      `${config.out.release}/${package.name}-${package.version}.zip`,
    );
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(output);
    archive.directory(config.out.dist, package.name);
    archive.finalize();
  });

// TASK - scaffold WP project
const setup = () =>
  task('setup', async () => {
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
  });

// TASK - development build to output folder
const dev = async () => {
  await task(
    'dev',
    async () => await Promise.all([copyStatic(), buildJS(), buildCSS()]),
  );
  watch();
  return;
};

// TASK - production build to output folder
const prod = () =>
  task(
    'prod',
    async () => await Promise.all([copyStatic(), buildJS(), buildCSS()]),
  );

// TASK - production build then zip for release
const release = () =>
  task('release', async () => {
    await prod();
    await zip();
    return;
  });

module.exports = {
  setup,
  dev,
  prod,
  release,
};
