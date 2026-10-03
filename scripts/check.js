#!/usr/bin/env node
/* Static checks: syntax of every JS file + manifest validity. */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
let failures = 0;

function fail(msg) {
  failures++;
  console.error('  FAIL ' + msg);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

console.log('[1/3] JavaScript syntax check');
const files = walk(root).filter((f) => f.endsWith('.js'));
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    fail(`${path.relative(root, file)}: ${(err.stderr || err.stdout || err.message).toString().trim()}`);
  }
}
console.log(`  checked ${files.length} files`);

console.log('[2/3] Manifest V3 validation');
const manifestPath = path.join(root, 'manifest.json');
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (err) {
  fail('manifest.json is not valid JSON: ' + err.message);
}

if (manifest) {
  if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
  if (!manifest.name) fail('missing name');
  if (!manifest.version) fail('missing version');
  if (!manifest.background || !manifest.background.service_worker) fail('missing background.service_worker');
  if (!manifest.action || !manifest.action.default_popup) fail('missing action.default_popup');
  if (!Array.isArray(manifest.content_scripts) || !manifest.content_scripts.length) fail('missing content_scripts');

  const perms = manifest.permissions || [];
  const allowed = new Set(['storage']);
  for (const p of perms) {
    if (!allowed.has(p)) fail(`unexpected permission: ${p}`);
  }
  if (perms.includes('cookies') || perms.includes('history') || perms.includes('webRequest') ||
      perms.includes('tabs') || perms.includes('management') || perms.includes('downloads')) {
    fail('privacy-sensitive permission requested');
  }

  const hosts = manifest.host_permissions || [];
  const allowedHostRes = [/instagram\.com/, /linktr\.ee/];
  const badHost = hosts.filter((h) => !allowedHostRes.some((re) => re.test(h)));
  if (badHost.length) fail('host_permissions outside instagram.com/linktr.ee: ' + badHost.join(', '));

  // referenced files must exist
  const referenced = new Set();
  if (manifest.background && manifest.background.service_worker) referenced.add(manifest.background.service_worker);
  if (manifest.action) {
    if (manifest.action.default_popup) referenced.add(manifest.action.default_popup);
    const icons = manifest.action.default_icon || {};
    Object.values(icons).forEach((f) => referenced.add(f));
  }
  Object.values(manifest.icons || {}).forEach((f) => referenced.add(f));
  (manifest.content_scripts || []).forEach((cs) => (cs.js || []).forEach((f) => referenced.add(f)));

  for (const rel of referenced) {
    if (!fs.existsSync(path.join(root, rel))) fail('referenced file missing: ' + rel);
  }

  // content script ordering: dependencies before dependents
  const jsOrder = (manifest.content_scripts[0] || {}).js || [];
  const idx = (name) => jsOrder.indexOf(name);
  const orderRules = [
    ['src/shared/logger.js', 'src/content/profile-extractor.js'],
    ['src/content/normalizer.js', 'src/content/profile-extractor.js'],
    ['src/content/selectors.js', 'src/content/profile-extractor.js'],
    ['src/content/profile-extractor.js', 'src/content/instagram-scanner.js'],
    ['src/content/business-detector.js', 'src/content/instagram-scanner.js'],
    ['src/content/mutation-observer.js', 'src/content/instagram-scanner.js'],
    ['src/content/instagram-scanner.js', 'src/content/auto-search.js']
  ];
  for (const [before, after] of orderRules) {
    const a = idx(before);
    const b = idx(after);
    if (a === -1 || b === -1) {
      fail(`content script missing from manifest: ${a === -1 ? before : after}`);
    } else if (a > b) {
      fail(`content script order wrong: ${before} must load before ${after}`);
    }
  }

  const resolverEntry = (manifest.content_scripts || []).find((cs) => (cs.js || []).includes('src/content/linktree-resolver.js'));
  const resolverJs = (resolverEntry || {}).js || [];
  const rIdx = (name) => resolverJs.indexOf(name);
  if (rIdx('src/content/linktree-resolver.js') === -1 || rIdx('src/content/normalizer.js') === -1) {
    fail('linktree resolver content script must include normalizer.js and linktree-resolver.js');
  } else if (rIdx('src/content/normalizer.js') > rIdx('src/content/linktree-resolver.js')) {
    fail('content script order wrong: normalizer.js must load before linktree-resolver.js');
  }
}

console.log('[3/3] No remote code / no forbidden endpoints');
const sourceFiles = files.filter((f) => !f.includes('make-icons'));
const forbidden = [
  { re: /src\s*=\s*["']https?:\/\//i, why: 'remote <script src>' },
  { re: /importScripts\(\s*["']https?:/i, why: 'remote importScripts' },
  { re: /firebaseio\.com|supabase\.co|apify|brightdata|scraperapi/i, why: 'remote service endpoint' },
  { re: /XMLHttpRequest|fetch\(\s*["'`]https?:\/\/(?!www\.instagram\.com)/i, why: 'network call to non-Instagram host' }
];
for (const file of sourceFiles) {
  const rel = path.relative(root, file);
  if (rel.startsWith('scripts' + path.sep) || rel.startsWith('tests' + path.sep)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const rule of forbidden) {
    if (rule.re.test(text)) fail(`${rel}: ${rule.why}`);
  }
}

if (failures) {
  console.error(`\ncheck failed with ${failures} problem(s)`);
  process.exit(1);
}
console.log('\ncheck passed');
