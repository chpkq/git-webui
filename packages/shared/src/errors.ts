import { z } from 'zod';

export const errorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'NOT_FOUND',
  'REPOSITORY_NOT_ALLOWED',
  'REPOSITORY_NOT_FOUND',
  'REPOSITORY_NOT_GIT',
  'REPOSITORY_CHANGED',
  'INVALID_REF',
  'INVALID_REMOTE',
  'INVALID_BRANCH',
  'INVALID_PATH',
  'PERMISSION_DENIED',
  'CSRF_REQUIRED',
  'RATE_LIMITED',
  'OPERATION_BUSY',
  'DIRTY_WORKTREE',
  'NO_UPSTREAM',
  'NON_FAST_FORWARD',
  'CONFLICT',
  'AUTH_REQUIRED',
  'HOST_KEY_REQUIRED',
  'GIT_IN_PROGRESS',
  'COMMAND_TIMEOUT',
  'OUTPUT_LIMIT_EXCEEDED',
  'GIT_COMMAND_FAILED',
  'INTERNAL_ERROR',
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string().optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export class GitWebUiError extends Error {
  public readonly code: ErrorCode;

  public readonly details: Record<string, unknown> | undefined;

  public constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'GitWebUiError';
    this.code = code;
    this.details = details;
  }
}
