import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class AppDatabase {
  public readonly connection: DatabaseSync;

  public constructor(databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.connection = new DatabaseSync(databasePath);
    this.connection.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS repositories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS operations (
        id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        target_json TEXT NOT NULL,
        preflight_json TEXT,
        result_json TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation_id TEXT,
        repository_id TEXT,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target_json TEXT NOT NULL,
        result TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    try {
      this.connection.exec('ALTER TABLE operations ADD COLUMN progress_json TEXT');
    } catch {
      // 已有数据库完成过该迁移时，SQLite 会报告重复列，继续使用现有列。
    }
  }

  public close(): void {
    this.connection.close();
  }
}
