import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";

const VALID_RELEASE_TYPES = new Set(["major", "minor", "patch"]);

export function bumpVersion(version, type) {
  if (!VALID_RELEASE_TYPES.has(type)) {
    throw new Error(`不支持的版本升级类型: ${type}`);
  }

  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`不支持的版本号格式: ${version}`);
  }

  const [major, minor, patch] = match.slice(1).map((value) => Number.parseInt(value, 10));

  if (type === "major") {
    return `${major + 1}.0.0`;
  }

  if (type === "minor") {
    return `${major}.${minor + 1}.0`;
  }

  return `${major}.${minor}.${patch + 1}`;
}

export function parseArgs(argv) {
  const options = {
    type: "patch",
    notes: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--type") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("--type 后面必须跟版本升级类型");
      }
      options.type = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--note") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("--note 后面必须跟更新说明");
      }
      options.notes.push(nextArg);
      index += 1;
      continue;
    }

    if (arg === "--date") {
      const nextArg = argv[index + 1];
      if (!nextArg) {
        throw new Error("--date 后面必须跟日期");
      }
      options.date = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    options.notes.push(arg);
  }

  if (!VALID_RELEASE_TYPES.has(options.type)) {
    throw new Error(`版本升级类型必须是 major、minor 或 patch，收到: ${options.type}`);
  }

  return options;
}

function formatDate(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function updateCargoTomlVersion(content, nextVersion) {
  const nextContent = content.replace(
    /^(\[package\][\s\S]*?^version = ")([^"]+)(")/m,
    `$1${nextVersion}$3`,
  );

  if (nextContent === content) {
    throw new Error("未在 src-tauri/Cargo.toml 的 [package] 段找到 version 字段");
  }

  return nextContent;
}

function updateWindowTitles(config, nextVersion) {
  const productName =
    typeof config.productName === "string" && config.productName.trim().length > 0
      ? config.productName.trim()
      : "App";
  const nextTitle = `${productName} v${nextVersion}`;

  if (!config.app || typeof config.app !== "object") {
    return config;
  }

  const windows = Array.isArray(config.app.windows) ? config.app.windows : [];

  return {
    ...config,
    app: {
      ...config.app,
      windows: windows.map((windowConfig) => ({
        ...windowConfig,
        title: nextTitle,
      })),
    },
  };
}

function renderUpdateEntry({ date, version, notes }) {
  const body = notes.map((note) => `- ${note}`).join("\n");
  return `## ${date} v${version}\n${body}\n`;
}

function updateUpdateLog(content, entry) {
  const trimmed = content.trim();

  if (!trimmed) {
    return `# UPDATE\n\n${entry}`;
  }

  const header = "# UPDATE";
  if (trimmed.startsWith(header)) {
    const body = trimmed.slice(header.length).trimStart();
    return `${header}\n\n${entry}${body ? `\n${body}\n` : ""}`;
  }

  return `# UPDATE\n\n${entry}${trimmed}\n`;
}

export async function applyReleaseUpdate({
  rootDir,
  type,
  notes,
  date = formatDate(),
}) {
  if (!notes.length) {
    throw new Error("至少提供一条更新功能点说明");
  }

  const packageJsonPath = path.join(rootDir, "package.json");
  const cargoTomlPath = path.join(rootDir, "src-tauri", "Cargo.toml");
  const tauriConfigPath = path.join(rootDir, "src-tauri", "tauri.conf.json");
  const updateLogPath = path.join(rootDir, "UPDATE.md");

  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const cargoToml = await readFile(cargoTomlPath, "utf8");
  const tauriConfig = JSON.parse(await readFile(tauriConfigPath, "utf8"));

  const previousVersion = packageJson.version;
  const nextVersion = bumpVersion(previousVersion, type);

  packageJson.version = nextVersion;
  const nextTauriConfig = updateWindowTitles(
    {
      ...tauriConfig,
      version: nextVersion,
    },
    nextVersion,
  );

  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  await writeFile(cargoTomlPath, updateCargoTomlVersion(cargoToml, nextVersion), "utf8");
  await writeFile(tauriConfigPath, `${JSON.stringify(nextTauriConfig, null, 2)}\n`, "utf8");

  let existingUpdateLog = "";
  try {
    existingUpdateLog = await readFile(updateLogPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const entry = renderUpdateEntry({
    date,
    version: nextVersion,
    notes,
  });
  await writeFile(updateLogPath, updateUpdateLog(existingUpdateLog, entry), "utf8");

  return {
    previousVersion,
    nextVersion,
    updatedFiles: [
      "package.json",
      "src-tauri/Cargo.toml",
      "src-tauri/tauri.conf.json",
      "UPDATE.md",
    ],
  };
}

function printHelp() {
  console.log(`用法:
  pnpm release:update -- --type patch --note "功能点一" --note "功能点二"

参数:
  --type  版本升级类型，可选 major / minor / patch，默认 patch
  --note  更新功能点说明，可重复传入
  --date  自定义日期，默认使用本地日期
  --help  查看帮助
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = await applyReleaseUpdate({
    rootDir,
    type: options.type,
    notes: options.notes,
    date: options.date,
  });

  console.log(`版本已升级: ${result.previousVersion} -> ${result.nextVersion}`);
  console.log("已更新文件:");
  for (const file of result.updatedFiles) {
    console.log(`- ${file}`);
  }
}

const executedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const currentFilePath = fileURLToPath(import.meta.url);

if (executedPath === currentFilePath) {
  main().catch((error) => {
    console.error(`发布更新失败: ${error.message}`);
    process.exitCode = 1;
  });
}
