import path from "node:path";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { openSidebarNavSettings } from "../support/helpers/sidebar-nav-settings";

const APP_SETTINGS_KEY = "@paseo:app-settings";
const SCREENSHOT_DIR = process.env.SIDEBAR_GROUPS_SCREENSHOT_DIR;

async function seedGroup(
  page: import("@playwright/test").Page,
  options: { collapsed: boolean },
): Promise<void> {
  await page.addInitScript(
    ({ key, collapsed }) => {
      const settings = JSON.parse(localStorage.getItem(key) ?? "{}");
      if (settings.sidebarNavGroups) return;
      localStorage.setItem(
        key,
        JSON.stringify({
          ...settings,
          sidebarNavItems: [
            { key: "new-workspace", visible: true },
            { key: "search", visible: true },
            { key: "group:fleet", visible: true },
            { key: "history", visible: true, group: "fleet" },
            { key: "schedules", visible: true, group: "fleet" },
          ],
          sidebarNavGroups: [{ id: "fleet", title: "Agents", collapsed }],
        }),
      );
    },
    { key: APP_SETTINGS_KEY, collapsed: options.collapsed },
  );
}

function shot(name: string): { path: string } | undefined {
  return SCREENSHOT_DIR ? { path: path.join(SCREENSHOT_DIR, name) } : undefined;
}

test("a sidebar group folds its rows and remembers it", async ({ page }) => {
  test.setTimeout(120_000);
  await seedGroup(page, { collapsed: false });
  await gotoAppShell(page);

  const toggle = page.locator('[data-testid="sidebar-nav-group-toggle-fleet"]:visible').first();
  const history = page.locator('[data-testid="sidebar-sessions"]:visible');
  const schedules = page.locator('[data-testid="sidebar-schedules"]:visible');

  await expect(toggle).toBeVisible({ timeout: 30_000 });
  await expect(history).toHaveCount(1);
  await expect(schedules).toHaveCount(1);
  await page.screenshot(shot("sidebar-group-expanded.png"));

  await toggle.click();
  await expect(history).toHaveCount(0);
  await expect(schedules).toHaveCount(0);
  await page.screenshot(shot("sidebar-group-collapsed.png"));

  await page.reload();
  await expect(toggle).toBeVisible({ timeout: 30_000 });
  await expect(history).toHaveCount(0);
});

test("Settings > Sidebar creates a group and moves a row into it", async ({ page }) => {
  test.setTimeout(120_000);
  await gotoAppShell(page);
  await openSidebarNavSettings(page);

  await page.getByTestId("sidebar-nav-new-group-name").fill("Agents");
  await page.getByTestId("sidebar-nav-new-group").click();
  await expect(page.locator('[data-testid^="sidebar-nav-group-name-"]')).toHaveValue("Agents");

  await page.getByTestId("sidebar-nav-group-menu-schedules").click();
  await page.getByRole("menuitem", { name: "Move to Agents" }).click();
  await expect(page.getByTestId("sidebar-nav-item-schedules")).toBeVisible();
  await page
    .getByTestId("sidebar-nav-section-header")
    .screenshot(shot("settings-sidebar-groups.png"));

  const stored = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "{}"),
    APP_SETTINGS_KEY,
  );
  expect(stored.sidebarNavGroups).toHaveLength(1);
  expect(
    stored.sidebarNavItems.find((item: { key: string }) => item.key === "schedules").group,
  ).toBe(stored.sidebarNavGroups[0].id);
});
