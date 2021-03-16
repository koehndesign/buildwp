<!-- PROJECT LOGO -->
<br />
<p align="center">
  <h3 align="center">BuildWP</h3>

  <p align="center">
    flexible build tool for WP projects
    <br />
    <br />
    <a href="https://github.com/koehndesign/buildwp/discussions">Discuss</a>
    ·
    <a href="https://github.com/koehndesign/buildwp/issues">Report Bug</a>
    ·
    <a href="https://github.com/koehndesign/buildwp/issues">Request Feature</a>
  </p>
</p>

<!-- TABLE OF CONTENTS -->
<details open="open">
  <summary><h2 style="display: inline-block">Table of Contents</h2></summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
  </ol>
</details>

<!-- ABOUT THE PROJECT -->

## About The Project

A simple, easy to use build tool for WordPress plugins/themes. Handles CSS/JS/PHP, builds to project directory or local dev server, and packages cleanly into a zip file for release.

### Built With

- [node](https://nodejs.org/)
- [Composer](https://getcomposer.org/)
- [esbuild](https://esbuild.github.io/)
- [PostCSS](https://postcss.org/)

<!-- GETTING STARTED -->

## Getting Started

To get a local copy up and running follow these simple steps.

### Prerequisites

- [npm initialized](https://docs.npmjs.com/creating-a-package-json-file#running-a-cli-questionnaire)
  ```sh
  npm init
  ```
- [composer installed globally](https://getcomposer.org/doc/00-intro.md#globally)

### Installation

1. install package
   ```sh
   npm i -D buildwp
   ```
2. run setup (WARNING - only use on new projects, may override existing files)
   ```sh
   npx buildwp setup
   ```

<!-- USAGE EXAMPLES -->

## Usage

After running "npx buildwp setup", a very basic folder structure and some default config files will be copied into your project root. Only files/folders added under the "src" directory will be included in the build processes. Your main plugin file or theme functions file should be placed into this "src" folder.

PHP classes can be included under the "src/app" directory. PSR-4 autoloading of your own classes should be enabled by adding your namespace to the composer.json config as described [here](https://getcomposer.org/doc/01-basic-usage.md#autoloading). The entire contents of the "src/app" directory will be copied to the build destination. All files/folders in the root "src" directory will also be copied, other than "src/scripts" and "src/styles" which are handled by their respective build processes.

JS and CSS builds are handled very similarly. Any ".js" files in "src/styles/index" or ".pcss" files in "src/scripts/index" will be compiled by their respective build tools (esbuild or PostCSS). JS builds are not currently set up to support CSS-in-JS. Feel free to structure common or included files as you want outside of the index directories.

Running "npx buildwp setup" also copies some build scripts into your root package.json file.

- "dev" builds for development and watches everything in the "src" directory for changes
- "prod" builds for production without watching
- "release" builds for production, then zips the "dist" directory in the correct folder structure for installation via wp-admin
  "dev" and "prod" scripts also are available to build directly to your local dev server, but you must first add this plugin directory to the "buildwp.config.js" file.
  Example:

```sh
module.exports = {
  sourceDir: 'src',
  distDir: 'dist',
  releaseDir: 'release',
  // add here...
  localDevDir: C:/<path-to-wp-plugins-dir>/<your-plugin-dir>
};
```

<!-- ROADMAP -->

## Roadmap

See the [open issues](https://github.com/koehndesign/buildwp/issues) for a list of proposed features (and known issues).

<!-- LICENSE -->

## License

Distributed under the MIT License. See `LICENSE` for more information.

<!-- CONTACT -->

## Contact

Project Link: [https://github.com/koehndesign/buildwp](https://github.com/koehndesign/buildwp)
