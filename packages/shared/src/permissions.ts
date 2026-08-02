import { z } from 'zod';

export const userRoleSchema = z.enum(['viewer', 'editor', 'admin']);
export type UserRole = z.infer<typeof userRoleSchema>;

export const writePermissionSchema = z.enum(['editor', 'admin']);
