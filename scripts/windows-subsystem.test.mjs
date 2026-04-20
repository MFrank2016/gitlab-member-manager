import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("release builds use the Windows GUI subsystem", async () => {
  const mainRs = await readFile("src-tauri/src/main.rs", "utf8");

  assert.match(
    mainRs,
    /^#!\[cfg_attr\(not\(debug_assertions\), windows_subsystem = "windows"\)\]/m,
    "发布版必须启用 windows_subsystem = \"windows\"，否则 MSI 启动时会额外弹出终端窗口",
  );
});
