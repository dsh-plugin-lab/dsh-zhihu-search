/**
 * 插件展示元数据（`locale/<lang>.json` 的 `meta` 与顶层 `icon`）**随包**与**可解析**的守卫。
 *
 * 为什么要有它：宿主读这份元数据的路是「按插件名做 Node 资源解析」——
 * `dsh-zhihu-search/locale/en.json` 必须先出现在 `exports` 里，文件又必须先随包发出去。
 * 两条里缺任何一条，**宿主都不报错**：插件页退回显示技术名（`dsh-zhihu-search` /
 * `zhihu-search`），中文标题与描述一个字都不出现。这是「接缝缺席是静默的」的同一族故障，
 * 所以它必须落成会红的断言，而不是散文。
 *
 * 读法刻意**不复刻宿主的全部解析规则**（那属于 DSH，会漂）：这里只判本仓能控制的两件事 ——
 * 导出面覆盖与 `files` 覆盖 —— 外加 locale 文件自身的形状。
 * 机制与回落链的出处：DSH `docs/cookbook/adding-a-package.md` 的
 * 「5. Add optional plugin display metadata」与 `packages/boot/app-boot/src/package-meta.ts`。
 *
 * 两个消费者读同一份判定，避免两处各写一套：
 * - [check-release.mjs](check-release.mjs)（`pnpm run check:release`，release.yml 发布前跑）
 * - [../test/plugin-metadata.test.ts](../test/plugin-metadata.test.ts)（`npm test`）
 *
 * 图标那几条的判据照抄宿主 `iconOf`：扩展名名单、**留在清单目录内**、普通文件、≤ 256 KiB
 * （`packages/boot/app-boot/src/package-meta.ts:14-41`）。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 语言 id 的形状，与宿主 `package-meta.ts` 的 `LANGUAGE_ID` 同源。 */
const LANGUAGE_ID = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;

/** 宿主 `iconOf` 认的扩展名与媒体类型（`package-meta.ts:16-19`）。 */
const ICON_MEDIA_TYPES = new Map([
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);

/** 宿主 `iconOf` 的上限：`MAX_ICON_BYTES = 256 * 1024`。 */
const MAX_ICON_BYTES = 256 * 1024;

/**
 * 从仓库根读展示元数据并逐条判定随包不变量。
 *
 * @param root - 仓库根目录。
 * @param pkg - 已经解析好的 `package.json`；不传就地读。
 * @returns 逐条判定结果与读到的元数据。
 */
export function inspectPluginMetadata(root, pkg = readManifest(root)) {
  const failures = [];

  /**
   * 断言一条「缺了就静默」的条件。
   *
   * @param label - 判定的名字。
   * @param ok - 条件。
   * @param hint - 红了之后该怎么改。
   */
  const require_ = (label, ok, hint) => {
    if (!ok) failures.push(`${label} —— ${hint}`);
  };

  const localeDir = join(root, 'locale');
  const languageIds = existsSync(localeDir)
    ? readdirSync(localeDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => entry.name.slice(0, -'.json'.length))
        .sort()
    : [];

  /** 按文件名读进来的 JSON 字典；解析失败的语言不在里面。 */
  const dictionariesOf = new Map();
  for (const language of languageIds) {
    const file = join(localeDir, `${language}.json`);
    try {
      dictionariesOf.set(language, JSON.parse(readFileSync(file, 'utf8')));
    } catch (error) {
      failures.push(
        `locale/${language}.json 不是合法 JSON —— ${String(error)}；格式错误时宿主只报一条诊断，界面直接退回技术名。`,
      );
    }
  }

  /**
   * 一个语言字典里的一个展示字段，按宿主的判据要求「非空字符串」。
   *
   * @param language - 文件名里的语言 id。
   * @param field - `title` 或 `description`。
   * @returns 可用的展示文本，缺失或空白时 `undefined`。
   */
  const displayField = (language, field) => {
    const value = dictionariesOf.get(language)?.meta?.[field];
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
  };

  require_(
    'locale 目录含 en.json',
    languageIds.some((id) => id.toLowerCase() === 'en'),
    'en.json 是宿主发现元数据的入口；没有它，其余语言文件一个都不会被读。',
  );
  require_(
    'locale 目录含 zh.json',
    languageIds.some((id) => id.toLowerCase() === 'zh'),
    '两份 README 与截图都按中英双语承诺；只给英文等于中文界面退回技术名。',
  );

  for (const language of languageIds) {
    require_(
      `locale/${language}.json 是合法语言 id`,
      LANGUAGE_ID.test(language),
      '文件名必须是一个语言 id；宿主对不是语言 id 的文件名直接报错。',
    );
    for (const field of ['title', 'description']) {
      require_(
        `locale/${language}.json 有非空 meta.${field}`,
        displayField(language, field) !== undefined,
        `该字段必须是**非空字符串**；缺字段或写成空串时宿主只回落到下一档（${fallbackOf(field)}），页面不会报错。`,
      );
    }
  }

  const files = Array.isArray(pkg.files) ? pkg.files : [];
  const exportsMap = typeof pkg.exports === 'object' && pkg.exports !== null ? pkg.exports : {};

  for (const language of languageIds) {
    const resource = `${pkg.name}/locale/${language}.json`;
    require_(
      `exports 暴露 ${resource}`,
      Object.hasOwn(exportsMap, './locale/*.json'),
      `没有这条子路径导出时，宿主按 ${pkg.name}/locale/${language}.json 解析会拿到 ERR_PACKAGE_PATH_NOT_EXPORTED —— 元数据静默消失。`,
    );
    require_(
      `files 收录 locale/${language}.json`,
      files.includes('locale/*.json') || files.includes(`locale/${language}.json`),
      '没随包的 locale 文件在 npm 上不存在，读到的还是包装前的仓库副本；落地包只会显示技术名。',
    );
  }

  require_(
    'exports 暴露 ./package.json',
    Object.hasOwn(exportsMap, './package.json'),
    '标题与描述的包级回落、以及图标声明都经 <包名>/package.json 读；不导出就没有这两档回落。',
  );
  // 图标（可选字段）：声明了就得真的能读 —— 路径留在清单目录内、文件在、扩展名与大小都合宿主的口径。
  // 缺一处宿主只留一条诊断、图标位空着，界面不报错。本仓 2026-09-22 起声明了它。
  require_(
    'icon 声明留在主清单目录内',
    iconIsLocal(pkg.icon),
    '顶层 icon 的路径相对**声明它的清单**解析，且必须留在该目录内（绝对路径、URL 与越界路径都会被宿主拒绝，只留一条诊断）。',
  );

  if (pkg.icon !== undefined) {
    const iconPath = String(pkg.icon).replace(/^\.\//u, '');
    const absolute = join(root, iconPath);
    const mediaType = ICON_MEDIA_TYPES.get(iconPath.slice(iconPath.lastIndexOf('.')).toLowerCase());
    require_(
      `icon 扩展名在宿主名单内（${ICON_MEDIA_TYPES.size} 种）`,
      mediaType !== undefined,
      '宿主只认 SVG / PNG / JPEG / WebP；其余扩展名一律拒绝。',
    );
    require_(
      `icon 文件在（${iconPath}）`,
      existsSync(absolute),
      '声明了却读不到：宿主留一条诊断、图标位空着 —— 与不声明同效。',
    );
    require_(
      `files 收录 ${iconPath}`,
      files.includes(iconPath),
      '没随包的图标在 npm 上不存在；本地 link: 挂载照样显示，落地包却是空的。',
    );
    if (existsSync(absolute)) {
      const size = statSync(absolute).size;
      require_(
        `icon 不超过 256 KiB（当前 ${size} B）`,
        size <= MAX_ICON_BYTES,
        '宿主对超限的图标只留一条诊断并弃用；上限是 256 KiB。',
      );
    }
  }

  return {
    languageIds,
    titles: Object.fromEntries(
      languageIds.map((language) => [language, displayField(language, 'title')]),
    ),
    descriptions: Object.fromEntries(
      languageIds.map((language) => [language, displayField(language, 'description')]),
    ),
    failures,
  };
}

/**
 * 就地读仓库根的 `package.json`。
 *
 * @param root - 仓库根目录。
 * @returns 解析后的清单。
 */
export function readManifest(root) {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
}

/**
 * 读 `locale/<language>.json` 里的 `meta`，形状与宿主 `readPluginMeta` 读出来的一致。
 *
 * 仅供**仓库内文档**引用文案时对账（本仓不复制文案，见根 [AGENTS.md](../AGENTS.md)）。
 *
 * @param root - 仓库根目录。
 * @param language - 语言 id，例如 `en`。
 * @returns `meta` 字段，缺文件时 `undefined`。
 */
export function displayMetadata(root, language) {
  const file = join(root, 'locale', `${language}.json`);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8')).meta;
}

/**
 * 标题与描述的回落链，写在提示里给改的人看（机制出处见本文件头部）。
 *
 * @param field - `title` 或 `description`。
 * @returns 该字段的回落顺序。
 */
function fallbackOf(field) {
  return field === 'title'
    ? 'meta.title → package.json 的 name → 完整 Cordis 插件名'
    : 'meta.description → package.json 的 description → 不显示描述';
}

/**
 * 图标声明是否是一个留在清单目录内的相对路径；未声明也算通过（图标是可选字段）。
 *
 * @param icon - 清单里的 icon 值。
 * @returns 是否可接受。
 */
function iconIsLocal(icon) {
  if (icon === undefined) return true;
  if (typeof icon !== 'string' || icon.trim() === '') return false;
  // 绝对路径（POSIX 与 Windows 盘符）、带协议的 URL、以及任何向上越界的路径。
  if (icon.startsWith('/') || /^[A-Za-z]:[\\/]/.test(icon) || /^[A-Za-z][A-Za-z\d+.-]*:/.test(icon))
    return false;
  return !icon.split(/[\\/]/).includes('..');
}
