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

export const emptyOperationInputSchema = z.object({}).default({});

export const pushOperationInputSchema = z.object({
  remote: z.string().min(1).max(256),
  branch: z.string().min(1).max(512),
  setUpstream: z.boolean().default(false),
});
export type PushOperationInput = z.infer<typeof pushOperationInputSchema>;

export const remoteAddInputSchema = z.object({
  name: z.string().min(1).max(256),
  fetchUrl: z.string().min(1).max(4096),
  pushUrl: z.string().max(4096).optional(),
});
export type RemoteAddInput = z.infer<typeof remoteAddInputSchema>;

export const remoteSetUrlInputSchema = z.object({
  name: z.string().min(1).max(256),
  url: z.string().min(1).max(4096),
  push: z.boolean().default(false),
});
export type RemoteSetUrlInput = z.infer<typeof remoteSetUrlInputSchema>;

export const remoteRemoveInputSchema = z.object({ name: z.string().min(1).max(256) });

export const branchCreateInputSchema = z.object({
  name: z.string().min(1).max(512),
  startPoint: z.string().max(512).optional(),
});
export type BranchCreateInput = z.infer<typeof branchCreateInputSchema>;

export const branchSwitchInputSchema = z.object({ name: z.string().min(1).max(512) });
export const branchRenameInputSchema = z.object({
  oldName: z.string().min(1).max(512),
  newName: z.string().min(1).max(512),
});
export const branchDeleteInputSchema = z.object({ name: z.string().min(1).max(512) });
export const branchUpstreamInputSchema = z.object({
  localBranch: z.string().min(1).max(512),
  remote: z.string().min(1).max(256),
  remoteBranch: z.string().min(1).max(512),
});
