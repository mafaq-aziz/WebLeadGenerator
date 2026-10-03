#!/usr/bin/env node
/* Assemble a clean, loadable extension directory under dist/. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}

function copy(rel) {
  const from = path.join(root, rel);
  const to = path.join(dist, rel);
  if (!fs.existsSync(from)) throw new Error('missing source: ' + rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

rmrf(dist);
fs.mkdirSync(dist, { recursive: true });

['manifest.json'].forEach(copy);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const roots = ['src', 'lib', 'assets'];
let count = 0;
for (const base of roots) {
  if (!fs.existsSync(path.join(root, base))) continue;
  walk(path.join(root, base)).forEach((file) => {
    const rel = path.relative(root, file);
    copy(rel);
    count++;
  });
}

const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));

const referenced = [];
if (manifest.background) referenced.push(manifest.background.service_worker);
if (manifest.action) {
  if (manifest.action.default_popup) referenced.push(manifest.action.default_popup);
  Object.values(manifest.action.default_icon || {}).forEach((f) => referenced.push(f));
}
Object.values(manifest.icons || {}).forEach((f) => referenced.push(f));
(manifest.content_scripts || []).forEach((cs) => (cs.js || []).forEach((f) => referenced.push(f)));

const missing = referenced.filter((f) => !fs.existsSync(path.join(dist, f)));
if (missing.length) {
  console.error('build failed, referenced files missing in dist: ' + missing.join(', '));
  process.exit(1);
}

const forbidden = /src\s*=\s*["']https?:\/\//i;
for (const file of walk(dist).filter((f) => f.endsWith('.js') || f.endsWith('.html'))) {
  const text = fs.readFileSync(file, 'utf8');
  if (forbidden.test(text) && !file.includes('xlsx.full.min.js')) {
    console.error('build failed, remote script src in ' + path.relative(dist, file));
    process.exit(1);
  }
}

console.log(`build ok: dist/ (${count} copied files, ${referenced.length} manifest references resolved)`);
