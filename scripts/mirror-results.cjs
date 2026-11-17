/* Keep the self-hosted 17-0 copy playable end to end.
 *
 * The game finishes a draft by navigating to /build-a-17-0-team/results, and that route was never
 * mirrored, so the results screen 404'd. This fetches the route (and the chunks it needs) from the
 * origin and keeps every in-app route inside the /17-and-0/ prefix, because this copy is served
 * from a project subpath. Run from the repository root; safe to run repeatedly.
 */
const fs = require('fs');
const path = require('path');

const ORIGIN = 'https://www.firstdown.studio';
const BASE = '/17-and-0';
const ROUTE = '/build-a-17-0-team';
const API_MAP = [
  ['/api/pools/nfl-current/18da6d398f030dbd', BASE + '/data/nfl-current.txt'],
  ['/api/build-the-goat-team/eras-players', BASE + '/data/eras-players.txt'],
  ['/api/build-the-goat-team/pools/current', BASE + '/data/pools-current.json'],
  ['/api/build-the-goat-team/daily/bootstrap', BASE + '/data/daily-bootstrap.json'],
];
// Route URLs start a string or attribute; asset paths like
// /_next/static/chunks/app/build-a-17-0-team/... must keep their own layout.
const ROUTE_URL = /(["'`(])\/build-a-17-0-team/g;

const prefixRoutes = (text) => text.replace(ROUTE_URL, (m, lead) => lead + BASE + ROUTE);

function rewriteUrls(text) {
  let out = text;
  for (const [from, to] of API_MAP) out = out.split(from).join(to);
  out = out.split('/site-icons/').join(BASE + '/site-icons/');
  out = out.split('/_next/').join(BASE + '/_next/');
  return prefixRoutes(out);
}

async function get(url) {
  const res = await fetch(ORIGIN + url, { headers: { 'user-agent': 'Mozilla/5.0 (site mirror)' } });
  if (!res.ok) throw new Error(res.status + ' ' + url);
  return Buffer.from(await res.arrayBuffer());
}

function save(rel, buf) {
  const dest = path.join(ROOT, rel.replace(/^\//, ''));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const changed = !fs.existsSync(dest) || !fs.readFileSync(dest).equals(buf);
  if (changed) fs.writeFileSync(dest, buf);
  console.log((changed ? 'write ' : 'same  ') + rel + ' ' + buf.length);
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

const ROOT = process.cwd();

(async () => {
  const html = (await get(ROUTE + '/results')).toString('utf8');
  const assets = new Set();
  for (const m of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) assets.add(m[1].split('?')[0]);
  for (const rel of assets) {
    if (fs.existsSync(path.join(ROOT, rel.replace(/^\//, '')))) continue;
    const body = await get(rel);
    save(rel, Buffer.from(rewriteUrls(body.toString('utf8')), 'utf8'));
  }
  save(ROUTE + '/results/index.html', Buffer.from(rewriteUrls(html), 'utf8'));

  // The route without /results is the game itself; send it back to the page that holds it.
  const stub = '<!doctype html><meta charset="utf-8"><title>Build a 17-0 Team</title>' +
    '<link rel="canonical" href="' + BASE + '/"><meta http-equiv="refresh" content="0;url=' + BASE + '/">' +
    '<a href="' + BASE + '/">Build a 17-0 Team</a>\n';
  save(ROUTE + '/index.html', Buffer.from(stub, 'utf8'));

  let touched = 0;
  for (const file of walk(ROOT)) {
    if (!/\.(js|html)$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes(ROUTE) || text.includes(BASE + ROUTE)) continue;
    const out = prefixRoutes(text);
    if (out !== text) {
      fs.writeFileSync(file, out);
      touched++;
    }
  }
  console.log('route-prefixed files:', touched);
})().catch((e) => { console.error('mirror failed:', e.message); process.exit(1); });
