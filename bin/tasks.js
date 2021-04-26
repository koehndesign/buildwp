// utils
const fse = require('fs-extra');
const path = require('path');
const os = require('os');
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
// args
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const argv = yargs(hideBin(process.argv)).argv;
// js
const esbuild = require('esbuild');
const esbuildrc = loadConfig('esbuild.config.js');
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
  return;
}

// dynamic directories
let src = config.in.src;
let dest = argv.dest === 'local' ? config.out.local : config.out.dist;

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
  watcher(inputs.static, () => Promise.all([copyStatic(), buildCSS()]));
  watcher(inputs.js, () => Promise.all([buildJS(), buildCSS()]));
  watcher(inputs.css, buildCSS);
  console.log(`${timeStamp()} watching all files...`);
}

// TASK - composer install to dest
// NOTICE - requires composer.phar in system path!
async function composerInstall() {
  // check if enabled first
  if (!config.composerInstall) return;
  // copy composer config and lock files
  const files = ['composer.json', 'composer.lock'];
  files.forEach((file) => {
    fse.copy(file, `${dest}/${file}`).catch((err) => {
      console.log(
        chalk.red(`${file} file not found in project root - exiting...`),
      );
      process.exit(1);
    });
  });
  // set up command
  const optimize = process.env.NODE_ENV === 'production' ? '-o' : '';
  const outputDir = dest.replace(/(\s+)/g, '\\$1');
  const dirOption = (os.type() === 'Windows_NT' ? '-d ' : '-d=') + outputDir;
  const command = `composer install ${dirOption} ${optimize}`;
  // run command
  try {
    console.log(chalk.blue('>>> ' + command));
    const { stdout, stderr } = await execa.command(command);
    if (stderr) console.log(chalk.red(stderr));
    if (stdout) console.log(chalk.blue(stdout));
    console.log(chalk.blue('<<< composer end'));
  } catch (error) {
    console.log(chalk.red(error));
  }
  return;
}

// TASK - copy static files
const copyStatic = () =>
  task('copyStatic', async () => {
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
    // run composer install
    await composerInstall();
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

// TASK - development build to output folder
const dev = async () => {
  await task('dev', async () =>
    Promise.all([copyStatic(), buildJS(), buildCSS()]),
  );
  watch();
  return;
};

// TASK - production build to output folder
const prod = () =>
  task('prod', () => Promise.all([copyStatic(), buildJS(), buildCSS()]));

// TASK - production build then zip for release
const release = () =>
  task('release', async () => {
    await prod();
    await zip();
    return;
  });

module.exports = {
  dev,
  prod,
  release,
};
