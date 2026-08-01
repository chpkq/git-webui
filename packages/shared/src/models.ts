import { z } from 'zod';

export const repositorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  path: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Repository = z.infer<typeof repositorySchema>;

export const fileStatusSchema = z.object({
  path: z.string(),
  kind: z.enum(['ordinary', 'rename', 'copy', 'untracked', 'conflict', 'ignored']),
  indexStatus: z.string(),
  worktreeStatus: z.string(),
  staged: z.boolean(),
  unstaged: z.boolean(),
  renameFrom: z.string().optional(),
});
export type FileStatus = z.infer<typeof fileStatusSchema>;

export const repositoryStatusSchema = z.object({
  head: z.string().nullable(),
  branch: z.string().nullable(),
  upstream: z.string().nullable(),
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
  dirty: z.boolean(),
  entries: z.array(fileStatusSchema),
  inProgress: z.array(z.enum(['merge', 'rebase', 'cherry-pick', 'revert', 'bisect'])),
});
export type RepositoryStatus = z.infer<typeof repositoryStatusSchema>;

export const branchSchema = z.object({
  name: z.string(),
  objectId: z.string(),
  upstream: z.string().nullable(),
  tracking: z.string().nullable(),
  worktreePath: z.string().nullable(),
  current: z.boolean(),
});
export type Branch = z.infer<typeof branchSchema>;

export const remoteSchema = z.object({
  name: z.string(),
  fetchUrl: z.string().nullable(),
  pushUrl: z.string().nullable(),
});
export type Remote = z.infer<typeof remoteSchema>;

export const remoteBranchSchema = z.object({
  name: z.string(),
  remote: z.string(),
  branch: z.string(),
  objectId: z.string(),
});
export type RemoteBranch = z.infer<typeof remoteBranchSchema>;

export const tagSchema = z.object({
  name: z.string(),
  objectId: z.string(),
  createdAt: z.string().nullable(),
});
export type Tag = z.infer<typeof tagSchema>;

export const submoduleSchema = z.object({
  name: z.string(),
  path: z.string(),
  url: z.string().nullable(),
});
export type Submodule = z.infer<typeof submoduleSchema>;

export const worktreeSchema = z.object({
  path: z.string(),
  head: z.string().nullable(),
  branch: z.string().nullable(),
  bare: z.boolean(),
  detached: z.boolean(),
});
export type Worktree = z.infer<typeof worktreeSchema>;

export const locationsSchema = z.object({
  branches: z.array(branchSchema),
  remotes: z.array(remoteSchema),
  remoteBranches: z.array(remoteBranchSchema),
  tags: z.array(tagSchema),
  submodules: z.array(submoduleSchema),
  worktrees: z.array(worktreeSchema),
});
export type Locations = z.infer<typeof locationsSchema>;

export const commitSummarySchema = z.object({
  hash: z.string(),
  parents: z.array(z.string()),
  authorName: z.string(),
  authorEmail: z.string(),
  authoredAt: z.string(),
  subject: z.string(),
  decorations: z.array(z.string()),
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable(),
  changedFiles: z.number().int().nonnegative().nullable(),
});
export type CommitSummary = z.infer<typeof commitSummarySchema>;

export const commitPageSchema = z.object({
  items: z.array(commitSummarySchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type CommitPage = z.infer<typeof commitPageSchema>;

export const changedFileSchema = z.object({
  path: z.string(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed', 'copied', 'unmerged', 'unknown']),
  oldPath: z.string().optional(),
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable(),
  binary: z.boolean(),
});
export type ChangedFile = z.infer<typeof changedFileSchema>;

export const commitDetailSchema = z.object({
  commit: commitSummarySchema,
  body: z.string(),
  changedFiles: z.array(changedFileSchema),
});
export type CommitDetail = z.infer<typeof commitDetailSchema>;

export const diffResultSchema = z.object({
  path: z.string(),
  kind: z.enum(['working', 'staged', 'commit', 'compare']),
  content: z.string(),
  binary: z.boolean(),
  lfsPointer: z.boolean(),
  truncated: z.boolean(),
  oversize: z.boolean(),
  bytes: z.number().int().nonnegative(),
  lines: z.number().int().nonnegative(),
});
export type DiffResult = z.infer<typeof diffResultSchema>;

export const operationStatusSchema = z.enum([
  'queued',
  'running',
  'success',
  'failed',
  'conflict',
  'cancelled',
]);
export type OperationStatus = z.infer<typeof operationStatusSchema>;

export const operationTypeSchema = z.enum([
  'stage',
  'unstage',
  'fetch',
  'pull',
  'push',
  'remote-add',
  'remote-set-url',
  'remote-remove',
  'branch-create',
  'branch-switch',
  'branch-rename',
  'branch-delete',
  'branch-set-upstream',
]);
export type OperationType = z.infer<typeof operationTypeSchema>;

export const preflightSnapshotSchema = z.object({
  head: z.string().nullable(),
  branch: z.string().nullable(),
  upstream: z.string().nullable(),
  dirty: z.boolean(),
  inProgress: z.array(z.string()),
});
export type PreflightSnapshot = z.infer<typeof preflightSnapshotSchema>;

export const operationSchema = z.object({
  id: z.string().uuid(),
  repositoryId: z.string().uuid(),
  type: operationTypeSchema,
  status: operationStatusSchema,
  target: z.record(z.string(), z.unknown()),
  preflight: preflightSnapshotSchema.nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
});
export type Operation = z.infer<typeof operationSchema>;
