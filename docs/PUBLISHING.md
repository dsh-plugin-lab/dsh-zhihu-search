# dsh-zhihu-search 发布说明

发布前必读。不变的设计约束归 [ARCHITECTURE.md](ARCHITECTURE.md)，日常命令与验证快照归 [AGENTS.md](../AGENTS.md)。

## 发版前确认

只列需要人判断的项；构建、测试、两处版本号一致、工作区状态由工作流自己保证。

0. **先 bump、再截图、最后发布** —— 顺序不能反（2026-09-22 定，跨仓规则 5b）：
   界面上的版本 tag 显示的就是 `package.json` 里那个号，而 release.yml **不 bump**。
   所以「bump 并提交」是**发布之前的独立一步**，排在截图之前 —— 反过来的话，
   截图拍到的永远是**上一个已发布版本**的号（本仓 2026-09-22 就是这么翻的车）。
0b. **远端必须已经有要发的那些提交**（2026-09-22 定，跨仓规则 5c）：`git rev-parse origin/main` **等于**
   `git rev-parse HEAD`。发布守卫判的是**远端**「上个 tag..HEAD」的区间 ——
   本地领先 11 个提交而没 push 时，远端那个区间是**空的**，守卫会正确地说「没有什么可发的」并拒发。
   注意这与第 0 条是同一类：**动作依赖什么状态，就先核那个状态**；而这一次依赖的是**远端**的，不是本地的。
   不对就把这些提交合到 `main`：常态是**开 PR 合并**（`main` 有 `protect-main` ruleset，直推会被拒）；
   自己是 admin 时可走 ruleset 的 **admin bypass** 直推，但既然是本仓的常态路径，优先走 PR。
1. 档位按下方[版本号](#版本号)的问题链定：**patch / minor 由维护 agent 定档后直接发，major 必须先经人类确认**。
2. `README.md` 与 `README_en.md` 的安装与配置说明与当前行为一致（两份必同改，见 [AGENTS.md](../AGENTS.md) 的全局规则）。
3. `cordis.patch.yml` 里**不含**任何凭据。

## 发版

**两步，顺序是死的**：

```bash
# ① 本地：定档 → bump → 提交（这一步不改远端任何东西）
npm version prerelease --preid=alpha --no-git-tag-version   # 同一条 X.Y.Z 线上的下一个 alpha
git commit -am "chore: release v2.0.0-alpha.1"

# ② 发布：把 package.json 里那个号发出去，workflow 不碰版本号
gh workflow run release.yml                                 # 或 Actions → Release → Run workflow
```

```bash
# ③ 发布之后：核远端与 npm 的最终状态
git fetch origin --tags && git log --oneline -1 origin/main   # main 已跟上
gh release list --limit 3                                     # 新号在列、标着 Pre-release
npm view dsh-zhihu-search dist-tags                           # alpha = 新号；latest 没动
```

一次运行按顺序做完：校验触发分支是 `main` → **守卫**（[`scripts/release-guard.mjs`](../scripts/release-guard.mjs)：上个 tag 以来没有产物改动就直接红）→ `npm ci` / typecheck / test → 拦两处版本号漂移（`package.json` ↔ `package-lock.json`）→ **读出** `package.json` 的版本 → 按版本自己的预发布段推 dist-tag → 幂等判据（这个号已在 npm 上就跳过 publish）→ **验收闸**（`node scripts/acceptance.mjs .`：打真实接口并过宿主 `output.schema`，需仓库 secret `ZHIHU_ACCESS_SECRET`；**红了不发**）→ `npm publish` → 推 `main` → `gh release create`（建 tag 与 GitHub Release，说明由 `--generate-notes` 依提交历史生成）。

六条设计约束：

- **先发布、后动远端**：publish 失败时远端不发生任何变化，tag 与 Release 也只可能在发布成功后创建。
- **幂等**：目标版本已在 npm 上时跳过 publish，只补齐 git 侧 —— 重跑一次即可修复「已发布但推送失败」的中断。
- **发布不得改写版本号（版本驱动）**：`release.yml` 只发 `package.json` 里那个号，**没有 bump 步**。判据是**会执行的命令行**（[scripts/check-release.mjs](../scripts/check-release.mjs) 的 `findVersionWrites`，`npm run check:release` 与 [test/release-workflow.test.ts](../test/release-workflow.test.ts) 读同一份，带反向控制）。为什么写成硬规则：界面上的版本 tag 就是那个号，workflow 自己 bump 会让工作树永远停在「上一个已发布版本」，**截图必然拍出旧号**。
- **dist-tag 由版本自己推导，不按输入参数判**：版本号带预发布段（`2.0.0-alpha.1`）就发到**那段本身**（`alpha`），否则走默认 `latest`；GitHub Release 的 `--prerelease` 与 publish 读同一个输出（`steps.version.outputs.dist_tag`）。判据只此一处，避免「推 latest 的那一档其实是预发布」—— `latest` 具体停在哪版一律现查 `npm view <包名> dist-tags`，本文不抄现值。
- **tag 名 = `v` + `package.json` 里的版本号**（`v2.0.0-alpha.1`），与全部历史 tag 同形；**前缀是显式补的、
  不从值里推**。2026-09-22 踩过：版本号原来取自 `npm version` 的输出（**自带 `v`**），改成读 `package.json`
  之后变成裸号，而 workflow 把那串**直接当 tag 名**用 —— 建出的 tag 与历史全不同形，还让本仓
  `git describe --tags --match 'v[0-9]*'` 的守卫**看不见它**。由 [test/release-workflow.test.ts](../test/release-workflow.test.ts)
  的正向断言 + 反向控制钉住。**换一个值的来源时，要连它的形状一起核**（前缀 / 大小写 / 末尾斜杠 / 是字符串还是数字）。
- **手工推 tag 不会发布**：tag 由工作流创建，绕过上面的顺序没有意义。
- **tag 与 GitHub Release 都由工作流创建**（本项目与 `dsh-ds-balance` 不同 —— 那边只打 tag 并推，Release 是手工补的）：
  最后两步是 `Push the release commit` → `Create the tag and the GitHub Release`（`gh release create … --generate-notes`，
  预发布另加 `--prerelease`）。**跑完不会只剩一个本地 tag**，但**要自己核一遍**：见上面第 ③ 步。
- **档位由判定链定，且在本地定完再发**：`npm version` 的档位（`patch` / `minor` / `major` / `prerelease` / `premajor`）写在**本地的 bump 命令**里，不从 commit 类型推断；patch / minor 由维护 agent 直接发，major 需人类确认。
- **两个预发布档别选错**：`prerelease` 在**同一条 `X.Y.Z` 线**上把预发布计数 +1（`2.0.0-alpha.0` → `2.0.0-alpha.1`），`premajor` 开**新的 `X.Y.Z` 预发布线**（`1.6.3` → `2.0.0-alpha.0`）。在同一线上推下一个 alpha 时用 `premajor` 会得到 `3.0.0-alpha.0` —— semver 见 prerelease 不是 `[0]` 就给 major 加一；而 npm 上的版本号**不可覆盖**。判据与实测输出见[决策记录](../.agents/notes/2026-09-22-release-tiers-and-dist-tags.md)。
- **不发无行为变更的版本**：bump 之前先比「上个 tag..HEAD」的改动清单，只剩非产物改动就红；`force` 是唯一的越过方式，且要说明理由。

## 发布后才发现严重缺陷

顺序固定，四步都要做：

1. **修 → 发 patch**（档位按[版本号](#版本号)的问题链定；修已发布缺陷一般是 patch）。
2. **`npm deprecate` 坏版本**：`npm deprecate "包名@<版本>" "<一句人话的原因 + 该升级到哪>" --registry=https://registry.npmjs.org/`。
3. **改坏版本的 GitHub Release 说明**：顶部加 `> [!WARNING]`，写清症状与替代版本 —— Release 说明是唯一能在「已经发出去之后」补充的对外面。
4. **新版本的 Release 说明也要说明它修了什么**：`--generate-notes` 只抄提交标题，标题未必自带结论。

三条边界：

- **`deprecate` 是警告不是拦截**：精确指定版本或 lockfile 钉住的安装**照样装上**，只多一行提示。真正拦住正常路径的是 `latest` 指向修好的版本。
- **不 unpublish**：撤版本会让钉住它的安装直接失败，也破坏可复现性。已发出的产物就当它存在。
- **`deprecate` 没有 OIDC 通道**：Trusted Publishing 只覆盖 `npm publish`，所以这一步**必须人工带 2FA 在本地做**，加进 [release.yml](../.github/workflows/release.yml) 也没用。仓库的 npm 侧设了「Require 2FA and disallow bypass-2FA tokens」，自动化凭据一律不可用。

判例：1.3.0（开关静默无效）、1.4.0（两个搜索工具整体失败）、1.6.0（卡片装不上）、1.6.1（工具无密钥）四个版本已按此标掉；理由与证据见 [docs/postmortem/](postmortem/)。

### 工作流文件头里的话也是「会执行的东西」的判据

[release.yml](../.github/workflows/release.yml) 顶部的注释是**给人读的用法说明**（怎么触发、有哪些输入），
所以它和正文一样会漂 —— 而**文档漂移不报错**，比代码漂移更耐久：

- 2026-09-22 实测：`tier` / `preid` 两个输入在改成版本驱动时撤掉了，
  但**文件头第 1 行还写着** `gh workflow run release.yml -f tier=patch`。
  GH Actions 对不存在的输入**不报错**（它只把没声明的 `-f` 忽略掉），
  所以照那行敲的人会**以为**自己选了档位，其实什么都没选 —— 所幸版本驱动下档位本来就在本地定，没造成实际后果。
- 判据落在 [test/release-workflow.test.ts](../test/release-workflow.test.ts) 的「工作流文本里没有过期指针」：
  文件里不得出现 `-f tier=` 与 `inputs.tier`，且必须写着无参数的 `gh workflow run release.yml`。
- **推广**：任何「用法说明 + 输入集」成对出现的地方（workflow 文件头、README 的安装段、脚本的 `--help`），
  改输入集时**同批改说明**；能落成断言的就落一条（这里落得动，因为它读的是同一个文件）。

## 版本号

按 SemVer 定档。判据是**原则加判定链**，不是清单：新情况按问题链推，不靠枚举命中。

### 使用者

所有判定都对着使用者问，先确认谁在依赖这个包：

- **模型**：读工具名、工具描述、参数 schema、返回文本。
- **人类使用者**：读插件配置卡片、README、安装命令、环境变量名、npm 页面元数据。
- **下游代码**：依赖包导出、`peerDependencies`、Node 与 DSH 的版本要求。
- **不算使用者**：CI、测试、`docs/`、[.agents/](../.agents/) —— 它们不进入发布产物。

### 三档原则

- **major**：使用者在旧版上**正确的用法**，升级后会出错或失败。
- **minor**：使用者旧用法**全部仍然正确**，且能观察到新能力。
- **patch**：使用者旧用法**全部仍然正确**，且观察不到新能力 —— 只是更正确、更快或更清楚。

### 判定问题链

按顺序问，**第一个「是」即定档**：

- **Q0**：改动是否改变**已发布产物的行为**（工具参数与描述、渲染文本、配置、导出面、构建产物）？否 → **不发版**，改动搭下次发布的车。
  - 判据是**行为**，不是文件路径：纯文档 / 测试 / CI / 工具脚本，以及**行为等价的内部重构**（端点常量换来源、改名、等价重写）都属于「否」。
  - 机器只判得了一半：`scripts/release-guard.mjs` 按路径拦下「上个 tag 以来全是非产物改动」的区间（见[发版](#发版)）；行为等价的重构它看不出，由回答 Q0 的人或 agent 负责。
- **Q1**：是否存在「在旧版上行为正确」的使用者，升级后行为变错或失败？是 → major。
- **Q2**：使用者是否必须改变自己的用法（调用、配置或依赖声明）才能继续正确工作？是 → major。
- **Q3**：使用者能否观察到「以前做不到的事现在能做到」？是 → minor。
- 全否 → patch。

### 判例库

本项目真实判例，每条注明套用哪一问。**只增不删**；与问题链冲突时以问题链为准，并把该条标注为「已 supersede」。

- 只动 `docs/`、`test/`、CI、[.agents/](../.agents/) → Q0 否 → 不发版，搭下次发布的车。
- ~~源码注释随 `lib/types.d.ts` 进入产物 → Q0 是 → patch~~ **已 supersede**：注释不构成行为，按现行 Q0 归「否」→ 不发版。
- 纯文档 / 测试 / CI / 工具脚本改动 → Q0 否 → **不发版**；`release-guard.mjs` 会直接拦下，确需发版时勾 `force`。
- 行为等价的内部重构（端点常量换来源、函数改名、等价重写）→ Q0 否 → **不发版**；守卫按路径判不出这类改动，靠 Q0 回答。
- 删除编造值（内容类型兜底成「回答」、点赞数缺失时假报 0）→ Q1 否（没有人能正确依赖一个编造值）→ patch。
- 输出 schema **收紧**（改名字、换类型、删字段、可选变必填）→ Q2 是 → major。
- 参数改名或删除 → Q2 是 → major。
- `peerDependencies` 大版本升级 → Q2 是 → major。
- 输出 schema **放宽**（字段变可选、允许省略值）→ Q1 否 Q2 否 → patch。
- 新增可选参数、新工具、新配置项、配置卡片新能力 → Q3 是 → minor。
- 重写工具描述让模型更容易择路（描述本身没错）→ Q3 是 → minor。
- 工具描述纯纠错（去掉一句做不到的承诺）→ Q1 否 Q3 否 → patch；描述随新能力一起更新 → 随该能力的档位。
- 补上端点本来就有、只是没透出的信号 → Q3 否（不是新能力）→ patch。
- 调整打包清单（排除 source map、补进英文 README）→ Q1 否 Q3 否 → patch。
- 包元数据纠错（`keywords`、npm 页面描述）→ Q1 否 Q3 否 → patch。
- **把发布流程从「档位驱动」改成「版本驱动」**（`release.yml` 去掉 bump、dist-tag 改按版本自己那段推；bump 变成发布前的本地一步）→ Q0 **是**（`.github/workflows/release.yml` 在产物判定里算改动，且下一次发布发的号由它决定）；Q1 否 Q2 否（使用者用法一个字都不用改）；Q3 否（**不是新能力**，是流程顺序的修正 —— 它修的是「截图必然拍出旧号」这个内部缺陷）→ **patch**。2026-09-22 判，与跨仓规则 5b 同批。
- **加插件展示元数据**（包根 `locale/<lang>.json` 的 `meta.title` / `meta.description` 进 `files` 与 `exports`，即宿主界面上的名字与那句描述；**同一批还给包根加了 `icon.svg`**，理由与几何判据见[图标记录](../.agents/notes/2026-09-22-plugin-icon.md)）→ Q0 **是**（渲染文本变了：插件页与设置里显示的不再是技术名，详情页描述那行从空变成一句话；`files` 也只增不减）；Q1 否（旧版上正确的用法不因此变错）；Q2 否（不需要改用法、不需要改配置）；Q3 否（**不是新能力** —— 只是同一件东西显示得更清楚，与上面两条包元数据判例同类；`README` 里「点哪个名字进详情页」这句话跟着改，属描述同步而不是新用法）→ **patch**。2026-09-22 判，本次带这份元数据的版本是 `2.0.0-alpha.1`（预发布线上按 SemVer 语义取整到 `2.0.0`）；图标（可选字段）本次未加，判据见[决策记录](../.agents/notes/2026-09-22-plugin-display-metadata.md)。
- 更新截图与 README 展示 → Q1 否 Q3 否 → patch —— 这是**搭车时的档位**，不是「为图发版」：`assets/` 与 `.md` 都不进产物，只含它们的区间会被[守卫](../scripts/release-guard.mjs)拦下，重截图随引起它的那次改动一起走（判例 `d0a3adb` 搭了 v1.4.0）。
- 新增可选开关（如「隐藏原生网页搜索」）→ 旧用法全部仍然正确，且能观察到新能力 → Q3 是 → minor。
- 修复已发布功能里的逻辑缺陷（开关存了却不生效）→ 旧用法仍正确、只是真的开始工作 → Q1 否 Q3 否 → patch。
- 补上漏声明的输出 schema 字段（宿主按 `additionalProperties: false` 校验，漏一处工具整体失败）→ 修复已发布缺陷 → patch；**发布后才发现**的回归另记[复盘](postmortem/2026-09-14-output-schema-drift.md)。
- **把声明面下限抬到 RC 线起点**（追承诺线，本例中承诺线随宿主迁到了 RC 线上）→ Q0 是（`package.json` 在产物里）；Q1 否（旧宿主上插件照常运行，只是不再承诺那条线）；Q2 是（落在旧线上的使用者必须升级宿主）→ 按问题链默认落点是 major，**实践走 minor**，理由是没有任何配置或数据因此失效；**必须发版**。2026-10-10 判，连同换版脚本那条链的修复（`engines.dsh` 同进同退、清旧线残留、红线收紧为「逐字相同」）→ [决策记录](../.agents/notes/2026-10-10-declaration-floor-to-rc-line.md)与[另一篇](../.agents/notes/2026-10-10-swap-must-move-engines-dsh.md)。
- 把密钥从设置字面量迁到凭据存储（启动期自动迁徙 + 卡片改走 `remote.credentials`）→ Q1 否（旧用法自动搬走，仍正确）Q3 是（密钥不再落 `settings.yaml`、徽标改问凭据域、只读遮蔽可见）→ **minor**。理由见[决策记录](../.agents/notes/2026-09-15-credential-store-migration.md)。2026-09-22 补记：迁徙此后只剩**组合配置**一条来源 —— 旧 `settings.yaml` 那半边随这次设置接缝换代（2026-09-22）一起消失（宿主按 section 名导入且只映射官方 section，结构上到不了本插件）。
- **Q1 的边界：新增对某个平台服务的硬依赖**，若标准装配必然提供它、且依赖它的那一边在不满足时**整体不工作**（而不是退化成错误行为）→ 不算 Q1 的破坏。上一条即此例：`remote.credentials` 是官方 web 装配的必备件，缺它时新版卡片本就不工作，旧用法谈不上「变错」。前提不成立时（标准装配不保证提供该服务）仍按 Q1 判 major。
- 修 v1.6.0 的卡片加载失败（`inject` 漏声明 `remote`，属性访问抛 `without inject`）→ 没有人**正确**的用法因此变错，也没有新能力 → Q1 否 Q3 否 → **patch**；**发布后才发现**的回归另记[复盘](postmortem/2026-09-15-client-inject-remote-missing.md)。
- 修 v1.6.0/v1.6.1 的工具「没有 key」与迁徙失效（`ctx.get('credentials')` 在线上装配里拿不到服务）→ 同理，旧用法不会因此变错，只是真的开始工作 → **patch**；发布后才发现 → [复盘](postmortem/2026-09-15-credential-service-unreachable.md)。

### 兜底与升级条款

- 问题链判不出的新情况：按**不破坏**假设往低档归（patch 或 minor）。在 [.agents/notes/](../.agents/notes/) 写决策记录，并提议是否扩展问题链 —— **不停下来等人类**。
- 唯一例外：判定落在 **major 时必须人类确认** —— major 是对使用者的不可逆承诺。
- 判例库与问题链冲突：以问题链为准，并给该判例标注「已 supersede」。

## 打包内容

发布内容由 [package.json](../package.json) 的 `files` 决定，**以它为准，本文不复制清单** —— 复制的清单会漂移，已经漏过一次 `README_en.md`。

六处需要解释，其余自明：

- `icon.svg` 必须随包：插件在**插件页卡片 / 详情页 / 设置清单**里的图标由宿主读清单声明的那个相对路径（顶层 `"icon": "./icon.svg"`，路径相对声明它的清单且必须留在包目录内）。缺了它**不报错**，只是那一格退回面板默认图案 —— 与 `locale` 同一族静默故障，判定同在 [scripts/plugin-metadata.mjs](../scripts/plugin-metadata.mjs)（另含扩展名、≤ 256 KiB）。**注意它与 `assets/logo.svg` 不是同一个文件**：图标是派生出来的 36×36 独立资产，改一个不动另一个。
- `locale/*.json` 必须随包，且被 `exports` 的 `./locale/*.json` 暴露：插件在**插件页与设置里的名字与描述**由宿主按包名读这两个文件（`meta.title` / `meta.description`），不走任何运行时通道。缺一条它**不报错**，只是退回技术名 —— 落地包与仓库里长得不一样，而本地开发（`link:` 挂载）永远看不出来。判定在 [scripts/plugin-metadata.mjs](../scripts/plugin-metadata.mjs)，`npm run check:release` 与 [test/plugin-metadata.test.ts](../test/plugin-metadata.test.ts) 读同一份。
- `lib/**/*.map` 被排除：这些 source map 指向未随包的 `src/`，对使用者是悬空的，却占了三分之一体积。tsconfig 仍生成它们，本地调试照常。
- `README_en.md` 必须随包：`README.md` 顶部链接指向它，不随包就是 npm 页面上的死链。
- `scripts/` 与 `src/` 不发布，因此 `npm run build` 必须在打包前跑过，`lib/` 是唯一交付物。
- `assets/` **不必**进包：npm 页面会把 README 里的相对图片路径改写到默认分支的 raw 地址（实测形态：`raw.githubusercontent.com/zlZayn/dsh-zhihu-search/HEAD/<仓库相对路径>`，按仓库里的原始尺寸渲染）。代价是**所有已发布版本的页面都跟着 `main` 上的图走** —— 换图或删图等于同时改历史版本的展示。

校验：

```bash
npm run build
npm pack --dry-run
```

需要证明 npm 上的产物与本地已验证的一致时：下载该版本的 tarball、解包，与仓库 `lib/` 逐文件比对 SHA-256 —— 一致即「发布产物 == 已验证产物」。
不必对裸包再跑一遍验收：包的 peer 依赖由宿主提供，裸包本来就跑不起来。

最省事的等价做法（也是唯一适合写进脚本的）：**先让两个来源本该相同，再比** ——

```bash
git status --porcelain --ignored=no   # 先确认工作树干净
npm pack --pack-destination "$TMP"    # 只放临时目录，别在仓里留 .tgz
npm view dsh-zhihu-search@<版本> dist.shasum   # 与上面那个 tarball 的 SHA-1 比
```

**比对之前必须先确认本机没有「不该有的东西」** —— 这条是本仓实测踩出来的（2026-09-22）：

| 来源 | 文件数 | 结果 |
|---|---|---|
| 本机 `npm pack` | **43** | shasum `9b8e1ead…` ✗ |
| npm 上（workflow 在干净检出里打的包） | **42** | shasum `bdd4d510…` |

差异只有一处：本机多一个 `lib/client.d.ts` —— **2026-09-13 遗留、不在 git 里**，
而 workflow 是 `npm ci` 之后从干净检出构建的，天然没有它。删掉即逐字节一致。
**错的是本机，不是远端产物** —— 这类假红与「假绿」是同一个病的两面：比对的两个来源本来就不同源。

- 同一批残留还有 `lib/client.d.ts.map` 与 `lib/client.js.map`（同为 9-13）：它们被 `files` 的
  `!lib/**/*.map` 挡在包外，**这次没影响，但同类残留还会再有** —— 别指望每次都被 `files` 挡住。
- 更稳的做法是**在干净检出里 pack**（`git clone` 一份 / `git worktree add` 一个临时树 + `npm ci` + `npm run build`），
  本机那份只用来开发。两种做法都行，**但不能跳过这一步直接比**。

## 构建链的两个事实

- 浏览器半体由 [scripts/build-client.mjs](../scripts/build-client.mjs) 用 esbuild 打成 DSH 的 lazy-CJS 工厂信封。
  官方生成该信封的预设 `clientBundle` 位于 DSH 仓库内 `packages/client/tsdown.client.ts`，**未发布到 npm**，
  所以本包自行复现 —— DSH 升级时需要回归 `test/client-bundle.test.ts`。
- 浏览器半体只允许值导入 `PLATFORM_MODULES` 里列出的模块（DSH `packages/client/web/src/platform.ts`）。
  超出该清单必须同时声明 `dsh.client.inject` 与 `dsh.client.external`。

## 认证与发布

### 主路径：Trusted Publishing（OIDC）

工作流声明 `id-token: write` 与 `environment: github-release`，npm CLI 据此换取短期凭据，**全程不带任何 token**。v1.2.8 即由该路径发布。

一次性配置（npmjs.com → 包 → Settings → Trusted Publisher → GitHub Actions）：

- **Organization or user**：`dsh-plugin-lab` —— 填 **GitHub 属主**，不是 npm 用户名。
- **Repository**：`dsh-zhihu-search`；**Workflow filename**：`release.yml`（只填文件名，不含路径）。
- **Environment name**：连接上显示的环境名（当前 `github-release`）**必须与 job 的 `environment:` 逐字一致**。
- **Allowed actions**：必须显式勾上 `npm publish` —— 2026-09-03 之后新建的连接默认只给 `npm stage publish`。
- npm 保存时不校验配置，填错只在发布时暴露。

排障：字段不符（属主 / 仓库 / workflow 文件名）通常报 `ENEEDAUTH`；**环境名不符实测报的是 `404 ... you do not have permission to access it`**，极易误读成权限问题 —— 先比对 `environment`，别按权限查。workflow 里的 `Dump the OIDC claims npm validates` 步骤只在发布失败时运行，打印 npm 校验时看到的声明。

时间约束：npm 已于 2026-07-31 收回这类 token 的账户与包管理权限，**2027-01 起收回直接发布**（[公告](https://github.blog/changelog/2026-07-31-restricting-npm-bypass-2fa-granular-access-tokens/)），故本项目不留长期凭据。

包的 Publishing access 已设为「Require two-factor authentication and disallow bypass-2FA tokens」：传统凭据一律不可用，发布只剩 OIDC 这一条路（该设置不影响 Trusted Publisher）。

### 备选：本地发布

```bash
npm run build
npm pack --dry-run
npm publish --registry=https://registry.npmjs.org/ --access public
```

本地发布只能靠交互式 2FA（`--otp=<码>`）：包已禁止 bypass-2FA 凭据，所以本地发布**无法**用 token 自动化 —— 要无人值守就只能是工作流。

本地发布不建 tag 与 GitHub Release：补 tag 走工作流重跑（幂等，不会重复发布），不要手工打 tag。

### 前置条件

- `package.json` 的 `repository.url` 必须指向真实仓库，否则 npm 拒绝 provenance 或页面上没有源链接。
- 所有 `@deepseek-ai/*` 保持在 `peerDependencies` 与 `devDependencies`，**不得**进 `dependencies` —— 见 [ARCHITECTURE.md](ARCHITECTURE.md) 的「不可破坏的约束」。
- `package-lock.json` 的 `resolved` 必须指向 `registry.npmjs.org`。锁文件若由国内镜像生成，CI 会去镜像取包（供应链隐患），且 `npm ci` 可能因 peer 未同步而失败。**这条已落成红线**（[test/redlines.test.ts](../test/redlines.test.ts) 的「锁文件」组）—— 别再靠人核对。
- **发布态不变量**（`dsh.bundle.patch` 在、`private` 未设、`engines.dsh` 已声明、`files` 含 `cordis.patch.yml`、LICENSE 在）已落成脚本 `npm run check:release`，[release.yml](../.github/workflows/release.yml) 发布前自动跑 —— 别再靠人核对这一节。
- 依赖变更后用 `npm install --registry=https://registry.npmjs.org/` 重建锁文件：本地用 `--legacy-peer-deps` 安装会让 `package-lock.json` 缺自动 peer，`npm ci` 随即失败。

## CI

- [ci.yml](../.github/workflows/ci.yml)：推 `main` 与每个 PR 跑 typecheck + test。
- [release.yml](../.github/workflows/release.yml)：手动触发，一次跑完[发版](#发版)全流程。
- [contract.yml](../.github/workflows/contract.yml)：每周一 01:00 UTC 盯**知乎开放平台**的行为指纹。
- [compat.yml](../.github/workflows/compat.yml)：每周一 02:00 UTC 盯**宿主 DSH** 的版本线，见[兼容性](#兼容性)。
  与 contract.yml 同构、分工不同：两条上游各自会悄悄漂移，时间错开是为了红了能分清是谁漂了。

两者都用 `npm ci`：它严格按锁文件安装，锁文件与 `package.json` 不同步时直接失败 —— 这是我们要在 CI 里拦下的情况。

两者都校验 `package.json` 与 `package-lock.json` 的**版本号**一致：ci.yml 在每次推送就拦，release.yml 在 bump 之前再拦一次。版本号写两处，漏一处不该等到发版才发现。

发版提交由 `dsh-shipwright` App token 推送，提交信息带 `[skip ci]`，因此不会再触发一轮 ci.yml；发布工作流自身已跑过 typecheck 与 test。

- 两份 workflow 的 action 均已升 v7：v7 移除了 dummy `NODE_AUTH_TOKEN` 兜底（`.npmrc` 引用 `${NODE_AUTH_TOKEN}`，而 `npm ci` 跑在带真 token 的 `npm publish` 之前）—— 2026-09-13 在 PR 分支用 `workflow_dispatch` 实跑验证过，无需为它退回 v4。
- action 版本漂移交给 [dependabot.yml](../.github/dependabot.yml)（每周一个 bump PR）。**PR 上的 CI 只跑 ci.yml：动 `release.yml` 的 PR 就算绿勾也不代表发布链路验过** —— 改发布链必须手动 dispatch 实跑。

## 兼容性

**声明面**只有一个事实来源：[package.json](../package.json) 的 `engines.dsh` 与全部 27 条 `@deepseek-ai/dsh-*`（三个依赖段加起来；两处**逐字相同**，由 [test/redlines.test.ts](../test/redlines.test.ts) 断言）。依赖的是 DSH 的**运行时行为**：`schema.volatile()` 的活引用语义（`.get()`）、**只有 volatile 字段进配置页**、`settings.configure({ auto: false }, fiber)`、`ctx.on('loader/volatile-update', …)`、`role('secret')` 脱敏、**`ctx.inject` 的属性访问语义**（不是 `ctx.get`）、`remote.credentials` 的 `describe`/`set`、`plugins.bundle.config` 的 keyed 分派（key = 包名，且**该槽不传 `form`**）、客户端服务 `ctx.configForms` 的 `get`/`getSnapshot`/`subscribe`/`mutate`、客户端模块格式。任一处改动都可能在升级后静默失效（卡片不显示、开关不生效、密钥读不到）。判断依据始终以 DSH 源码为准，不凭文档推断。

**验证面**是 [compat.yml](../.github/workflows/compat.yml)。声明与验证必须对齐 —— 改动任意一边都要同步另一边。

### 声明面是若干个族（`||`）的并集

npm 的预发布语义决定了一件事：**一个预发布候选只有在区间里存在「同一个 major.minor.patch、也带预发布段」的比较子时才匹配**。要同时承诺两族，单区间罩不住 —— 必须用 `||` 显式枚举成并集。所以声明面的形状是「若干个族（`||` 分隔）的并集」，换版语义随之是「保留旧族、只替换目标族」。

**巡检矩阵 = 声明面承诺哪些族就测哪些族，不是宿主发过就自动全测**（这是这套流程最容易误解的一点）：

- 声明面承诺了一族 → 它就**必须**出现在 [compat.yml](../.github/workflows/compat.yml) 的测试矩阵里，不跑就是假绿；
- 想**加承诺一个新族**（宿主推出新的 `major.minor.patch` 预发布，我们决定也支持）→ 这是一次**手动**动作：① 在 `package.json` 的声明面并集里加一族；② 在 `compat.yml` 的矩阵里加一行；两处之后 CI 自动跑那一族。
- 反过来，宿主发了新族但我们**不**加进声明面 → 那一族就不测（声明面没承诺它）。别把「矩阵」当成宿主的发布日历。

判据与「什么时候该加一族」的取舍见[决策记录](../.agents/notes/2026-10-10-two-families-declared.md)。

### dist-tag 是唯一可用的锚点

DSH 至今全是 prerelease，版本号本身不构成承诺，tag 才是。三个 tag 语义**各不相同**（`@deepseek-ai/dsh-*` 全家族一致）：

| tag | 含义 | compat.yml 怎么用 |
| --- | --- | --- |
| `next` | **当前承诺线**：声明面（`engines.dsh` + 27 条 DSH 依赖）落在这一条上 | 换包 + 跑全套；红了**必须修**（run 红） |
| `alpha` | **已低于本仓声明的下限** | 换包 + 跑全套；红了**只记录**（job 红、run 绿） |
| `latest` | **不可用** | 不碰 |

**2026-09-24 承诺线迁回 `next`**：宿主把新线（rc 档）发在 `next` 上、`alpha` 停在旧档（具体值现查 `npm view @deepseek-ai/dsh dist-tags`；区间形状看 `package.json` 的 `engines.dsh` —— 承诺线是**推荐**线，声明面是**安装前提**，两者可以不一致），本仓推荐的配置界面下限已跟着迁到那条线，承诺线因此落在 `next`。**2026-09-22 那次对调**（此前 next 承诺、alpha 前瞻）理由不是口味：本仓的配置接缝只存在于 alpha 线上 —— 接缝换代之前 `next` 线上没有 `configForms` 那套配置面（卡片因此拿不到表单），声明面只能跟着 alpha 走。而一条**长期必红**的周更任务会让「红 = 出事」这个信号失效，所以判断哪条线是承诺线，判据是「声明面落在哪」，不是历史习惯。

**2026-10-10 下限抬到 RC 线起点**：承诺线 2026-09-24 就迁到 `next` 了，但下界一直停在 alpha 线那一段上，而 npm 的预发布语义让它**永远罩不住** `next` 上的版本（候选带预发布段时，只有区间里同一个 `major.minor.patch` 也带预发布段才允许匹配 —— 两段写在不同补丁位上就永远对不上）—— 于是 `declaration` 作业自迁线起**每周必红**（issue [#2](https://github.com/zlZayn/dsh-zhihu-search/issues/2) 就是它）。修法是把整条声明面的下界抬到那条线的起点，与姊妹仓 `dsh-ds-balance` 换线时的做法同型。同一条语义的固有代价：**宿主再往前推一个补丁位的预发布时，这条下界会再次罩不住**，届时要再抬一次 —— 这不是形状选错，是「跟预发布线」这件事本身的代价。

`latest` 为什么不可用：多数 `@deepseek-ai/dsh-*` 包上它指向很早的版本，`@deepseek-ai/dsh` 自己那条也未必落在本插件的声明区间里 —— 逐包对照现查 `node scripts/check-declaration.mjs --line latest`（那个脚本收任意 dist-tag），宿主自己那条线现查 `npm view @deepseek-ai/dsh dist-tags`。按默认方式装宿主的人会落在声明范围之外，所以 [README](../README.md) 的前置版本必须写明装哪条线。

### 红了怎么办（按线分流）

**`next` 红 = 使用者会装到，必须修。**先判类别，三类处理完全不同：

- **换包或核对步骤失败** → 树根本没换成，先解决安装问题再看别的（多半是上游包之间的 peer 冲突）。这一条不能省：旧版本的树会让后面每一步都绿，报出一个**假兼容**。
- **类型面红** → 上游 API 签名变了。定位到具体包与符号，改调用点使其**新旧都能编译**；做不到就说明下限必须抬高，那是 Q2 是 → **major，先问人类**。
- **全量测试红** → **行为差异**，最重。按 [test/README.md](../test/README.md) 的分层定位：L3b/L6a 红说明平台语义变了，L1/L2 红则先怀疑换包装错了（那几层对宿主版本不敏感）。

**`alpha` 红 = 记录，不阻断。**它已不在本仓声明的区间里，换上去等于把依赖装到自己声明范围之外，红了通常只说明旧线上装不出新接缝 —— 那是**预期**，不是缺陷。这一类的价值只剩「旧线哪一步先坏」这份记录；不要按它去放宽声明（那会把使用者引到我们不再声明的线上）。
**预期内还有两条**：换到那条线时 `npm install` 可能直接 ERESOLVE（旧线上的包内部 peer 图与新声明对不上），以及部分包在那条线上还停在更早的版本、于是**换完的清单里会出现两种区间**，那条「逐字相同」的红线随之红 —— 两者都是「我们不再支持那条线」的直接推论，不是新缺陷。

### 声明面变动要同步的地方

- `peerDependencies` 的区间 → [README.md](../README.md) 与 [README_en.md](../README_en.md) 的「前置」版本（两份必同改）。
- `engines.dsh` 的区间 → 两份 README 的「版本兼容」章节（那份章节只指真源，不抄版本）：它声明的是**实际验证过的最低宿主版本**与**排除下一个大版本的上界**。
- **`engines.dsh` 与全部 27 条 `@deepseek-ai/dsh-*` 声明必须逐字相同**（2026-10-10 起：同一条区间字符串，连上界与运算符一起比）→ 由 [test/redlines.test.ts](../test/redlines.test.ts) 的「声明面自洽」一组断言；改一处就要改全部，否则使用者按我们给的区间装出来的宿主可能没有本插件赖以工作的接缝。判据收紧过一次：从「下限不得低于」到「逐字相同」，理由见[决策记录](../.agents/notes/2026-10-10-swap-must-move-engines-dsh.md)。
- [scripts/compat-swap.mjs](../scripts/compat-swap.mjs) 的换包写回是**保形**的：只替换区间里的下限版本，运算符与上界原样留下；它同时**一并改写 `engines.dsh`**、**清掉换线前的锁与树**、并自带 `verify` 核对实装版本。别改成 `'^' + version` 那种硬编码 —— 它会把声明面在 CI 里悄悄变形，而人只看到 job 绿。形状自检跑 `node scripts/compat-swap.mjs selftest`（[test/compat-swap.test.ts](../test/compat-swap.test.ts) 跑同一条）。
- 声明面与「README 让用户去装的那条线」由 [compat.yml](../.github/workflows/compat.yml) 的 `declaration` 作业对账，判定实现**只有一处**：[scripts/check-declaration.mjs](../scripts/check-declaration.mjs)（`npm run check:declaration`，或 `--line <tag>` 换一条线判）。它红了就是声明面落后，失败会开一条固定标题的跟踪 issue。**它只查承诺线（next）** —— 查一条我们不再声明的线，红只会变成每周的噪音。
- **区间放宽**本身不改行为（旧用法仍正确，只是允许更新的宿主）→ 按[版本号](#版本号)的 Q1/Q2 全否 → **patch**；但**必须发版**，声明在产物里。
- **下限抬到某条线**是另一种情形：旧宿主上的用法仍然正确，但那条线上的使用者必须升级宿主才能用新版本 —— 这是 Q2 **是**，按问题链的默认落点是 major，实践上一般走 **minor**（不改任何配置或数据，只缩窄承诺面）。2026-10-10 那次即按 minor 发，理由与替代方案见[决策记录](../.agents/notes/2026-10-10-declaration-floor-to-rc-line.md)。
- 已知缺口与待办见 [AGENTS.md](../AGENTS.md)。
