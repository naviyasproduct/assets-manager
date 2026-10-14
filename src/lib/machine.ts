import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { NotFoundError, fail } from '@/lib/api';
import { canAccessDepartment, type SessionUser } from '@/lib/auth';

/**
 * The department check every machine route makes. A machine in a department
 * this person cannot see is "not found", like an order, so a guessed id
 * learns nothing.
 */
export async function loadMachineFacts(id: string, user: SessionUser) {
  const machine = await prisma.machine.findUnique({
    where: { id },
    select: { id: true, departmentId: true },
  });
  if (!machine || !canAccessDepartment(user, machine.departmentId)) {
    throw new NotFoundError('Machine not found.');
  }
  return machine;
}

/** The one unique field on a machine is its number; say so in words, on that field. */
export function duplicateNumberResponse(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return fail('Another machine already has that number.', 409, { code: 'Already used by another machine.' });
  }
  return null;
}

/** A fix, checked to belong to the machine in the URL and to be reachable. */
export async function loadFixFacts(machineId: string, fixId: string, user: SessionUser) {
  await loadMachineFacts(machineId, user);
  const fix = await prisma.machineFix.findUnique({
    where: { id: fixId },
    select: { id: true, machineId: true, version: true },
  });
  if (!fix || fix.machineId !== machineId) throw new NotFoundError('Repair not found.');
  return fix;
}
