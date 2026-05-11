import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import {
  applyReleaseUpdate,
  bumpVersion,
  parseArgs,
} from "./release-update.mjs";

test("bumpVersion upgrades semver by release type", () => {
  assert.equal(bumpVersion("0.1.0", "patch"), "0.1.1");
  assert.equal(bumpVersion("0.1.0", "minor"), "0.2.0");
  assert.equal(bumpVersion("0.1.0", "major"), "1.0.0");
});

test("parseArgs collects release type and notes", () => {
  assert.deepEqual(parseArgs(["--type", "minor", "--note", "A", "--note", "B"]), {
    type: "minor",
    notes: ["A", "B"],
  });
});

test("applyReleaseUpdate syncs version files and prepends UPDATE entry", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "release-update-"));

  try {
    await mkdir(path.join(tempRoot, "src-tauri"), { recursive: true });
    await writeFile(
      path.join(tempRoot, "package.json"),
      JSON.stringify({ version: "0.1.0" }, null, 2) + "\n",
      "utf8",
    );
    await writeFile(
      path.join(tempRoot, "src-tauri", "Cargo.toml"),
      ['[package]', 'name = "demo"', 'version = "0.1.0"', 'edition = "2021"', ""].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(tempRoot, "src-tauri", "tauri.conf.json"),
      JSON.stringify(
        {
          productName: "Gitlab Manager",
          version: "0.1.0",
          app: {
            windows: [{ title: "Gitlab Manager" }],
          },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    await writeFile(
      path.join(tempRoot, "UPDATE.md"),
      ["# UPDATE", "", "## 2026-04-19 v0.1.0", "- 初始版本", ""].join("\n"),
      "utf8",
    );

    const result = await applyReleaseUpdate({
      rootDir: tempRoot,
      type: "patch",
      notes: ["新增自动版本同步", "新增 UPDATE.md 自动记录"],
      date: "2026-04-20",
    });

    assert.equal(result.previousVersion, "0.1.0");
    assert.equal(result.nextVersion, "0.1.1");

    const packageJson = JSON.parse(await readFile(path.join(tempRoot, "package.json"), "utf8"));
    const tauriConfig = JSON.parse(await readFile(path.join(tempRoot, "src-tauri", "tauri.conf.json"), "utf8"));
    const cargoToml = await readFile(path.join(tempRoot, "src-tauri", "Cargo.toml"), "utf8");
    const updateLog = await readFile(path.join(tempRoot, "UPDATE.md"), "utf8");

    assert.equal(packageJson.version, "0.1.1");
    assert.equal(tauriConfig.version, "0.1.1");
    assert.equal(tauriConfig.app.windows[0].title, "Gitlab Manager");
    assert.match(cargoToml, /version = "0\.1\.1"/);
    assert.match(updateLog, /## 2026-04-20 v0\.1\.1/);
    assert.match(updateLog, /- 新增自动版本同步/);
    assert.match(updateLog, /- 新增 UPDATE\.md 自动记录/);
    assert.match(updateLog, /## 2026-04-19 v0\.1\.0/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
