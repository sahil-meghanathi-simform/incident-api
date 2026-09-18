import type { User } from '@prisma/client';
import type { AdminUserRow } from '../../contracts/admin.contract';

export function toAdminUserRow(user: User): AdminUserRow {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    clearanceLevel: user.clearanceLevel,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
  };
}
