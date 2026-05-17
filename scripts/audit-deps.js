#!/usr/bin/env node
// scripts/audit-deps.js
// Run: npm run audit-deps
//
// Checks the installed node_modules for:
//  1. Versions from the recent npm supply-chain attacks (Mini Shai-Hulud,
//     axios RAT, node-ipc credential stealer, etc.)
//  2. Install/preinstall/postinstall hooks (the malware delivery mechanism
//     used in all 2026 incidents) — and flags anything that isn't a
//     known-good native-binding builder.
//  3. Runs `npm audit` for regular CVEs.
//
// Sources tracked:
//   - https://socket.dev/blog (real-time)
//   - CISA alerts for major incidents
//   - npm advisory database
//
// This list is point-in-time. Update before each install if you're paranoid.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

// Known-compromised package versions from 2026 supply-chain attacks.
// Format: 'package-name' -> Set of malicious version strings.
const COMPROMISED = {
  // axios — North Korean Sapphire Sleet RAT, March 31 2026
  'axios': new Set(['1.14.1', '0.30.4']),
  // plain-crypto-js — phantom dep injected by malicious axios
  'plain-crypto-js': new Set(['4.2.1']),
  // node-ipc — credential stealer, May 14 2026
  'node-ipc': new Set(['9.1.6', '9.2.3', '12.0.1']),
  // Mini Shai-Hulud / TeamPCP — SAP wave, April 29 2026
  'mbt': new Set(['1.2.48']),
  '@cap-js/db-service': new Set(['2.10.1']),
  '@cap-js/postgres': new Set(['2.2.2']),
  '@cap-js/sqlite': new Set(['2.2.2']),
  // Mini Shai-Hulud — Intercom + Lightning wave, April 30 2026
  'intercom-client': new Set(['7.0.4', '7.0.5']),
  // (TanStack May 11 wave covers ~42 packages — just flag any @tanstack/* below)
};

// Any version of these packages with any tag is treated as compromised
// because the maintainers' npm accounts were taken over.
const COMPROMISED_NAMESPACES = ['@tanstack/', '@mistralai/', '@squawk/'];

// Known-safe install scripts (legitimate native binding builders).
const SAFE_INSTALL_SCRIPTS = new Set([
  'node-gyp-build', 'node-gyp rebuild', 'prebuild-install', 'prebuild-install || node-gyp rebuild',
]);

const C = { red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', dim: '\x1b[2m', reset: '\x1b[0m' };

function findAllPackageJsons(dir) {
  const results = [];
  function walk(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === '.bin' || e.name === '.cache') continue;
        walk(full);
      } else if (e.name === 'package.json') {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

const root = process.cwd();
const nodeModules = path.join(root, 'node_modules');

if (!fs.existsSync(nodeModules)) {
  console.error(`${C.red}node_modules/ not found. Run \`npm install --ignore-scripts\` first.${C.reset}`);
  process.exit(1);
}

console.log(`\n${C.dim}scanning node_modules…${C.reset}\n`);
const pkgs = findAllPackageJsons(nodeModules);
console.log(`  ${pkgs.length} package.json files scanned\n`);

let compromisedHits = 0;
let unknownHooks = 0;
const hookList = [];

for (const file of pkgs) {
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
  const name = pkg.name;
  const version = pkg.version;
  if (!name || !version) continue;

  // (1) Known-compromised version match
  if (COMPROMISED[name]?.has(version)) {
    console.log(`${C.red}  ✗ COMPROMISED: ${name}@${version}${C.reset}  ${C.dim}(${file})${C.reset}`);
    compromisedHits++;
  }
  for (const ns of COMPROMISED_NAMESPACES) {
    if (name.startsWith(ns)) {
      console.log(`${C.red}  ✗ COMPROMISED NAMESPACE: ${name}@${version}${C.reset}  ${C.dim}(${file})${C.reset}`);
      compromisedHits++;
    }
  }

  // (2) Install hooks
  const scripts = pkg.scripts || {};
  for (const hook of ['preinstall', 'install', 'postinstall']) {
    const cmd = scripts[hook];
    if (!cmd) continue;
    if (SAFE_INSTALL_SCRIPTS.has(cmd.trim())) {
      hookList.push({ name, version, hook, cmd, safe: true });
    } else {
      hookList.push({ name, version, hook, cmd, safe: false });
      unknownHooks++;
    }
  }
}

console.log(`\n${C.dim}install hooks found:${C.reset}`);
if (hookList.length === 0) {
  console.log(`  (none)`);
} else {
  for (const h of hookList) {
    const mark = h.safe ? `${C.green}safe${C.reset}` : `${C.yellow}REVIEW${C.reset}`;
    console.log(`  [${mark}] ${h.name}@${h.version} :: ${h.hook}: ${h.cmd}`);
  }
}

console.log(`\n${C.dim}running \`npm audit\`…${C.reset}\n`);
try {
  execSync('npm audit', { stdio: 'inherit' });
} catch {
  /* npm audit exits non-zero on findings; that's reported above */
}

console.log('');
if (compromisedHits === 0 && unknownHooks === 0) {
  console.log(`${C.green}✓ no known-compromised packages and no unknown install hooks${C.reset}`);
  console.log(`${C.dim}  (this list is point-in-time — check socket.dev / cisa.gov before installs)${C.reset}\n`);
  process.exit(0);
} else {
  console.log(`${C.red}✗ ${compromisedHits} compromised, ${unknownHooks} unknown install hooks${C.reset}\n`);
  process.exit(1);
}
