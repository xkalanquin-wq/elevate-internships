// Outbound email.
//
// A web app cannot send mail on its own — it needs a provider. This supports
// Resend (simplest to set up) and any SMTP host, and when neither is
// configured it writes the message to the server console instead.
//
// The console fallback is deliberate and loud: it is genuinely useful in
// development, and it never pretends a message was delivered when it was not.

import net from 'node:net';
import tls from 'node:tls';
import { recordSource } from './sourcehealth.js';
import { take } from './limits.js';

export function emailProvider() {
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.SMTP_HOST) return 'smtp';
  return 'console';
}

export const emailConfigured = () => emailProvider() !== 'console';

const FROM = () => process.env.MAIL_FROM || 'Elevate Internships <onboarding@resend.dev>';

// ---- Resend ----------------------------------------------------------------

async function sendViaResend({ to, subject, text, html, headers }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ from: FROM(), to: [to], subject, text, html, ...(headers ? { headers } : {}) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend returned ${res.status}: ${body.slice(0, 200)}`);
  }
  return { provider: 'resend', id: (await res.json()).id };
}

// ---- SMTP ------------------------------------------------------------------
//
// A deliberately small SMTP client: connect, AUTH LOGIN, send, quit. Enough for
// transactional mail without pulling in a dependency, and it fails loudly
// rather than silently dropping a message.

function smtpConverse(socket, steps) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let i = 0;
    const timer = setTimeout(() => reject(new Error('SMTP timed out')), 20_000);

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (!buffer.endsWith('\n')) return;

      const line = buffer.trim();
      buffer = '';
      const code = Number(line.slice(0, 3));

      if (code >= 400) {
        clearTimeout(timer);
        socket.end();
        return reject(new Error(`SMTP error: ${line.slice(0, 160)}`));
      }
      if (i >= steps.length) {
        clearTimeout(timer);
        socket.end();
        return resolve();
      }
      socket.write(`${steps[i++]}\r\n`);
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function sendViaSmtp({ to, subject, text }) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;

  const socket = secure
    ? tls.connect({ host, port, servername: host })
    : net.connect({ host, port });

  const body = [
    `From: ${FROM()}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    text,
    '.',
  ].join('\r\n');

  const steps = [
    `EHLO ${host}`,
    ...(user && pass
      ? ['AUTH LOGIN', Buffer.from(user).toString('base64'), Buffer.from(pass).toString('base64')]
      : []),
    `MAIL FROM:<${FROM().replace(/.*<|>.*/g, '')}>`,
    `RCPT TO:<${to}>`,
    'DATA',
    body,
    'QUIT',
  ];

  await smtpConverse(socket, steps);
  return { provider: 'smtp' };
}

// ---- Public ----------------------------------------------------------------

/**
 * Sends a message, or prints it when nothing is configured.
 * Returns { provider, delivered } so callers can tell the person the truth
 * about what actually happened.
 */
export async function sendMail({ to, subject, text, html, headers, bulk = false }) {
  const provider = emailProvider();

  // Stay inside the provider's daily allowance. Bulk mail (reminders, the
  // weekly email) stops earlier, so password resets always get through.
  if (provider !== 'console' && !take('email', { bulk })) {
    console.warn(`[email] not sent: today's ${bulk ? 'bulk ' : ''}email cap is reached (${subject.slice(0, 60)})`);
    return { provider, delivered: false, error: 'daily email limit reached' };
  }

  if (provider === 'console') {
    console.log(
      [
        '',
        '─'.repeat(72),
        '  NO EMAIL PROVIDER CONFIGURED — message not sent, printed instead.',
        `  To:      ${to}`,
        `  Subject: ${subject}`,
        '',
        text.split('\n').map((l) => `  ${l}`).join('\n'),
        '',
        '  Set RESEND_API_KEY or SMTP_HOST in .env to deliver this for real.',
        '─'.repeat(72),
        '',
      ].join('\n'),
    );
    return { provider: 'console', delivered: false };
  }

  try {
    const result = provider === 'resend' ? await sendViaResend({ to, subject, text, html, headers }) : await sendViaSmtp({ to, subject, text });
    recordSource('Email', true);
    return { ...result, delivered: true };
  } catch (err) {
    console.error(`[email] send failed via ${provider}: ${err.message}`);
    recordSource('Email', false, err.message);
    return { provider, delivered: false, error: err.message };
  }
}
