// Genera la versión de la app (hora de Madrid). Ejecutar antes de cada publicación:
//   node tools/version.mjs
// Así, al abrir Ajustes, la app ve que hay una versión nueva y ofrece actualizar.
import fs from 'fs';

const v = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' }).slice(0, 16);
const FILES = ['./', 'index.html', 'logic.js', 'store.js', 'app.js', 'version.js', 'manifest.webmanifest',
  'favicon.png', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable.png'];

fs.writeFileSync(new URL('../version.json', import.meta.url), JSON.stringify({ v }) + '\n');
fs.writeFileSync(new URL('../version.js', import.meta.url),
  `window.APP_VERSION = "${v}";\nwindow.APP_FILES = ${JSON.stringify(FILES)};\n`);
console.log('versión', v);
