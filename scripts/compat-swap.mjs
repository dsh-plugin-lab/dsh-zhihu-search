#!/usr/bin/env node
/**
 * compat 换包：把 DSH 的**整条声明面**就地换到某条 dist-tag 线（next / alpha）或某个**版本前缀**
 * 代表的族上，清掉旧线的残留，重装，再回头核对**真的装到了**那条线。
 *
 * 用法：
 *   node scripts/compat-swap.mjs swap   next          # 按 dist-tag 线换（保留声明面里的其他族）
 *   node scripts/compat-swap.mjs swap   0.1.7-rc      # 按版本前缀换（定位一族；无 tag 时用）
 *   node scripts/compat-swap.mjs swap   next --drop 0.1.7   # 换到 next 并显式删掉 0.1.7 族
 *   node scripts/compat-swap.mjs verify next          # 只核对（不改任何东西）
 *   node scripts/compat-swap.mjs selftest             # 换版保形的自检表（不联网、不装依赖）
 *
 * 声明面单独查「区间还罩不罩得住那条线」用 [check-declaration.mjs](check-declaration.mjs) ——
 * 它读的是同一份 `package.json`，判据只有一处。
 *
 * ## 声明面 = 依赖段 **加**宿主本体，换版必须整条同进同退
 *
 * `engines.dsh` 是声明面的另一半（使用者按它选宿主，按 peer 装插件），而它**两层都不在受管面内**：
 * 不在 `MANIFEST_FIELDS` 覆盖的三个依赖段里，名字 `@deepseek-ai/dsh` 也不带 `dsh-` 尾巴
 * （`SWAP_PREFIX` 是带尾横线的 `@deepseek-ai/dsh-`），`managedNames()` 收不到它。
 * 只换依赖段时，换线后 18 条依赖全新版而宿主本体停在旧版，与 [test/redlines.test.ts](../test/redlines.test.ts)
 * 的「逐字相同」必然矛盾 —— 那条红线会在**每次换线**时亮，亮的位置恰好会盖住真正的不兼容点。
 * 所以 `applyPlan()` 一并改写 `engines.dsh`，缺这个键就直接抛错（不把声明面落在半路）。
 *
 * ## 一个声明区间是**若干个族**的并集（`||` 分隔）
 *
 * npm 的预发布语义：候选带预发布段时，只有区间里**同一个 `major.minor.patch`** 也带预发布段
 * 才允许匹配。所以要同时承诺两族（0.1.7-rc 与 0.2.0-rc），单个区间**罩不住** ——
 * 必须用 `||` 显式枚举。实测：`>=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.1 <0.2.1-0`
 * 恰好罩住两族，`>=0.1.7-rc.1`（单区间）只罩得住 0.1.7 那族。
 *
 * 换版的语义随之变成「**保留旧族，只替换目标族**」：把当前声明里**元组与目标版本相同**的那一族
 * 换到目标版本，其余族原样留着。`--drop <前缀>` 显式删掉一族（换线到新族、放弃旧族时用）。
 *
 * **`--only <前缀>` 为什么必需**：并集区间对 npm 的含义是「这几族都合法」，它给每个包选的是
 * **匹配集里最高的**那族。所以要**测**承诺里的某一族（尤其是低族），不能靠保留全部族 ——
 * 实测（2026-10-10）保留两族换到低族时，`npm install` 装到的仍是最高族，`verify` 18 项全红。
 * `--only` 把声明面**临时收窄成只有目标族**，测的就是那一族；这份收窄后的清单是一次性的，
 * **不提交**（提交的那份始终是并集声明面 —— 那是给使用者的承诺）。
 *
 * 代价写在决策记录里：**宿主再推一个补丁位的预发布**（新的 `major.minor.patch`）时，这条并集
 * 不会自动罩住它，需要**手动加一族**（或用本脚本换一次）—— 这是「跟多条预发布线」的固有代价。
 *
 * ## 为什么是「改写 package.json + 清锁 + 裸 npm install」
 *
 * `npm install <包>@<tag>` 会清空某个**恰好没被点名**的包的目录（2026-09-16 实测多次假红）。
 * `--legacy-peer-deps` 不能用（关掉 peer 自动安装，dsh-tools 自己的 peer 全缺席）；`--force`
 * 更坏（吞掉真实冲突、造出假绿）。
 *
 * **换线等于整棵树搬家，必须从零解**（2026-10-05 巡检的 `next` 作业实测）：旧 `package-lock.json`
 * 记着换线**前**的解析，拿它去装新声明的 manifest 会直接 ERESOLVE。装了旧树的 `node_modules` 同理。
 * 两者都由本脚本清掉，让 npm 只按新 manifest 解 —— 本地复现与 CI 走同一条路径。
 *
 * 装的那一步固定带 `--ignore-scripts`：本仓声明了 `prepare`（= `npm run build`），裸装会先跑一次
 * build，于是**类型面一漂移 install 自己就非零退出**，类型面与行为面再也分不开。构建由随后的
 * `npm run typecheck` / `npm test` 显式驱动。
 *
 * ## 写回是**保形**的
 *
 * 换包只替换目标族里的**下限版本**，每个族的运算符与上界原样留下。硬编码 `'^' + version` 会把
 * `>=` 静默改回 `^`、把上界抹掉 —— 声明面在 CI 里当场变形，而人只看到 job 绿。认不出的形状
 * （`*`、`1.x`、`workspace:^`、`>=a <b <=c`）**报错停下**，不静默改写。
 *
 * ## 为什么必须有 verify
 *
 * `npm install` 会**假绿**：因上游 peer 冲突失败（exit 1）而 node_modules 停在旧版本上，随后
 * typecheck 与全部测试全绿。所以换包之后必须**断言装出来的版本就是目标线的版本**，不过就红。
 * `verify` 还先验 `engines.dsh`：依赖段全绿而宿主本体落后时，只看 node_modules 会报出
 * 「N 个包全部落在目标线上」——一个假的干净结论。
 *
 * ## 谁参与换包
 *
 * 只有 `@deepseek-ai/dsh-*`（外加单独处理的宿主本体 `@deepseek-ai/dsh`）。
 * `@deepseek-ai/cordis` 与 `@deepseek-ai/schemastery` 除外：它们的 `next` 比 latest 还旧，套 tag
 * 会把它们降级到声明范围之外。
 *
 * 某个包在目标线上没有版本时：出现在 `peerDependencies` → **失败**；只在 `devDependencies` →
 * 告警并跳过。
 *
 * 退出码：0 = 通过；1 = 失败；2 = 用法错误。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 只换 DSH 自己的包；理由见文件头。 */
const SWAP_PREFIX = '@deepseek-ai/dsh-';

/**
 * 宿主本体。它不带 `SWAP_PREFIX`（`dsh-` 带尾横线，宿主本体没有），所以天然落在
 * `managedNames()` 之外，必须单独处理 —— 声明面那一半就在 `engines.dsh` 里。
 */
const HOST_PACKAGE = '@deepseek-ai/dsh';

/** 声明区间可能出现的位置。`engines.dsh` 单独处理 —— 它不在任何一个依赖段里。 */
const MANIFEST_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'];

/**
 * 一个**族**的形状：**可选的单运算符 + 一个版本号**，后面可跟一个 `<上界`。
 *
 * 上界是本仓声明面的固定形态（`>=下限 <下一族`），所以它是形状的一部分而不是随便的尾巴。
 * 运算符与上界原样保留（见 {@link swapFamily}）：形状由维护者定，脚本只换版本号。
 */
const FAMILY_SHAPE =
  /^(>=|<=|>|<|=|\^|~)?\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?:\s+(<)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?))?$/;

/** 族之间用 `||` 分隔（并集）。分隔符两侧允许空格，读的时候 trim。 */
const FAMILY_SEPARATOR = '||';

/** 认识的 dist-tag。换线只在这几条线上有意义；别的一律按版本前缀处理。 */
const LINES = ['next', 'alpha', 'latest'];

const USAGE = `用法：
  node scripts/compat-swap.mjs swap <${LINES.join('|')}|版本前缀如 0.1.7-rc> [--drop <前缀> | --only <前缀>]
  node scripts/compat-swap.mjs verify <${LINES.join('|')}|版本前缀>
  node scripts/compat-swap.mjs selftest

--drop <前缀>：换线时显式删掉一族（放弃那条线的承诺）。
--only <前缀>：测某一族时把声明面**临时收窄成只有那一族**（并集区间会被 npm 解析成
               「装匹配集里最高的族」，不收窄就测不到低族）。测完的清单是一次性的，不提交。

退出码：0 = 通过 / 1 = 有未过 / 2 = 用法错误`;

/** 读版本一律打官方源：镜像可能落后，落后就会把「线还没动」误报成结论。 */
const REGISTRY = 'https://registry.npmjs.org/';

/**
 * 一个族：下限的运算符与版本、上界的运算符与版本。
 *
 * @typedef {{ op: string, version: string, upperOp: string, upper: string }} Family
 */

/**
 * 解析一个族（单个 `||` 分支）。认不出的形状抛错 —— 宁可红一次，也不静默改坏声明面。
 *
 * @param {string} declared - 单个族的声明串。
 * @returns {Family} 解析出的族。
 * @throws 形状不认识时抛出。
 */
function parseFamily(declared) {
  const shape = FAMILY_SHAPE.exec(declared.trim());
  if (shape === null) {
    throw new Error(
      '不认识的区间形状：' +
        declared.trim() +
        '（换版只支持「可选运算符 + 版本号」外加一个 `<上界`，请手工改这一条）',
    );
  }
  return {
    op: shape[1] ?? '',
    version: shape[2],
    upperOp: shape[3] ?? '',
    upper: shape[4] ?? '',
  };
}

/**
 * 把一个族**保形**地写回字符串（运算符与上界原样保留）。
 *
 * @param {Family} family - 族。
 * @returns {string} 声明串。
 */
function formatFamily(family) {
  const upper = family.upperOp === '' ? '' : ' ' + family.upperOp + family.upper;
  return family.op + family.version + upper;
}

/**
 * 把一个声明区间拆成若干个族（`||` 分隔的并集）。
 *
 * @param {string} declared - 完整声明区间。
 * @returns {Family[]} 族列表。
 * @throws 任何一族形状不认识时抛出。
 */
function parseFamilies(declared) {
  return declared.split(FAMILY_SEPARATOR).map((part) => parseFamily(part));
}

/**
 * 把族列表写回完整声明区间（`||` 连接，规范化分隔符两侧空格）。
 *
 * @param {Family[]} families - 族列表。
 * @returns {string} 声明区间。
 */
function formatFamilies(families) {
  return families.map(formatFamily).join(' ' + FAMILY_SEPARATOR + ' ');
}

/**
 * 一个版本的 `major.minor.patch` 元组（族的身份）。
 *
 * @param {string} version - 版本号。
 * @returns {string} 元组，如 `0.2.0`。
 */
function tupleOf(version) {
  const match = /^(\d+\.\d+\.\d+)/.exec(version);
  if (match === null) throw new Error('版本号读不出元组：' + version);
  return match[1];
}

/**
 * 把族列表里**元组与 target 相同**的那一族换到 `version`，其余族原样保留。
 *
 * 两种情形（这是「保留旧族、只替换目标族」的全部含义）：
 *   - **多族**：必须能找到同元组的那一族，换它、其余留着。找不到抛错 —— 换上去等于**新增**
 *     一条承诺，不该由脚本静默做（要加族请手工加，或 `--drop` 掉一族再让它换另一族）。
 *   - **单族**：把**那一族本身**换到 target（允许跨元组）。这是本仓声明面长期以来的行为 ——
 *     单族区间表达的是「就承诺这一条线」，换线就是把它推到目标那条。
 *
 * @param {Family[]} families - 族列表。
 * @param {string} version - 目标版本。
 * @returns {{ families: Family[], changed: boolean }} 换后的族列表与是否改动了。
 * @throws 多族且找不到目标族时抛出。
 */
function swapTargetFamily(families, version) {
  const tuple = tupleOf(version);
  const index = families.findIndex((family) => tupleOf(family.version) === tuple);
  const next = families.slice();
  // 单族：没有同元组就换掉它自己（跨元组换线）；多族：必须命中，否则抛错。
  const at = index === -1 && families.length === 1 ? 0 : index;
  if (at === -1) {
    throw new Error(
      '声明面里没有 ' +
        tuple +
        ' 这一族（现有：' +
        families.map((family) => family.version).join(' / ') +
        '）—— 换上去等于新增一条承诺，请手工加族后再换。',
    );
  }
  const before = next[at];
  const after = { ...before, version };
  const changed =
    before.version !== after.version ||
    before.op !== after.op ||
    before.upper !== after.upper ||
    before.upperOp !== after.upperOp;
  if (!changed) return { families: next, changed: false };
  next[at] = after;
  return { families: next, changed: true };
}

/**
 * 从族列表里删掉下限版本以 `prefix` 开头的那一族（`--drop`）。找不到不报错（幂等）。
 *
 * @param {Family[]} families - 族列表。
 * @param {string} prefix - 版本前缀，如 `0.1.7`。
 * @returns {{ families: Family[], dropped: number }} 删后的族列表与删除条数。
 */
function dropFamily(families, prefix) {
  const kept = families.filter((family) => !family.version.startsWith(prefix));
  return { families: kept, dropped: families.length - kept.length };
}

/**
 * 从族列表里**只保留**下限版本以 `prefix` 开头的那一族（`--only`）。
 *
 * 为什么需要它：声明面是**并集**，而 npm 解析一个并集区间时给每个包选的是**匹配集里最高的**那个版本。
 * 所以「测承诺里的某一族」不能靠保留全部族 —— 那样装出来的永远是最高族，低族根本测不到
 * （2026-10-10 实测：`swap 0.1.7-rc` 保留两族时，`npm install` 装到 0.2.0 族，`verify` 18 项全红）。
 * `--only` 把声明面**临时收窄成只有目标族**，测的就是那一族；测完的清单是一次性的，
 * 不提交（提交的那份仍是并集声明面 —— 那是给使用者的承诺）。
 *
 * @param {Family[]} families - 族列表。
 * @param {string} prefix - 版本前缀，如 `0.1.7`。
 * @returns {{ families: Family[], kept: number }} 收窄后的族列表与保留条数。
 */
function keepOnlyFamily(families, prefix) {
  const kept = families.filter((family) => family.version.startsWith(prefix));
  return { families: kept, kept: kept.length };
}

const tagsCache = new Map();
const versionsCache = new Map();

/**
 * 从 registry 读一个包的 dist-tags。
 *
 * 走 HTTP 而不是 `npm view`：少一层子进程依赖（本机 Windows 上裸名 `npm` 是 `.cmd`，
 * 无 shell 地 spawn 会直接失败，而经 shell 又会把区间里的 `<` / `^` 改义）。判定用的
 * 「区间能取到哪些版本」仍交给 npm 自己 —— 那件事在 [check-declaration.mjs](check-declaration.mjs) 里。
 *
 * @param {string} name - 包名。
 * @returns {Promise<Record<string, string>>} dist-tag 到版本。
 */
async function distTags(name) {
  if (tagsCache.has(name)) return tagsCache.get(name);
  const response = await fetch(REGISTRY + encodeURIComponent(name), {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  });
  if (!response.ok) throw new Error('registry 查 ' + name + ' 回了 ' + response.status);
  const tags = (await response.json())['dist-tags'] ?? {};
  tagsCache.set(name, tags);
  return tags;
}

/**
 * 读一个包的全部已发布版本号。
 *
 * @param {string} name - 包名。
 * @returns {Promise<string[]>} 版本号列表。
 */
async function publishedVersions(name) {
  if (versionsCache.has(name)) return versionsCache.get(name);
  const response = await fetch(REGISTRY + encodeURIComponent(name), {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  });
  if (!response.ok) throw new Error('registry 查 ' + name + ' 回了 ' + response.status);
  const body = await response.json();
  const versions = Object.keys(body.versions ?? {});
  versionsCache.set(name, versions);
  return versions;
}

/**
 * 把一条「线」解析成版本。两种线：
 *   - dist-tag（`next` / `alpha` / `latest`）→ 读该 tag 指向的版本；
 *   - 版本前缀（其余一切，如 `0.1.7-rc`）→ 取该前缀下**最高的**已发布版本。
 *
 * 版本前缀这条是给「没有 dist-tag 指向那一族」的场景用的（实测：没有任何 tag 指向 0.1.7-rc）。
 *
 * @param {string} name - 包名。
 * @param {string} line - dist-tag 或版本前缀。
 * @returns {Promise<string | undefined>} 版本；取不到时 `undefined`。
 */
async function resolveLine(name, line) {
  if (LINES.includes(line)) {
    return (await distTags(name))[line];
  }
  const versions = await publishedVersions(name).catch(() => []);
  const matching = versions.filter((version) => version.startsWith(line)).sort();
  return matching.length === 0 ? undefined : matching[matching.length - 1];
}

/** @returns {Record<string, any>} 解析后的 package.json。 */
function readManifest() {
  return JSON.parse(readFileSync('package.json', 'utf8'));
}

/**
 * 清单里所有受管的包名。
 *
 * @param {Record<string, any>} manifest - 解析后的 package.json。
 * @returns {string[]} 排好序的包名。
 */
function managedNames(manifest) {
  const names = new Set();
  for (const field of MANIFEST_FIELDS) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (name.startsWith(SWAP_PREFIX)) names.add(name);
    }
  }
  return [...names].sort();
}

function usageError(message) {
  console.error(message);
  console.error(USAGE);
  process.exit(2);
}

/**
 * 解析子命令参数：`<线> [--drop <前缀>] [--only <前缀>]`。
 *
 * @param {string[]} argv - 位置参数。
 * @returns {{ line: string, dropPrefix: string | undefined, onlyPrefix: string | undefined }} 线、删族前缀、只留族前缀。
 */
function parseArgs(argv) {
  const line = argv[0];
  if (line === undefined) usageError('缺线（dist-tag 或版本前缀）');

  /**
   * 取某个开关后面的值，缺值即用法错误。
   *
   * @param {string} flag - 开关名。
   * @returns {string | undefined} 值；没带这个开关时 `undefined`。
   */
  const valueOf = (flag) => {
    const index = argv.indexOf(flag);
    if (index === -1) return undefined;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      usageError(flag + ' 后面要跟一个版本前缀');
    }
    return value;
  };

  const dropPrefix = valueOf('--drop');
  const onlyPrefix = valueOf('--only');
  if (dropPrefix !== undefined && onlyPrefix !== undefined) {
    usageError('--drop 与 --only 只能给一个（都是「改声明面的族集合」）');
  }
  return { line, dropPrefix, onlyPrefix };
}

/**
 * 把 plan 应用到 manifest 上，就地改写，返回改了几处。
 *
 * 抽成纯函数是为了让 {@link selftest} 能**执行**它（不联网、不装依赖）：这条路径上曾经漏掉
 * `engines.dsh`，而漏掉的症状要等每周巡检 + 那条红线一起发作才看得见。
 *
 * 每个包的族列表各自处理（不同包在目标线上的版本可能不同元组？——同一线通常同元组，但脚本
 * 不假设：按**该包自己的**目标版本定位要换的那一族）。
 *
 * @param {Record<string, any>} manifest - 待改写的 package.json（就地修改）。
 * @param {{ name: string, version: string }[]} plan - 目标线上各受管包的版本。
 * @param {string} hostVersion - 宿主本体在目标线上的版本；用于换 `engines.dsh`。
 * @param {string} [dropPrefix] - 要显式删掉的族前缀（`--drop`）。
 * @param {string} [onlyPrefix] - 要**只保留**的族前缀（`--only`，测低族时临时收窄）。
 * @returns {number} 实际改写的处数（0 = 已经是目标线）。
 * @throws manifest 没有声明 `engines.dsh`、或某个包声明面里没有目标族时抛出。
 */
function applyPlan(manifest, plan, hostVersion, dropPrefix, onlyPrefix) {
  let touched = 0;

  /**
   * 把一条声明换到目标版本：先按 `--drop` 删族，再把目标族换到 version，返回新串与是否改动。
   *
   * @param {string} declared - 当前声明。
   * @param {string} version - 目标版本。
   * @returns {{ next: string, changed: boolean }} 新声明与是否改动。
   */
  const swapOne = (declared, version) => {
    let families = parseFamilies(declared);
    let reshaped = false;
    if (dropPrefix !== undefined) {
      const dropped = dropFamily(families, dropPrefix);
      families = dropped.families;
      reshaped = dropped.dropped > 0;
    } else if (onlyPrefix !== undefined) {
      // 临时收窄成只有目标族：并集区间会被 npm 解析成「装匹配集里最高的那族」，
      // 不收窄就永远测不到低族（理由见 keepOnlyFamily 的注释）。
      const kept = keepOnlyFamily(families, onlyPrefix);
      families = kept.families;
      reshaped = kept.kept !== parseFamilies(declared).length;
      if (kept.kept === 0) {
        throw new Error(
          '--only ' +
            onlyPrefix +
            ' 在声明面里没有匹配族（现有：' +
            parseFamilies(declared)
              .map((f) => f.version)
              .join(' / ') +
            '）',
        );
      }
    }
    if (families.length === 0) {
      throw new Error('改族之后声明面空了 —— 至少要留一族，请检查前缀');
    }
    const swapped = swapTargetFamily(families, version);
    const next = formatFamilies(swapped.families);
    return { next, changed: reshaped || swapped.changed || next !== declared };
  };

  for (const field of MANIFEST_FIELDS) {
    const block = manifest[field];
    if (!block) continue;
    for (const { name, version } of plan) {
      if (!(name in block)) continue;
      const { next, changed } = swapOne(block[name], version);
      if (changed) {
        console.log(field + '：' + name + ' ' + block[name] + ' → ' + next);
        block[name] = next;
        touched += 1;
      }
    }
  }

  // 声明面的另一半：宿主本体（理由见文件头）。缺了它就没法保证两边同进同退，直接抛错。
  const declaredHost = manifest.engines?.dsh;
  if (typeof declaredHost !== 'string') {
    throw new Error('package.json 没有声明 engines.dsh —— 换版会把它落在半路，请先补上');
  }
  const host = swapOne(declaredHost, hostVersion);
  if (host.changed) {
    console.log('engines.dsh：' + HOST_PACKAGE + ' ' + declaredHost + ' → ' + host.next);
    manifest.engines.dsh = host.next;
    touched += 1;
  }
  return touched;
}

/**
 * 清掉换线前的残留：锁文件与已装的树。理由见文件头（换线 = 整棵树搬家）。
 *
 * @returns {void}
 */
function clearStaleLine() {
  // 两种锁文件都清：npm 仓只有前者，pnpm 仓只有后者。留着旧锁 = 换线后直接 ERESOLVE，
  // 而装失败之后 node_modules 停在旧版本上，后面每一步都绿（假绿）。
  for (const lock of ['package-lock.json', 'pnpm-lock.yaml']) {
    if (existsSync(lock)) {
      rmSync(lock);
      console.log(`已删 ${lock}（它记着换线前的解析，留着会 ERESOLVE）。`);
    }
  }
  if (existsSync('node_modules')) {
    rmSync('node_modules', { recursive: true, force: true });
    console.log('已删 node_modules（它装的是换线前那条线的树）。');
  }
}

/**
 * 跑一次安装。
 *
 * `--ignore-scripts` 的理由见文件头（本仓的 `prepare` 会 build）；`shell: true` 只为在 Windows 上
 * 找得到 `npm.cmd`，参数里没有 shell 元字符。
 *
 * @returns {boolean} 是否成功。
 */
function install() {
  const result = spawnSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) {
    console.error('npm install 退出码 ' + String(result.status) + ' —— 树没换成，先解决安装问题。');
    return false;
  }
  return true;
}

/**
 * 换包：改写声明面 → 清旧线残留 → 装 → 核对。四步是一条命令，避免「只跑了前半段」。
 *
 * @param {string} line - 目标线（dist-tag 或版本前缀）。
 * @param {string} [dropPrefix] - 要显式删掉的族前缀（`--drop`）。
 * @param {string} [onlyPrefix] - 要只保留的族前缀（`--only`；测低族时用它临时收窄）。
 * @returns {Promise<number>} 进程退出码。
 */
async function swap(line, dropPrefix, onlyPrefix) {
  const manifest = readManifest();
  const plan = [];
  const skipped = [];
  for (const name of managedNames(manifest)) {
    const version = await resolveLine(name, line);
    if (version === undefined) {
      // 判定分档见文件头：只有 peer 缺失才红。
      if (name in (manifest.peerDependencies ?? {})) {
        throw new Error(name + ' 在 ' + line + ' 上没有版本（它声明在 peerDependencies 里）');
      }
      skipped.push(name);
      continue;
    }
    plan.push({ name, version });
  }
  if (skipped.length > 0) {
    console.log(
      '::warning::跳过 ' +
        String(skipped.length) +
        ' 个仅 dev 声明的包（' +
        line +
        ' 上没有版本）：' +
        skipped.join(', ') +
        ' —— 声明面此时会出现两种区间，红线会亮，那是真话。',
    );
  }

  const hostVersion = await resolveLine(HOST_PACKAGE, line);
  if (hostVersion === undefined) {
    throw new Error(
      '宿主本体 ' + HOST_PACKAGE + ' 在 ' + line + ' 上没有版本（engines.dsh 无从换起）',
    );
  }

  const touched = applyPlan(manifest, plan, hostVersion, dropPrefix, onlyPrefix);
  if (touched === 0) {
    console.log('已经是 ' + line + ' 的版本，package.json 未改动。');
  } else {
    writeFileSync('package.json', JSON.stringify(manifest, null, 2) + '\n');
    console.log(
      '\npackage.json 改了 ' +
        String(touched) +
        ' 处。回滚：git checkout package.json package-lock.json',
    );
  }

  clearStaleLine();
  if (!install()) return 1;

  console.log('\nnpm install 成功 —— 但这不代表装到了目标版本，接着核对。');
  return verify(line);
}

/**
 * 核对：声明面与**实装版本**都必须在目标线上。
 *
 * @param {string} line - 目标线（dist-tag 或版本前缀）。
 * @returns {Promise<number>} 进程退出码。
 */
async function verify(line) {
  const manifest = readManifest();
  let failed = 0;
  let skipped = 0;

  // `engines.dsh` 先验：它是声明面的一半。verify 漏掉它的话，半换过的 manifest 会在
  // 依赖段全绿的情况下被读成「这次换版是干净的」。
  const expectedHost = await resolveLine(HOST_PACKAGE, line);
  const declaredHost = manifest.engines?.dsh;
  if (expectedHost === undefined) {
    console.log('::warning::宿主本体 ' + HOST_PACKAGE + ' 在 ' + line + ' 上没有版本，无从核对。');
  } else if (typeof declaredHost !== 'string') {
    console.log('红  engines.dsh：package.json 没有声明它（声明面只有一半）');
    failed += 1;
  } else {
    try {
      const expectedRange = formatFamilies(
        swapTargetFamily(parseFamilies(declaredHost), expectedHost).families,
      );
      if (declaredHost === expectedRange) {
        console.log(
          'ok  engines.dsh：' +
            declaredHost +
            '（' +
            HOST_PACKAGE +
            ' 在 ' +
            line +
            ' 上是 ' +
            expectedHost +
            '）',
        );
      } else {
        console.log(
          '红  engines.dsh：声明 ' +
            declaredHost +
            '，' +
            line +
            ' 上的宿主本体是 ' +
            expectedHost +
            '，两者对不上',
        );
        failed += 1;
      }
    } catch (error) {
      console.log('红  engines.dsh：' + error.message);
      failed += 1;
    }
  }

  for (const name of managedNames(manifest)) {
    const expected = await resolveLine(name, line);
    if (expected === undefined) {
      // 判定分档同 swap()：peer 缺失算失败，仅 dev 缺失告警跳过。
      if (name in (manifest.peerDependencies ?? {})) {
        console.log('红  ' + name + '：在 peerDependencies 里，但 ' + line + ' 上没有版本');
        failed += 1;
        continue;
      }
      console.log(
        '::warning::' + name + ' 仅声明在 devDependencies，' + line + ' 上没有版本，跳过。',
      );
      skipped += 1;
      continue;
    }
    let installed;
    try {
      installed = JSON.parse(
        readFileSync(join('node_modules', name, 'package.json'), 'utf8'),
      ).version;
    } catch {
      installed = undefined;
    }
    if (installed !== expected) {
      console.log('红  ' + name + '：应为 ' + expected + '，实装 ' + String(installed));
      failed += 1;
    } else {
      console.log('ok  ' + name + '：' + String(installed));
    }
  }

  if (failed > 0) {
    console.error('');
    console.error(
      '::error::有 ' +
        String(failed) +
        ' 处没有落在 ' +
        line +
        ' 上 —— 换包那一步失败了，而旧版本的树会让测试全绿。',
    );
    console.error('先看 npm install 的输出：多半是上游包之间的 peer 冲突，需要清掉旧树重装。');
    return 1;
  }
  console.log(
    '确认：' +
      String(managedNames(manifest).length - skipped) +
      ' 个包与宿主本体都真的在 ' +
      line +
      ' 上。',
  );
  return 0;
}

/**
 * 换版保形的自检表（不联网、不装依赖）。
 *
 * 它是可执行的断言而不是散文：`swap` 会改 `package.json` 的声明面，而它曾经只动依赖段、
 * 曾经无条件写回 `^`、曾经把 `||` 判成不认识的形状 —— 每一类错都只在**每周巡检**里发作一次。
 * 末尾有两条**反向控制**：没有 `engines.dsh` 时必须抛错、声明面缺目标族时必须抛错。
 *
 * @returns {number} 0 = 全部符合预期；1 = 有不符合的。
 */
function selftest() {
  const cases = [
    // 本仓声明面的实际形状（多族并集）：换目标族，保留旧族。
    [
      '>=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.1 <0.2.1-0',
      '0.2.0-rc.2',
      '>=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.2 <0.2.1-0',
    ],
    [
      '>=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.1 <0.2.1-0',
      '0.1.7-rc.2',
      '>=0.1.7-rc.2 <0.1.8-0 || >=0.2.0-rc.1 <0.2.1-0',
    ],
    // 已经是目标版本时是空操作，但形状与其他族原样留下。
    [
      '>=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.2 <0.2.1-0',
      '0.2.0-rc.2',
      '>=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.2 <0.2.1-0',
    ],
    // 单族形状（换版面不止声明面这一处）。
    ['>=0.1.7-alpha.1 <0.3.0', '0.2.0-rc.1', '>=0.2.0-rc.1 <0.3.0'],
    ['>=0.2.0-rc.1 <0.3.0', '0.2.0-rc.2', '>=0.2.0-rc.2 <0.3.0'],
    ['>=0.2.0-rc.2 <0.3.0', '0.2.0-rc.2', '>=0.2.0-rc.2 <0.3.0'],
    ['>=0.1.7-alpha.1', '0.1.8-alpha.1', '>=0.1.8-alpha.1'],
    ['^0.1.6-alpha.2', '0.1.7-alpha.1', '^0.1.7-alpha.1'],
    ['~1.2.3', '1.2.4', '~1.2.4'],
    ['1.2.3', '2.0.0', '2.0.0'],
    ['=1.2.3', '1.2.4', '=1.2.4'],
    ['>1.0.0', '1.0.1', '>1.0.1'],
    ['>= 0.1.7-alpha.1', '0.1.8-alpha.1', '>=0.1.8-alpha.1'],
  ];
  const rejects = [
    '1.x || 2.x', // `||` 本身现在**合法**，但族内是 `1.x` 仍是坏形状
    '*',
    'workspace:^',
    'latest',
    '1.2',
    '>=0.2.0-rc.1 <=0.3.0',
    '',
  ];
  let failed = 0;
  let passes = 0;
  for (const [declared, version, expected] of cases) {
    let actual;
    try {
      actual = formatFamilies(swapTargetFamily(parseFamilies(declared), version).families);
    } catch (error) {
      console.log('FAIL  ' + declared + ' → 抛错：' + error.message);
      failed += 1;
      continue;
    }
    if (actual !== expected) {
      console.log('FAIL  ' + declared + ' → ' + actual + '（期望 ' + expected + '）');
      failed += 1;
      continue;
    }
    console.log('PASS  ' + declared + ' → ' + actual);
    passes += 1;
  }
  for (const declared of rejects) {
    try {
      const actual = formatFamilies(swapTargetFamily(parseFamilies(declared), '9.9.9').families);
      console.log('FAIL  ' + JSON.stringify(declared) + ' 应当被拒，却给出了 ' + actual);
      failed += 1;
    } catch {
      console.log('PASS  ' + JSON.stringify(declared) + ' 被拒');
      passes += 1;
    }
  }

  // `--drop`：显式删掉一族，其余族保留。
  try {
    const dropped = dropFamily(
      parseFamilies('>=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.1 <0.2.1-0'),
      '0.1.7',
    );
    const actual = formatFamilies(dropped.families);
    if (dropped.dropped === 1 && actual === '>=0.2.0-rc.1 <0.2.1-0') {
      console.log('PASS  --drop 0.1.7 → ' + actual + '（删 1 族，保留目标族）');
      passes += 1;
    } else {
      console.log(
        'FAIL  --drop 结果不对：' + actual + '（删了 ' + String(dropped.dropped) + ' 族）',
      );
      failed += 1;
    }
  } catch (error) {
    console.log('FAIL  --drop 抛错：' + error.message);
    failed += 1;
  }

  // 声明面整份换过去：依赖段与 `engines.dsh` 必须**同进同退**（多族并集形状）。
  const sample = {
    engines: { dsh: '>=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.1 <0.2.1-0', node: '>=20' },
    peerDependencies: {
      '@deepseek-ai/dsh-credentials': '>=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.1 <0.2.1-0',
    },
    devDependencies: {
      '@deepseek-ai/dsh-client-locale': '>=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.1 <0.2.1-0',
    },
  };
  const touched = applyPlan(
    sample,
    [
      { name: '@deepseek-ai/dsh-credentials', version: '0.2.0-rc.2' },
      { name: '@deepseek-ai/dsh-client-locale', version: '0.2.0-rc.2' },
    ],
    '0.2.0-rc.2',
    undefined,
  );
  const ranges = [
    ...new Set([
      sample.engines.dsh,
      ...Object.values(sample.peerDependencies),
      ...Object.values(sample.devDependencies),
    ]),
  ];
  const expectedUnion = '>=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.2 <0.2.1-0';
  if (ranges.length !== 1 || ranges[0] !== expectedUnion) {
    console.log('FAIL  换版后声明面没有落到同一条并集区间上：' + JSON.stringify(sample));
    failed += 1;
  } else if (touched !== 3) {
    console.log('FAIL  应当改写 3 处（两条依赖 + engines.dsh），实际 ' + String(touched) + ' 处');
    failed += 1;
  } else {
    console.log(
      'PASS  换版后 engines.dsh 与依赖段同进同退（旧族保留：' +
        expectedUnion +
        '，改写 ' +
        String(touched) +
        ' 处）',
    );
    passes += 1;
  }

  // `--only`：把声明面**临时收窄成只有目标族**（并集区间会被 npm 解析成「装最高族」，
  // 测低族必须收窄 —— 理由见 keepOnlyFamily / 文件头）。
  const onlySample = {
    engines: { dsh: '>=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.1 <0.2.1-0', node: '>=20' },
    peerDependencies: {
      '@deepseek-ai/dsh-credentials': '>=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.1 <0.2.1-0',
    },
  };
  const onlyTarget = {
    ...onlySample,
    engines: { ...onlySample.engines },
    peerDependencies: { ...onlySample.peerDependencies },
  };
  const onlyTouched = applyPlan(
    onlyTarget,
    [{ name: '@deepseek-ai/dsh-credentials', version: '0.1.7-rc.2' }],
    '0.1.7-rc.2',
    undefined,
    '0.1.7',
  );
  const onlyRanges = [onlyTarget.engines.dsh, ...Object.values(onlyTarget.peerDependencies)];
  if (onlyRanges.length !== 2 || onlyRanges.some((range) => range !== '>=0.1.7-rc.2 <0.1.8-0')) {
    console.log('FAIL  --only 0.1.7 没有把声明面收窄成只有目标族：' + onlyRanges.join(' / '));
    failed += 1;
  } else if (onlyTouched !== 2) {
    console.log(
      'FAIL  --only 应当改写 2 处（一条依赖 + engines.dsh），实际 ' + String(onlyTouched) + ' 处',
    );
    failed += 1;
  } else {
    console.log('PASS  --only 0.1.7 收窄成单族（>=0.1.7-rc.2 <0.1.8-0，两边同改）');
    passes += 1;
  }

  // 反向控制三：`--only` 前缀在声明面里没有匹配族时必须抛错（不能把声明面清空）。
  let onlyGuardFired = false;
  try {
    applyPlan(
      {
        engines: { dsh: '>=0.1.7-rc.1 <0.1.8-0' },
        peerDependencies: { '@deepseek-ai/dsh-tools': '>=0.1.7-rc.1 <0.1.8-0' },
      },
      [{ name: '@deepseek-ai/dsh-tools', version: '0.3.0-rc.1' }],
      '0.3.0-rc.1',
      undefined,
      '0.3.0',
    );
  } catch {
    onlyGuardFired = true;
  }
  if (onlyGuardFired) {
    console.log('PASS  --only 前缀无匹配族时抛错');
    passes += 1;
  } else {
    console.log('FAIL  --only 前缀无匹配族时没有抛错 —— 守卫没响');
    failed += 1;
  }

  // 反向控制一：manifest 没有 `engines.dsh` 时必须抛错停下，而不是把声明面落在半路。
  let guardFired = false;
  try {
    applyPlan(
      {
        engines: { node: '>=20' },
        peerDependencies: { '@deepseek-ai/dsh-tools': '>=0.2.0-rc.1 <0.3.0' },
      },
      [{ name: '@deepseek-ai/dsh-tools', version: '0.2.0-rc.2' }],
      '0.2.0-rc.2',
      undefined,
    );
  } catch {
    guardFired = true;
  }
  if (guardFired) {
    console.log('PASS  没有 engines.dsh 时换版抛错停下（不把声明面落在半路）');
    passes += 1;
  } else {
    console.log('FAIL  没有 engines.dsh 时换版没有抛错 —— 守卫没响');
    failed += 1;
  }

  // 反向控制二：**多族**声明面缺目标族时必须抛错（换上去等于新增一条承诺，不能静默加族）。
  // 注意用多族：单族区间跨元组换线是合法且长期存在的行为（单族 = 就承诺这一条线）。
  let familyGuardFired = false;
  try {
    swapTargetFamily(parseFamilies('>=0.1.7-rc.1 <0.1.8-0 || >=0.2.0-rc.1 <0.2.1-0'), '0.2.1-rc.1');
  } catch {
    familyGuardFired = true;
  }
  if (familyGuardFired) {
    console.log('PASS  声明面缺目标族时抛错（不会静默新增一条承诺）');
    passes += 1;
  } else {
    console.log('FAIL  声明面缺目标族时没有抛错 —— 守卫没响');
    failed += 1;
  }

  console.log('');
  if (failed > 0) {
    console.error(String(failed) + ' 条不符合预期 —— 换版会改坏声明面的形状，别信这次换版。');
    return 1;
  }
  console.log(String(passes) + ' 条全部符合预期（共 ' + String(passes + failed) + ' 条）。');
  return 0;
}

const [command, ...rest] = process.argv.slice(2);

let code;
try {
  if (command === 'swap') {
    const { line, dropPrefix, onlyPrefix } = parseArgs(rest);
    code = await swap(line, dropPrefix, onlyPrefix);
  } else if (command === 'verify') {
    const { line } = parseArgs(rest);
    code = await verify(line);
  } else if (command === 'selftest') code = selftest();
  else usageError('用法：node scripts/compat-swap.mjs <swap|verify|selftest>');
} catch (error) {
  console.error(error.message);
  code = 1;
}
process.exit(code);
