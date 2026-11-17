/* Mirror the 17-0 game into this repository for GitHub Pages at /<repo>/. */
const fs = require('fs');
const path = require('path');

const ORIGIN = 'https://www.firstdown.studio';
const BASE = '/17-and-0';
const ROOT = process.cwd();

const seen = new Set();
const queue = [];

function local(p) {
  return path.join(ROOT, p.replace(/^\//, ''));
}

function enqueue(raw) {
  if (!raw) return;
  let u = raw.replace(/\\+$/, '').split('#')[0].trim();
  if (!u.startsWith('/') || u.startsWith('/api/')) return;
  const clean = u.split('?')[0];
  if (!/^\/(_next|site-icons|images|icons|assets|fonts)\//.test(clean)) return;
  if (seen.has(clean)) return;
  seen.add(clean);
  queue.push(clean);
}

async function download(p) {
  const res = await fetch(ORIGIN + p);
  if (!res.ok) { console.log('FAIL', res.status, p); return null; }
  const buf = Buffer.from(await res.arrayBuffer());
  const dest = local(p);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  console.log(res.status, buf.length, p);
  return buf;
}

function scan(txt) {
  for (const re of [
    /["'`(](\/_next\/[^"'`)\\ ]+)/g,
    /["'`(](\/site-icons\/[^"'`)\\ ]+)/g,
    /["'`(](\/images\/[^"'`)\\ ]+)/g,
    /["'`(](\/assets\/[^"'`)\\ ]+)/g,
    /static\/chunks\/[A-Za-z0-9._/-]+\.js/g,
    /static\/css\/[A-Za-z0-9._/-]+\.css/g,
    /static\/media\/[A-Za-z0-9._/-]+/g,
  ]) {
    let m;
    while ((m = re.exec(txt))) {
      const v = m[1] || m[0];
      enqueue(v.startsWith('static/') ? '/_next/' + v : v);
    }
  }
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

(async () => {
  // 1. Page shell.
  const page = await fetch(ORIGIN + '/build-a-17-0-team');
  if (!page.ok) throw new Error('page fetch failed: ' + page.status);
  const html = Buffer.from(await page.arrayBuffer());
  fs.writeFileSync(path.join(ROOT, 'index.html'), html);
  const htmlText = html.toString('utf8');
  scan(htmlText);
  for (const m of htmlText.matchAll(/https:\/\/www\.firstdown\.studio(\/[^"'\\ ]+)/g)) enqueue(m[1]);

  // 2. Every referenced asset, following imports in JS/CSS.
  while (queue.length) {
    const p = queue.shift();
    const buf = await download(p);
    if (!buf) continue;
    if (/\.(js|css)$/.test(p)) scan(buf.toString('utf8'));
  }

  // Extra component chunks Next.js requests after hydration.
  for (const rel of [
    '/_next/static/chunks/3107.1f0bfaa661e07cb1.js',
    '/_next/static/chunks/8164.452a855f0982346c.js',
    '/_next/static/chunks/7532.b9125385dd4105b2.js',
    '/_next/static/chunks/6492-7efdda005b29dd9a.js',
    '/_next/static/chunks/6997-0c7083f65257ec41.js',
    '/_next/static/chunks/8546.39d296efdb5a3b1d.js',
    '/_next/static/chunks/7698.abf7d10c417ff71a.js',
    '/_next/static/chunks/3269.046050936d87d7f5.js',
    '/_next/static/chunks/1190.40fe1b8c7d91d0ce.js',
    '/_next/static/chunks/4631.e6ebb40d6c4ce8ae.js',
  ]) {
    if (!fs.existsSync(local(rel))) await download(rel);
  }

  // 3. Async chunks named by the webpack runtime.
  const wpFile = walk(path.join(ROOT, '_next')).find(f => /webpack-[^/]+\.js$/.test(f));
  const wp = fs.readFileSync(wpFile, 'utf8');
  const names = new Set([
    ...[...wp.matchAll(/static\/chunks\/[A-Za-z0-9._-]+\.js/g)].map(m => m[0]),
    ...[...wp.matchAll(/static\/css\/[A-Za-z0-9._-]+\.css/g)].map(m => m[0]),
  ]);
  for (const rel of names) {
    if (!fs.existsSync(local('_next/' + rel))) await download('/_next/' + rel);
  }

  // 4. Game data endpoints.
  const today = new Date().toISOString().slice(0, 10);
  const apis = {
    '/api/pools/nfl-current/18da6d398f030dbd': 'data/nfl-current.txt',
    '/api/build-the-goat-team/eras-players': 'data/eras-players.txt',
    '/api/build-the-goat-team/pools/current': 'data/pools-current.json',
    ['/api/build-the-goat-team/daily/bootstrap?daily=' + today]: 'data/daily-bootstrap.json',
  };
  for (const [url, rel] of Object.entries(apis)) {
    const res = await fetch(ORIGIN + url);
    if (!res.ok) { console.log('FAIL', res.status, url); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(local(rel)), { recursive: true });
    fs.writeFileSync(local(rel), buf);
    console.log(res.status, buf.length, rel);
  }

  // 5. Static icons served from the site root.
  for (const [rel, out] of [['/favicon.ico', 'favicon.ico'], ['/icon.png', 'icon.png'], ['/apple-icon.png', 'apple-icon.png']]) {
    const res = await fetch(ORIGIN + rel);
    if (res.ok) fs.writeFileSync(path.join(ROOT, out), Buffer.from(await res.arrayBuffer()));
  }

  // 6. Point the Next image components straight at the original images.
  const loaderFile = walk(path.join(ROOT, '_next')).find(f => /1356-b555fc5f745af797\.js$/.test(f));
  let loader = fs.readFileSync(loaderFile, 'utf8');
  const loaderBefore = loader;
  loader = loader.replace(
    /return r\.path\+"\?url="\+encodeURIComponent\(i\)\+"&w="\+n\+"&q="\+l\+\(i\.startsWith\("\/_next\/static\/media\/"\)&&1\?"&dpl=dpl_7GtmdAVAMhqvomoUsAcwyR6Gdjij":""\)\}/,
    'return i}'
  );
  if (loader === loaderBefore) throw new Error('image loader patch did not match');
  fs.writeFileSync(loaderFile, loader);

  const logoFile = walk(path.join(ROOT, '_next')).find(f => /2290-c057110502e0cd8d\.js$/.test(f));
  let logo = fs.readFileSync(logoFile, 'utf8');
  const logoBefore = logo;
  logo = logo.split('src:"/_next/image?url=".concat(encodeURIComponent(e))+"&w=".concat(96,"&q=").concat(90),width:96').join('src:e,width:96');
  if (logo === logoBefore) throw new Error('team logo image patch did not match');
  fs.writeFileSync(logoFile, logo);

  // 7. Serve everything from the project subpath.
  const replacements = [
    ['/_next/', BASE + '/_next/'],
    ['/site-icons/', BASE + '/site-icons/'],
    ['/apple-icon.png', BASE + '/apple-icon.png'],
    ['/icon.png', BASE + '/icon.png'],
    ['/favicon.ico', BASE + '/favicon.ico'],
    ['/api/pools/nfl-current/18da6d398f030dbd', BASE + '/data/nfl-current.txt'],
    ['/api/build-the-goat-team/eras-players', BASE + '/data/eras-players.txt'],
    ['/api/build-the-goat-team/pools/current', BASE + '/data/pools-current.json'],
    ['/api/build-the-goat-team/daily/bootstrap', BASE + '/data/daily-bootstrap.json'],
  ];
  for (const f of walk(ROOT)) {
    if (!/\.(js|css|html)$/.test(f)) continue;
    let txt = fs.readFileSync(f, 'utf8');
    const before = txt;
    for (const [from, to] of replacements) txt = txt.split(from).join(to);
    if (txt !== before) fs.writeFileSync(f, txt);
  }

  // 8. Keep GitHub Pages from running Jekyll over _next/.
  fs.writeFileSync(path.join(ROOT, '.nojekyll'), '');

  console.log('mirror complete, files:', walk(ROOT).length);
})();
