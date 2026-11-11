// Prepara una publicación: sube en uno el número de la caché del service worker y el ?v= de los scripts,
// y actualiza version.json / version.js. Uso: node tools/release.mjs
import fs from 'fs';
import { execFileSync } from 'child_process';

const root = new URL('../', import.meta.url);
const read = f => fs.readFileSync(new URL(f, root), 'utf8');
const write = (f, s) => fs.writeFileSync(new URL(f, root), s);

let sw = read('sw.js');
const m = sw.match(/betting-v(\d+)/);
if (!m) throw new Error('No encuentro la versión de la caché en sw.js');
const next = +m[1] + 1;
write('sw.js', sw.replace(/betting-v\d+/, 'betting-v' + next));

let html = read('index.html');
const before = (html.match(/\?v=\d+/g) || []).length;
html = html.replace(/\?v=\d+"/g, `?v=${next}"`);
write('index.html', html);

execFileSync('node', ['tools/version.mjs'], { cwd: new URL('./', root), stdio: 'inherit' });
console.log(`caché betting-v${next} · ${before} scripts con ?v=${next}`);
