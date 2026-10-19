import {ApiError} from './accounts.mjs';

const voice = 'Microsoft Server Speech Text to Speech Voice (ru-RU, DmitryNeural)';
const endpoint = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
// Public Edge client identifier, not a user API key.
const clientIdentifier = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const decoder = new TextDecoder();
const escapeXml = value => value.replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[character]));

export async function synthesize(text, env) {
  const signatureResponse = await env.VOICE_SIGNATURE.fetch('https://voice-signature.internal/');
  if (!signatureResponse.ok) throw new ApiError('Сервис голоса временно недоступен.', 502);
  const signature = await signatureResponse.json();
  const url = new URL(endpoint);
  url.searchParams.set('TrustedClientToken', clientIdentifier);
  url.searchParams.set('Sec-MS-GEC', signature.token);
  url.searchParams.set('Sec-MS-GEC-Version', signature.version);
  url.searchParams.set('ConnectionId', crypto.randomUUID().replace(/-/g, ''));
  const response = await fetch(url, {headers: {
    Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
    Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
    Cookie: 'muid=' + crypto.randomUUID().replace(/-/g, '').toUpperCase() + ';'
  }});
  const socket = response.webSocket;
  if (!socket) throw new ApiError('Сервис голоса Дмитрия временно недоступен.', 502);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0, complete = false;
    let messages = Promise.resolve();
    const timer = setTimeout(() => fail(), 35000);
    function fail(reason = 'connection') {
      if (complete) return;
      console.error('Speech failed:', typeof reason === 'string' ? reason : 'socket-error');
      complete = true; clearTimeout(timer); socket.close();
      reject(new ApiError('Дмитрий не вернул аудио. Попробуйте ещё раз.', 502));
    }
    socket.addEventListener('error', fail);
    socket.addEventListener('close', event => {
      messages.then(() => {
        if (!complete) { console.error('Speech connection closed before audio completed:', event.code); fail(); }
      });
    });
    socket.addEventListener('message', event => {
      // Workers may deliver binary frames as Blobs. Preserve ordering while decoding
      // them so turn.end cannot finish the response before the last audio frame.
      messages = messages.then(async () => {
      if (complete) return;
      if (typeof event.data === 'string') {
        if (/(?:^|\r\n)Path:turn.end(?:\r\n|$)/i.test(event.data)) {
          if (!length) return fail('empty-audio');
          complete = true; clearTimeout(timer); socket.close();
          const result = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
          resolve(result);
        }
        return;
      }
      const bytes = new Uint8Array(event.data instanceof Blob ? await event.data.arrayBuffer() : event.data);
      if (bytes.length < 2) return fail('binary-type-' + Object.prototype.toString.call(event.data));
      const headerLength = (bytes[0] << 8) | bytes[1];
      if (headerLength + 2 > bytes.length) return fail('invalid-header-length');
      const headers = decoder.decode(bytes.subarray(2, headerLength + 2));
      if (/(?:^|\r\n)Path:\s*audio(?:\r\n|$)/i.test(headers) && /Content-Type:\s*audio\/mpeg/i.test(headers)) {
        const chunk = bytes.slice(headerLength + 2);
        chunks.push(chunk); length += chunk.length;
      }
      }).catch(() => fail('invalid-message'));
    });
    socket.accept();
    const now = new Date();
    const timestamp = now.toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) (.*) GMT$/, '$1 $3 $2 $4 $5 GMT+0000 (Coordinated Universal Time)');
    socket.send('X-Timestamp:' + timestamp + '\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n' +
      JSON.stringify({context: {synthesis: {audio: {metadataoptions: {sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'true'}, outputFormat: 'audio-24khz-48kbitrate-mono-mp3'}}}}) + '\r\n');
    const ssml = '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="' + voice + '"><prosody pitch="+0Hz" rate="+0%" volume="+0%">' + escapeXml(text) + '</prosody></voice></speak>';
    socket.send('X-RequestId:' + crypto.randomUUID().replace(/-/g, '') + '\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:' + timestamp + 'Z\r\nPath:ssml\r\n\r\n' + ssml);
  });
}
