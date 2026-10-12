[简体中文](CONTRIBUTING.md) · [English](CONTRIBUTING_en.md)

# Contributing — 参与 dsh-zhihu-search

issue 与 PR 提交至 [GitHub](https://github.com/dsh-plugin-lab/dsh-zhihu-search)。

## 报 bug 时附上

- 插件版本、DSH 版本（`dsh --version`）、Node 版本（`node --version`）。
- 从源码安装还是从 npm 安装；改动后是否重启 DSH。
- 最小可重复的复现步骤，以及完整报错原文。

## 提功能前

- 翻 [.agents/notes/](.agents/notes/) —— 已被实测排除的提案，以及每条决策放弃的替代方案。
- 设计与平台的「做不到」→ [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 提 PR 前

- 在仓库目录执行 `npm test`。
- 读 [AGENTS.md](AGENTS.md) 的「全局规则」与 [test/README.md](test/README.md)：合并判据在其中，红线由 [test/redlines.test.ts](test/redlines.test.ts) 固化。
- 不要修改版本号（发版流程 → [docs/PUBLISHING.md](docs/PUBLISHING.md)）。
