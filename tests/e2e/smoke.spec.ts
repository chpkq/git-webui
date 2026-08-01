import { test, expect } from '@playwright/test';

test('首页显示 Git WebUI 工作台', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Git WebUI')).toBeVisible();
  await expect(page.getByText('还没有注册仓库')).toBeVisible();
});
