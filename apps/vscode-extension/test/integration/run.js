/**
 * Runs the integration suite inside a real VS Code — what @vscode/test-electron
 * does, without downloading anything: it launches the installed VS Code with
 * --extensionDevelopmentPath / --extensionTestsPath, an isolated profile and
 * extensions directory, and a throwaway git workspace. A fake PromptGuard API
 * (the CLI's test server) answers the scans.
 *
 * Usage: node test/integration/run.js   (VS_CODE_BINARY to override the binary)
 */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startFakeApi } = require('../../../../packages/cli/test/helpers');

const EXT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_BINARIES = {
  darwin: '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
  linux: '/usr/share/code/code',
  win32: path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
};

function workspace(apiUrl) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptguard-vscode-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.mkdirSync(path.join(dir, '.vscode'));
  fs.writeFileSync(path.join(dir, '.vscode', 'settings.json'), JSON.stringify({
    'promptguard.apiUrl': apiUrl,
    'promptguard.minimumSeverity': 'LOW',
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'config.js'), 'export const region = "ap-south-1";\n');
  return dir;
}

async function main() {
  const binary = process.env.VS_CODE_BINARY ?? DEFAULT_BINARIES[process.platform];
  if (!binary || !fs.existsSync(binary)) {
    console.error(`VS Code not found at ${binary}; set VS_CODE_BINARY`);
    process.exit(2);
  }

  const api = await startFakeApi();
  const ws = workspace(api.url);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'promptguard-vscode-profile-'));

  const args = [
    ws,
    `--extensionDevelopmentPath=${EXT_ROOT}`,
    `--extensionTestsPath=${path.join(__dirname, 'suite.js')}`,
    `--user-data-dir=${path.join(profile, 'user')}`,
    `--extensions-dir=${path.join(profile, 'extensions')}`,
    '--disable-extensions', '--disable-workspace-trust', '--skip-welcome',
    '--skip-release-notes', '--disable-telemetry', '--new-window',
  ];

  console.log(`Launching VS Code (fake API ${api.url}, workspace ${ws})`);
  const env = { ...process.env, PROMPTGUARD_TEST_WORKSPACE: ws };
  delete env.ELECTRON_RUN_AS_NODE;
  const code = await new Promise((resolve) => {
    const child = spawn(binary, args, { env, stdio: 'inherit' });
    child.on('close', resolve);
  });

  api.close();
  fs.rmSync(profile, { recursive: true, force: true });
  fs.rmSync(ws, { recursive: true, force: true });
  console.log(code === 0 ? 'Integration tests passed' : `Integration tests failed (exit ${code})`);
  process.exit(code ?? 1);
}

main();
