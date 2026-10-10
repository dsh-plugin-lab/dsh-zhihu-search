#!/usr/bin/env node
/**
 * compat 换包：把 DSH 的**整条声明面**就地换到某条 dist-tag 线（next / alpha）上，
 * 清掉旧线的残留，重装，再回头核对**真的装到了**那条线。
 *
 * 用法：
 *   node scripts/compat-swap.mjs swap   next    # 改写 package.json → 清锁清树 → 装 → 自动核对
 *   node scripts/compat-swap.mjs verify next    # 只核对（不改任何东西）
 *   node scripts/compat-swap.mjs selftest       # 换版保形的自检表（不联网、不装依赖）
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
 * ## 为什么是「改写 package.json + 清锁 + 裸 npm install」
 *
 * `npm install <包>@<tag>` 会清空某个**恰好没被点名**的包的目录。2026-09-16 在 npm 12.0.1 上实测：
 * 点名 18 个包时 dsh-client-locale 被清空，点名另外 17 个时 dsh-client-ui-primitives 被清空 ——
 * 目录还在、里面是空的，随后 typecheck 报「找不到模块」，是一个与上游毫无关系的**假红**。
 * 而 `--legacy-peer-deps` 同样不能用：它会把 npm 的 **peer 自动安装**一起关掉，于是 dsh-tools 自己的 peer
 * （dsh-sandbox / dsh-sandbox-policy / dsh-ptc-runtime）一个都不装，测试以「Cannot find package」假红。
 * `--force` 也不是解药：它会把**真实**的 peer 冲突一起吞掉，正好造出「假绿」。装了旧树才冲突，
 * 所以正解是下面这条「从零解」。
 *
 * **换线等于整棵树搬家，必须从零解**（2026-10-05 巡检的 `next` 作业实测）：
 * `package-lock.json` 记着换线**前**的解析，拿着它去装新声明的 manifest 会直接 ERESOLVE
 * （锁里是 `dsh-sandbox-policy@0.1.7-alpha.1`，它要 `dsh-agent@^0.1.7-alpha.1`，而根声明要 `>=0.2.0-rc.2`）。
 * 装了旧树的 `node_modules` 同理。两者都清掉，让 npm 只按新 manifest 解 —— 本脚本自己做这件事，
 * 不指望调用方记得（本地复现与 CI 走的是同一条路径）。
 *
 * 装的那一步固定带 `--ignore-scripts`：本仓声明了 `prepare`（= `npm run build`），裸装会先跑一次
 * build，于是**类型面一漂移 install 自己就非零退出**，类型面与行为面再也分不开（compat.yml 的
 * 分流诊断正是为分清这两者而存在）。构建由随后的 `npm run typecheck` / `npm test` 显式驱动。
 *
 * ## 写回是**保形**的
 *
 * 换包只替换声明区间里的**下限版本**，比较符与上界原样留下（`>=0.1.7-alpha.1 <0.3.0` →
 * `>=0.2.0-rc.2 <0.3.0`）。硬编码一个 `'^' + version` 会把 `>=` 静默改回 `^`、把上界抹掉 ——
 * 声明面在 CI 里当场变形，而人只看到 job 绿。认不出的形状（`||`、`*`、`1.x`、`workspace:^`）
 * **报错停下**，不静默改写。
 *
 * ## 为什么必须有 verify
 *
 * 2026-09-16 实测到一个会**假绿**的失败模式：`npm install` 因上游包之间的 peer 冲突直接失败（exit 1），
 * 而 node_modules 原封不动地停在旧版本上；随后 typecheck 与全部测试全绿 —— 整条线报「兼容」，
 * 实际上一个新包都没装。所以换包之后必须**断言装出来的版本就是 tag 上的版本**，断言不过就红。
 * `verify` 还先验 `engines.dsh`：依赖段全绿而宿主本体落后时，只看 node_modules 会报出
 * 「N 个包全部落在目标线上」——一个假的干净结论。
 *
 * ## 谁参与换包
 *
 * 只有 `@deepseek-ai/dsh-*`（外加单独处理的宿主本体 `@deepseek-ai/dsh`）。
 * `@deepseek-ai/cordis` 与 `@deepseek-ai/schemastery` 除外：它们的 `next` 标签**比 latest 旧**，
 * 套 tag 会把它们降级到声明范围之外。
 *
 * 某个包在该 tag 上没有版本时：
 *   - 它出现在 `peerDependencies` → **失败**（声明面点名了一条线上不存在的版本）；
 *   - 它只是 `devDependencies` → 告警并跳过（此时声明面会短暂出现两种区间，红线会亮，那是真话）。
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
 * 认识的区间形状：**可选的单运算符 + 一个版本号**，后面可跟一个 `<上界`。
 *
 * 上界是本仓声明面的固定形态（`>=下限 <下一个大版本`），所以它是形状的一部分而不是随便的尾巴。
 * 运算符与上界原样保留（见 {@link swapRange}）：形状由维护者定，脚本只换版本号。
 * 认不出来的形状宁可报错停下 —— `||`、`*`、`1.x`、`workspace:^` 换成「一个版本号」都会丢信息，
 * 而「每周巡检悄悄改坏声明面」比「巡检红一次」贵得多。
 */
const RANGE_SHAPE =
  /^(>=|<=|>|<|=|\^|~)?\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?:\s+(<)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?))?$/;

/** 认识的 dist-tag。换版只在这几条线上有意义；别的一律判用法错误。 */
const LINES = ['next', 'alpha', 'latest'];

const USAGE = `用法：
  node scripts/compat-swap.mjs swap <${LINES.join('|')}>
  node scripts/compat-swap.mjs verify <${LINES.join('|')}>
  node scripts/compat-swap.mjs selftest

退出码：0 = 通过 / 1 = 有未过 / 2 = 用法错误`;

/** 读版本一律打官方源：镜像可能落后，落后就会把「线还没动」误报成结论。 */
const REGISTRY = 'https://registry.npmjs.org/';

/**
 * 把声明区间换到某个版本上，**保留它自己的形状**。
 *
 * 只替换下限那个版本号，比较符与上界原样留着：
 * `>=0.1.7-alpha.1 <0.3.0` → `>=<ver> <0.3.0`；`^1.2.3` → `^<ver>`。
 *
 * 「读不出版本号」必须用正则的匹配结果判，不能拿替换结果与原串比：目标版本与下限**恰好相同**时
 * 替换是个空操作，比字符串会把它误判成「没有版本号」从而退回裸版本 —— 形状照样丢。
 *
 * @param {string} declared - 当前声明。
 * @param {string} version - 该 tag 上的版本。
 * @returns {string} 保形的新声明。
 * @throws 区间不是认识的形状时抛出（宁可红一次，也不静默改坏声明面）。
 */
function swapRange(declared, version) {
  const shape = RANGE_SHAPE.exec(declared.trim());
  if (shape === null) {
    throw new Error(
      '不认识的区间形状：' +
        declared +
        '（换版只支持「可选运算符 + 版本号」外加一个 `<上界`，请手工改这一条）',
    );
  }
  const upper = shape[3] === undefined ? '' : ' ' + shape[3] + shape[4];
  return (shape[1] ?? '') + version + upper;
}

const tagsCache = new Map();

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
 * 解析位置参数里的 dist-tag。
 *
 * @param {string[]} argv - 位置参数。
 * @returns {string} dist-tag。
 */
function parseLine(argv) {
  const line = argv[0];
  if (line === undefined) usageError('缺 dist-tag');
  if (!LINES.includes(line)) usageError('不认识的 dist-tag：' + line);
  return line;
}

/**
 * 把 plan 应用到 manifest 上，就地改写，返回改了几处。
 *
 * 抽成纯函数是为了让 {@link selftest} 能**执行**它（不联网、不装依赖）：这条路径上曾经漏掉
 * `engines.dsh`，而漏掉的症状要等每周巡检 + 那条红线一起发作才看得见。
 *
 * @param {Record<string, any>} manifest - 待改写的 package.json（就地修改）。
 * @param {{ name: string, version: string }[]} plan - 目标线上各受管包的版本。
 * @param {string} hostVersion - 宿主本体在目标线上的版本；用于换 `engines.dsh`。
 * @returns {number} 实际改写的处数（0 = 已经是目标线）。
 * @throws manifest 没有声明 `engines.dsh` 时抛出。
 */
function applyPlan(manifest, plan, hostVersion) {
  let touched = 0;
  for (const field of MANIFEST_FIELDS) {
    const block = manifest[field];
    if (!block) continue;
    for (const { name, version } of plan) {
      if (!(name in block)) continue;
      const next = swapRange(block[name], version);
      if (block[name] !== next) {
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
  const nextHost = swapRange(declaredHost, hostVersion);
  if (declaredHost !== nextHost) {
    console.log('engines.dsh：' + HOST_PACKAGE + ' ' + declaredHost + ' → ' + nextHost);
    manifest.engines.dsh = nextHost;
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
  if (existsSync('package-lock.json')) {
    rmSync('package-lock.json');
    console.log('已删 package-lock.json（它记着换线前的解析，留着会 ERESOLVE）。');
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
 * @param {string} line - 目标 dist-tag。
 * @returns {Promise<number>} 进程退出码。
 */
async function swap(line) {
  const manifest = readManifest();
  const plan = [];
  const skipped = [];
  for (const name of managedNames(manifest)) {
    const version = (await distTags(name))[line];
    if (version === undefined) {
      // 判定分档见文件头：只有 peer 缺失才红。
      if (name in (manifest.peerDependencies ?? {})) {
        throw new Error(name + ' 在 ' + line + ' 线上没有版本（它声明在 peerDependencies 里）');
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
        ' 线上没有版本）：' +
        skipped.join(', ') +
        ' —— 声明面此时会出现两种区间，红线会亮，那是真话。',
    );
  }

  const hostVersion = (await distTags(HOST_PACKAGE))[line];
  if (hostVersion === undefined) {
    throw new Error(
      '宿主本体 ' + HOST_PACKAGE + ' 在 ' + line + ' 线上没有版本（engines.dsh 无从换起）',
    );
  }

  const touched = applyPlan(manifest, plan, hostVersion);
  if (touched === 0) {
    console.log('已经是 ' + line + ' 线的版本，package.json 未改动。');
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
 * @param {string} line - 目标 dist-tag。
 * @returns {Promise<number>} 进程退出码。
 */
async function verify(line) {
  const manifest = readManifest();
  let failed = 0;
  let skipped = 0;

  // `engines.dsh` 先验：它是声明面的一半。verify 漏掉它的话，半换过的 manifest 会在
  // 依赖段全绿的情况下被读成「这次换版是干净的」。
  const expectedHost = (await distTags(HOST_PACKAGE))[line];
  const declaredHost = manifest.engines?.dsh;
  if (expectedHost === undefined) {
    console.log(
      '::warning::宿主本体 ' + HOST_PACKAGE + ' 在 ' + line + ' 线上没有版本，无从核对。',
    );
  } else if (typeof declaredHost !== 'string') {
    console.log('红  engines.dsh：package.json 没有声明它（声明面只有一半）');
    failed += 1;
  } else {
    try {
      const expectedRange = swapRange(declaredHost, expectedHost);
      if (declaredHost === expectedRange) {
        console.log(
          'ok  engines.dsh：' +
            declaredHost +
            '（' +
            HOST_PACKAGE +
            ' 在 ' +
            line +
            ' 线上是 ' +
            expectedHost +
            '）',
        );
      } else {
        console.log(
          '红  engines.dsh：声明 ' +
            declaredHost +
            '，' +
            line +
            ' 线上的宿主本体是 ' +
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
    const expected = (await distTags(name))[line];
    if (expected === undefined) {
      // 判定分档同 swap()：peer 缺失算失败，仅 dev 缺失告警跳过。
      if (name in (manifest.peerDependencies ?? {})) {
        console.log('红  ' + name + '：在 peerDependencies 里，但 ' + line + ' 线上没有版本');
        failed += 1;
        continue;
      }
      console.log(
        '::warning::' + name + ' 仅声明在 devDependencies，' + line + ' 线上没有版本，跳过。',
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
        ' 线上 —— 换包那一步失败了，而旧版本的树会让测试全绿。',
    );
    console.error('先看 npm install 的输出：多半是上游包之间的 peer 冲突，需要清掉旧树重装。');
    return 1;
  }
  console.log(
    '确认：' +
      String(managedNames(manifest).length - skipped) +
      ' 个包与宿主本体都真的在 ' +
      line +
      ' 线上。',
  );
  return 0;
}

/**
 * 换版保形的自检表（不联网、不装依赖）。
 *
 * 它是可执行的断言而不是散文：`swap` 会改 `package.json` 的声明面，而它曾经只动依赖段、
 * 曾经无条件写回 `^` —— 两类错都只在**每周巡检**里发作一次，等看见 diff 时形状早就漂了。
 * 最后一条是**反向控制**：把「没有 `engines.dsh`」的 manifest 喂进去，必须抛错（证明守卫真的会响）。
 *
 * @returns {number} 0 = 全部符合预期；1 = 有不符合的。
 */
function selftest() {
  const cases = [
    // 本仓声明面的实际形状：下限 + 上界。
    ['>=0.1.7-alpha.1 <0.3.0', '0.2.0-rc.1', '>=0.2.0-rc.1 <0.3.0'],
    ['>=0.2.0-rc.1 <0.3.0', '0.2.0-rc.2', '>=0.2.0-rc.2 <0.3.0'],
    // 已经是目标版本时是空操作，但形状必须原样留下。
    ['>=0.2.0-rc.2 <0.3.0', '0.2.0-rc.2', '>=0.2.0-rc.2 <0.3.0'],
    // 无上界的形状（换版面不止声明面这一处）。
    ['>=0.1.7-alpha.1', '0.1.8-alpha.1', '>=0.1.8-alpha.1'],
    ['^0.1.6-alpha.2', '0.1.7-alpha.1', '^0.1.7-alpha.1'],
    ['~1.2.3', '1.2.4', '~1.2.4'],
    ['1.2.3', '2.0.0', '2.0.0'],
    ['=1.2.3', '1.2.4', '=1.2.4'],
    ['>1.0.0', '1.0.1', '>1.0.1'],
    ['>= 0.1.7-alpha.1', '0.1.8-alpha.1', '>=0.1.8-alpha.1'],
  ];
  const rejects = [
    '>=1.0.0 <2.0.0 || >=3.0.0',
    '1.x || 2.x',
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
      actual = swapRange(declared, version);
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
      const actual = swapRange(declared, '9.9.9');
      console.log('FAIL  ' + JSON.stringify(declared) + ' 应当被拒，却给出了 ' + actual);
      failed += 1;
    } catch {
      console.log('PASS  ' + JSON.stringify(declared) + ' 被拒');
      passes += 1;
    }
  }

  // 声明面整份换过去：依赖段与 `engines.dsh` 必须**同进同退**。
  // 这是那条红线的对侧 —— 它要求两者逐字相同，而换版曾经只动依赖段。
  const sample = {
    engines: { dsh: '>=0.2.0-rc.1 <0.3.0', node: '>=20' },
    peerDependencies: { '@deepseek-ai/dsh-credentials': '>=0.2.0-rc.1 <0.3.0' },
    devDependencies: { '@deepseek-ai/dsh-client-locale': '>=0.2.0-rc.1 <0.3.0' },
  };
  const touched = applyPlan(
    sample,
    [
      { name: '@deepseek-ai/dsh-credentials', version: '0.2.0-rc.2' },
      { name: '@deepseek-ai/dsh-client-locale', version: '0.2.0-rc.2' },
    ],
    '0.2.0-rc.2',
  );
  const ranges = [
    ...new Set([
      sample.engines.dsh,
      ...Object.values(sample.peerDependencies),
      ...Object.values(sample.devDependencies),
    ]),
  ];
  if (ranges.length !== 1 || ranges[0] !== '>=0.2.0-rc.2 <0.3.0') {
    console.log('FAIL  换版后声明面没有落到同一条区间上：' + JSON.stringify(sample));
    failed += 1;
  } else if (touched !== 3) {
    console.log('FAIL  应当改写 3 处（两条依赖 + engines.dsh），实际 ' + String(touched) + ' 处');
    failed += 1;
  } else {
    console.log(
      'PASS  换版后 engines.dsh 与依赖段同进同退（' +
        ranges[0] +
        '，改写 ' +
        String(touched) +
        ' 处）',
    );
    passes += 1;
  }

  // 反向控制：manifest 没有 `engines.dsh` 时必须抛错停下，而不是把声明面落在半路。
  let guardFired = false;
  try {
    applyPlan(
      {
        engines: { node: '>=20' },
        peerDependencies: { '@deepseek-ai/dsh-tools': '>=0.2.0-rc.1 <0.3.0' },
      },
      [{ name: '@deepseek-ai/dsh-tools', version: '0.2.0-rc.2' }],
      '0.2.0-rc.2',
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
  if (command === 'swap') code = await swap(parseLine(rest));
  else if (command === 'verify') code = await verify(parseLine(rest));
  else if (command === 'selftest') code = selftest();
  else usageError('用法：node scripts/compat-swap.mjs <swap|verify|selftest>');
} catch (error) {
  console.error(error.message);
  code = 1;
}
process.exit(code);
