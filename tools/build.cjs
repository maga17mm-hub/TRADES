const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'dist');
fs.mkdirSync(target, {recursive: true});
for (const asset of ['index.html', 'manifest.json', 'sw.js', 'css', 'js', 'icons']) {
  fs.cpSync(path.join(root, asset), path.join(target, asset), {recursive: true});
}
console.log('Built public assets; server code and secrets are excluded.');
