# client/ — 浏览器半体

- 职责：在侧边栏「插件（Plugins）」→「已安装（Installed）」组 → **点本插件进它的详情页**时，渲染内联在描述与「包含的组件」之间的「知乎搜索」配置卡片（槽 `plugins.bundle.config`，`key` 是**包名**；没有多一次 Configure）。配置面只承载凭据引用名与开关；**密钥经 `ctx.remote.credentials` 写进凭据存储**（`$DSH_HOME/.credentials.yaml`），不经过配置文件。
- 文件索引：`index.tsx` 卡片本体与注册；[credential-store.ts](credential-store.ts) 凭据状态源（纯逻辑，无 React）；[locales.ts](locales.ts) 中英字典，并导出 `LOCALE_NS`、`ZhihuLocaleKey` 与 `LocaleNamespaceMap` 增强声明（key 拼错或漏一种语言即编译错误）。
- 关键导出：`apply`（注册字典与卡片）、`inject`（`['slots', 'remote', 'remote.credentials', 'locale']` —— **`remote` 与 `remote.credentials` 缺一不可**，理由见 [AGENTS.md](AGENTS.md)）、`createCredentialStore`（纯函数，跟踪引用名当下的配置状态）。
- 卡片怎么拿到配置面：**自己取**。`plugins.bundle.config` 的座位里**没有** `form`（页面只递 `view` 与 `entryKey`），所以卡片在嵌套的 `ctx.inject(['configForms'])` 里调 `ctx.configForms.get(ENTRY_ID)`，`ENTRY_ID` = bundle patch 那条 insert 的 `id`（loader entry id，也是设置命名空间）。**槽 key（包名）与这个 entry id 是两个不同的东西**，今天恰好同串，由 [test/settings-seam.test.ts](../../test/settings-seam.test.ts) 各自对账。
- 卡片**自己订阅**表单快照（`getSnapshot` + `subscribe`，走 `useSyncExternalStore`）：没有页面重渲染这条路可等。命名空间不在册（`status === 'unavailable'`）或宿主不可写时按「不可写」渲染，沿用既有只读文案，不新增可见状态。
- 能力探测：这条链有**两环**（服务 `configForms`、槽 `plugins.bundle.config`），各自缺席都不报错、界面静默缺席 —— 两环**各给一个超时窗口**，到点仍在缺席的那一环往**客户端控制台**写一条英文 WARN；那一环迟到则补一条 INFO 撤销它自己那条。只加提示路径，注册的槽名 / key / 时机一字不改，探测失败不影响任何既有功能。**服务缺席时槽那一环不发声**（一次超时只发一条，报的是真正断掉的那一环）。
- 被谁依赖：DSH Web 的客户端模块系统按包清单的 `dsh.client` 扫描并加载 `lib/client.js`。
- 改后必测：`pnpm test` 的 [产物契约](../../test/README.md)（信封 id、导出面、inject 装配、注册 key）与 [credential-store 单测](../../test/credential-store.test.ts)。

## 视觉与结构

对齐原生配置表单（DSH `packages/client/ui-primitives/src/settings-form/` 的 `SettingsForm` + `fields`）：

- 不可折叠、没有标题、**没有外框**：标题与面包屑由插件页自己画，一列控件直接落在插件页的 `data-plugin-config` 区里（无 border / 圆角 / 底色 / 内边距）。
- 字段行：标签 + 状态标记（`Tag`）+ 重置；说明行在控件下方，Access Secret 的说明里带一个「知乎开放平台个人中心」外链（新开页）。字段之间以 `border-l2` 分隔。
- 说明行里的外链只用 `--dsw-alias-link` 令牌；组件是纯内联样式、写不了 `:hover`，因此常驻下划线作为静态可点提示。
- 底部：失败诊断（`role=status`，占满剩余宽度）+ **单一保存按钮**（无分割线、左对齐）；disabled = 无改动 / 不可写 / 保存中。草稿随卸载丢弃，因此没有「放弃」控件。
- 取值逐条对齐官方配置表单的样式表 `ui-primitives/src/settings-form/{SettingsForm,fields}.module.css`，只用 `--dsw-alias-*` 令牌。（**别去引 `PluginConfigForm.module.css`**：那一份在接缝换代《决策记录》所说的新线上已不存在，等价物就在上面那两处。）
- 开关行（「隐藏原生网页搜索」）用官方 `Switch`（同在 `ui-primitives`），行布局抄官方 `SubagentModelSelectionCard.module.css` 的 `.toggleRow` / `.toggleLabel`，外观因此与官方卡片同款；其下再一行**状态行**随开关换文案（同官方写法），让用户不必从开关位置反推它做了什么。
- 文案全部取自 [locales.ts](locales.ts) 的字典，组件不写死字符串。字典把命名空间合并进 `LocaleNamespaceMap`，key 拼错或漏一种语言都是**编译错误**。

`Tag` 与 `Switch` 来自 `@deepseek-ai/dsh-client-ui-primitives`。它是外壳预置模块（`PLATFORM_MODULES`），不是别的插件，因此可以直接用，不需要 `dsh.client.inject` 边。

`ctx.remote` 走**结构类型**而不是 `import type {} from '@deepseek-ai/dsh-api-remotes/client'`：那是客户端的装配包，只为声明它就把整包加进 `peerDependencies` 不划算，而本卡片只碰 `credentials` 一个命名空间。写法与 Host 侧取 `logger` 同款。

## 变更影响路由

- 改 `index.tsx` 的 `BUNDLE_NAME` 或 `ENTRY_ID` → 前者必须与 [package.json](../../package.json) 的 `name` 逐字一致（写错 = 整块配置不出现），后者必须与 [cordis.patch.yml](../../cordis.patch.yml) 的行 id 逐字一致（写错 = 卡片照常出现但**永远只读且不报错**）。两者都由 [test/settings-seam.test.ts](../../test/settings-seam.test.ts) 从文件解析后对账；同步 [src/README.md](../README.md)。改槽位名同理。
- 改 `inject` 声明 → 同步 [test/client-bundle.test.ts](../../test/client-bundle.test.ts) 的导出面断言，并跑「按真实 Cordis 语义装配」组（**唯一**能看见 inject 门禁的地方）。`remote` 让 `ctx.remote` 属性访问合法、`remote.credentials` 等命名空间就绪，两个都不能删。
- 改 `credential-store.ts` → 跑 [test/credential-store.test.ts](../../test/credential-store.test.ts)。两条不可弱化：**引用名一换旧答案立即作废**（徽标说谎比徽标迟到更糟）、**写失败必须抛**（安静停在「未配置」会让用户以为保存成功了）。
- 改样式 → 只用 `--dsw-alias-*` 语义令牌，不写字面色值。
- 加文案 → 只改 [locales.ts](locales.ts) 的 key 与两份字典；两处都补齐才编得过。**没有 `summary` 那一条**：`plugins.bundle.config` 只渲染 `page`，留着就是没人渲染的死文案。
- 改**渲染面**（文案值、JSX 结构、样式对象、可见状态）→ **必须同批重截** [assets/](../../assets/) 的两张卡片图；触发判据、步骤与验收见 [assets/AGENTS.md](../../assets/AGENTS.md)。
- 改 locale 命名空间 → 必须与槽位注册的 `locale:` 一致，否则 `t` 取不到值、界面显示 key 本身。
- 改探测窗口或提示文案 → 跑 [产物测试](../../test/client-bundle.test.ts) 的「配置能力探测」一组（两环各一个窗口：都按时到达不发声 / 服务缺席报服务 / 服务在槽缺席报槽 / 迟到各撤各的 / 服务缺席时槽不跟着喊），并同步根 [README.md](../../README.md) 的「版本兼容」。**提示里点名的槽必须是实际注册的那个**（`plugins.bundle.config`）—— 探测说要装 A、卡片装进 B，是最坏的一种「说谎」，测试对此有断言。
- 改完必须 `pnpm run build`。客户端半体由 `dsh-client-hmr` 轮询 `lib/client.js` 就地换装；**host 半体换不了**。
  生效链**取决于本机 profile 怎么挂的**（先 `Get-Item <profile>\node_modules\dsh-zhihu-search | Select LinkType,Target`）：符号链接到仓库时构建**直接写线上浏览器半体**；版本化副本则要 build → 发版 → `dsh plugin --profile web add dsh-zhihu-search@<ver>`。两种模式下 host 半体都要重启 → 见 [../AGENTS.md](../AGENTS.md) 的活跃坑。

## 参考

- 卡片为何必须存在 → 见 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的「两半体约束」
- 密钥为何不写设置文档 → 见 [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) 的「密钥解析契约」
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)
