import { test, expect } from '@playwright/test';
import path from 'node:path';

test.describe.configure({ mode: 'serial' });

test('首页显示 Git WebUI 工作台', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Git WebUI')).toBeVisible();
  await expect(page.getByText('还没有注册仓库')).toBeVisible();
});

test('注册仓库并查看 Working Copy', async ({ page }) => {
  const repositoryPath = path.resolve(process.cwd());
  let registeredId: string | undefined;
  await page.goto('/');
  try {
    await page.getByRole('button', { name: '注册仓库' }).first().click();
    await page.getByLabel('仓库路径').fill(repositoryPath);
    await page.getByLabel('显示名称（可选）').fill('E2E 测试仓库');
    await page.getByRole('button', { name: '注册仓库', exact: true }).last().click();
    await expect(page.getByRole('button', { name: /E2E 测试仓库/ })).toBeVisible();
    await expect(page).toHaveURL(/repo=/u);
    await expect(page.getByRole('separator', { name: '调整 Locations 宽度' })).toBeVisible();
    const locationsResizer = await page
      .getByRole('separator', { name: '调整 Locations 宽度' })
      .boundingBox();
    expect(locationsResizer).not.toBeNull();
    await page.mouse.move(locationsResizer!.x + 3, locationsResizer!.y + 8);
    await page.mouse.down();
    await page.mouse.move(locationsResizer!.x + 23, locationsResizer!.y + 8);
    await page.mouse.up();
    expect(await page.evaluate(() => window.localStorage.getItem('git-webui-layout'))).toContain(
      'locations',
    );
    const repositoriesResponse = await page.request.get('/api/repositories');
    const repositories = (await repositoriesResponse.json()) as {
      items: Array<{ id: string; name: string }>;
    };
    expect(repositoriesResponse.status()).toBe(200);
    registeredId = repositories.items.find((item) => item.name === 'E2E 测试仓库')?.id;
    expect(registeredId).toBeDefined();
    await page.getByRole('tab', { name: 'WORKING COPY' }).click();
    await expect(page.getByText(/工作区干净|读取 Working Copy/)).toBeVisible();
    await page.keyboard.press('Control+Shift+U');
    await expect(page.getByRole('heading', { name: 'Fetch All + Prune' })).toBeVisible();
    await page.getByRole('button', { name: '关闭' }).last().click();

    page.once('dialog', (dialog) => void dialog.accept());
    const deleteResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' && response.url().includes('/api/repositories/'),
    );
    await page.getByTitle('移除注册（不会删除磁盘仓库）').click();
    const response = await deleteResponse;
    expect(response.status()).toBe(204);
    await page.reload();
    await expect(page.getByText('还没有注册仓库')).toBeVisible();
  } finally {
    if (registeredId !== undefined) {
      await fetch(`http://127.0.0.1:3000/api/repositories/${registeredId}`, {
        method: 'DELETE',
      }).catch(() => undefined);
    }
  }
});
