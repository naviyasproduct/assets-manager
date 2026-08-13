/**
 * Creates or resets an administrator account from the command line.
 *
 * The recovery path when nobody can sign in - for example if the only admin
 * password was lost. Run it on the office PC:
 *
 *   npm run create-admin -- --email boss@company.local --name "Jane" --password "a-long-password"
 *
 * If the email already exists, the account is promoted to ADMIN, reactivated,
 * and given the new password.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

async function main() {
  const email = arg('email')?.trim().toLowerCase();
  const name = arg('name')?.trim();
  const password = arg('password');

  if (!email || !name || !password) {
    console.error(
      'Usage: npm run create-admin -- --email <email> --name "<name>" --password "<password>"',
    );
    process.exit(1);
  }

  if (password.length < 10) {
    console.error('Password must be at least 10 characters.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name,
      passwordHash,
      role: 'ADMIN',
      isActive: true,
      departmentId: null,
      mustChangePassword: false,
    },
    create: {
      email,
      name,
      passwordHash,
      role: 'ADMIN',
      // Set by hand at the console, so the person running this already knows it.
      mustChangePassword: false,
    },
  });

  // Any existing sessions for this account are no longer trustworthy.
  await prisma.session.deleteMany({ where: { userId: user.id } });

  console.log(`Administrator ready: ${user.email}`);
}

main()
  .catch((error) => {
    console.error('Failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
