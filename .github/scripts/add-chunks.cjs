const fs = require('fs');
const path = require('path');

const CH = path.join(process.cwd(), '_next/static/chunks');
const wpFile = fs.readdirSync(CH).find(f => /^webpack-.*\.js$/.test(f));
const wp = fs.readFileSync(path.join(CH, wpFile), 'utf8');

const ids = new Map();
for (const m of wp.matchAll(/(?:^|[,{])(\d{2,7}):"([0-9a-f]{16})"/g)) ids.set(m[1], m[2]);
console.log('map entries:', ids.size);

(async () => {
  let added = 0;
  for (const [id, hash] of ids) {
    for (const name of [id + '.' + hash + '.js', id + '-' + hash + '.js']) {
      const dest = path.join(CH, name);
      if (fs.existsSync(dest)) break;
      const res = await fetch('https://www.firstdown.studio/_next/static/chunks/' + name + '?dpl=dpl_7GtmdAVAMhqvomoUsAcwyR6Gdjij');
      if (!res.ok) continue;
      let txt = Buffer.from(await res.arrayBuffer()).toString('utf8');
      txt = txt.split('/_next/').join('/17-and-0/_next/').split('/site-icons/').join('/17-and-0/site-icons/');
      fs.writeFileSync(dest, txt);
      added++;
      break;
    }
  }
  console.log('added chunks:', added);
})();
