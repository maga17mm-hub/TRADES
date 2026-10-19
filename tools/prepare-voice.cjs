/* Reproducible browser voice assets; run explicitly when changing dependencies/model. */
const fs = require('node:fs/promises');
const path = require('node:path');
const {gzipSync} = require('node:zlib');
const {createHash} = require('node:crypto');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'js/vendor/piper');
const revision = 'c10ece1aade47bb51c153c893d14e5bf8e5b7117';
const modelBase = `https://huggingface.co/rhasspy/piper-voices/resolve/${revision}/ru/ru_RU/dmitri/medium/`;
const hash = data => createHash('sha256').update(data).digest('hex');
async function download(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(180000)});
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
async function main() {
  await fs.mkdir(target, {recursive: true});
  const manifest = {id: 'ru_RU-dmitri-medium-v1', revision, files: {}, model: {parts: []}};
  async function compressed(name, data) {
    const compressed = gzipSync(data, {level: 9});
    await fs.writeFile(path.join(target, name), compressed);
    manifest.files[name] = {size: compressed.length, sha256: hash(compressed)};
  }
  for (const name of ['piper_phonemize.data', 'piper_phonemize.wasm'])
    await compressed(name + '.gz', await fs.readFile(path.join(root, 'node_modules/@diffusionstudio/piper-wasm/build', name)));
  await compressed('ort-wasm-simd.wasm.gz', await fs.readFile(path.join(root, 'node_modules/onnxruntime-web/dist/ort-wasm-simd.wasm')));
  await fs.copyFile(path.join(root, 'node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.js'), path.join(target, 'piper_phonemize.js'));
  await fs.copyFile(path.join(root, 'node_modules/onnxruntime-web/dist/ort.wasm.min.js'), path.join(target, 'ort.wasm.min.js'));
  const model = await download(modelBase + 'ru_RU-dmitri-medium.onnx');
  manifest.model.rawSha256 = hash(model);
  const zippedModel = gzipSync(model, {level: 9});
  for (let offset = 0, index = 0; offset < zippedModel.length; offset += 18000000, index++) {
    const name = `dmitri.onnx.gz.part${index}`;
    const data = zippedModel.subarray(offset, offset + 18000000);
    await fs.writeFile(path.join(target, name), data);
    manifest.files[name] = {size: data.length, sha256: hash(data)};
    manifest.model.parts.push(name);
  }
  for (const [url, name] of [
    [modelBase + 'ru_RU-dmitri-medium.onnx.json', 'voice.json'],
    [modelBase + 'MODEL_CARD', 'MODEL_CARD.md'],
    ['https://raw.githubusercontent.com/microsoft/onnxruntime/v1.18.0/LICENSE', 'ONNX-LICENSE.txt'],
    ['https://raw.githubusercontent.com/rhasspy/piper/master/LICENSE.md', 'PIPER-LICENSE.txt'],
    ['https://raw.githubusercontent.com/espeak-ng/espeak-ng/1.51/COPYING', 'ESPEAK-LICENSE.txt']
  ]) await fs.writeFile(path.join(target, name), await download(url));
  await fs.copyFile(path.join(root, 'node_modules/@diffusionstudio/piper-wasm/README.md'), path.join(target, 'PHONEMIZER-BUILD.md'));
  await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('Prepared Dmitri voice, bytes:', Object.values(manifest.files).reduce((sum, file) => sum + file.size, 0));
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
