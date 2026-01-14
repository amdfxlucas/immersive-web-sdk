#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

(async function main(){
  const arg = process.argv[2] || '.';
  const pkgDir = path.resolve(arg);
  const pkgPath = path.join(pkgDir, 'package.json');
  const backupPath = pkgPath + '.backup';
  if (!fs.existsSync(backupPath)) {
    console.error('Backup not found:', backupPath);
    process.exit(1);
  }
  fs.copyFileSync(backupPath, pkgPath);
  fs.unlinkSync(backupPath);
  console.log('Restored original package.json from', backupPath);
})();
