import 'server-only';
import nodemailer from 'nodemailer';
import { config } from '@/lib/config';

/**
 * The one way this app sends email. Without SMTP_HOST it sends nothing and
 * says so in the server log - mail is an extra, never something a save waits
 * on or fails over.
 */

let transport: nodemailer.Transporter | null = null;

/** A host, and a password whenever there is an account to sign in as. */
export function mailIsConfigured(): boolean {
  return Boolean(config.mail.host) && (!config.mail.user || Boolean(config.mail.password));
}

export async function sendMail(to: string[], subject: string, text: string): Promise<boolean> {
  if (!mailIsConfigured()) {
    console.info(`[mail] SMTP is not set up (host or password missing); not sending "${subject}"`);
    return false;
  }
  if (to.length === 0) {
    console.info(`[mail] nobody to send "${subject}" to`);
    return false;
  }
  try {
    transport ??= nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.port === 465,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.password } : undefined,
    });
    await transport.sendMail({
      from: config.mail.from || config.mail.user,
      to: to.join(', '),
      subject,
      text,
    });
    return true;
  } catch (error) {
    console.error(`[mail] could not send "${subject}"`, error);
    return false;
  }
}
