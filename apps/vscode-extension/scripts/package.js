/**
 * Builds dist/promptguard-<version>.vsix without vsce (no npm needed).
 *
 * A .vsix is a zip with:
 *   [Content_Types].xml      MIME type per file extension
 *   extension.vsixmanifest   identity, engine, assets (what vsce generates)
 *   extension/…              the extension itself
 *
 * The promptguard CLI's modules are copied into extension/cli, where
 * src/cliBridge.js looks for them first.
 *
 * Usage: node scripts/package.js     (needs the `zip` command)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.resolve(ROOT, '..', '..', 'packages', 'cli');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const MIME = {
  '.json': 'application/json', '.js': 'application/javascript', '.md': 'text/markdown',
  '.txt': 'text/plain', '.png': 'image/png', '.svg': 'image/svg+xml', '.vsixmanifest': 'text/xml',
};

function xml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}

function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true, filter: (p) => !/node_modules|\.DS_Store|[\\/]test[\\/]?$/.test(p) });
}

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(p, base) : [path.relative(base, p)];
  });
}

function manifest() {
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${xml(pkg.name)}" Version="${xml(pkg.version)}" Publisher="${xml(pkg.publisher)}" />
    <DisplayName>${xml(pkg.displayName)}</DisplayName>
    <Description xml:space="preserve">${xml(pkg.description)}</Description>
    <Tags>${xml((pkg.keywords ?? []).join(','))}</Tags>
    <Categories>${xml((pkg.categories ?? []).join(','))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xml(pkg.engines.vscode)}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
  </Assets>
</PackageManifest>
`;
}

function contentTypes(files) {
  const exts = [...new Set(files.map((f) => path.extname(f)).filter(Boolean))].sort();
  const missing = exts.filter((e) => !MIME[e]);
  if (missing.length) throw new Error(`no MIME type for: ${missing.join(', ')}`);
  return `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
${exts.map((e) => `  <Default Extension="${e}" ContentType="${MIME[e]}" />`).join('\n')}
</Types>
`;
}

function main() {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'promptguard-vsix-'));
  const ext = path.join(stage, 'extension');
  fs.mkdirSync(ext);

  // The manifest without dev-only scripts
  const { scripts, ...shipped } = pkg;
  fs.writeFileSync(path.join(ext, 'package.json'), `${JSON.stringify(shipped, null, 2)}\n`);
  for (const f of ['README.md', 'LICENSE.txt']) {
    if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(ext, f));
  }
  copyDir(path.join(ROOT, 'src'), path.join(ext, 'src'));
  if (fs.existsSync(path.join(ROOT, 'media'))) copyDir(path.join(ROOT, 'media'), path.join(ext, 'media'));

  // Bundle the CLI (bin + src + package.json), minus its tests
  fs.mkdirSync(path.join(ext, 'cli'));
  fs.copyFileSync(path.join(CLI, 'package.json'), path.join(ext, 'cli', 'package.json'));
  copyDir(path.join(CLI, 'bin'), path.join(ext, 'cli', 'bin'));
  copyDir(path.join(CLI, 'src'), path.join(ext, 'cli', 'src'));

  const files = listFiles(stage);
  fs.writeFileSync(path.join(stage, 'extension.vsixmanifest'), manifest());
  fs.writeFileSync(path.join(stage, '[Content_Types].xml'), contentTypes([...files, 'extension.vsixmanifest']));

  const dist = path.join(ROOT, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  const out = path.join(dist, `${pkg.name}-${pkg.version}.vsix`);
  fs.rmSync(out, { force: true });
  execFileSync('zip', ['-q', '-r', '-X', out, '[Content_Types].xml', 'extension.vsixmanifest', 'extension'], { cwd: stage });
  fs.rmSync(stage, { recursive: true, force: true });

  const kb = (fs.statSync(out).size / 1024).toFixed(1);
  console.log(`Built ${path.relative(process.cwd(), out)} (${kb} KB, ${files.length} files)`);
}

main();
