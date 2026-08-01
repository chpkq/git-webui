import { randomUUID } from 'node:crypto';
import { GitWebUiError, type Repository } from '@git-webui/shared';
import type { AppDatabase } from './database.js';

interface RepositoryRow {
  id: string;
  name: string;
  path: string;
  created_at: string;
  updated_at: string;
}

const toRepository = (row: RepositoryRow): Repository => ({
  id: row.id,
  name: row.name,
  path: row.path,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class RepositoryStore {
  public constructor(private readonly database: AppDatabase) {}

  public list(): Repository[] {
    const rows = this.database.connection
      .prepare('SELECT id, name, path, created_at, updated_at FROM repositories ORDER BY name, id')
      .all() as unknown as RepositoryRow[];
    return rows.map(toRepository);
  }

  public getById(id: string): Repository | null {
    const row = this.database.connection
      .prepare('SELECT id, name, path, created_at, updated_at FROM repositories WHERE id = ?')
      .get(id) as unknown as RepositoryRow | undefined;
    return row === undefined ? null : toRepository(row);
  }

  public getByPath(repositoryPath: string): Repository | null {
    const row = this.database.connection
      .prepare('SELECT id, name, path, created_at, updated_at FROM repositories WHERE path = ?')
      .get(repositoryPath) as unknown as RepositoryRow | undefined;
    return row === undefined ? null : toRepository(row);
  }

  public create(repository: Pick<Repository, 'name' | 'path'>): Repository {
    const now = new Date().toISOString();
    const result: Repository = {
      id: randomUUID(),
      name: repository.name,
      path: repository.path,
      createdAt: now,
      updatedAt: now,
    };
    try {
      this.database.connection
        .prepare(
          'INSERT INTO repositories (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(result.id, result.name, result.path, result.createdAt, result.updatedAt);
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        throw new GitWebUiError('INVALID_REQUEST', '该 Git 仓库已经注册。');
      }
      throw error;
    }
    return result;
  }

  public remove(id: string): boolean {
    const result = this.database.connection
      .prepare('DELETE FROM repositories WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }
}
