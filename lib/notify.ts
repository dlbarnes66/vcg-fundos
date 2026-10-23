// Transactional email through Resend. If RESEND_API_KEY / MAIL_FROM aren't set, nothing is sent
// and the app carries on — notifications are a convenience, never a step anything depends on.
import { appUrl } from '@/lib/invite';

export const emailReady = () => Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export async function sendEmail(opts: { to: string[]; subject: string; heading: string; lines: string[]; button?: { label: string; path: string } }) {
  const to = [...new Set(opts.to.filter(Boolean))];
  if (!emailReady() || to.length === 0) return false;
  const base = await appUrl();
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;color:#14213d">
  <h2 style="margin:0 0 12px">${esc(opts.heading)}</h2>
  ${opts.lines.map((l) => `<p style="margin:0 0 10px">${esc(l)}</p>`).join('')}
  ${opts.button ? `<p><a href="${esc(base + opts.button.path)}" style="display:inline-block;background:#14213d;color:#fff;padding:10px 18px;border-radius:7px;text-decoration:none;font-weight:600">${esc(opts.button.label)}</a></p>` : ''}
  <p style="color:#5b6475;font-size:12px;margin-top:20px">Sent by VCG FundOS. For security, we never send wiring instructions by email.</p>
</div>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      // Each recipient gets their own copy so staff/investor addresses aren't exposed to each other.
      body: JSON.stringify(to.length === 1
        ? { from: process.env.MAIL_FROM, to, subject: opts.subject, html }
        : { from: process.env.MAIL_FROM, to: [process.env.MAIL_FROM], bcc: to, subject: opts.subject, html }),
      cache: 'no-store',
    });
    if (!res.ok) console.error('[notify] Resend error', res.status, await res.text().catch(() => ''));
    return res.ok;
  } catch (e) {
    console.error('[notify] send failed', e);
    return false;
  }
}
