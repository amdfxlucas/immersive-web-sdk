#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function findRepoRoot(dir) {
  let cur = dir;
  while (true) {
    if (fs.existsSync(path.join(cur, 'pnpm-workspace.yaml'))) return cur;
    const pkgPath = path.join(cur, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.name === 'iwsdk-monorepo') return cur;
      } catch (_) {}
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return dir;
}

(async function main(){
  const arg = process.argv[2] || '.';
  const pkgDir = path.resolve(arg);
  const root = findRepoRoot(pkgDir);
  const examplesDir = path.join(root, 'examples');

  const pkgPath = path.join(pkgDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.error('package.json not found in', pkgDir);
    process.exit(1);
  }

  const backupPath = pkgPath + '.backup';
  fs.copyFileSync(pkgPath, backupPath);

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  ['dependencies','devDependencies','peerDependencies'].forEach(field => {
    if (!pkg[field]) return;
    for (const [name, ver] of Object.entries(pkg[field])) {
      if (!name.startsWith('@iwsdk/')) continue;
      if (!String(ver).startsWith('workspace:')) continue;
      const short = name.replace('@iwsdk/', '');
      const tarball = path.join(examplesDir, `iwsdk-${short}.tgz`);
      if (!fs.existsSync(tarball)) {
        console.error(`Tarball not found: ${tarball}. Run \"pnpm run build:tgz\" first.`);
        process.exit(1);
      }
      const rel = path.relative(pkgDir, tarball).split(path.sep).join('/');
      pkg[field][name] = `file:${rel}`;
      console.log('     Replaced', name, '→', pkg[field][name]);
    }
  });

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log('Wrote modified package.json and created backup at', backupPath);
})();
