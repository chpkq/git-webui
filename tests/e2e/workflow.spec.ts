import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { createE2eFixture, removeE2eFixture, runGit, type E2eFixture } from './fixture.js';

const E2E_SERVER_URL = 'http://127.0.0.1:3100';

test.describe.configure({ mode: 'serial' });

let fixture: E2eFixture;

test.beforeAll(async () => {
  fixture = await createE2eFixture();
});

test.afterAll(async () => {
  await removeE2eFixture(fixture);
});

test('标注当前分支并在快速切换后显示最后选中分支历史', async ({ page }) => {
  let repositoryId: string | undefined;
  await page.goto('/');
  try {
    await page.getByRole('button', { name: '注册仓库' }).first().click();
    await page.getByLabel('仓库路径').fill(fixture.repositoryPath);
    await page.getByLabel('显示名称（可选）').fill('E2E 历史竞态仓库');
    await page.getByRole('button', { name: '注册仓库', exact: true }).last().click();
    await expect(page.getByRole('button', { name: /E2E 历史竞态仓库/ })).toBeVisible();

    const repositoriesResponse = await page.request.get('/api/repositories');
    const repositories = (await repositoriesResponse.json()) as {
      items: Array<{ id: string; name: string }>;
    };
    repositoryId = repositories.items.find((item) => item.name === 'E2E 历史竞态仓库')?.id;
    expect(repositoryId).toBeDefined();

    await expect(page.getByText(/LOCAL BRANCHES · 2 · 当前：main/)).toBeVisible();
    await expect(page.getByRole('button', { name: /main.*当前/ })).toBeVisible();
    await expect(page.getByText('E2E 初始提交')).toBeVisible();

    let delayedFeatureRequest = true;
    await page.route('**/api/repositories/*/commits*', async (route) => {
      const ref = new URL(route.request().url()).searchParams.get('ref');
      if (ref === 'feature/history' && delayedFeatureRequest) {
        delayedFeatureRequest = false;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      try {
        await route.continue();
      } catch {
        // 切换 ref 时浏览器可能已取消该请求。
      }
    });

    await page.getByRole('button', { name: /feature\/history/ }).click();
    await page.getByRole('button', { name: /main.*当前/ }).click();
    await page.getByRole('button', { name: /feature\/history/ }).click();
    await expect(page.getByText('E2E 分支独有提交')).toBeVisible();
    await expect(page.getByText('E2E 初始提交')).toBeVisible();

    await runGit(fixture.repositoryPath, ['switch', '--detach', 'HEAD']);
    await expect(page.getByText(/LOCAL BRANCHES · 2 · 当前：Detached HEAD/)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('button', { name: /main.*当前/ })).toHaveCount(0);
    await runGit(fixture.repositoryPath, ['switch', 'main']);
    await expect(page.getByText(/LOCAL BRANCHES · 2 · 当前：main/)).toBeVisible({
      timeout: 10_000,
    });
  } finally {
    await page.unroute('**/api/repositories/*/commits*').catch(() => undefined);
    if (repositoryId !== undefined) {
      await page.request.delete(`/api/repositories/${repositoryId}`).catch(() => undefined);
    }
  }
});

test('通过分支圆点切换并在右栏内联查看文件 Diff', async ({ page }) => {
  let repositoryId: string | undefined;
  await page.goto('/');
  try {
    await page.getByRole('button', { name: '注册仓库' }).first().click();
    await page.getByLabel('仓库路径').fill(fixture.repositoryPath);
    await page.getByLabel('显示名称（可选）').fill('E2E 分支切换仓库');
    await page.getByRole('button', { name: '注册仓库', exact: true }).last().click();
    await expect(page.getByRole('button', { name: /E2E 分支切换仓库/ })).toBeVisible();

    const repositoriesResponse = await page.request.get('/api/repositories');
    const repositories = (await repositoriesResponse.json()) as {
      items: Array<{ id: string; name: string }>;
    };
    repositoryId = repositories.items.find((item) => item.name === 'E2E 分支切换仓库')?.id;
    expect(repositoryId).toBeDefined();

    const detailColumn = page.locator('.detail-column');
    const summaryPanel = detailColumn.locator(':scope > .panel').first();
    const detailBox = await detailColumn.boundingBox();
    const emptySummaryBox = await summaryPanel.boundingBox();
    expect(detailBox).not.toBeNull();
    expect(emptySummaryBox).not.toBeNull();
    expect(emptySummaryBox!.height).toBeLessThan(detailBox!.height * 0.5);

    await expect(page.getByText(/LOCAL BRANCHES · 2 · 当前：main/)).toBeVisible();
    await page.getByRole('button', { name: '切换当前分支' }).click();
    await expect(page.getByRole('heading', { name: '切换当前分支' })).toBeVisible();
    await page.getByRole('button', { name: '确认切换' }).click();
    await expect(page.getByText('操作成功')).toBeVisible();
    await expect(page.getByText(/LOCAL BRANCHES · 2 · 当前：feature\/history/)).toBeVisible();
    await expect(page.getByText(/E2E 分支切换仓库 · feature\/history/)).toBeVisible();
    await page.getByRole('button', { name: '关闭', exact: true }).last().click();

    await page.getByRole('button', { name: /feature\/history/ }).click();
    await page.getByText('E2E 分支独有提交').click();
    const changedFile = page.getByRole('button', { name: /history-only\.txt/ });
    await expect(changedFile).toBeVisible();
    await changedFile.click();
    await expect(changedFile).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Diff · history-only.txt')).toBeVisible();
    await changedFile.click();
    await expect(changedFile).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('Diff · history-only.txt')).toBeHidden();
  } finally {
    await runGit(fixture.repositoryPath, ['switch', 'main']).catch(() => undefined);
    if (repositoryId !== undefined) {
      await page.request.delete(`/api/repositories/${repositoryId}`).catch(() => undefined);
    }
  }
});

test('完成注册、Working Copy、同步与 Branch/Remote 管理工作流', async ({ page }) => {
  let repositoryId: string | undefined;
  await page.goto('/');
  try {
    await page.getByRole('button', { name: '注册仓库' }).first().click();
    await page.getByLabel('仓库路径').fill(fixture.repositoryPath);
    await page.getByLabel('显示名称（可选）').fill('E2E 工作流仓库');
    await page.getByRole('button', { name: '注册仓库', exact: true }).last().click();
    await expect(page.getByRole('button', { name: /E2E 工作流仓库/ })).toBeVisible();

    const repositoriesResponse = await page.request.get('/api/repositories');
    const repositories = (await repositoriesResponse.json()) as {
      items: Array<{ id: string; name: string }>;
    };
    repositoryId = repositories.items.find((item) => item.name === 'E2E 工作流仓库')?.id;
    expect(repositoryId).toBeDefined();

    await writeFile(pathFor(fixture.repositoryPath, 'readme.md'), '# e2e changed\n');
    await page.getByRole('tab', { name: 'WORKING COPY' }).click();
    await expect(page.getByRole('button', { name: /readme\.md/ })).toBeVisible({ timeout: 10_000 });

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Stage All', exact: true }).click();
    await expect.poll(() => readFileStatus(page, repositoryId!, 'readme.md')).toBe('staged');

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Unstage All', exact: true }).click();
    await expect.poll(() => readFileStatus(page, repositoryId!, 'readme.md')).toBe('unstaged');

    await runGit(fixture.repositoryPath, ['add', '--', 'readme.md']);
    await runGit(fixture.repositoryPath, ['commit', '-m', 'E2E 本地变更']);
    await runSync(page, '更新', 'Fetch All + Prune', repositoryId!);
    await runSync(page, 'Push', 'Push 当前分支', repositoryId!);

    await runGit(fixture.otherPath, ['pull', '--ff-only']);
    await writeFile(pathFor(fixture.otherPath, 'remote.txt'), 'remote change\n');
    await runGit(fixture.otherPath, ['add', '--', 'remote.txt']);
    await runGit(fixture.otherPath, ['commit', '-m', 'E2E 远端变更']);
    await runGit(fixture.otherPath, ['push', 'origin', 'main']);
    await runSync(page, '更新', 'Fetch All + Prune', repositoryId!);
    await runSync(page, 'Pull', 'ff-only Pull', repositoryId!);

    await page.getByTitle('管理 Remote 与 Branch').click();
    await expect(page.getByRole('heading', { name: '创建 Branch' })).toBeVisible();
    await page.getByLabel('新 Branch 名称').fill('feature/e2e');
    await page.getByRole('button', { name: '确认执行' }).click();
    await expect(page.getByText('操作成功')).toBeVisible();
    await page.getByRole('button', { name: '关闭' }).last().click();

    await page.getByTitle('管理 Remote 与 Branch').click();
    await page.getByLabel('操作').selectOption('remote-add');
    await page.getByLabel('Remote 名称').fill('backup');
    await page.getByLabel('Fetch URL').fill(fixture.remotePath);
    await page.getByRole('button', { name: '确认执行' }).click();
    await expect(page.getByText('操作成功')).toBeVisible();
    await page.getByRole('button', { name: '关闭' }).last().click();

    page.once('dialog', (dialog) => void dialog.accept());
    const removeResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        response.url().includes(`/api/repositories/${repositoryId}`),
    );
    await page.getByTitle('移除注册（不会删除磁盘仓库）').click();
    expect((await removeResponse).status()).toBe(204);
    await page.reload();
    await expect(page.getByText('还没有注册仓库')).toBeVisible();
  } finally {
    if (repositoryId !== undefined) {
      await fetch(`${E2E_SERVER_URL}/api/repositories/${repositoryId}`, {
        method: 'DELETE',
      }).catch(() => undefined);
    }
  }
});

const pathFor = (directory: string, fileName: string): string => path.join(directory, fileName);

const readFileStatus = async (
  page: Page,
  repositoryId: string,
  filePath: string,
): Promise<'staged' | 'unstaged' | 'missing'> => {
  const response = await page.request.get(`/api/repositories/${repositoryId}/status`);
  const body = (await response.json()) as {
    status: { entries: Array<{ path: string; staged: boolean; unstaged: boolean }> };
  };
  const entry = body.status.entries.find((item) => item.path === filePath);
  if (entry === undefined) return 'missing';
  if (entry.staged) return 'staged';
  if (entry.unstaged) return 'unstaged';
  return 'missing';
};

const runSync = async (
  page: Page,
  toolbarLabel: string,
  dialogTitle: string,
  repositoryId: string,
): Promise<void> => {
  await page.getByRole('button', { name: toolbarLabel, exact: true }).click();
  await expect(page.getByRole('heading', { name: dialogTitle })).toBeVisible();
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes(`/api/repositories/${repositoryId}/`),
  );
  await page.getByRole('button', { name: '确认执行' }).click();
  expect((await responsePromise).status()).toBe(200);
  await expect(page.getByText('操作成功')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '关闭' }).last().click();
};
