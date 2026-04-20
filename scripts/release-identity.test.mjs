import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const APP_NAME = "Gitlab Manager";

test("installer-facing app identity stays stable", async () => {
  const tauriConfig = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
  const sidebar = await readFile("src/components/ui/sidebar.tsx", "utf8");
  const readme = await readFile("README.md", "utf8");

  assert.equal(
    tauriConfig.productName,
    APP_NAME,
    "MSI productName 必须保持稳定，否则 Windows 会把升级包识别成另一套产品",
  );
  assert.equal(
    tauriConfig.app.windows[0]?.title,
    APP_NAME,
    "主窗口标题应和安装产品名保持一致，避免升级后出现双品牌",
  );
  assert.match(
    sidebar,
    new RegExp(APP_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "侧边栏品牌文案应和安装产品名保持一致",
  );
  assert.match(readme, /^# Gitlab Manager$/m);
});
