import {
  GitWebUiError,
  type Operation,
  type OperationProgress,
  type OperationStatus,
  type OperationType,
  type PreflightSnapshot,
} from '@git-webui/shared';
import type { AppDatabase } from './database.js';

interface OperationRow {
  id: string;
  repository_id: string;
  type: OperationType;
  status: OperationStatus;
  target_json: string;
  preflight_json: string | null;
  result_json: string | null;
  error_json: string | null;
  progress_json: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

const parseObject = <T>(value: string | null): T | null =>
  value === null ? null : (JSON.parse(value) as T);

const toOperation = (row: OperationRow): Operation => ({
  id: row.id,
  repositoryId: row.repository_id,
  type: row.type,
  status: row.status,
  target: JSON.parse(row.target_json) as Record<string, unknown>,
  preflight: parseObject<PreflightSnapshot>(row.preflight_json),
  result: parseObject<Record<string, unknown>>(row.result_json),
  error: parseObject<{ code: string; message: string }>(row.error_json),
  progress: parseObject<OperationProgress>(row.progress_json),
  createdAt: row.created_at,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
});

export class OperationStore {
  public constructor(private readonly database: AppDatabase) {}

  public create(input: {
    id: string;
    repositoryId: string;
    type: OperationType;
    target: Record<string, unknown>;
  }): Operation {
    const createdAt = new Date().toISOString();
    this.database.connection
      .prepare(
        'INSERT INTO operations (id, repository_id, type, status, target_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        input.id,
        input.repositoryId,
        input.type,
        'queued',
        JSON.stringify(input.target),
        createdAt,
      );
    return this.get(input.id);
  }

  public get(id: string): Operation {
    const row = this.database.connection
      .prepare('SELECT * FROM operations WHERE id = ?')
      .get(id) as unknown as OperationRow | undefined;
    if (row === undefined) throw new GitWebUiError('NOT_FOUND', '操作记录不存在。');
    return toOperation(row);
  }

  public list(repositoryId?: string): Operation[] {
    const statement =
      repositoryId === undefined
        ? this.database.connection.prepare(
            'SELECT * FROM operations ORDER BY created_at DESC LIMIT 100',
          )
        : this.database.connection.prepare(
            'SELECT * FROM operations WHERE repository_id = ? ORDER BY created_at DESC LIMIT 100',
          );
    const rows = (repositoryId === undefined
      ? statement.all()
      : statement.all(repositoryId)) as unknown as OperationRow[];
    return rows.map(toOperation);
  }

  public setPreflight(id: string, preflight: PreflightSnapshot): Operation {
    this.database.connection
      .prepare('UPDATE operations SET preflight_json = ? WHERE id = ?')
      .run(JSON.stringify(preflight), id);
    return this.get(id);
  }

  public setRunning(id: string): Operation {
    this.database.connection
      .prepare('UPDATE operations SET status = ?, started_at = ? WHERE id = ?')
      .run('running', new Date().toISOString(), id);
    return this.get(id);
  }

  public setFinished(
    id: string,
    status: Extract<OperationStatus, 'success' | 'failed' | 'conflict' | 'cancelled'>,
    result?: Record<string, unknown>,
    error?: { code: string; message: string },
  ): Operation {
    this.database.connection
      .prepare(
        'UPDATE operations SET status = ?, result_json = ?, error_json = ?, finished_at = ? WHERE id = ?',
      )
      .run(
        status,
        result === undefined ? null : JSON.stringify(result),
        error === undefined ? null : JSON.stringify(error),
        new Date().toISOString(),
        id,
      );
    return this.get(id);
  }

  public setProgress(id: string, progress: OperationProgress): Operation {
    this.database.connection
      .prepare('UPDATE operations SET progress_json = ? WHERE id = ?')
      .run(JSON.stringify(progress), id);
    return this.get(id);
  }

  public appendAudit(input: {
    operationId: string;
    repositoryId: string;
    actor: string;
    action: string;
    target: Record<string, unknown>;
    result: string;
  }): void {
    this.database.connection
      .prepare(
        'INSERT INTO audit_logs (operation_id, repository_id, actor, action, target_json, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        input.operationId,
        input.repositoryId,
        input.actor,
        input.action,
        JSON.stringify(input.target),
        input.result,
        new Date().toISOString(),
      );
  }
}
