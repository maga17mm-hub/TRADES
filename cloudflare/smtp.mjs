/* SMTP over Cloudflare's native TLS sockets. Credentials never leave TLS. */
export async function sendSmtp(env, recipient, text, connectOverride) {
  const sender = env.SMTP_USER;
  const validAddress = value => typeof value === 'string' && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
  if (!validAddress(sender) || !validAddress(recipient)) throw new Error('SMTP_INVALID_ADDRESS');
  const connect = connectOverride || (await import('cloudflare:sockets')).connect;
  const socket = connect({hostname: env.SMTP_HOST, port: 465}, {secureTransport: 'on'});
  socket.closed.catch(() => {});
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = '';
  let timeout;
  async function response(allowed) {
    let multilineCode = '';
    while (true) {
      const newline = buffer.indexOf('\r\n');
      if (newline < 0) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error('SMTP_CONNECTION_CLOSED');
        buffer += decoder.decode(chunk.value, {stream: true});
        if (buffer.length > 16000) throw new Error('SMTP_RESPONSE_TOO_LONG');
        continue;
      }
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 2);
      const match = /^(\d{3})([ -])/.exec(line);
      if (!match || (multilineCode && multilineCode !== match[1])) throw new Error('SMTP_INVALID_RESPONSE');
      multilineCode = match[1];
      if (match[2] === '-') continue;
      if (!allowed.includes(Number(match[1]))) throw new Error('SMTP_REJECTED_' + match[1]);
      return;
    }
  }
  async function command(value, allowed) {
    await writer.write(encoder.encode(value + '\r\n'));
    await response(allowed);
  }
  async function exchange() {
    await socket.opened;
    await response([220]);
    await command('EHLO tradelog.local', [250]);
    await command('AUTH LOGIN', [334]);
    await command(Buffer.from(sender).toString('base64'), [334]);
    await command(Buffer.from(env.SMTP_PASSWORD).toString('base64'), [235]);
    await command('MAIL FROM:<' + sender + '>', [250]);
    await command('RCPT TO:<' + recipient + '>', [250, 251]);
    await command('DATA', [354]);
    const encodedText = Buffer.from(text).toString('base64').match(/.{1,76}/g).join('\r\n');
    const subject = Buffer.from('TradeLog — восстановление пароля').toString('base64');
    const message = ['From: TradeLog <' + sender + '>', 'To: <' + recipient + '>',
      'Subject: =?UTF-8?B?' + subject + '?=', 'Date: ' + new Date().toUTCString(),
      'Message-ID: <' + crypto.randomUUID() + '@tradelog.local>', 'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', encodedText, '.'].join('\r\n');
    await command(message, [250]);
    // Acceptance after DATA is the delivery hand-off; QUIT cannot undo it.
    await writer.write(encoder.encode('QUIT\r\n')).catch(() => {});
  }
  try {
    await Promise.race([exchange(), new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('SMTP_TIMEOUT')), 25000);
    })]);
  } finally {
    clearTimeout(timeout);
    await socket.close().catch(() => {});
  }
}
