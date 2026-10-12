# dsh-zhihu-search — 维护索引

## 状态

- 已发布版本以 [package.json](package.json) 的 `version` 为准 → <https://github.com/dsh-plugin-lab/dsh-zhihu-search>
- npm → <https://www.npmjs.com/package/dsh-zhihu-search>（由 [release.yml](.github/workflows/release.yml) 手动触发：**只发 `package.json` 里那个号**，不 bump；版本号是发布前的本地一步，见「常用命令」的发版两步）
- 功能、插件页配置卡片与本地真机验证全部完成；工具清单见 [README.md](README.md)。
- 市场收录：仓库已带 `dsh-plugin` topic；`awesome-dsh-plugin` 的 [PR #5037](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/5037) 已提，等评审 → [笔记](.agents/notes/2026-09-12-marketplace-submission.md)

## 全局规则

- 结论必须来自实测，不得来自文档推断 → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 红线以测试固化，共五条（依赖分层、呈现隔离、模型上下文隔离、无全局状态、模型不见原始语法）→ [test/README.md](test/README.md)
- 对外可见行为变化，同一次改动内同步 [README.md](README.md) 与 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 改根 [README.md](README.md) 必同改 [README_en.md](README_en.md)，冲突以中文为准
- 「版本兼容」章节只讲分水岭与真源指针，**不抄会漂的宿主版本**；判据：`engines.dsh` 一旦落后于实际部署的宿主线（[compat.yml](.github/workflows/compat.yml) 的 declaration 作业转红即为信号），该章与两份 README 的「前置」必须同批复核
- **声明面应当自洽**：`engines.dsh` 与全部 27 条 `@deepseek-ai/dsh-*` 声明（9 条 peer + 18 条 dev，去重后 18 个包）**逐字相同**（同形状、同区间）。两份声明矛盾时，使用者按我们给的区间装出来的宿主未必有本插件赖以工作的设置接缝，而接缝缺席是**静默**的（配置页不出现、宿主不报错）。由 [test/redlines.test.ts](test/redlines.test.ts) 的「声明面自洽」一组断言钉住（判据 2026-10-10 从「下限不低于」收紧为「逐字相同」，因为上界也是声明的一半；同一批还把换版脚本曾经漏掉 `engines.dsh` 的缺口补上，理由见[决策记录](.agents/notes/2026-10-10-swap-must-move-engines-dsh.md)）。**声明面是若干个族（`||`）的并集**（要同时承诺两族，npm 的预发布语义下必须枚举成并集），换版语义随之是「保留旧族、只替换目标族」，巡检矩阵 = **声明面承诺哪些族就测哪些族**（承诺一族 = 声明面加一族 + [compat.yml](.github/workflows/compat.yml) 矩阵加一行；两族的理由与代价见[决策记录](.agents/notes/2026-10-10-two-families-declared.md)，换包脚本的族机制见[另一篇](.agents/notes/2026-10-10-swap-moves-family.md)）
- **依赖写在 peer 还是 dev，判据是「我们与它的关系」，不是它住在哪一侧** —— 两类，缺一类就会出事：
  - **只做类型面（module augmentation）、我们只 `import type`** → 只写 `devDependencies`。现有两个：
    客户端的 `@deepseek-ai/dsh-client-ui-plugin-manager`（运行时关系由 `dsh.client.inject` 表达，peer 是重复声明）、
    宿主侧的 `@deepseek-ai/cordis-plugin-loader`（只为 `loader/volatile-update` 的事件声明，2026-09-22 加）。
  - **我们消费它提供的服务（运行时真的要用）** → 必须 `peerDependencies`（外加同一区间的 `devDependencies`，红线钉着版本相等）：
    装载器得把它与我们装在同一棵树里，否则 `ctx.<服务>` 在运行期就是 undefined。
    `@deepseek-ai/dsh-client-ui-settings` 属于这一类 —— 它是宿主服务 **`configForms` 的提供方**
    （宿主 `packages/client/ui-settings/src/client/config-form.ts:241` 的 `class ConfigForms extends Service`、
    `:266` 的 `super(ctx, 'configForms')`，行号以当前检出为准），而卡片经 `ctx.configForms.get(<entry id>)` **属性访问**它。
    源码里连一行 `import` 都没有；它留在 `devDependencies` 只是为了让 `plugin-manager` 的 `.d.ts` 能解析 ——
    **那不构成「只能写 dev」的理由，两种关系同时成立就该两边都写。**
    **注意那三条例行断言**（[test/redlines.test.ts](test/redlines.test.ts) 的 `peer ↔ dev 版本一致`、上下文相关包名单、声明面自洽）
    **都不覆盖「服务提供方是否被声明」** —— 删掉 peer 它们照样全绿，所以「全绿」不能当作这类改动的判据。
  理由、机制出处与替代方案见[决策记录](.agents/notes/2026-09-20-plugin-manager-dependency-kind.md)。
- **插件展示元数据（宿主界面上的名字、描述与图标）只住在包根**：[locale/](locale/) 的 `meta.title` / `meta.description` 是文案的唯一来源，[icon.svg](icon.svg) 是图标的唯一来源（由 `package.json` 顶层 `icon` 声明）。别处只留指针、不复制 —— 抄一份就有两处会漂，而宿主**读不到时不报错**（名字退回技术名；图标位空着就退回面板默认图案）。两者都由 [scripts/plugin-metadata.mjs](scripts/plugin-metadata.mjs) 判定随包与可解析（`npm run check:release` 与 [test/plugin-metadata.test.ts](test/plugin-metadata.test.ts) 读同一份），理由与回落链见[决策记录](.agents/notes/2026-09-22-plugin-display-metadata.md)，图标几何与配色判据见[图标记录](.agents/notes/2026-09-22-plugin-icon.md)
- **四个「通用 lint 那一档」的编译器开关仍在**（`noUnusedLocals` / `noUnusedParameters` / `noImplicitReturns` / `noFallthroughCasesInSwitch`），缺任何一个覆盖面就不成立 → 由 [test/redlines.test.ts](test/redlines.test.ts) 断言；client / test 两个 project 都 extends 根 `tsconfig.json`，一处生效三处。**它们与 ESLint 的分工**（开关管类型与死代码、ESLint 管编译器覆盖不到的那一档）见 [决策记录](.agents/notes/2026-09-27-adopt-eslint-prettier.md)
- **发布态不变量由脚本守卫**（`dsh.bundle.patch` 在、`private` 没设、`engines.dsh` 声明了、`files` 带 `cordis.patch.yml`、LICENSE 在）→ `npm run check:release`，[release.yml](.github/workflows/release.yml) 发布前跑。**端到端验收**（真实接口 + 宿主 `output.schema` 校验，补的正是 v1.4.0 那类漏）同样在 [release.yml](.github/workflows/release.yml)、**publish 前**跑一次：`node scripts/acceptance.mjs .`，**红了不发**，需要仓库 secret `ZHIHU_ACCESS_SECRET` → [scripts/acceptance.mjs](scripts/acceptance.mjs)
- 决策理由 → [.agents/notes/](.agents/notes/)
- 发版授权：patch / minor 按 [docs/PUBLISHING.md](docs/PUBLISHING.md) 的问题链定档后**直接发**；**major 必须先问人类**；**零行为变更不发版**（纯文档 / 测试 / CI / 等价重构）

## 事实来源（只查不抄）

- 版本号、依赖、宿主兼容性 → [package.json](package.json)
- 工具参数、默认值与上限 → [src/tools/](src/tools/) 的常量与 [src/transport.ts](src/transport.ts) 的端点契约常量（上限只住后者，工具层取别名），由 [test/tool.test.ts](test/tool.test.ts) 守护
- 端点语法与实测偏差 → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 构建产物的运行方式 → [docs/PUBLISHING.md](docs/PUBLISHING.md)
- DSH 平台知识（插件装配、Remote API、设置卡片、i18n、工具契约）→ [DSH cookbook](https://github.com/deepseek-ai/deepseek-harness/tree/master/docs/cookbook)，每篇都有 `.zh.md` 中文版
- **有自更新来源的事实一律指向来源**：测试与类型检查 → Actions；发布版本 → npm badge；产物一致性 → 哈希比对（见 [docs/PUBLISHING.md](docs/PUBLISHING.md) 的「打包内容」）。别在本文件留快照数值。

## 常用命令

- 本地钩子：`pre-commit install`（每个 clone 一次；本体 `uv tool install pre-commit`）——提交前自动 `prettier --write` + `eslint --fix`（`npx --no-install`，不联网）；CI 只读新增 format:check；全量跑 `pre-commit run --all-files`；临时跳过 `git commit --no-verify`；定义见 [.pre-commit-config.yaml](.pre-commit-config.yaml)

- `npm run build`（host tsc + client tsc + esbuild）· `npm run typecheck` · `npm test`（先 build 再 vitest）· `npm run test:contract`（打真实接口，需 `ZHIHU_ACCESS_SECRET`，日常 CI 不跑）
- 真机验收：`ZHIHU_ACCESS_SECRET=xxx node scripts/acceptance.mjs [包目录]` —— 默认验 profile 里装的那份，覆盖真实接口 + 宿主 schema 校验 + 渲染文本，见 [scripts/README.md](scripts/README.md)
- **发版两步，顺序是死的**：① 本地 `npm version <档位> [--preid=alpha] --no-git-tag-version` → `git commit`；② `gh workflow run release.yml`（**没有 tier 参数** —— workflow 只发 `package.json` 里那个号，它不 bump）。档位按 [docs/PUBLISHING.md](docs/PUBLISHING.md) 的问题链定；**dist-tag 由版本自己那段推**（`2.0.0-alpha.1` → `alpha`，稳定档 → `latest`）；同一条 X.Y.Z 线上推下一个 alpha 要用 `prerelease`，不是 `premajor`（后者开新线，从 `2.0.0-alpha.0` 会得到不可覆盖的 `3.0.0-alpha.0`）；无行为变更时 [守卫](scripts/release-guard.mjs) 会拦下（`-f force=true` 才能越过）
- 兼容性换包（本地复现 [compat.yml](.github/workflows/compat.yml)）：`node scripts/compat-swap.mjs swap <线>` —— 一条命令走完「改写整条声明面 → 清掉旧线的锁与树 → 裸 `npm install --ignore-scripts` → 核对实装版本」；测某一族（尤其低族）时加 `--only <前缀>` 临时把声明面收窄成单族（并集区间会被 npm 解析成装最高族，不收窄就测不到低族）。全部子命令见 [scripts/README.md](scripts/README.md)

## 验证快照（定性结论出自 2026-09-16 实跑；2026-09-24 复核过 main 的 CI、tag `v2.0.0` 与 npm `latest`，结论未变）

数字与版本一律看自更新来源（理由见「[文档网络与自更新](#文档网络与自更新)」）：测试与类型检查 → [Actions](https://github.com/dsh-plugin-lab/dsh-zhihu-search/actions)，发布版本 → [npm](https://www.npmjs.com/package/dsh-zhihu-search)。下面只记不随数字漂移的定性结论；更早轮次的真机验证见 [.agents/notes/](.agents/notes/) 与 `git log`。

- 契约测试：本机与 GitHub Actions 都实跑通过（后者由 repo secret `ZHIHU_ACCESS_SECRET` 供燃料）；每周一由 [contract.yml](.github/workflows/contract.yml) 跑；日常 `npm test` 不含 live 探针，只多一份底座的离线自检
- 真机验收：[scripts/acceptance.mjs](scripts/acceptance.mjs) 覆盖扩池 / 输出对称 / www 归一化 + 宿主 schema 校验 + 渲染文本；升级 + host 重启后在 profile 安装副本上跑通，工具面同参数复验一致
- 发版守卫：只有文档 / 工具脚本改动的区间在 `npm ci` 之前被拦下（后续步骤全 skipped，npm 侧零动作）；含 `src/` 的区间正常放行
- 诚实渲染：到顶必说 / 来源构成分流 / 空态首句条件限定由 [test/presentation.test.ts](test/presentation.test.ts) 固化；`count` 回满上限不额外提示（刻意防噪音）
- 宿主兼容性：由 [compat.yml](.github/workflows/compat.yml) 每周对 `next`（承诺线）与 `alpha`（**已低于声明下限，只记录**）换包，跑的是现有套件、不写新测试；结论与处理链归 [docs/PUBLISHING.md](docs/PUBLISHING.md) 的「兼容性」。这里只留定性结论：**类型面会先于行为面动**，所以「测试全绿」不能当作「兼容」的结论。**2026-09-24 承诺线迁到 `next`；2026-10-10 下限跟着抬到 RC 线起点**（此前下界停在 alpha 线那一段上，在 npm 的预发布语义下**永远罩不住** `next` 上的版本 —— 元组对不上，正是 issue #2 的 `declaration` 那条红）。具体值一律现查 `npm view @deepseek-ai/dsh dist-tags`，区间形状查 [package.json](package.json) 的 `engines.dsh`；理由是[决策记录](.agents/notes/2026-10-10-declaration-floor-to-rc-line.md)
- 明文迁徙：**真机跑通**（2026-09-16）—— 装入 1.6.2 + 重启 host 后，`settings.yaml` 的 `zhihu-search:` 段只剩 `disableNativeWebSearch`，值（40 位十六进制、与原明文逐字一致）落进 `.credentials.yaml` 的 `refs`，两个文件同一秒被改写。此前在 `lib/` 产物 + 真实 provider + 本机 `settings.yaml` **副本**上也跑通过（段内清理、其他 section 与注释原样保留、第二次运行是空操作）。
  **2026-09-22 起范围收窄**：设置文档那一层随这次接缝换代（2026-09-22）一起没了（宿主按 section 名导入且只映射三个官方 section，我们那段到不了插件），迁徙只剩**组合配置**一条来源，`purge` 通道退场。上面那条真机结论仍然真实，但它描述的是接缝换代之前的宿主

## 待办

- **卡片图已随 2026-09-22 那批改动重截完毕**（配置入口回到 bundle 详情页内联、显示名与描述改读 `locale`、
  左上角图标换成 [icon.svg](icon.svg) 的「鲸鱼 + 知」同色双拼 —— 三处都在新图里）。
  **下一次动渲染面时按判据重来**：改 `locale` 的文案、改 [icon.svg](icon.svg)、或改卡片的 JSX / 样式 / 可见状态
  都要**同批重截**两张（中英各一），判废项与拍摄路径见 [assets/AGENTS.md](assets/AGENTS.md) 与 [assets/README.md](assets/README.md)
- 清理旧明文通道：等使用者跨过当前版本后，删 `Config.accessSecret` 与 [src/migrate.ts](src/migrate.ts)（**必须一起删**，理由见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 的「`accessSecret` 为什么仍留在 schema 里」）。2026-09-22 起它服务的只剩**组合配置**一条来源
- **真机验收未做**：迁移后的卡片只有在「插件装回 profile + 宿主重启」之后才谈得上验收，装回由主 agent 收尾统一做；验收口径见 [scripts/README.md](scripts/README.md) 与 [docs/PUBLISHING.md](docs/PUBLISHING.md)
- **npm 上已发布版本的头图**：已核结清 —— `latest` 现为 2.0.0（现查 `npm view dsh-zhihu-search dist-tags`），那一页按 HEAD 的 README 渲染、图指 `assets/banner.svg`（现存文件），**不再断**。更早版本（v1.6.3 及以前）的页面文字发布时已定死、仍指被删的 `cover.svg`；**裁定：不为几个历史页面把 `cover.svg` 补回仓库**（那等于让一个没人引用的文件常驻），要真有人被误导再谈。
- **文档校验脚本还没落进本仓**：AGENTS 的「能落成校验的不写散文」这条目前对文档是空的（链接与行尾没有执行体）。容器仓 `dsh-plugins/scripts/check-links.py` 是本机可用的实现，收进来时要顺带回答「CI 跑不跑它」（`ci.yml` 现在没有 docs 步骤）
- **`prepare` 与 `dsh-ds-balance` 相反，本仓零解释**：本仓 `package.json` 声明 `"prepare": "npm run build"`，而 DSB 明文「本仓**不**声明 `prepare` —— 声明了 CI 的 `npm ci` 会先产出 `lib/`，`artifacts.test.ts` 那种『干净检出』判据就永远绿不到点上（那边踩过，见其决策记录）」。两仓同源，一个声明一个刻意不声明。**要么删掉本仓的 `prepare`，要么写清本仓为什么例外**（例如 profile 用 `link:` 挂载时依赖它保证产物新鲜）—— 属跨仓取舍，未裁

- **宿主推出新族（新的 major.minor.patch 预发布）时的处置**：声明面是并集，**不会自动罩住**新族。要不要加承诺是人工决定 —— 加则**手动**两处（[package.json](package.json) 的 `engines.dsh` 与 27 条声明加一族；[compat.yml](.github/workflows/compat.yml) 的测试矩阵加一行），之后 CI 自动跑；不加则那一族不在承诺内、也不测。判据与代价见[决策记录](.agents/notes/2026-10-10-two-families-declared.md)

## 活跃坑（工具链与 DSH 平台）

知乎 API 自身的反直觉处归 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)；**模块内的坑下放到对应子目录的 `AGENTS.md`**（在那里工作时自动注入），此处只留跨模块、踩了整条链就崩的几条。

- **宿主版本可能与 devDeps 错位**：本仓 devDeps 锁在某个宿主编译，实际运行的宿主可能更新。
  改代码前先跑 `dsh --version` 对比 `package.json` 的 devDeps；错位可能导致**编译通过但运行时崩**。
  升级 devDeps 要同步决定 `engines.dsh` 的兼容范围。
  - **连带一条：传递依赖也会被抬**。宿主线升级时，宿主包自己依赖的第三方包可能一并抬版；
    本仓若把它写死在旧版，包管理器会装出**两份同名包**，类型互不兼容 ——
    编译报「A 不能赋给 B」而两个路径都带 `node_modules`（姊妹仓 dsh-workbuddy-bridge 的
    `@earendil-works/pi-ai` 就是这么被 `dsh-llm-pi-ai` 从 `^0.85` 抬到 `^0.87` 的）。
  - **判据**：报错里出现两个不同层级的 `node_modules` → 不是类型定义变了，是同一个包装了两份。
    **处置**：把本仓那份升到与宿主同源的范围（用 `^`，别写死）。
  - **核验兼容性要在仓库外**：装目标线宿主包做类型比对时用临时目录。
    在仓内建目录的代价是双份的：包管理器把它当 workspace 成员，`add` 会顺带重排本仓 `node_modules`，
    并往锁文件写一条 **importer** 记录。目录删了记录还在，而**本机安装不带 frozen 校验会静默自愈**，
    只有 CI 的 frozen 模式才判红（姊妹仓 2026-10-02 三平台齐红，失败在第一步 install）。
    判据：在锁文件里搜那个目录名；处置：重新解析，别手工编辑锁文件。

- **生效链取决于 profile 怎么挂的，先查再假设**：`Get-Item <profile>\node_modules\dsh-zhihu-search | Select LinkType,Target`。
  - **符号链接到仓库**：`npm run build`（含 `npm test` 的 build）**直接写线上**，`dsh-client-hmr` 轮询 `lib/client.js` 当场换掉**浏览器半体**；host 半体要重启才换。改客户端半体因此免发版即生效，但**构建即上线** —— 没验证过的构建会立刻影响正在用的界面。
  - **普通目录（registry 副本）**：build → 发版 → `dsh plugin --profile web add dsh-zhihu-search@<ver>` → 重启。按版本安装会把链接换成副本，开发环也就断了。
  - 两种模式下 host 半体都只在启动时读，**必重启**；`dsh.profile.bundles` 同理。

- **`link:` 到 profile 外的插件，仓库必须自己装好 peer deps**（`npm install` 会做到）——
  它按**仓库路径**解析 `@deepseek-ai/*`，走不到 profile 的兜底目录；
  少了报 `ERR_MODULE_NOT_FOUND`、插件显示「未运行」。
- **半体可以错配**：浏览器半体热更、host 半体不热更，两者版本因此可能不一致（一次 build 或一次安装就能造成）。v1.6.0 的卡片回归就是这样暴露的 —— 维护者没装任何东西，仓库里一次 `npm run build` 就把线上浏览器半体换成了带 bug 的构建，而 host 半体仍是旧的（启动期迁徙因此从未执行）。**看到客户端半体报错时，别假设 host 半体是同一个版本。**
- **产物三副本**：改工具输出字段必须**同时**改 Canonical 类型、投影层、`output.schema`；宿主按最后一份校验（`additionalProperties: false`），漏一处 = 整个工具调用失败（v1.4.0 的 P0 → [复盘](docs/postmortem/2026-09-14-output-schema-drift.md)）。
- **DSH scope 机制**：原生网页工具**不在全局层**（住在 agent preset 的 standing scope），判断存在性必须站在 agent scope 上；取注册表只能走**免 inject 的 `agent.ctx.get('tools')`**（属性访问抛 `without inject`）。v1.3.0 因读全局视图而静默失效 → [复盘](docs/postmortem/2026-09-14-hidden-tool-restriction-noop.md)。
- **inject 门禁按服务名逐字判**：`ctx.x` 属性访问要求 `x` **逐字**出现在某个 fiber 的 `inject` 里，点号键**不展开**成父级 —— 声明了 `remote.credentials` **不等于**能访问 `ctx.remote`。同一机制已踩中两次（agent scope 的 `tools`、客户端半体的 `remote`，后者让卡片整块装不上）；碰平台服务先看官方同类插件的 `inject` 怎么声明 → [复盘](docs/postmortem/2026-09-15-client-inject-remote-missing.md)。
- **`ctx.get` 不是取服务的正路**：它按 cordis 文档是「不受 inject 约束的读取」，绕过的是门禁而非服务发现本身，跨挂载位置并不可靠。实测：同一上下文里 `ctx.tools`（inject + 属性访问）一直正常，而 `ctx.get('credentials')` 拿不到服务 —— 旧版有条兜底替它兜着，兜底一删工具就集体「没有 key」。**要服务就用 `inject` + 属性访问**；`agent.ctx.get('tools')` 是「agent scope 的依赖面不由我们决定」的特例，不是通用写法 → [复盘](docs/postmortem/2026-09-15-credential-service-unreachable.md)。
- **告警可能到不了终端**：v1.6.x 的每一处失败都 `warn` 过，维护者终端里一条都没有。判断故障别只看日志，先看文件状态与工具报错。
- **redact 是 schema 驱动的**：`redactSecrets` 只剥 schema 里带 `role('secret')` 的字段。把一个「代码已经不读」的密钥字段从 schema 里删掉，redact 会同时停止保护它，而功能测试全绿。接缝换代后下行的配置描述**只投影 volatile 字段**，所以非 volatile 的密钥字段已经不在这条线路上（本仓的 `accessSecret` 就是如此）—— 但这层保护对**任何新加的密钥字段**仍然靠角色声明，删字段前先读 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 的「密钥解析契约」。
- **挂载方式**：只用官方 CLI `dsh plugin --profile web add <path>`（它会顺带 reconcile `dsh.profile.bundles`），不要手改 `cordis.patch.yml`。
- **DSH 的 dist-tag 语义各不相同，`latest` 是陷阱**：**`next` = 当前承诺线**（2026-09-24 起；声明面落在它上面），`alpha` = 已低于我们声明下限的旧线（只作记录），`latest` **不可用** —— 多数 `@deepseek-ai/dsh-*` 上它指向很早的版本，具体值一律现查（`npm view @deepseek-ai/dsh dist-tags`）。装宿主必须点名线；锚点语义与红了怎么办见 [docs/PUBLISHING.md](docs/PUBLISHING.md) 的「兼容性」。
- **发版的两档预发布不是同义词，选错要赔一个版本号**：`prerelease` 在**同一条 `X.Y.Z` 线**上把预发布计数 +1，`premajor` **开新线**。从 `2.0.0-alpha.0` 跑 `premajor` 得到的是 **`3.0.0-alpha.0`**（semver 见 prerelease 不是 `[0]` 就给 major 加一），而 npm 上的版本号**不可覆盖**。本仓踩过一次：初版提案正是「先人工 bump 到 alpha.1 再跑 premajor」，被 Lead 用同一张实测表推翻 —— **别拿文档推断 semver，量一次**（`npm version <tier> --preid=alpha --no-git-tag-version` 在临时目录里跑）。另：**2026-09-22 起本仓改成版本驱动** —— workflow **不 bump**，bump 是发布前的本地一步（先 bump → 提交 → 再截图 → 最后发布），所以现在这句话反过来成立：**本地 bump 才是正路**。全套判据与实测输出见[决策记录](.agents/notes/2026-09-22-release-tiers-and-dist-tags.md)与[版本驱动那条](.agents/notes/2026-09-22-version-driven-release.md)。
- **接缝缺席是静默的，缺法有三种、各踩过一次**：
  - 宿主早于接缝换代时，客户端 `inject` 里的 `settingsScope` 让整个 `apply` 不执行（**声明一个已删服务 = 激活门禁不过**，用户只看到 pending）；
  - 客户端服务 `configForms` 缺席（更早的宿主）时**卡片整个不注册** —— 界面里没有任何配置入口；
  - **`entry id` 与包名不再同串**时卡片照常出现，但 `ctx.configForms.get(<entry id>)` 查不到命名空间 —— **永远只读且不报错**。
  三者都不报错。判据是「能不能拿到**这一条**的 `form`」，所以能力探测盯的是那条链上真正会断的两环（服务与槽），**不是槽名** —— 说谎的探测比没有探测更坏，见 [src/client/AGENTS.md](src/client/AGENTS.md)。
- **换包有两个方向相反的假信号，都踩过**：
  - **假红**：`npm install <包>@<tag>` 会把某个恰好没被点名的包**目录清空**（实测 `dsh-client-locale` 与 `dsh-client-ui-primitives` 都中过），随后 typecheck 报「找不到模块」。`--legacy-peer-deps` 也不是解药：它连 npm 的 peer 自动安装一起关掉，`dsh-tools` 自己的 peer 集体缺席。`--force` 更坏 —— 它把真实的 peer 冲突一起吞掉。正路是 [scripts/compat-swap.mjs](scripts/compat-swap.mjs)：**改写整条声明面 → 清掉旧线的锁与树 → 裸 `npm install --ignore-scripts` → `verify`**（换线是整棵树搬家，旧锁/旧树会让 npm 直接 ERESOLVE，2026-10-05 巡检的 `committed` 就是这么红的）。
  - **假绿**：`npm install` 因上游 peer 冲突退出时，`node_modules` 会**原封不动停在旧版本**上，随后 typecheck 与全套测试全绿。所以换包之后必须 `verify` 断言实装版本 —— **「测试全绿」不等于「跑在目标版本上」**。

## 文档网络与自更新

维护成本几乎全在「同步」上；下面五条把它压到最低 —— 从任何一处都能顺着链接找到该改的地方。

- **一条事实只有一个 home**：根 README 讲门面（给访客），本文件讲规则与仪表盘；子目录双件分讲「有什么 / 改哪」（README）与「在这里要怎么干」（AGENTS.md，进入该目录时自动注入）；[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 讲不变的设计与防错，[.agents/notes/](.agents/notes/) 讲为什么，[docs/PUBLISHING.md](docs/PUBLISHING.md) 讲怎么发。别处一律链接，不复制。
- **能自证的不抄（自更新）**：凡是有「会自己更新的来源」的事实就指向它 —— 测试与类型检查 → [Actions](https://github.com/dsh-plugin-lab/dsh-zhihu-search/actions)，发布版本 → [npm](https://www.npmjs.com/package/dsh-zhihu-search)，产物一致性 → 哈希比对。抄一次数字就要手动跟一次（本文件已经因此过时过两回），所以只留指针与不随数字漂移的定性结论。
- **能落成校验的不写散文**：五条红线 → 测试；发版噪音 → [release-guard](scripts/release-guard.mjs)；上游契约 → [contract.yml](.github/workflows/contract.yml)；**宿主版本线 → [compat.yml](.github/workflows/compat.yml)**；**文档链接与换行：本仓暂无校验脚本**（容器仓 `dsh-plugins` 有 `check-links.py`，没收进来）—— 改文档后手工做一遍相对链接与锚点检查，再加 `git diff --check`。把它做成仓内脚本是待办（见下）。机器判得了的规则，就别指望人记得。
- **改一处要查得到同步点**：每个子目录 README 的「变更影响路由」是同步清单的入口；新增或改名文件后必须回填，否则下一个人只能靠运气。
- **坑按作用域分流**：跨模块、踩了整条链就崩的留在本文件；模块内的下放到对应子目录 `AGENTS.md`，本文件不重复。

## 文档地图

- 外部贡献入口 → [CONTRIBUTING.md](CONTRIBUTING.md)（双语，另一份是 [CONTRIBUTING_en.md](CONTRIBUTING_en.md)）
- 架构设计 → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 发布流程 → [docs/PUBLISHING.md](docs/PUBLISHING.md)
- 事故复盘 → [docs/postmortem/](docs/postmortem/)
- 源码手册 → [src/README.md](src/README.md)
- 工具层 → [src/tools/README.md](src/tools/README.md)
- 参数编译、文本清洗与错误规范化 → [src/utils/README.md](src/utils/README.md)
- 呈现层 → [src/present/README.md](src/present/README.md)
- 浏览器半体 → [src/client/README.md](src/client/README.md)
- 测试对应关系 → [test/README.md](test/README.md)
- 构建与校验脚本 → [scripts/README.md](scripts/README.md)
- 图片资源与重截流程 → [assets/README.md](assets/README.md)（`banner.svg` 头图双语共用，其余资产的引用面见该文件）+ [assets/AGENTS.md](assets/AGENTS.md)（改渲染面必重截，先问再占用浏览器）
