const package = require('./package.json');

module.exports = {
  in: {
    src: 'src',
    js: 'scripts',
    css: 'styles',
  },
  out: {
    dist: 'dist',
    local: '<path-to-local-wp-install>/wp-content/plugins/<your-project>',
    js: 'scripts',
    css: 'styles',
  },
  replace: [
    ['{_name_}', package.name],
    ['{_displayName_}', package.displayName],
    ['{_link_}', package.link],
    ['{_description_}', package.description],
    ['{_version_}', package.version],
    ['{_author_}', package.author],
    ['{_author_uri_}', package.authorURL],
    ['{_license_}', package.license],
    ['{_license_uri_}', package.licenseURL],
  ],
};
