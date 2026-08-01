import { z } from 'zod';

export const registerRepositoryInputSchema = z.object({
  path: z.string().min(1).max(4096),
  name: z.string().trim().min(1).max(120).optional(),
});
export type RegisterRepositoryInput = z.infer<typeof registerRepositoryInputSchema>;

export const commitsQuerySchema = z.object({
  ref: z.string().min(1).max(512).default('HEAD'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type CommitsQuery = z.infer<typeof commitsQuerySchema>;

export const diffQuerySchema = z.object({
  kind: z.enum(['working', 'staged', 'commit', 'compare']),
  path: z.string().min(1).max(4096),
  ref: z.string().max(512).optional(),
  baseRef: z.string().max(512).optional(),
  maxBytes: z.coerce
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024)
    .default(2 * 1024 * 1024),
});
export type DiffQuery = z.infer<typeof diffQuerySchema>;

export const pathsMutationSchema = z.object({
  paths: z.array(z.string().min(1).max(4096)).min(1).max(500),
});
export type PathsMutation = z.infer<typeof pathsMutationSchema>;

export const operationDiffQuerySchema = diffQuerySchema;
