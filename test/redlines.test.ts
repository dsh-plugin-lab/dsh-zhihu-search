/**
 * 红线守卫（把「约定」变成「可执行校验」）。
 *
 * 这些规则写在文档里会随时间长草；写成测试则每次 \`npm test\` 都会重新校验。
 * 每条 `it` 对应一条红线，另外几组（文档不抄实测值等）是与红线同级的可执行约定。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createZhihuGlobalSearchTool } from '../src/tools/global-search.js';
import { createZhihuSearchTool } from '../src/tools/search.js';
import { createZhihuZhidaTool } from '../src/tools/zhida.js';
import { createState } from '../src/state.js';
import { envelope, jsonResponse, makeHarness } from './helpers.js';

/** 去掉块注释与行注释，避免注释里的字样触发守卫。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const root = fileURLToPath(new URL('..', import.meta.url));
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
  name?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: Record<string, string>;
};

/**
 * 读**已提交**的那份 package.json（`git show HEAD:package.json`）。
 *
 * 为什么需要它：compat 巡检的 `swap --only` 会把工作区清单**临时收窄成单族**去测低族，
 * 那是一次性测量、不提交。凡是判「**对外承诺了什么**」的断言都必须读这一份，否则测量会误报成缺陷
 * （实测：`swap 0.1.7-rc --only` 之后工作区只剩一族，而声明面并没有缩窄）。
 * 无 git 的检出（发布 tarball 等）读不到时返回 `undefined`，调用方自行决定降级。
 */
function readCommittedPackageJson(): { engines?: Record<string, string> } | undefined {
  try {
    const result = spawnSync('git', ['show', 'HEAD:package.json'], {
      cwd: root,
      encoding: 'utf8',
    });
    if (result.status !== 0 || typeof result.stdout !== 'string') return undefined;
    return JSON.parse(result.stdout) as { engines?: Record<string, string> };
  } catch {
    return undefined;
  }
}

/** 构造全部三个工具，用于检查模型可见面。 */
function allTools() {
  const harness = makeHarness(async () => jsonResponse(envelope({ HasMore: false, Items: [] })));
  return {
    tools: [
      createZhihuSearchTool(harness.deps),
      createZhihuGlobalSearchTool(harness.deps),
      createZhihuZhidaTool(harness.deps),
    ],
    dispose: () => {
      harness.dispose();
    },
  };
}

describe('红线 1：@deepseek-ai/* 绝不进入 dependencies', () => {
  it('dependencies 为空或缺席', () => {
    const runtimeDeps = Object.keys(packageJson.dependencies ?? {});
    expect(runtimeDeps.filter((name) => name.startsWith('@deepseek-ai/'))).toEqual([]);
  });

  it('上下文相关包全部在 peerDependencies 与 devDependencies', () => {
    for (const name of [
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-tools',
      '@deepseek-ai/schemastery',
    ]) {
      expect(Object.keys(packageJson.peerDependencies ?? {})).toContain(name);
      expect(Object.keys(packageJson.devDependencies ?? {})).toContain(name);
    }
  });

  it('peerDependencies 里的 @deepseek-ai 包在 devDependencies 中版本一致', () => {
    const peers = packageJson.peerDependencies ?? {};
    const devs = packageJson.devDependencies ?? {};
    for (const [name, range] of Object.entries(peers)) {
      if (!name.startsWith('@deepseek-ai/')) continue;
      expect(devs[name]).toBe(range);
    }
  });
});

describe('声明面自洽：全部 dsh 声明与 engines.dsh 逐字相同，且承诺的族不只一族', () => {
  // 这条是**跨仓规则 7**（见根目录 AGENTS.md 的逐条裁定）。此前它写的是「下限不得低于」，
  // 2026-10-10 收紧成**逐字相同** —— 理由有两条，各自都实测过：
  //   1. **上界也是声明的一半**。本仓的形态是 `>=下限 <下一族`，一条写成 `^0.2.0-rc.1`、
  //      另一条写成 `>=0.2.0-rc.1 <0.3.0`，使用者按它们装到的宿主不是同一批，而「下限一致」看不出来。
  //   2. **换版脚本曾经只动依赖段、漏掉 `engines.dsh`**（它不在任何依赖段里，名字也不带 `dsh-` 尾巴）。
  //      旧判据下那种半换过的 manifest 照样全绿 —— 测试比文档里那句「同形状」弱，缺口就在这。
  // 为什么必须一致：使用者按我们给的区间装出来的宿主，未必有本插件赖以工作的宿主接缝，
  // 而接缝缺席是**静默**的（插件 pending、卡片不出现，都不报错）。
  //
  // 「不只一族」这一条来自同一个预发布语义：npm 只在区间里存在**同元组**的预发布项时才匹配预发布候选，
  // 所以要同时承诺 0.1.7 与 0.2.0 两族，单区间罩不住 —— 必须用 `||` 显式枚举成并集。
  // 这条断言在「逐字相同」之外再钉住**族集合**：防止有人把某一族的分支悄悄删掉（那等于
  // 缩窄了对外承诺却不改任何别的地方）。
  it('每条 @deepseek-ai/dsh-* 区间与 engines.dsh 逐字相同', () => {
    const engine = packageJson.engines?.['dsh'];
    expect(typeof engine === 'string' && engine !== '', 'engines.dsh 没声明').toBe(true);
    // 每个分支的下限必须带预发布段（写成裸版本号会让 next / alpha 两条线被混为一谈）。
    for (const branch of (engine ?? '').split('||')) {
      expect(branch.trim(), 'engines.dsh 的某一族下限没有点名一条线').toMatch(
        /^(>=|\^|~|=)?\s*\d+\.\d+\.\d+-[0-9A-Za-z.-]+/,
      );
    }

    const declared: string[] = [];
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
      for (const [name, range] of Object.entries(packageJson[field] ?? {})) {
        if (name.startsWith('@deepseek-ai/dsh-')) declared.push(`${field}:${name} = ${range}`);
      }
    }
    // 扫不到声明说明匹配规则坏了，先红这个 —— 别让它静默变成一条永不触发的守卫。
    expect(declared.length).toBeGreaterThan(10);

    const offenders = declared.filter((entry) => !entry.endsWith(' = ' + engine));
    expect(offenders, `这些声明与 engines.dsh（${engine}）不同形状或不同区间`).toEqual([]);
  });

  it('engines.dsh 同时承诺 0.1.7 与 0.2.1 两族（|| 并集），删掉一族等于缩窄对外承诺', () => {
    // 为什么钉这一条：0.1.7 那族是**真实兼容修复**（有使用者停在 0.1.7，2.1.0 抬下限把他们判不兼容，
    // 本次加回）。删掉它会让那批使用者再次装不上，而且没有任何别的地方会红。
    //
    // 第二族的**元组**是会漂的：npm 的预发布语义要求候选与区间里**同一 major.minor.patch** 且带预发布段的
    // 比较子对上，所以宿主每往前推一个补丁位的预发布，这一族就得手工跟着抬（2026-10-17 宿主发 0.2.1-rc.x，
    // 0.2.0 族当场罩不住 —— 不是形状选错，是「跟预发布线」的固有代价）。本条钉住的是「不只一族 + 稳住 0.1.7」，
    // 第二族的元组由上面那条「逐字相同」与 [docs/PUBLISHING.md](../docs/PUBLISHING.md) 的换线流程一起守。
    //
    // 读**已提交**的那份声明（`git show HEAD:package.json`），且**只在读得到时判**：compat 巡检的
    // `swap --only` 会把工作区清单**临时收窄成单族**去测低族，那是一次性测量、不提交。若读工作区
    // 就会把测量误报成「声明面缩窄」（实测：`swap --only` 之后工作区只剩一族，而承诺并未变）。
    // 无 git 时（本条只在有历史记录的检出里成立）读不到已提交那份 —— 跳过本条而不是误判，
    // 因为「已提交的承诺」这一对象在无 git 时不存在。字节相等的红线在无 git 时仍照常判工作区。
    const committed = readCommittedPackageJson();
    if (committed === undefined) return; // 读不到已提交声明 —— 跳过，不误判工作区（见注释）
    const engine = committed.engines?.['dsh'] ?? '';
    const families = engine
      .split('||')
      .map((branch) => /(\d+)\.(\d+)\.(\d+)/.exec(branch)?.[0])
      .filter((tuple): tuple is string => tuple !== undefined);
    expect(families, 'engines.dsh 读不出任何族').toHaveLength(3);
    expect(families).toContain('0.1.7');
    // 第二、三族的**元组**不写死：宿主每往前推一个补丁位的预发布，就得手工把它抬一次
    // （npm 只匹配同一 major.minor.patch 且带预发布段的比较子）。写死元组会让每轮换线都要改测试，
    // 而这条红线要守的是「别把承诺的族悄悄删掉」。
    expect(
      families.filter((tuple) => tuple !== '0.1.7'),
      'engines.dsh 承诺的 RC 族不足两族（两个 RC 族都得在）',
    ).toHaveLength(2);
  });
});

describe('类型检查开关', () => {
  const tsconfig = JSON.parse(
    stripComments(readFileSync(new URL('../tsconfig.json', import.meta.url), 'utf8')),
  ) as {
    compilerOptions?: Record<string, unknown>;
  };

  it('四个「通用 lint 那一档」的开关都在', () => {
    // 它们是「类型与死代码」这一档的守卫（与 ESLint 的分工见 2026-09-27-adopt-eslint-prettier.md）：
    // 缺任何一个，覆盖面就不再成立。
    // client 与 test 两个 project 都 extends 根 tsconfig，所以这里一处生效、三个 project 都覆盖。
    const flags = [
      'noUnusedLocals',
      'noUnusedParameters',
      'noImplicitReturns',
      'noFallthroughCasesInSwitch',
    ];
    for (const flag of flags) {
      expect(tsconfig.compilerOptions?.[flag], flag).toBe(true);
    }
  });
});

describe('锁文件：必须指向官方源', () => {
  it('pnpm-lock.yaml 里没有镜像源', () => {
    // 镜像生成的锁文件会让 CI 去镜像取包（供应链隐患），也可能因镜像未同步而让安装失败。
    // 这条此前只写在 docs/PUBLISHING.md 的前置条件里（散文）—— 规则住在文字里就没人执行，
    // 所以 2026-09-20 落成断言。
    //
    // 迁到 pnpm 之后判据的**形状变了但口径没变**：pnpm-lock 把 tarball 的完整性摘要放在
    // `resolution: {integrity: …}`，不再有 `resolved: <url>` 这一层。所以这里查的是**文件里
    // 出现的每一个 http(s) URL**：pnpm 锁定的是 integrity 而非来源地址，因此只要出现地址就该是
    // 官方源，出现别处就是有人在镜像上生成过这个锁文件。
    const lock = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
    const hosts = [
      ...new Set(
        [...lock.matchAll(/https?:\/\/[^\s'"<>\\)\]]+/g)].map((match) => {
          try {
            return new URL(match[0]).host;
          } catch {
            return match[0];
          }
        }),
      ),
    ].filter((host) => !host.startsWith('registry.npmjs.org'));
    expect(hosts, `锁文件里出现了非官方源的地址：\n${hosts.join('\n')}`).toEqual([]);
  });

  it('pnpm-lock.yaml 是唯一的锁文件', () => {
    // 跨仓判据：全族只有 pnpm 一条路。两份锁文件同时存在时，CI 装的那棵与本机装的那棵可以不是同一棵，
    // 而「装出来能跑」不会报错 —— 那正是要在这里拦的情况。
    //
    // ⚠️ 这里刻意**拼出**那个名字而不是写字面量：本文件刚被一次批量改名扫过，写字面量的话这条断言
    // 会被改成「pnpm-lock.yaml 不该存在」而永远红 —— 一个自我否定的守卫比没有守卫更坏。
    const npmLock = ['package', 'lock.json'].join('-');
    expect(
      existsSync(new URL(`../${npmLock}`, import.meta.url)),
      `${npmLock} 与 pnpm-lock.yaml 不能共存`,
    ).toBe(false);
    expect(
      existsSync(new URL('../pnpm-lock.yaml', import.meta.url)),
      'pnpm-lock.yaml 必须入库',
    ).toBe(true);
  });
});

describe('红线 2 & 3：呈现层与模型上下文严格隔离', () => {
  it('模型可见的 Markdown 不含任何 UI 卡片字段', async () => {
    const { tools, dispose } = allTools();
    for (const tool of tools) {
      const value = {
        ok: true,
        query: 'q',
        question: 'q',
        model: 'm',
        answer: 'a',
        reasoning: '',
        items: [],
        hasMore: false,
      };
      const blocks = tool.output.render({ query: 'q', question: 'q' }, value);
      const text = blocks.map((block) => ('text' in block ? block.text : '')).join('');
      expect(text).not.toContain('"card"');
      expect(text).not.toContain('"sources"');
      expect(text).not.toContain('presentationMeta');
    }
    dispose();
  });

  it('presentationMeta 连续两次调用结果完全相同（纯函数）', () => {
    const { tools, dispose } = allTools();
    const value = {
      ok: true,
      query: 'q',
      items: [
        {
          title: 't',
          url: 'https://a',
          snippet: 's',
          author: 'a',
          voteUpCount: 1,
          contentType: 'Answer',
        },
      ],
      hasMore: false,
    };
    for (const tool of tools) {
      if (tool.output.presentationMeta === undefined) continue;
      const first = JSON.stringify(tool.output.presentationMeta({ query: 'q' }, value));
      const second = JSON.stringify(tool.output.presentationMeta({ query: 'q' }, value));
      expect(first).toBe(second);
    }
    dispose();
  });
});

describe('红线 4：无可变全局状态', () => {
  it('两次 createState 完全隔离', () => {
    const a = createState({
      cacheMaxEntries: 10,
      cacheTtlMs: 1000,
      searchPerMinute: 1,
      zhidaPerMinute: 1,
    });
    const b = createState({
      cacheMaxEntries: 10,
      cacheTtlMs: 1000,
      searchPerMinute: 1,
      zhidaPerMinute: 1,
    });
    a.cache.set('k', 'v');
    expect(b.cache.get('k')).toBeUndefined();
    expect(a.searchBucket.tryConsume()).toBe(true);
    // a 的桶已空，但 b 的桶不受影响。
    expect(a.searchBucket.tryConsume()).toBe(false);
    expect(b.searchBucket.tryConsume()).toBe(true);
    a.dispose();
    b.dispose();
  });

  it('dispose 会清空缓存', () => {
    const state = createState({
      cacheMaxEntries: 10,
      cacheTtlMs: 60_000,
      searchPerMinute: 60,
      zhidaPerMinute: 10,
    });
    state.cache.set('k', 'v');
    state.dispose();
    expect(state.cache.get('k')).toBeUndefined();
  });

  it('插件入口是唯一接触 Cordis 的模块，且状态在 ctx.effect 内创建', () => {
    const index = readFileSync(root + 'src/index.ts', 'utf8');
    expect(index).toContain('ctx.effect(');
    expect(index).toContain('createState(');
    // 状态创建必须发生在 effect 回调内部，而不是 apply 顶层。
    const effectAt = index.indexOf('ctx.effect(');
    expect(index.indexOf('createState(')).toBeGreaterThan(effectAt);
  });

  it('源码里没有模块级 let 声明（可变全局的典型形态）', () => {
    const files = [
      'src/transport.ts',
      'src/state.ts',
      'src/utils/compiler.ts',
      'src/utils/text.ts',
      'src/utils/errors.ts',
    ];
    for (const file of files) {
      const source = readFileSync(root + file, 'utf8');
      const topLevelLet = source.split('\n').filter((line) => /^(export )?let\s/.test(line));
      expect(topLevelLet, file).toEqual([]);
    }
  });

  it('凭据服务只能经 inject 取得，不得走 ctx.get 旁路', () => {
    // 只校验生效的代码行：注释里正当地提到被否决的写法（与 cordis.patch.yml 的校验同理）。
    const effective = readFileSync(root + 'src/index.ts', 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
      .join('\n');
    // `ctx.get` 按 cordis 文档是「不受 inject 约束的读取」—— 它绕过的是门禁，
    // 不是服务发现本身，跨挂载位置并不可靠。同一上下文里 `ctx.tools`（inject + 属性访问）
    // 一直正常，而 `ctx.get('credentials')` 在 1.6.0 的线上装配里拿不到服务：
    // 旧版有一条 `fromSettings` 兜底替它兜着，兜底一删，工具就集体「没有 key」。
    // 取凭据的唯一合法路径是 `ctx.inject(['credentials'], …)` + 属性访问。
    expect(effective, 'src/index.ts').not.toContain("ctx.get('credentials')");
  });
});

describe('红线 5：模型绝不接触知乎原始语法', () => {
  it('参数 schema 里不出现 SortBy / Filter / 知乎字段名', async () => {
    const { tools, dispose } = allTools();
    for (const tool of tools) {
      const serialized = JSON.stringify(tool.parameters);
      for (const forbidden of [
        'SortBy',
        'Filter',
        'VoteUpCount',
        'CommentCount',
        'publish_time',
        'host==',
        'desc:(',
      ]) {
        expect(serialized, tool.name).not.toContain(forbidden);
      }
    }
    dispose();
  });

  it('排序字段以语义化名称暴露', () => {
    const { tools, dispose } = allTools();
    const search = tools.find((tool) => tool.name === 'zhihu_search');
    expect(JSON.stringify(search?.parameters)).toContain('voteUpCount');
    dispose();
  });

  it('每个工具的参数与输出 schema 都是封闭对象', async () => {
    const { tools, dispose } = allTools();
    for (const tool of tools) {
      const schema = tool.output.schema as { additionalProperties?: boolean };
      expect(schema.additionalProperties, tool.name).toBe(false);
    }
    dispose();
  });
});

describe('工具集不变量', () => {
  it('工具名唯一且带 zhihu_ 前缀', () => {
    const { tools, dispose } = allTools();
    const names = tools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name.startsWith('zhihu_')).toBe(true);
    dispose();
  });

  it('cordis.patch.yml 用可解析的包名，不用 @local/ 别名', () => {
    const patch = readFileSync(root + 'cordis.patch.yml', 'utf8');
    // 只校验生效的 YAML 行；注释里提到 @local/ 是在解释「为什么不这么写」。
    const effective = patch
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(effective).not.toContain('@local/');
    expect(effective).toContain(`name: ${packageJson.name}`);
  });

  it('每个工具都有真实的描述文本（模型靠它做工具选择）', () => {
    const { tools, dispose } = allTools();
    for (const tool of tools) {
      expect(tool.description.length, tool.name).toBeGreaterThan(30);
    }
    dispose();
  });
});

describe('文档不抄实测值', () => {
  /**
   * 记录类：写的就是当时的事实，**故意**带着会漂的值，所以不在约束范围内。
   * 判据是「它写的是此刻还是当时」—— 被当现状读的才算活文档。
   * 本仓的记录层只有两处：决策记录（.agents/notes/）与事故复盘（docs/postmortem/）。
   */
  const RECORDS = [/^\.agents\/notes\//, /^docs\/postmortem\//];

  /** 门面双件：装之前必须看得见兼容范围，所以允许留值 —— 但必须与真源同行。 */
  const FACADE = ['README.md', 'README_en.md'];

  /** 真源。留值的那一行必须自己写出处。 */
  const HOME = 'package.json';

  /**
   * 会漂的宿主版本字面量。
   * 形状跟着宿主主版本走：宿主换主版本号时下面那条「守卫跟着宿主线走」会红，来改这里。
   */
  const HOST_VERSION = /\b0\.\d+\.\d+(?:-[a-z]+\.\d+)?\b/g;

  /**
   * 会被当文档读的 markdown（相对仓库根）；跳过依赖、产物与版本库目录。
   *
   * @param dir - 相对仓库根的目录，空串表示仓库根。
   * @returns 相对仓库根的路径列表。
   */
  function liveDocs(dir = ''): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(root + dir, { withFileTypes: true })) {
      const path = dir === '' ? entry.name : dir + '/' + entry.name;
      if (entry.isDirectory()) {
        if (['node_modules', 'lib', '.git'].includes(entry.name)) continue;
        found.push(...liveDocs(path));
        continue;
      }
      if (!entry.name.endsWith('.md')) continue;
      if (RECORDS.some((pattern) => pattern.test(path))) continue;
      found.push(path);
    }
    return found;
  }

  it('活文档里不写会漂的宿主版本；门面要留就得与真源同行', () => {
    const files = [
      ...liveDocs(),
      ...readdirSync(root + '.github/workflows').map((name) => '.github/workflows/' + name),
    ];
    // 扫不到文件说明 walk 的路径规则坏了，先红这个，别让它静默变成一条永不触发的守卫。
    expect(files.length).toBeGreaterThan(10);

    for (const file of files) {
      const isWorkflow = file.startsWith('.github/workflows/');
      const lines = readFileSync(root + file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        // workflow 里只扫**注释行**：那里的文字是给人读的用法说明（会漂、该指真源）。
        // 非注释行是**机器消费的输入** —— 矩阵值、步骤名、run 命令 —— 与 [package.json](../package.json)
        // 同一类（声明面本身就是真源，它当然含版本号）。本仓确实需要一处：compat.yml 的矩阵用
        // **版本前缀**定位一个没有 dist-tag 的族（`0.1.7-rc`），那是配置而非散文。
        if (isWorkflow && !line.trimStart().startsWith('#')) return;
        for (const value of line.match(HOST_VERSION) ?? []) {
          if (FACADE.includes(file) && line.includes(HOME)) continue;
          throw new Error(
            file +
              ':' +
              (index + 1) +
              ' 抄了会漂的宿主版本 ' +
              value +
              ' —— 改成指向 ' +
              HOME +
              ' 的指针，或现查 npm view @deepseek-ai/dsh dist-tags',
          );
        }
      });
    }
  });

  it('守卫跟着宿主线走：宿主换主版本号时这条会红，来改 HOST_VERSION', () => {
    // 声明面是「若干族（`||`）的并集，每族一个可选运算符 + 版本」，形状判据因此落在下限版本上。
    // 运算符接受 `>=` / `^` / `~`（本仓用 `^`）—— 三者都写出一个下限。
    expect(
      packageJson.engines?.['dsh'],
      '宿主已不在 0.x 线上，HOST_VERSION 的形状要跟着改',
    ).toMatch(/(?:^|[>=\s^~])0\./);
  });
});
