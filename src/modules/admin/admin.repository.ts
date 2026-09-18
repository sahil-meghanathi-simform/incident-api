import type { Prisma, Role, User } from '@prisma/client';
import { prisma } from '../../db/prisma';
import type { TxClient } from '../../db/transaction';
import type { AdminUsersQuery } from '../../contracts/admin.contract';

function buildUsersWhere(query: AdminUsersQuery): Prisma.UserWhereInput {
  return {
    AND: [
      ...(query.role && query.role.length > 0 ? [{ role: { in: query.role } }] : []),
      ...(query.isActive !== undefined ? [{ isActive: query.isActive }] : []),
      ...(query.q ? [{ OR: [{ email: { contains: query.q, mode: 'insensitive' as const } }, { displayName: { contains: query.q, mode: 'insensitive' as const } }] }] : []),
    ],
  };
}

export async function listUsers(query: AdminUsersQuery): Promise<{ items: User[]; totalItems: number }> {
  const where = buildUsersWhere(query);
  const [totalItems, items] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { items, totalItems };
}

export function findUserById(id: string, client: TxClient | typeof prisma = prisma): Promise<User | null> {
  return client.user.findUnique({ where: { id } });
}

export function updateUserRole(id: string, role: Role, tx: TxClient): Promise<User> {
  return tx.user.update({ where: { id }, data: { role } });
}

export function updateUserClearance(id: string, clearanceLevel: number, tx: TxClient): Promise<User> {
  return tx.user.update({ where: { id }, data: { clearanceLevel } });
}

export function updateUserStatus(id: string, isActive: boolean, tx: TxClient): Promise<User> {
  return tx.user.update({ where: { id }, data: { isActive } });
}

/**
 * build-plan.md §15.1 rule 2: "the last active admin cannot be demoted or deactivated,
 * checked inside the transaction with a locking count so two concurrent demotions
 * cannot both succeed." `FOR UPDATE` locks every currently-active-admin row for the
 * duration of the caller's transaction — a second concurrent demotion's own `FOR
 * UPDATE` blocks until the first commits, then re-reads the now-current state, so the
 * two can never both observe "2 admins" and both proceed.
 */
export async function activeAdminIdsForUpdate(tx: TxClient): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "User" WHERE role = 'ADMIN' AND "isActive" = true FOR UPDATE
  `;
  return rows.map((r) => r.id);
}
