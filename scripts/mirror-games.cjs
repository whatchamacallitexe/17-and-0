/* Mirror the First Down Studio sidebar games into the 17-and-0 GitHub Pages repo.
 *
 * The 17-0 copy under /17-and-0/ is self-hosted, but the other games in its sidebar
 * (82-0 NBA, LNB-0 MLB, Build the GOAT Team) still link to firstdown.studio root
 * routes, which 404 on this host. This fetches those routes and everything they
 * need, rewrites every URL into the /17-and-0/ prefix, and keeps existing files
 * untouched (they are already patched; assets that already exist are never
 * overwritten). Run from the repository root; safe to run repeatedly.
 */
const fs = require('fs');
const path = require('path');

const ORIGIN = 'https://www.firstdown.studio';
const BASE = '/17-and-0';
const ROOT = process.cwd();
const UA = { headers: { 'user-agent': 'Mozilla/5.0 (static mirror)' } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROUTES = [
  '/build-a-82-0-team',
  '/build-a-82-0-team/results',
  '/build-a-162-0-team',
  '/build-a-162-0-team/results',
  '/build-the-goat-team',
  '/build-the-goat-team/results',
];

// Server data the games fetch at runtime; rewritten to local files they can read offline.
const API_MAP = [
  ['/api/pools/nfl-current/18da6d398f030dbd', BASE + '/data/nfl-current.txt'],
  ['/api/build-the-goat-team/eras-players', BASE + '/data/eras-players.txt'],
  ['/api/build-the-goat-team/pools/current', BASE + '/data/pools-current.json'],
  ['/api/build-the-goat-team/daily/bootstrap', BASE + '/data/daily-bootstrap.json'],
  ['/api/pools/mlb-current/27a322d962671c79', BASE + '/data/mlb-current.txt'],
  ['/api/build-a-162-0-team/all-time/cells/v2', BASE + '/data/mlb-alltime-cells.json'],
  ['/api/daily-challenge/mlb-alltime/hub', BASE + '/data/mlb-daily-hub.json'],
];

const ROUTE_NAMES = ['build-a-17-0-team', 'build-a-82-0-team', 'build-a-162-0-team', 'build-the-goat-team'];
// Route URLs start a string/attribute; /_next/static/chunks/app/build-.../ paths must not match.
const ROUTE_RE = new RegExp('(["\'`(])\\/((?:' + ROUTE_NAMES.join('|') + '))(?=[/"\'`]|$)', 'g');
const PUBLIC = new Set();
const downloaded = [];

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

function local(rel) {
  return path.join(ROOT, rel.replace(/^\//, ''));
}

async function get(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(ORIGIN + url, UA);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      last = e;
      await sleep(400 * (i + 1));
    }
  }
  console.log('FAIL', url, String(last && last.message));
  return null;
}

async function mirrorAsset(p) {
  if (!p || !p.startsWith('/') || p.startsWith('//')) return;
  const clean = p.replace(/\\+$/, '').split('?')[0].split('#')[0];
  if (!clean || clean === '/') return;
  const dest = local(clean);
  if (fs.existsSync(dest)) return;
  const buf = await get(clean);
  if (!buf) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  downloaded.push(clean);
}

function scanAssets(text, fromHtml) {
  const norm = text.replace(/\\\//g, '/');
  const found = new Set();
  for (const m of norm.matchAll(/\/(?:_next\/static|site-icons|images|icons|assets|fonts)\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+/g)) {
    const p = m[0].replace(/\\+$/, '').split('?')[0].split('#')[0];
    if (p && p.length <= 400) found.add(p);
  }
  if (fromHtml) {
    for (const m of norm.matchAll(/["'`(](\/[A-Za-z0-9._-]+\.(?:png|jpe?g|webp|svg|ico|woff2?|ttf))/g)) {
      const p = m[1].split('?')[0];
      if (/^\/(?!api\/|build-|_next\/|site-icons\/|images\/|icons\/|assets\/|fonts\/)/.test(p)) {
        PUBLIC.add(p);
        found.add(p);
      }
    }
  }
  return found;
}

async function mirrorRoute(route) {
  const buf = await get(route);
  if (!buf) throw new Error('route failed: ' + route);
  const rel = route.replace(/^\//, '');
  const dest = path.join(ROOT, rel, 'index.html');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  console.log('page  ' + rel + '/index.html ' + buf.length);

  const queue = [...scanAssets(buf.toString('utf8'), true)];
  while (queue.length) {
    const p = queue.shift();
    await mirrorAsset(p);
    const f = local(p);
    if (!fs.existsSync(f) || !/\.(js|css)$/.test(f)) continue;
    for (const extra of scanAssets(fs.readFileSync(f, 'utf8'), false)) {
      if (!fs.existsSync(local(extra))) queue.push(extra);
    }
  }
}

(async () => {
  for (const route of ROUTES) await mirrorRoute(route);

  // CSS-referenced media (fonts, images).
  for (const f of walk(ROOT)) {
    if (!f.endsWith('.css')) continue;
    const css = fs.readFileSync(f, 'utf8');
    for (const m of css.matchAll(/url\((?:["'])?(\/[^"')]+)(?:["'])?\)/g)) {
      const p = m[1].split('?')[0];
      if (!fs.existsSync(local(p))) await mirrorAsset(p);
    }
  }

  // Every async chunk named by any webpack runtime in the tree.
  for (const f of walk(ROOT)) {
    if (!/\/_next\/static\/chunks\/webpack-[^/]+\.js$/.test(f)) continue;
    const txt = fs.readFileSync(f, 'utf8');
    for (const m of txt.matchAll(/static\/(?:chunks|css)\/[A-Za-z0-9._-]+\.(?:js|css)/g)) {
      const p = '/_next/' + m[0];
      if (!fs.existsSync(local(p))) await mirrorAsset(p);
    }
    // The runtime also maps numeric chunk ids to <id>.<hash>.js names.
    for (const m of txt.matchAll(/(?:^|[{,])(\d{1,6}):"([0-9a-f]{16})"/g)) {
      const p = '/_next/static/chunks/' + m[1] + '.' + m[2] + '.js';
      if (!fs.existsSync(local(p))) await mirrorAsset(p);
    }
  }

  // Public assets referenced from scripts/styles (logos, icons, fonts, mask images).
  for (const f of walk(ROOT)) {
    if (!/\.(js|css|html)$/.test(f)) continue;
    for (const p of scanAssets(fs.readFileSync(f, 'utf8'), true)) {
      if (!fs.existsSync(local(p))) await mirrorAsset(p);
    }
  }

  // Team logos: the games build hashed gameplay-logo URLs from these maps at runtime,
  // so mirror both the map's gameplay webp and the plain png fallback.
  const logoSets = new Set();
  for (const f of walk(ROOT)) {
    if (!f.endsWith('.js')) continue;
    const txt = fs.readFileSync(f, 'utf8');
    for (const m of txt.matchAll(/"((?:mlb|nba|nfl|wnba)-team-logos(?:-dark)?)\/(\d+)\.png":"([a-f0-9]+)"/g)) {
      const dir = m[1];
      const id = m[2];
      const hash = m[3];
      logoSets.add('/' + dir + '/' + id + '.png');
      logoSets.add('/mlb-gameplay-logos/' + dir + '/' + id + '.' + hash + '.webp');
    }
  }
  for (const p of [...logoSets]) {
    if (!fs.existsSync(local(p))) await mirrorAsset(p);
  }

  // Game data endpoints.
  for (const [url, out] of API_MAP) {
    const buf = await get(url);
    if (!buf) continue;
    const dest = path.join(ROOT, out.replace(BASE + '/', ''));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    console.log('data  ' + out.replace(BASE + '/', '') + ' ' + buf.length);
  }

  // Next.js image optimizer: return the original image path instead of /_next/image.
  for (const f of walk(ROOT)) {
    if (!f.endsWith('.js')) continue;
    let txt = fs.readFileSync(f, 'utf8');
    if (!txt.includes('r.path+"?url="+encodeURIComponent')) continue;
    const before = txt;
    txt = txt.replace(
      /return r\.path\+"\?url="\+encodeURIComponent\(i\)\+"&w="\+n\+"&q="\+l\+\(i\.startsWith\("\/_next\/static\/media\/"\)&&1\?"&dpl=[^"]*":""\)\}/,
      'return i}'
    );
    if (txt !== before) {
      fs.writeFileSync(f, txt);
      console.log('patch image loader ' + path.relative(ROOT, f));
    } else {
      console.log('WARN image loader unmatched ' + path.relative(ROOT, f));
    }
  }

  // Rewrite every HTML/JS/CSS file so all routes and assets stay under /17-and-0/.
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const publicRes = [...PUBLIC].map((p) => [p, new RegExp('(^|["\'`(\\s])' + escapeRe(p), 'g')]);
  let touched = 0;
  for (const f of walk(ROOT)) {
    if (!/\.(html|js|css)$/.test(f)) continue;
    let out = fs.readFileSync(f, 'utf8');
    const before = out;
    // Prefix asset roots without doubling an existing prefix. The marker must not
    // contain the root string itself, or a re-run would rewrite the marker too.
    const roots = [
      ['/_next/', '\u0000NEXTROOT\u0000'],
      ['/site-icons/', '\u0000ICONROOT\u0000'],
      ['/mlb-team-logos/', '\u0000MLBPNG\u0000'],
      ['/mlb-team-logos-dark/', '\u0000MLBDARK\u0000'],
      ['/mlb-team-logos-historical/', '\u0000MLBHIST\u0000'],
      ['/mlb-gameplay-logos/', '\u0000MLBGAME\u0000'],
      ['/nfl-gameplay-logos/', '\u0000NFLGAME\u0000'],
      ['/nfl-team-logos-historical/', '\u0000NFLHIST\u0000'],
    ];
    for (const [root, marker] of roots) {
      out = out.split(BASE + root).join(marker);
      out = out.split(root).join(BASE + root);
      out = out.split(marker).join(BASE + root);
    }
    for (const [from, to] of API_MAP) out = out.split(from).join(to);
    out = out.replace(ROUTE_RE, (m, lead, route) => lead + BASE + '/' + route);
    for (const [p, re] of publicRes) out = out.replace(re, (m, lead) => lead + BASE + p);
    // The First Down Studio logo and home links point at the host root; keep them in this copy.
    if (f.endsWith('.html')) out = out.split('href="/"').join('href="' + BASE + '/"');
    if (out !== before) {
      fs.writeFileSync(f, out);
      touched++;
    }
  }
  console.log('rewrote files:', touched);

  // Force real page loads between mirrored games instead of Next.js client routing
  // (a static host cannot answer the router's RSC fetches).
  const marker = 'data-17-mirror-nav';
  const inject = '<script ' + marker + '>document.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;var h=a.getAttribute("href");if(!h||h.indexOf("' + BASE + '/")!==0)return;if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||a.target==="_blank")return;e.preventDefault();e.stopPropagation();location.href=h;},true);<\/script>';
  let injected = 0;
  for (const f of walk(ROOT)) {
    if (!f.endsWith('.html')) continue;
    let html = fs.readFileSync(f, 'utf8');
    if (html.includes(marker)) continue;
    if (html.includes('</body>')) html = html.replace('</body>', inject + '</body>');
    else html += inject;
    fs.writeFileSync(f, html);
    injected++;
  }
  console.log('injected nav shim into', injected, 'pages');

  console.log('mirror complete; new files:', downloaded.length);
  if (downloaded.length) console.log(downloaded.sort().join('\n'));
})().catch((e) => {
  console.error('MIRROR FAILED', e && e.stack ? e.stack : e);
  process.exit(1);
});
