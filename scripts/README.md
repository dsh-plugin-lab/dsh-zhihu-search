# scripts/ — 构建与校验脚本

- 职责：构建可发布产物，并校验产物本身、发版资格与宿主兼容性。本目录脚本都不进入运行时。

## 文件索引

- `build-client.mjs`：用 esbuild 生成浏览器半体的 lazy-CJS 工厂信封（`window.__ModuleLoader__.load({ id, factory })`），被 `npm run build` 调用，产物为 `lib/client.js`。
  信封为何必须长这样、官方预设为何不能直接用 → 见 [docs/PUBLISHING.md](../docs/PUBLISHING.md) 的「构建链的两个事实」，此处不重述。
  **信封 id（`BUNDLE_ID`）读 `package.json` 的 `name`**，不在脚本里手抄包名；它必须等于包名（模块表以它作 key）。
- `release-guard.mjs`：**发版守卫**。从 stdin 读「上个 tag..HEAD」的改动清单，判定这段区间是否真的改变了已发布产物；只剩非产物改动时以非零退出码拦下发布。
- `plugin-metadata.mjs`：**展示元数据守卫**。读包根 [locale/](../locale/) 下的语言文件、[icon.svg](../icon.svg) 与 [package.json](../package.json)，断言「宿主要读得到插件名、描述与图标」所需的条件：`locale/<lang>.json` 被 `exports` 暴露（`./locale/*.json`）、被 `files` 收录、且 `meta.title` / `meta.description` 是非空字符串；图标侧照抄宿主 `iconOf` 的口径 —— 声明留在清单目录内、文件在、扩展名在名单里、`files` 收录、≤ 256 KiB（未声明图标时整组跳过，它是可选字段）。
  为什么需要它：宿主是**按插件名做 Node 资源解析**去读这份元数据的，上面任一条缺了它都**不报错** —— 插件页与设置静默退回技术名（`dsh-zhihu-search` / `zhihu-search`）。判定只写在这一处，[check-release.mjs](check-release.mjs) 与 [test/plugin-metadata.test.ts](../test/plugin-metadata.test.ts) 读**同一份**，避免红只红一边。
  机制与回落链（标题 `meta.title` → `name` → 完整 Cordis 名；描述 `meta.description` → `package.json.description` → 不显示）归 DSH：`docs/cookbook/adding-a-package.md` 的「5. Add optional plugin display metadata」与 `packages/boot/app-boot/src/package-meta.ts`，本仓库不复制。
- `plugin-metadata.d.mts`：上面那个判定模块的**类型面**（手写）。为什么手写而不是打开 `allowJs`：`tsconfig.test.json` 要 import 这个 `.mjs`，而 `allowJs` 会把本目录另外几个脚本一起拖进 `strict` 的检查面 —— 那是另一件事。**改实现时同批改它**，漂了不会静默（typecheck 与测试都会红）。

- `check-release.d.mts`：上面那个守卫的**类型面**（手写，理由与 `plugin-metadata.d.mts` 同：开 `allowJs` 会把本目录另外几个 `.mjs` 一起拖进 `strict` 检查面）。**改实现时同批改它**，漂了不会静默 —— `npm run typecheck` 会红。
- `check-release.mjs`：**发布态守卫**。断言五条发布态不变量（`dsh.bundle.patch` 在、`private` 未设、`engines.dsh` 已声明、`files` 含 `cordis.patch.yml`、LICENSE 在）**外加展示元数据与图标那几条**，被 `npm run check:release` 调用、[release.yml](../.github/workflows/release.yml) 发布前跑。
  口径是「能否改变 npm 上的产物」而非「文件是否随包发布」：`build-client.mjs` 自己不随包，却决定 `lib/client.js` 长什么样，所以算产物改动。接线在 [release.yml](../.github/workflows/release.yml)，判定规则归 [docs/PUBLISHING.md](../docs/PUBLISHING.md) 的 Q0。
- `acceptance.mjs`：**验收脚本**。对指定包目录的产物打真实接口，验三件事：下限扩池、输出面与排序档位对称、`site` 归一化；每条都过一遍宿主的 `output.schema` 校验器，并打印模型可见文本。
  用法 `ZHIHU_ACCESS_SECRET=xxx node scripts/acceptance.mjs [包目录]`，默认验本机 profile 里装的那份；退出码非 0 即有未通过项。
  为什么它必须存在：单元测试读的是 `execute()` 的返回值，既不过宿主那道校验，也拿不到渲染文本 —— v1.4.0 的 P0 正是漏在这条缝里（[复盘](../docs/postmortem/2026-09-14-output-schema-drift.md)）。
- `compat-swap.mjs`：**兼容性换包**。把 DSH 的**整条声明面**就地换到某条 dist-tag 线（`next` / `alpha` / `latest`）或某个**版本前缀**代表的族上，交给 [compat.yml](../.github/workflows/compat.yml) 去跑现有测试。
  子命令三条：`swap <线> [--drop <前缀> | --only <前缀>]`（一条命令走完四步，见下）、`verify <线>`（只核对）、`selftest`（形状表与整份换版的离线自检）。
  `swap` 的四步是**一次**动作，拆开写就会留下「只跑了前半段」的口子：
  1. **改写声明面**：三个依赖段里每条 `@deepseek-ai/dsh-*` **外加 `engines.dsh`**（宿主本体既不在依赖段里、名字也不带 `dsh-` 尾巴，所以单独处理；manifest 缺这个键直接抛错，不把声明面落在半路）。
  2. **清掉换线前的残留**：`package-lock.json` 与 `node_modules`。换线是**整棵树搬家** —— 旧锁记着旧线的解析、旧树装着旧线的包，拿着它们去装新声明的 manifest 会直接 ERESOLVE（2026-10-05 巡检的 `committed` 就是这么红的）。
  3. **裸 `npm install`**：固定带 `--ignore-scripts`（本包声明了 `prepare` = `npm run build`，不带它 install 会先 build，类型面一漂移 install 自己就挂，类型面与行为面再也分不开）；`--legacy-peer-deps` / `--force` 一律不用，理由见脚本头部注释（实测结论，不是推断）。
  4. **`verify` 核对实装版本**：先验 `engines.dsh`，再逐包断言 `node_modules` 里的版本就是目标线的版本。它自己有独立价值 —— `npm install` 会**假绿**（失败但树停在旧版本上，随后测试全绿）。
  **声明面是若干个族（`||`）的并集**，换版语义是「**保留旧族、只替换目标族**」：按「元组相同」定位要换的那一族，其余族原样留着。两个改族集合的开关：
  - `--drop <前缀>`：显式删掉一族（换线到新族、放弃旧族时用）。
  - `--only <前缀>`：**测某一族时把声明面临时收窄成只有那一族**。为什么必需 —— 并集区间对 npm 的含义是「这几族都合法」，它给每个包选的是**匹配集里最高**的那族（实测 2026-10-10：保留两族换到低族时装到的仍是最高族，`verify` 18 项全红）。收窄后的清单是一次性的，**不提交**（提交的那份始终是并集声明面 —— 那是给使用者的承诺）。
  线的参数既收 dist-tag 也收**版本前缀**（如某条旧 RC 族）—— 实测没有任何 dist-tag 指向某些族，此时用前缀定位「该前缀下最高的已发布版本」。
  为什么是「改写 package.json + 裸 `npm install`」而不是 `npm install <包>@<tag>`：后者会清空某个恰好没被点名的包的目录（实测 `dsh-client-locale` / `dsh-client-ui-primitives` 都中过），是假红；正路与全部实测理由见脚本头部注释。

- `check-declaration.mjs`：**声明面判定**（与 [compat.yml](../.github/workflows/compat.yml) 的 `declaration` 作业同一实现，也是这件事**唯一**的实现 —— `compat-swap.mjs` 不再自带一份同名判定）。只读 `package.json`、再问 npm，断言「我们声明的区间还罩不罩得住**承诺线**」，并同时看 `engines.dsh` 与三个依赖段里的每一条。
  承诺线是脚本里的 `TRACKED_LINE` 常量（当前 `next`）——为什么是它，见 [docs/PUBLISHING.md](../docs/PUBLISHING.md) 的「兼容性」。入口：`npm run check:declaration`（要换一条线判就 `node scripts/check-declaration.mjs --line <tag>`）。
  红了 = 声明面罩不住我们推荐用户装的那条线：要么放宽声明，要么抬下限（抬下限会动使用者面，档位按 PUBLISHING 的判定问题链走）。
  注意：声明下限**不等于**推荐线 —— 区间只要**罩得住**那条线就成立（区间形状见 [package.json](../package.json) 的 `engines.dsh`，具体宿主版本一律现查）。
## 变更影响路由

- 改信封格式或 external 清单 → 跑 `test/client-bundle.test.ts`（只请求平台模块）与 `test/dist.test.ts`（编译图可求值）。
- 改产物路径 → 必须同时确认不与 `tsc` 输出撞车，并同步根 [package.json](../package.json) 的 `exports['./client']`。
- 改构建脚本 → 同步 [docs/PUBLISHING.md](../docs/PUBLISHING.md) 的「构建链的两个事实」。
- 改验收脚本 → 在真机 profile 上实跑一次（默认目标就是它），确认结论可复现；不进 `ci.yml`（花真实配额），但**发布闸**在 [release.yml](../.github/workflows/release.yml) 里跑一次，目标写 `.`（本次产物）。
- 改守卫的判定口径 → 同步 [docs/PUBLISHING.md](../docs/PUBLISHING.md) 的 Q0 与判例库；改完用「纯文档区间」和「含源码区间」各喂一次 stdin，确认两个方向都对。
- 改声明面判定（`TRACKED_LINE`、区间形状）→ 同步 [docs/PUBLISHING.md](../docs/PUBLISHING.md) 的「兼容性」两节与两份 README 的前置版本（必同改）。
- **改 `package.json` 的 `exports` / `files` / `description` / `icon`，或改 [locale/](../locale/) 的语言文件与包根 [icon.svg](../icon.svg) → 三处必须同批走**：① 包根 `locale/*.json` 两份（文案真源）与 `icon.svg`（图标真源）；② `package.json`（`files` 收录 `locale/*.json` 与 `icon.svg`、`exports` 暴露 `./locale/*.json` 与 `./package.json`、`description` 与 `locale/en.json` 的 `meta.description` 同内容、`icon` 声明留在清单目录内）；③ 回归 `npm run check:release` 与 `test/plugin-metadata.test.ts`（读同一份判定，含反向控制）。改了 `meta.title` 或图标还会挪动插件页上的显示名与外观 → 顺带走一次 [README.md](../README.md) / [README_en.md](../README_en.md) 的「配置」节与 [assets/AGENTS.md](../assets/AGENTS.md) 的判废项（**改图标 = 必须重截卡片图**）。
- 改换包脚本的参与范围或判据 → 同步 [compat.yml](../.github/workflows/compat.yml) 的注释与 [docs/PUBLISHING.md](../docs/PUBLISHING.md) 的「兼容性」节；**声明面的判定只有一处实现**（`check-declaration.mjs`），别在换包脚本里再养一份；改完后用 `node scripts/compat-swap.mjs selftest`（[test/compat-swap.test.ts](../test/compat-swap.test.ts) 跑同一条）与 [test/redlines.test.ts](../test/redlines.test.ts) 的「声明面自洽」复核。

## 参考

- 产物为何必须是这个格式 → 见 [docs/PUBLISHING.md](../docs/PUBLISHING.md)
- 使用约束与工作偏好 → 见 [AGENTS.md](AGENTS.md)
