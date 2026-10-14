# src/ — 源码手册

- 职责：插件全部实现。`index.ts` 是唯一接触 Cordis 的模块，其余均可脱离框架单测。

## 文件索引

- `index.ts`：插件入口。导出 `name` / `inject` / `Config` / `apply`，以及常量 `DEFAULT_ACCESS_SECRET_REF`；在 `ctx.effect()` 内创建客户端与状态并注册工具；观察 `agent/created` / `agent/disposed` / `loader/volatile-update`，维护「隐藏原生网页工具」的 restriction；并用 `settings.configure({ auto: false }, ctx.fiber)` 声明「这一行自带配置页面」。被 DSH loader 加载。
- `transport.ts`：知乎传输层。鉴权、两个搜索与额度自检走 GET、chat 走 POST、SSE 解析、错误映射、可取消重试。被 `tools/` 与 `utils/errors.ts` 依赖。
- `state.ts`：缓存与令牌桶，以及缓存键计算。被 `index.ts` 创建、被 `tools/` 使用。
- `credentials.ts`：Access Secret 的取值链（凭据域 → 进程环境）。纯函数 + 注入来源，被 `index.ts` 使用。
- `migrate.ts`：把**组合配置**里手写的明文 Access Secret 搬进凭据域，再告警请人手动删掉那一行（组合配置不属插件，删不掉）。纯逻辑 + 注入动作，启动期由 `index.ts` 调一次。**有删除条件**：使用者跨过这一版后整份删除。
- `types.ts`：知乎原始响应类型与 Canonical Output 类型。
- `tools/`：工具定义，见 [tools/README.md](tools/README.md)。
- `utils/`：编译器与文本清洗，见 [utils/README.md](utils/README.md)。
- `present/`：纯函数呈现层，见 [present/README.md](present/README.md)。
- `client/`：浏览器半体（插件页配置卡片），见 [client/README.md](client/README.md)。

## 依赖方向

`index.ts` → `tools/` + `state.ts` + `transport.ts` + `credentials.ts` + `migrate.ts`；`tools/` → `utils/` + `present/` + `transport.ts` + `state.ts`；`utils/errors.ts` → `transport.ts` + `state.ts` + `utils/compiler.ts`（只为 `instanceof` 判定取错误类）。`present/` 与 `types.ts` 无值依赖；`utils/describe-error.ts` 零导入，被 `transport.ts`、`migrate.ts`、`index.ts` 依赖。

逐条：

- `tools/*.ts` 还值导入 `@deepseek-ai/dsh-tools`（工具定义类型与常量），依赖注入经 `tools/deps.ts` 收口，因此三个工具实现本身不认识 Cordis。
- `utils/compiler.ts`、`utils/text.ts` 与 `utils/describe-error.ts` 无内部依赖；`utils/errors.ts` 是 `utils/` 唯一的例外。
- `present/` 只有 `import type`，`types.ts` 是纯类型、`utils/describe-error.ts` 零导入 —— 这些是真正的「不反向依赖任何模块」。

为什么必须单向、哪些模块不认识框架 → 见 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的「模块骨架与依赖方向」。

## 变更影响路由

- 改 `transport.ts` 的端点或响应处理 → 同步 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的「请求生命周期」，并跑 `test/sse.test.ts`、`test/tool.test.ts`。
- 改 `utils/compiler.ts` 的语法 → 必须先用生产凭据复核，再改 `test/compiler.test.ts`，并同步 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的「与知乎官方文档的偏差」。
- 改 Canonical Output 字段 → 契约变更，同步 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的「端点契约」、[tools/README.md](tools/README.md) 与两个搜索工具的 schema 一致性测试。
- 改 `utils/errors.ts` 的分类或 `hint` 文案 → `error.kind` 与 `hint` 是对模型的契约，增删取值等于改契约，需同步 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的「错误契约」并跑 `test/tool.test.ts`。
- 改 `state.ts` 的 TTL、令牌桶或缓存键 → 同步 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的「缓存与限流」，跑 `test/state.test.ts`；缓存键必须用归一化参数加凭据来源标识。
- 改工具描述 → 描述是模型择路与判断能力的唯一依据，按 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的「工具描述约定」三槽改，并跑 `test/tool.test.ts`（描述一致性断言在此）。
- 改呈现层 → 跑 `test/presentation.test.ts` 与 `test/redlines.test.ts`。
- 改密钥取值链或引用名守卫 → 契约变更，跑 `test/credentials.test.ts` 与 `test/auth.test.ts`，同步 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的「密钥解析契约」；若环境变量名 `ZHIHU_ACCESS_SECRET` 变更，同时改根 [README.md](../README.md) 的那一句。
- 改凭据服务的**取用方式** → 只能 `inject` + 属性访问（`ctx.get('credentials')` 由 `test/redlines.test.ts` 静态拦下，理由见 [复盘](../docs/postmortem/2026-09-15-credential-service-unreachable.md)）；跑 `test/plugin.test.ts`。**`settings` 与 `credentials` 是两个平行的可选层**（本次接缝换代起）：前者只承载「自带页面」这条策略，后者只承载取值口，谁都不该等谁 —— 从前凭据嵌在设置里是为了定死迁徙顺序，而设置文档没了，那个顺序也就不存在。
- 改 `Config` 的 volatile 字段 → 三个同步点缺一不可：schema 上 `.default()` 在 `.volatile()` **之前**、读取点用 `.get()`（不是挂载时快照）、并在 `ctx.on('loader/volatile-update')` 里补一次对账。字段集合由 `test/settings-seam.test.ts` 断言（只有 volatile 字段进配置页，多一个少一个都是缺陷）。
- 改 `migrate.ts` 的纪律 → 跑 `test/migrate.test.ts` 与 `test/plugin.test.ts` 的「组合配置明文迁徙」组。两条不可弱化：**凭据域已有值时不覆盖**、**写不进去就原样保留**（只吞预期失败，绝不阻断启动）。注意本次接缝换代后**没有删除动作**了 —— 明文留在组合配置里，插件只能告警。删 `Config.accessSecret` 前先读 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的「`accessSecret` 为什么仍留在 schema 里」。
- 改 `client/` → 必须 `pnpm run build` 并跑 `test/client-bundle.test.ts` 与 `test/settings-seam.test.ts`，确认注册的槽是 `plugins.bundle.config`、key 与 `package.json` 的 `name` 逐字一致，且 `ctx.configForms.get()` 的实参是 `cordis.patch.yml` 的行 id（**两个 id 今天同串但不是一回事**）；浏览器读的是 **profile 里那份** `lib/client.js`，要随新版本装进 profile 才生效。
- 新增模块或调整依赖方向 → 同步 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的「模块骨架与依赖方向」，并同步本文件的「文件索引」与 [AGENTS.md](AGENTS.md) 的约束。
- 改「隐藏原生网页工具」的对账逻辑 → 跑 `test/plugin.test.ts` 的「隐藏原生网页工具」组与 `test/native-web-tools.test.ts`。三条硬约束别踩：原生工具住在 **preset 的 standing scope**（全局视图看不到它）；agent scope 上取注册表必须用 `agent.ctx.get('tools')` 而非属性访问；那条 **tool-web 不在场时不抛错** 的断言是 blocker 守卫（同步抛错会否决 agent 创建），不可删。设计约束见 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的「原生工具的可见性」。

## 已知限制

- 直答的流式读取有**自己的预算**：Config 的 `streamTimeoutMs`（默认值来自 `transport.ts` 的 `DEFAULT_STREAM_TIMEOUT_MS`，55s），与 `timeoutMs` 取较大者；定时器与调用方 `signal` 的转发都随流结束才释放 —— 超时与取消在响应头之后同样生效。搜索类请求仍用配置的 `timeoutMs`（默认 `DEFAULT_TIMEOUT_MS`，15s）。当前工具一次性消费完整流（`chat()` 拼完再返回）；边流边回传 UI 需要直接暴露 `openChatStream`。
- `global_search` 的 `SortBy` 被端点忽略（**实测多次**，连非法字段名也照回 `code=0`），故未向该工具暴露排序参数。

## 参考

- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)
- 不变的设计约束 → 见 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
