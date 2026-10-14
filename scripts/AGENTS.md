# scripts/ — 规则层

继承根规则，见 [../AGENTS.md](../AGENTS.md)。

本目录特有约束：

- 产物格式契约由本目录负责：`lib/client.js` 必须是 DSH 的 lazy-CJS 工厂信封，不得手改产物。
- 输出路径不得与 `tsc` 的产物撞车 —— `src/<name>.ts` 会编译到 `lib/<name>.js`，因此路径冲突守卫必须保留。
- 外部依赖只允许 `PLATFORM_MODULES` 清单内的模块；清单外的一律标记 external 并写 `dsh.client.inject`。
- 脚本内不得写死本机路径或凭据。
- `acceptance.mjs` 是**验收工具**不是构建产物：不得进入 `pnpm run build` / `pnpm test` 链路，凭据只从环境变量取；默认目标允许指向本机 profile（用户主目录相对路径，不算写死本机路径）。
- 改 `build-client.mjs` 后必须跑 `test/client-bundle.test.ts` 与 `test/dist.test.ts`，并同步 [docs/PUBLISHING.md](../docs/PUBLISHING.md) 的构建链说明；其余脚本各自的同步点见 [README.md](README.md) 的变更影响路由。
