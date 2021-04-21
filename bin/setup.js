const fse = require('fs-extra');
const path = require('path');

const setup = async () => {
  console.log('buildwp: starting setup...');
  await fse.copy(
    path.join(path.dirname(require.main.path), 'defaults', 'scaffold'),
    './',
    {
      overwrite: false,
    },
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
  console.log('buildwp: setup complete!');
  return;
};

module.exports = {
  setup,
};
