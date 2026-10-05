#!/usr/bin/env node
/* Real-Chrome smoke test.
   Serves an Instagram-shaped fixture over HTTPS as www.instagram.com (host-resolver map),
   launches headless Chrome with --remote-debugging-pipe, installs dist/ via CDP
   Extensions.loadUnpacked (branded Chrome removed --load-extension in M137), opens the
   fixture page, then reads chrome.storage over CDP to prove:
   1) the content script scanned and the service worker saved the profile lead, and
   2) an injected auto-search session harvests posts, opens the author profile,
      resolves its Linktree (opened in the driven tab), submits it with saveAll,
      and stops at the configured target. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync, spawn } = require('child_process');

const root = path.join(__dirname, '..');
let HTTP_PORT = 8443;

const E2E_PROFILE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>E2E Clinic (@e2e_clinic) Instagram photos</title></head>
<body>
<main>
  <header>
    <section>
      <h2>e2e_clinic</h2>
      <span dir="auto">E2E Skin Clinic</span>
      <span dir="auto">Skin care clinic</span>
      <div dir="auto">Dermatology, laser &amp; hair treatments<br>Walk-ins welcome<br>Open daily 10-8</div>
      <ul>
        <li><span>2,040</span> Followers</li>
        <li><span>150</span> Following</li>
        <li><span>88</span> Posts</li>
      </ul>
      <button>Contact</button>
    </section>
  </header>
</main>
<div id="feed">
  <a href="/p/POST1/">post one</a>
  <a href="/p/POST2/">post two</a>
</div>
<article>
  <header><a href="/a1_shop/">a1_shop</a></header>
  <section>
    <h2>a1_shop</h2>
    <span dir="auto">A1 Beauty Store</span>
    <span dir="auto">Beauty store</span>
    <div dir="auto">Cosmetics and skincare<br>Walk-ins welcome</div>
    <ul><li>980 Followers</li></ul>
  </section>
</article>
<script>
  setTimeout(function () {
    var wrap = document.createElement('div');
    wrap.innerHTML = '<a href="/dynamic_shop/">dynamic_shop</a>';
    document.getElementById('feed').appendChild(wrap);
  }, 1200);
</script>
</body></html>`;

const SEARCH_RESULTS = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Search results</title></head>
<body><main><div id="feed">
  <a href="/p/POST1/">post one</a>
  <a href="/p/POST2/">post two</a>
</div></main></body></html>`;

const POST1 = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Post • Instagram</title></head>
<body><main><article>
  <header><a href="/alice_styles/">alice_styles</a><span>and</span><a href="/a1_shop/">a1_shop</a></header>
  <div dir="auto">Fresh stock arrived #beauty #skincare — call +39 333 123 4567 or write a1@shop.example</div>
  <a href="/explore/tags/beauty/">beauty</a>
</article></main></body></html>`;

const POST2 = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="description" content="874 likes, 12 comments - b2_market on Instagram: &quot;weekend sale&quot;">
<title>Post • Instagram</title></head>
<body><main><article>
  <div dir="auto">Weekend sale on home goods — call +39 349 987 6543</div>
  <a href="/p/OTHERPOST/">related</a>
</article></main></body></html>`;

const A1_PROFILE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>A1 Beauty Store (@a1_shop) Instagram photos</title></head>
<body><main><header><section>
  <h2>a1_shop</h2>
  <span dir="auto">A1 Beauty Store</span>
  <span dir="auto">Beauty store</span>
  <div dir="auto">Cosmetics and skincare<br>Walk-ins welcome</div>
  <a href="https://linktr.ee/a1_shop">linktr.ee/a1_shop</a>
  <ul><li>980 Followers</li><li>150 Following</li><li>64 Posts</li></ul>
</section></header></main></body></html>`;

const B2_PROFILE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>B2 Market (@b2_market) Instagram photos</title></head>
<body><main><header><section>
  <h2>b2_market</h2>
  <span dir="auto">B2 Market</span>
  <span dir="auto">Home goods store</span>
  <div dir="auto">Furniture and decor<br>Delivery available</div>
  <a href="https://wa.me/39123000000">WhatsApp us</a>
  <ul><li>430 Followers</li><li>90 Following</li><li>41 Posts</li></ul>
</section></header></main></body></html>`;

const LINKTREE_A1 = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>A1 Beauty Store</title></head>
<body><main>
  <a href="https://www.instagram.com/a1_shop/">Instagram</a>
  <a href="https://wa.me/39123000000">WhatsApp</a>
  <a href="https://linktr.ee/privacy">Privacy Policy</a>
</main></body></html>`;

const DM_PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>A1 Beauty Store • Direct</title></head>
<body>
<div role="dialog" aria-label="Chat">
  <div contenteditable="true" aria-label="Message"></div>
</div>
<script>
  window.__igEnter = 0;
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') window.__igEnter++;
  });
</script>
</body></html>`;

const WA_PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>WhatsApp</title></head>
<body><main><h1>WhatsApp Web</h1></main></body></html>`;

const fixtureHits = { linktree: 0 };

function routeFixture(host, url) {
  if (/^linktr\.ee/i.test(host || '')) {
    fixtureHits.linktree++;
    return LINKTREE_A1;
  }
  if (/^web\.whatsapp\.com/i.test(host || '')) return WA_PAGE;
  if (/^\/direct\//.test(url)) return DM_PAGE;
  if (/^\/p\/POST1\//.test(url)) return POST1;
  if (/^\/p\/POST2\//.test(url)) return POST2;
  if (/^\/a1_shop\//.test(url)) return A1_PROFILE;
  if (/^\/b2_market\//.test(url)) return B2_PROFILE;
  if (/^\/explore\/(search|tags)\//.test(url)) return SEARCH_RESULTS;
  return E2E_PROFILE;
}

function fail(msg) {
  console.error('SMOKE FAIL: ' + msg);
  process.exitCode = 1;
}

function genCert(dir) {
  const key = path.join(dir, 'key.pem');
  const crt = path.join(dir, 'cert.pem');
  const args = ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', key, '-out', crt,
    '-days', '2', '-nodes', '-subj', '/CN=www.instagram.com',
    '-addext', 'subjectAltName=DNS:www.instagram.com'];
  try {
    execFileSync('openssl', args, { stdio: 'pipe' });
  } catch (e) {
    const full = 'C:\\msys64\\ucrt64\\bin\\openssl.exe';
    if (!fs.existsSync(full)) throw e;
    execFileSync(full, args, { stdio: 'pipe' });
  }
  return { key, crt };
}

function startServer(cert) {
  const server = https.createServer({
    key: fs.readFileSync(cert.key),
    cert: fs.readFileSync(cert.crt)
  }, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(routeFixture(req.headers.host || '', req.url || '/'));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      HTTP_PORT = server.address().port;
      resolve(server);
    });
  });
}

function pipeClient(proc) {
  const pending = new Map();
  const listeners = [];
  let nextId = 1;
  let buffer = '';

  function onData(chunk) {
    buffer += chunk.toString('utf8');
    let idx;
    while ((idx = buffer.indexOf('\0')) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!raw.trim()) continue;
      let msg;
      try { msg = JSON.parse(raw); } catch (e) { continue; }
      if (msg.id && pending.has(msg.id)) {
        const cb = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? cb.rej(new Error(JSON.stringify(msg.error))) : cb.res(msg.result);
      } else if (msg.method) {
        listeners.forEach((fn) => fn(msg));
      }
    }
  }

  proc.stdio[4].on('data', onData);

  return {
    send(method, params, sessionId) {
      return new Promise((res, rej) => {
        const id = nextId++;
        pending.set(id, { res, rej });
        const msg = { id, method, params: params || {} };
        if (sessionId) msg.sessionId = sessionId;
        proc.stdio[3].write(JSON.stringify(msg) + '\0');
        setTimeout(() => {
          if (pending.has(id)) { pending.delete(id); rej(new Error('timeout: ' + method)); }
        }, 20000);
      });
    },
    on(fn) { listeners.push(fn); }
  };
}

async function poll(fn, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, intervalMs || 500));
  }
  throw new Error('timed out' + (lastErr ? ': ' + lastErr.message : ''));
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const dist = path.join(root, 'dist');
  if (!fs.existsSync(path.join(dist, 'manifest.json'))) {
    fail('dist/ missing - run `npm run build` first');
    return;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ficino-smoke-'));
  const cert = genCert(tmp);
  const server = await startServer(cert);

  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new',
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    '--user-data-dir=' + path.join(tmp, 'profile'),
    '--host-resolver-rules=MAP www.instagram.com 127.0.0.1:' + HTTP_PORT + ', MAP linktr.ee 127.0.0.1:' + HTTP_PORT + ', MAP web.whatsapp.com 127.0.0.1:' + HTTP_PORT,
    '--ignore-certificate-errors',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu'
  ], {
    stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
    windowsHide: true
  });

  let chromeLog = '';
  chrome.stdout.on('data', (d) => { chromeLog += d; });
  chrome.stderr.on('data', (d) => { chromeLog += d; });
  const chromeExit = new Promise((resolve) => chrome.on('exit', (code) => resolve(code)));

  const cdp = pipeClient(chrome);

  let pageSession = null;
  let swSession = null;
  let targetDump = '';
  try {
    console.log('  waiting for chrome pipe endpoint...');
    const version = await poll(() => cdp.send('Browser.getVersion'), 60000, 500);
    console.log('  ' + version.product);

    const loaded = await cdp.send('Extensions.loadUnpacked', { path: dist });
    const extId = loaded.id;
    console.log('  extension installed via Extensions.loadUnpacked: ' + extId);
    if (!extId) throw new Error('loadUnpacked returned no id');

    const fixtureUrl = 'https://www.instagram.com:' + HTTP_PORT + '/e2e_clinic/';
    const created = await cdp.send('Target.createTarget', { url: fixtureUrl });
    const pageAttach = await cdp.send('Target.attachToTarget', { targetId: created.targetId, flatten: true });
    pageSession = pageAttach.sessionId;
    await cdp.send('Runtime.enable', {}, pageSession);
    console.log('  fixture page opened: ' + fixtureUrl);

    const swTarget = await poll(async () => {
      const t = await cdp.send('Target.getTargets');
      targetDump = t.targetInfos.map((x) => x.type + ':' + x.url.slice(0, 90)).join(' | ');
      return t.targetInfos.find((x) => x.type === 'service_worker' &&
        x.url.indexOf('chrome-extension://' + extId + '/') === 0) || null;
    }, 60000, 750);

    const swAttach = await cdp.send('Target.attachToTarget', { targetId: swTarget.targetId, flatten: true });
    swSession = swAttach.sessionId;
    await cdp.send('Runtime.enable', {}, swSession);
    console.log('  service worker attached: ' + swTarget.url.slice(0, 70) + '...');

    const settingsVal = await poll(async () => {
      const out = await cdp.send('Runtime.evaluate', {
        expression: 'chrome.storage.local.get(["settings"]).then(function (s) { return JSON.stringify(s.settings || null); })',
        awaitPromise: true,
        returnByValue: true
      }, swSession);
      const parsed = JSON.parse(out.result.value || 'null');
      return parsed && parsed.businessConfidenceThreshold ? parsed : null;
    }, 20000, 500);
    const threshold = settingsVal.businessConfidenceThreshold;
    console.log('  settings initialised with threshold: ' + threshold);
    if (threshold !== 70) throw new Error('settings not initialised by service worker');

    const snapshot = await poll(async () => {
      const out = await cdp.send('Runtime.evaluate', {
        expression: 'chrome.storage.local.get(["leads","statistics","settings"])',
        awaitPromise: true,
        returnByValue: true
      }, swSession);
      const data = out.result.value || {};
      const leads = data.leads || [];
      const stats = data.statistics || {};
      return leads.length >= 1 && (stats.scanned || 0) >= 2 ? { leads, stats } : null;
    }, 40000, 750);

    const profileLead = snapshot.leads.find((l) => l.instagram_username === 'e2e_clinic');
    if (!profileLead) throw new Error('profile lead not saved: ' + JSON.stringify(snapshot.leads.map((l) => l.instagram_username)));
    if (profileLead.website) throw new Error('website should be empty, got: ' + profileLead.website);
    if (profileLead.website_not_found_on_instagram !== true) throw new Error('website_not_found_on_instagram flag missing');
    if (profileLead.confidence < 70) throw new Error('confidence below threshold: ' + profileLead.confidence);
    if (profileLead.status !== 'New') throw new Error('unexpected status: ' + profileLead.status);
    if (profileLead.instagram_name !== 'E2E Skin Clinic') throw new Error('name not extracted: ' + profileLead.instagram_name);
    if (profileLead.category !== 'Skin care clinic') throw new Error('category not extracted: ' + profileLead.category);
    if (profileLead.instagram_url !== 'https://www.instagram.com/e2e_clinic/') throw new Error('bad url: ' + profileLead.instagram_url);

    console.log('  profile lead saved: @' + profileLead.instagram_username +
      ' (confidence ' + profileLead.confidence + ', name "' + profileLead.instagram_name + '")');
    console.log('  stats: ' + JSON.stringify(snapshot.stats));

    if (snapshot.leads.some((l) => l.instagram_username === 'dynamic_shop')) {
      console.log('  note: dynamic_shop also saved (scored above threshold)');
    } else {
      console.log('  dynamic link candidate counted in scanned but scored below threshold (expected)');
    }

    console.log('  injecting auto search session (target 2 leads)...');
    await cdp.send('Runtime.evaluate', {
      expression: 'chrome.storage.local.set({ autoSearch: { active: true, query: "skin clinic", target: 2, collected: 0, phase: "idle", message: "", tabId: null, searchUrl: "https://www.instagram.com/explore/search/keyword/?q=skin%20clinic", visitedPosts: [], visitedProfiles: [], pending: [], updatedAt: Date.now() } })',
      awaitPromise: true,
      returnByValue: true
    }, swSession);

    const finalData = await poll(async () => {
      const out = await cdp.send('Runtime.evaluate', {
        expression: 'chrome.storage.local.get(["autoSearch","leads","statistics"])',
        awaitPromise: true,
        returnByValue: true
      }, swSession);
      const data = out.result.value || {};
      const s = data.autoSearch || {};
      if (s.active) return null;
      if (s.phase === 'idle') return null;
      return data;
    }, 300000, 1000);

    const run = finalData.autoSearch || {};
    if (run.phase !== 'done' || (run.collected || 0) < 2) {
      throw new Error('auto search did not complete: ' + JSON.stringify(run));
    }
    if (fixtureHits.linktree < 1) {
      throw new Error('linktree page was never opened by auto search');
    }
    console.log('  linktree opened and resolved (' + fixtureHits.linktree + ' request(s))');
    const autoLead = (finalData.leads || []).find((l) => l.instagram_username === 'a1_shop');
    if (!autoLead) {
      throw new Error('a1_shop lead not saved by auto search: ' +
        JSON.stringify((finalData.leads || []).map((l) => l.instagram_username)));
    }
    if (autoLead.instagram_url !== 'https://www.instagram.com/a1_shop/') {
      throw new Error('bad auto search lead url: ' + autoLead.instagram_url);
    }
    if (autoLead.website) {
      throw new Error('linktree with no real website must leave website empty, got: ' + autoLead.website);
    }
    if (autoLead.phone_normalized !== '+393331234567') {
      throw new Error('phone from the post caption must merge into the auto lead, got: ' + autoLead.phone_normalized);
    }
    if (autoLead.email !== 'a1@shop.example') {
      throw new Error('email from the post caption must merge into the auto lead, got: ' + autoLead.email);
    }
    if (!run.postContacts || !run.postContacts.a1_shop) {
      throw new Error('post contact for a1_shop was never stashed: ' + JSON.stringify(run.postContacts || null));
    }
    if ((run.visitedProfiles || []).indexOf('alice_styles') !== -1) {
      throw new Error('influencer author of the collab post must not be opened: ' +
        JSON.stringify(run.visitedProfiles));
    }
    if ((finalData.leads || []).some((l) => l.instagram_username === 'alice_styles')) {
      throw new Error('influencer must not become a lead: ' +
        JSON.stringify((finalData.leads || []).map((l) => l.instagram_username)));
    }
    const b2Lead = (finalData.leads || []).find((l) => l.instagram_username === 'b2_market');
    if (b2Lead && b2Lead.website) {
      throw new Error('whatsapp link in bio must not count as website, got: ' + b2Lead.website);
    }
    if (b2Lead && b2Lead.phone_normalized !== '+393499876543') {
      throw new Error('phone from the post2 caption must merge into the b2 lead, got: ' + b2Lead.phone_normalized);
    }

    await poll(async () => {
      const out = await cdp.send('Runtime.evaluate', {
        expression: 'chrome.storage.local.get(["statistics"])',
        awaitPromise: true,
        returnByValue: true
      }, swSession);
      const stats = (out.result.value || {}).statistics || {};
      return (stats.saved || 0) >= 2 && (stats.scanned || 0) >= 4 ? stats : null;
    }, 10000, 300).then((stats) => {
      console.log('  final stats: ' + JSON.stringify(stats));
    }).catch(() => {
      console.log('  final stats: (read before debounced flush)');
    });

    console.log('  auto search loop done: collected ' + run.collected + '/' + run.target +
      ', lead @a1_shop saved (confidence ' + autoLead.confidence + ')');

    const a1 = (finalData.leads || []).find((l) => l.instagram_username === 'a1_shop');
    if (!a1 || !a1.id) throw new Error('a1_shop lead id missing for outreach');

    try {
      const alive = await cdp.send('Runtime.evaluate', { expression: '1', returnByValue: true }, swSession);
      if (!alive.result || alive.result.value !== 1) throw new Error('stale session');
    } catch (e) {
      const swTarget2 = await poll(async () => {
        const t = await cdp.send('Target.getTargets');
        return t.targetInfos.find((x) => x.type === 'service_worker' &&
          x.url.indexOf('chrome-extension://' + extId + '/') === 0) || null;
      }, 15000, 400);
      const reattach = await cdp.send('Target.attachToTarget', { targetId: swTarget2.targetId, flatten: true });
      swSession = reattach.sessionId;
      await cdp.send('Runtime.enable', {}, swSession);
      console.log('  service worker reattached for outreach');
    }

    const dashTarget = await cdp.send('Target.createTarget', {
      url: 'chrome-extension://' + extId + '/src/dashboard/dashboard.html'
    });
    const dashAttach = await cdp.send('Target.attachToTarget', { targetId: dashTarget.targetId, flatten: true });
    const dashSession = dashAttach.sessionId;
    await cdp.send('Runtime.enable', {}, dashSession);

    const fromDashboard = async (expr) => {
      const out = await cdp.send('Runtime.evaluate', {
        expression: expr, awaitPromise: true, returnByValue: true
      }, dashSession);
      if (out.exceptionDetails) {
        throw new Error('dashboard eval failed: ' + JSON.stringify(out.exceptionDetails));
      }
      return out.result.value;
    };

    const outreachState = async () => {
      const out = await cdp.send('Runtime.evaluate', {
        expression: 'chrome.storage.local.get(["outreach"])',
        awaitPromise: true,
        returnByValue: true
      }, swSession);
      return ((out.result.value || {}).outreach) || {};
    };

    const readLead = async (id) => {
      const out = await cdp.send('Runtime.evaluate', {
        expression: 'chrome.storage.local.get(["leads"])',
        awaitPromise: true,
        returnByValue: true
      }, swSession);
      const leads = (out.result.value || {}).leads || [];
      return leads.find((l) => l.id === id) || null;
    };

    console.log('  phone cleanup: verifying saved numbers...');
    const cleanResult = JSON.parse(await fromDashboard(
      'new Promise(function (resolve) {' +
      ' chrome.runtime.sendMessage({ type: "CLEAN_PHONES" },' +
      ' function (r) { resolve(JSON.stringify(r || null)); }); })'
    ));
    if (!cleanResult || !cleanResult.ok) {
      throw new Error('phone cleanup did not run: ' + JSON.stringify(cleanResult));
    }
    const flaggedLead = await readLead(a1.id);
    if (!flaggedLead || flaggedLead.phone_issue !== 'caption_source') {
      throw new Error('caption-sourced phone must be flagged for review, got: ' +
        JSON.stringify(flaggedLead && flaggedLead.phone_issue));
    }
    console.log('  caption-sourced number flagged: ' + flaggedLead.phone_issue +
      ' (phone kept: ' + flaggedLead.phone_normalized + ')');

    const acceptFix = JSON.parse(await fromDashboard(
      'new Promise(function (resolve) {' +
      ' chrome.runtime.sendMessage({ type: "SET_PHONE", payload: { id: "' + a1.id + '", phone_raw: "+393331234567" } },' +
      ' function (r) { resolve(JSON.stringify(r || null)); }); })'
    ));
    if (!acceptFix || !acceptFix.ok) {
      throw new Error('manual phone fix did not apply: ' + JSON.stringify(acceptFix));
    }
    const fixedLead = await readLead(a1.id);
    if (!fixedLead || fixedLead.phone_issue) {
      throw new Error('manual phone fix must clear the flag, got: ' +
        JSON.stringify(fixedLead && fixedLead.phone_issue));
    }
    console.log('  manual fix accepted, phone_issue cleared: ' + fixedLead.phone_normalized);

    console.log('  outreach: preparing Instagram DM draft for @a1_shop...');
    const igStart = JSON.parse(await fromDashboard(
      'new Promise(function (resolve) {' +
      ' chrome.runtime.sendMessage({ type: "OUTREACH_START", payload: { channel: "instagram", ids: ["' + a1.id + '"] } },' +
      ' function (r) { resolve(JSON.stringify(r || null)); }); })'
    ));
    if (!igStart || !igStart.started) throw new Error('instagram outreach did not start: ' + JSON.stringify(igStart));

    const igDone = await poll(async () => {
      const o = await outreachState();
      return o.state === 'done' ? o : null;
    }, 60000, 500);
    if ((igDone.prepared || []).length !== 1 || (igDone.failed || []).length !== 0) {
      throw new Error('instagram draft not prepared: ' + JSON.stringify(igDone));
    }

    const dmTarget = await poll(async () => {
      const t = await cdp.send('Target.getTargets');
      return t.targetInfos.find((x) => x.url.indexOf('direct/new/?to=a1_shop') !== -1) || null;
    }, 15000, 400);
    const dmAttach = await cdp.send('Target.attachToTarget', { targetId: dmTarget.targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, dmAttach.sessionId);
    const composerText = await poll(async () => {
      const out = await cdp.send('Runtime.evaluate', {
        expression: '(function () { var n = document.querySelector(\'div[contenteditable="true"]\'); return n ? n.textContent : null; })()',
        returnByValue: true
      }, dmAttach.sessionId);
      const text = out.result.value;
      return typeof text === 'string' && text.indexOf('A1 Beauty Store') !== -1 ? text : null;
    }, 20000, 400);
    console.log('  IG draft typed into the DM composer: "' + composerText.slice(0, 70) + '..."');
    const enterCount = await poll(async () => {
      const out = await cdp.send('Runtime.evaluate', {
        expression: '(function () { return window.__igEnter || 0; })()',
        returnByValue: true
      }, dmAttach.sessionId);
      return out.result.value > 0 ? out.result.value : null;
    }, 10000, 300);
    console.log('  IG message sent automatically with Enter (keydown x' + enterCount + ')');

    console.log('  outreach: preparing WhatsApp draft for @a1_shop...');
    const waStart = JSON.parse(await fromDashboard(
      'new Promise(function (resolve) {' +
      ' chrome.runtime.sendMessage({ type: "OUTREACH_START", payload: { channel: "whatsapp", ids: ["' + a1.id + '"] } },' +
      ' function (r) { resolve(JSON.stringify(r || null)); }); })'
    ));
    if (!waStart || !waStart.started) throw new Error('whatsapp outreach did not start: ' + JSON.stringify(waStart));

    const waDone = await poll(async () => {
      const o = await outreachState();
      return o.state === 'done' ? o : null;
    }, 60000, 500);
    if ((waDone.prepared || []).length !== 1 || (waDone.failed || []).length !== 0) {
      throw new Error('whatsapp draft not prepared: ' + JSON.stringify(waDone));
    }

    const waTarget = await poll(async () => {
      const t = await cdp.send('Target.getTargets');
      return t.targetInfos.find((x) => x.url.indexOf('web.whatsapp.com/send?phone=') !== -1) || null;
    }, 15000, 400);
    if (waTarget.url.indexOf('phone=393331234567') === -1) {
      throw new Error('whatsapp draft must use normalized phone digits: ' + waTarget.url);
    }
    const waDecoded = decodeURIComponent(waTarget.url);
    if (waDecoded.indexOf('A1 Beauty Store') === -1) {
      throw new Error('whatsapp draft must contain the rendered message: ' + waDecoded);
    }
    console.log('  WhatsApp draft tab opened with prefilled message, not sent: ' + waDecoded.slice(0, 80) + '...');

    console.log('SMOKE PASS: passive scan saved a lead, auto-search collected to target,' +
      ' IG message sent automatically, WhatsApp draft prefilled without sending');
  } catch (err) {
    fail(err.message);
    const exited = await Promise.race([
      chromeExit.then((c) => 'code ' + c),
      new Promise((r) => setTimeout(() => r('still running'), 300))
    ]);
    console.error('  chrome: ' + exited);
    try {
      const t = await cdp.send('Target.getTargets');
      console.error('  targets: ' + t.targetInfos.map((x) => x.type + ':' + x.url.slice(0, 80)).join(' | '));
    } catch (e) {
      console.error('  target dump failed: ' + e.message);
    }
    if (chromeLog.trim()) {
      console.error('  chrome output: ' + chromeLog.trim().split('\n').slice(0, 8).join('\n  '));
    }
  } finally {
    try { chrome.kill(); } catch (e) {}
    try { server.close(); } catch (e) {}
    setTimeout(() => {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
    }, 500);
  }
}

main().catch((err) => fail(err.stack || err.message));
