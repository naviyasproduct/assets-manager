import 'server-only';
import { notFound } from 'next/navigation';
import { NotFoundError } from '@/lib/api';

/** An order the API would call "not found" is a 404 page here, too. */
export async function pageOrder<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
