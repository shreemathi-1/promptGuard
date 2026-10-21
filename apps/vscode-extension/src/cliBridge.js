const fs = require('fs');
const path = require('path');

/**
 * The extension reuses the promptguard CLI's modules (file collection, ignore
 * rules, inline-ignore / test-value filtering, batch client, hook installer)
 * instead of duplicating them.
 *
 * In the packaged .vsix they are copied to ./cli (scripts/package.js); during
 * development (F5 from this repo) they are loaded from packages/cli.
 */

const EXT_ROOT = path.resolve(__dirname, '..');
const BUNDLED = path.join(EXT_ROOT, 'cli');
const IN_REPO = path.resolve(EXT_ROOT, '..', '..', 'packages', 'cli');

const CLI_ROOT = fs.existsSync(path.join(BUNDLED, 'src')) ? BUNDLED : IN_REPO;

function load(name) {
  return require(path.join(CLI_ROOT, 'src', name));
}

module.exports = {
  CLI_ROOT,
  files: load('files'),
  ignore: load('ignore'),
  report: load('report'),
  api: load('api'),
  hook: load('hook'),
};
