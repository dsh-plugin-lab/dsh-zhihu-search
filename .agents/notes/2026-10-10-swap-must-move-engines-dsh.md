# 决策：换版必须连带改写 `engines.dsh`，并让 verify 先验它（2026-10-10）

状态：生效

## 问题

换包脚本 [scripts/compat-swap.mjs](../../scripts/compat-swap.mjs) 原来只改写 `dependencies` / `devDependencies` / `peerDependencies` 三个依赖段，
**不碰 `engines.dsh`**。而 [test/redlines.test.ts](../../test/redlines.test.ts) 那一组断言要求
「全部 `@deepseek-ai/dsh-*` 声明与 `engines.dsh` 逐字相同」—— 两者由此每次换线都产生结构性矛盾：

- 宿主本体有两层**都不**落在受管面内：不在三个依赖段的任何一段里，且名字 `@deepseek-ai/dsh`
  **不带 `dsh-` 尾横线**（`SWAP_PREFIX` 是带尾横线的 `@deepseek-ai/dsh-`），`managedNames()` 收不到它。
- 换线后 27 条依赖全新线版本而 `engines.dsh` 留旧版，那条红线**必然红**。

本仓当时因为红线写的是「下限不得低于」而不是「逐字相同」，这个缺陷**没有立刻发作** ——
但它是一颗定时炸弹：谁把红线收紧（本就该收紧），巡检就变成每次换线必红；且红的位置
恰好会盖住真正的不兼容点（那时 typecheck 与测试都可能绿）。

## 事实（实测，非推断）

- 2026-10-10 本机复现：把「只动依赖段」的换版结果喂给 `npm test`，那一组断言全绿 ——
  说明当时的判据比声明面散文弱，脚本的缺口没有守卫。
- `swap` 之后再 `verify` 只看 `node_modules`，依赖段全绿而 `engines.dsh` 落后时会报
  「N 个包全部落在目标线上」——一个**假的干净结论**。
- 本仓声明面带**上界**（`>=下限 <下一个大版本`），所以换版逻辑必须保形地只替换**下限**那个版本号；
  姐妹仓 `dsh-ds-balance` 的形状没有上界，它的 `swapRange` 直接照搬过来会拒掉本仓的声明面。

## 决策

1. **`swap` 一并改写 `engines.dsh`**：宿主本体由 `applyPlan(manifest, plan, hostVersion)` 单独处理；
   manifest 缺该键直接抛错，不把声明面落在半路（抛错发生在写回之前，所以清单不会被写成半换状态）。
2. **`verify` 先验 `engines.dsh`**：这是独立的假绿修复，与红线强度无关。
3. **换版逻辑抽成纯函数 `applyPlan`**，形状表与「整份换版」断言放进 `selftest`，
   由 [test/compat-swap.test.ts](../../test/compat-swap.test.ts) 执行（不联网、不装依赖）。
   理由与本仓既有取向一致：**能落成可执行断言的不写散文**。
4. **红线收紧为「逐字相同」**：删掉 `floorOf` / `compareFloors` 那套下限比较（上界也是声明的一半），
   改为每条声明的整串区间必须与 `engines.dsh` 相同。
5. **顺带清掉一处重复判定**：换版脚本原来自带 `check <tag>`，与
   [scripts/check-declaration.mjs](../../scripts/check-declaration.mjs) 判同一件事，两份实现迟早各红各的。
   `check` 子命令删除，[compat.yml](../../.github/workflows/compat.yml) 的 `declaration` 作业改跑后者
   （后者覆盖面更大：连 `engines.dsh` 一起看）。

## 影响

- 换版不再制造结构性矛盾：每周巡检的 `committed` 作业跑在**前后一致**的清单上，
  红了就是真不兼容。
- 红线强度上升：有人在别处手改声明面（只改依赖段、不改 `engines.dsh`）时它会立刻红 ——
  这正是它该做的事。
- `selftest` 里有一条**反向控制**（没有 `engines.dsh` 时必须抛错），证明守卫真的会响而不是恰好绿。
- 不发版（脚本不随包进产物，见 [scripts/release-guard.mjs](../../scripts/release-guard.mjs) 的
  `NON_ARTIFACT_SCRIPTS`）；同批的声明面下限变更才是发版主体 → 见
  [2026-10-10-declaration-floor-to-rc-line.md](2026-10-10-declaration-floor-to-rc-line.md)。