/**
 * Sends one test email with the SMTP settings in .env, to whoever low-stock
 * alerts go to (STOCK_ALERT_TO, else every active administrator).
 *
 *   npm run test-mail
 *
 * tsx does not load .env the way Next does, so the SMTP lines are read here.
 */
import fs from 'node:fs';
import nodemailer from 'nodemailer';
import { PrismaClient } from '@prisma/client';

function env(name: string): string {
  if (process.env[name]) return process.env[name]!.trim();
  if (!fs.existsSync('.env')) return '';
  const line = fs
    .readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : '';
}

async function main() {
  const host = env('SMTP_HOST');
  const port = Number(env('SMTP_PORT') || '587');
  const user = env('SMTP_USER');
  const pass = env('SMTP_PASSWORD');
  if (!host) throw new Error('SMTP_HOST is empty in .env - nothing to test.');
  if (user && !pass) throw new Error('SMTP_PASSWORD is empty in .env.');

  let to = env('STOCK_ALERT_TO').split(',').map((a) => a.trim()).filter(Boolean);
  if (to.length === 0) {
    const prisma = new PrismaClient();
    to = (await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { email: true } })).map(
      (u) => u.email,
    );
    await prisma.$disconnect();
  }
  if (to.length === 0) throw new Error('Nobody to send to: set STOCK_ALERT_TO or make sure an administrator is active.');

  const transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: user ? { user, pass } : undefined });
  await transport.verify();
  await transport.sendMail({
    from: env('SMTP_FROM') || user,
    to: to.join(', '),
    subject: 'Asset Manager: test email',
    text: 'Email is working. Low-stock alerts from the Stock page will arrive here.',
  });
  console.log(`Sent a test email to ${to.join(', ')}.`);
}

main().catch((error) => {
  console.error(`Not sent: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
