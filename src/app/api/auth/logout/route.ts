import { destroySession } from '@/lib/auth';
import { ok, handleRouteError } from '@/lib/api';

export const runtime = 'nodejs';

export async function POST() {
  try {
    await destroySession();
    return ok({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
