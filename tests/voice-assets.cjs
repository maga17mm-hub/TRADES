const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {gunzipSync} = require('node:zlib');
const {createHash} = require('node:crypto');
const root = path.resolve(__dirname, '../js/vendor/piper');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
const hash = data => createHash('sha256').update(data).digest('hex');
for (const [name, file] of Object.entries(manifest.files)) {
  const bytes = fs.readFileSync(path.join(root, name));
  assert.equal(bytes.length, file.size, name);
  assert.ok(bytes.length < 25 * 1024 * 1024, 'Cloudflare asset limit: ' + name);
  assert.equal(hash(bytes), file.sha256, name);
  if (name.endsWith('.wasm.gz')) assert.deepEqual([...gunzipSync(bytes).subarray(0, 4)], [0, 97, 115, 109]);
}
assert.equal(hash(gunzipSync(Buffer.concat(manifest.model.parts.map(name => fs.readFileSync(path.join(root, name)))))), manifest.model.rawSha256);
console.log('PASS: voice checksums, WASM binaries, complete ONNX model and hosting size limits');
