/**
 * E2E 测试：应用加载与聊天界面骨架（无 API Key 也能验证 UI 渲染）
 * 正常流程：页面加载 → 出现聊天输入区；边界：未知路由回到应用不白屏
 */
import { test, expect } from '@playwright/test';

test('应用应正常加载，标题非空', async ({ page }) => {
  await page.goto('/');
  const title = await page.title();
  expect(title.trim().length).toBeGreaterThan(0);
});

test('聊天界面骨架应渲染出输入区域', async ({ page }) => {
  await page.goto('/');
  // 输入框或文本域（聊天输入组件）应可见
  const input = page.locator('textarea, input[type="text"], [contenteditable="true"]').first();
  await expect(input).toBeVisible({ timeout: 15_000 });
});

test('未知路由不应白屏（异常流程）', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/some/unknown/path');
  await page.waitForLoadState('domcontentloaded');
  // 允许应用显示错误占位/重定向，但不能抛页面级异常
  expect(errors).toHaveLength(0);
});
