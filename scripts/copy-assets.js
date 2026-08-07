// Copies non-TS assets (codex .json, icons) from nodes/ and credentials/
// into the matching dist/ paths. Runs as part of `npm run build`.

const fs = require('fs');
const path = require('path');

const sourceRoots = ['nodes', 'credentials', 'icons'];
const exts = new Set(['.json', '.png', '.svg']);

function copyDir(srcDir, dstDir) {
  if (!fs.existsSync(srcDir)) return;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, dstPath);
    } else if (exts.has(path.extname(entry.name))) {
      fs.mkdirSync(path.dirname(dstPath), { recursive: true });
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

for (const root of sourceRoots) {
  copyDir(root, path.join('dist', root));
}
