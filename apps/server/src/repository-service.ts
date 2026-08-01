import { basename } from 'node:path';
import {
  GitWebUiError,
  type Locations,
  type Repository,
  type RepositoryStatus,
} from '@git-webui/shared';
import type { GitProvider } from '@git-webui/git-core';
import type { RegisterRepositoryInput } from '@git-webui/shared';
import type { RepositoryStore } from './repository-store.js';

export class RepositoryService {
  public constructor(
    private readonly store: RepositoryStore,
    private readonly gitProvider: GitProvider,
  ) {}

  public list(): Repository[] {
    return this.store.list();
  }

  public async register(input: RegisterRepositoryInput): Promise<Repository> {
    const validated = await this.gitProvider.validateRepository(input.path);
    if (this.store.getByPath(validated.path) !== null) {
      throw new GitWebUiError('INVALID_REQUEST', '该 Git 仓库已经注册。');
    }
    return this.store.create({
      name: input.name ?? basename(validated.path),
      path: validated.path,
    });
  }

  public remove(id: string): void {
    if (!this.store.remove(id)) {
      throw new GitWebUiError('NOT_FOUND', '注册的仓库不存在。');
    }
  }

  public get(id: string): Repository {
    const repository = this.store.getById(id);
    if (repository === null) throw new GitWebUiError('NOT_FOUND', '注册的仓库不存在。');
    return repository;
  }

  private async validateRegistered(id: string): Promise<Repository> {
    const repository = this.get(id);
    const validated = await this.gitProvider.validateRepository(repository.path);
    if (validated.path !== repository.path) {
      throw new GitWebUiError(
        'REPOSITORY_CHANGED',
        '注册后的仓库真实路径已发生变化，请移除后重新注册。',
      );
    }
    return repository;
  }

  public async getStatus(
    id: string,
  ): Promise<{ repository: Repository; status: RepositoryStatus }> {
    const repository = await this.validateRegistered(id);
    return { repository, status: await this.gitProvider.getStatus(repository.path) };
  }

  public async getLocations(id: string): Promise<{ repository: Repository; locations: Locations }> {
    const repository = await this.validateRegistered(id);
    return { repository, locations: await this.gitProvider.getLocations(repository.path) };
  }
}
