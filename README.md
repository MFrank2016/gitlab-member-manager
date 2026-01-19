# GitLab Member Manager (Tauri2 + React18 + Tailwind v4 + shadcn/ui + Rust + SQLite)

> 这是一个**可直接运行**的 GitLab 项目成员管理小工具：项目搜索、查看成员、本地成员库、本地虚拟分组、按分组批量拉人/移除。

## 1) 前置依赖

- Node.js 18+（推荐 20+）
- pnpm
- Rust toolchain（stable）
- 各平台 Tauri 依赖（WebView2 / Xcode / GTK 等）

## 2) 运行

```bash
pnpm install
pnpm tauri dev
```

> 首次启动后，SQLite 数据库会创建在系统的 AppData 目录下（Tauri 的 app_data_dir）。

## 3) 使用

1. 打开「配置」页：填 Base URL（例如 `https://gitlab.example.com`）和 Private Token。
2. 「项目搜索」页：输入关键字搜索项目。
3. 「项目成员」页：输入项目名/ID 选择项目，查看成员。
   - 勾选成员 → “保存所选到本地成员”
   - 选择本地分组 + 权限 → “按分组批量拉人”
   - 选择分组或多选成员 → 批量移除
4. 「本地成员」页：从本地库选择成员加入本地分组。
5. 「本地分组」页：创建分组、查看/移除分组成员。

## 4) 注意

- 本工具默认使用 `PRIVATE-TOKEN` 头访问 GitLab API。
- 批量操作是逐个调用成员 API，返回成功/失败列表，便于定位错误。
- `bundle.active=false`（避免没有图标时打包失败）；需要打包时请自行生成 icons 并开启。

