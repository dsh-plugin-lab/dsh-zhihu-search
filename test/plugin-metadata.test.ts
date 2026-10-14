/**
 * 插件展示元数据（`locale/<lang>.json` 的 `meta`）不变量。
 *
 * 这一组盯的是**宿主读不到标题与描述时会怎样**：它**不报错** ——
 * 插件页与设置里的插件清单直接退回技术名（`dsh-zhihu-search` / `zhihu-search`），
 * 中文文案一个字都不出现。三条静默路径，各写一条断言：
 *
 * - `locale/en.json` 不在包内 → 宿主连发现入口都没有（*随包*）；
 * - `exports` 没有 `./locale/*.json` → 按 `<包名>/locale/en.json` 解析拿到
 *   `ERR_PACKAGE_PATH_NOT_EXPORTED`，同样只是回落（*可解析*）；
 * - 字段缺失、空白或 JSON 写坏 → 只回落到下一档（`package.json.name` → 完整 Cordis 名）。
 *
 * 判定本身住在 [scripts/plugin-metadata.mjs](../scripts/plugin-metadata.mjs)，
 * `pnpm run check:release` 读**同一份**（避免守卫与测试各写一套判定，红了只红一边）。
 * 机制与回落链的出处：DSH `docs/cookbook/adding-a-package.md` 的
 * 「5. Add optional plugin display metadata」、`packages/boot/app-boot/src/package-meta.ts`。
 * 为什么这么定、为什么不加图标 → [决策记录](../.agents/notes/2026-09-22-plugin-display-metadata.md)。
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
// 类型面由 [../scripts/plugin-metadata.d.mts](../scripts/plugin-metadata.d.mts) 提供（手写，改实现时同批改）。
import {
  displayMetadata,
  inspectPluginMetadata,
  readManifest,
  type Manifest,
} from '../scripts/plugin-metadata.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

/** 这一组期间临时建出来的仓副本；每个用例结束后删掉。 */
const fixtures: string[] = [];

afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * 造一棵「只差一处」的仓副本：清单与 locale 目录都从本仓抄，再按需改写。
 *
 * 用真副本而不是内存对象，是因为守卫**故意从目录读语言文件**
 * （宿主的发现入口就是「en.json 所在目录里的所有 .json」），
 * 给它塞一份内存清单就测不到那条路径了。
 *
 * @param mutate - 就地改写副本的钩子。
 * @returns 副本的根目录。
 */
function fixture(mutate: (dir: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'zhihu-metadata-'));
  fixtures.push(dir);
  mkdirSync(join(dir, 'locale'));
  for (const language of ['en', 'zh']) {
    writeFileSync(
      join(dir, 'locale', `${language}.json`),
      readFileSync(join(root, 'locale', `${language}.json`)),
    );
  }
  // 清单与图标先照抄本仓那份：只改一处，红了才说明是那一处引起的。
  writeFileSync(join(dir, 'package.json'), JSON.stringify(readManifest(root), null, 2));
  writeFileSync(join(dir, 'icon.svg'), readFileSync(join(root, 'icon.svg')));
  mutate(dir);
  return dir;
}

/**
 * 把一个对象写成副本里的 `package.json`。
 *
 * @param dir - 副本根目录。
 * @param manifest - 要写进去的清单对象。
 */
function writeManifest(dir: string, manifest: Manifest): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2));
}

/**
 * 副本应有的失败条目，按标签取；取不到就报出全部条目，免得只看到一句「undefined」。
 *
 * @param dir - 副本根目录。
 * @param label - 期望出现的判定名（用 `toContain` 匹配，避免把提示文案也钉住）。
 * @returns 命中的失败提示。
 */
function failureFor(dir: string, label: string): string | undefined {
  return failuresFor(dir, label)[0];
}

/**
 * 命中某个标签的全部失败条目。
 *
 * 用**全量匹配**而不是「第一条」：判定的名字互为前缀（`icon 声明留在…` 与 `icon 文件在…`），
 * 只看第一条会把「另一条也红了」当成「这一条红了」。
 *
 * @param dir - 副本根目录。
 * @param label - 判定名的一部分。
 * @returns 命中的失败提示（可能为空）。
 */
function failuresFor(dir: string, label: string): string[] {
  return inspectPluginMetadata(dir).failures.filter((entry) => entry.includes(label));
}

describe('展示元数据：宿主读得到（本仓现状）', () => {
  const { failures, titles, descriptions, languageIds } = inspectPluginMetadata(root);
  const meta = readManifest(root);

  it('随包与可解析的判定全部通过（导出面、files、语言文件形状）', () => {
    expect(failures).toEqual([]);
  });

  it('两种语言都在，且标题与描述都是非空字符串', () => {
    expect(languageIds).toEqual(['en', 'zh']);
    for (const language of languageIds) {
      expect(typeof titles[language], language).toBe('string');
      expect(typeof descriptions[language], language).toBe('string');
      expect(titles[language]!.trim().length, language).toBeGreaterThan(0);
      expect(descriptions[language]!.trim().length, language).toBeGreaterThan(0);
    }
  });

  it('中英两份不是同一串（中文那页没抄英文）', () => {
    // 不是风格判据，是**漏译判据**：两份文件内容相同时最可能的写法是复制英文那份。
    expect(titles.zh).not.toBe(titles.en);
    expect(descriptions.zh).not.toBe(descriptions.en);
  });

  it('标题与描述都不含 npm 作用域名与包名前缀（展示面不该出现技术名）', () => {
    for (const language of languageIds) {
      for (const text of [titles[language]!, descriptions[language]!]) {
        expect(text).not.toContain('@deepseek-ai/');
        expect(text).not.toContain('dsh-zhihu-search');
      }
    }
  });

  it('包级 description 与英文描述同源同内容（回落链的中间那档）', () => {
    // 描述回落是 meta.description → package.json.description：两档不一致时，
    // 英文界面与 npm 页面会讲两套话，而两处都不会红。
    expect(meta.description).toBe(descriptions.en);
  });

  it('图标：声明了、在包内、且是自包含的 SVG（2026-09-22 起）', () => {
    // 声明与随包由守卫那几条钉住；这里管的是**文件本身**：
    // 宿主把图标 base64 成 data URL **按图片**渲染，所以 currentColor / 外链 / 外部字体一律不起作用。
    expect(meta.icon).toBe('./icon.svg');
    const svg = readFileSync(join(root, 'icon.svg'), 'utf8');
    expect(svg).toContain('viewBox="0 0 36 36"');
    for (const forbidden of [
      'currentColor',
      '<image',
      'href',
      'url(',
      '@import',
      'font-family',
      '<style',
    ]) {
      expect(svg, forbidden).not.toContain(forbidden);
    }
  });

  it('locale 的 meta 与卡片字典的 key 互不重叠（两个命名空间，谁也不读对方）', () => {
    const en = JSON.parse(readFileSync(join(root, 'locale', 'en.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(Object.keys(en)).toEqual(['meta']);
    expect(displayMetadata(root, 'en')?.title).toBe(titles.en);
  });
});

describe('展示元数据守卫：反向控制', () => {
  it('files 漏掉 locale/*.json 时红，且报的是那一条', () => {
    const dir = fixture((target) => {
      const manifest = readManifest(root);
      manifest.files = manifest.files.filter((entry) => entry !== 'locale/*.json');
      writeManifest(target, manifest);
    });
    const failure = inspectPluginMetadata(dir).failures;
    expect(failure.some((entry) => entry.includes('files 收录 locale/en.json'))).toBe(true);
    expect(failure.some((entry) => entry.includes('files 收录 locale/zh.json'))).toBe(true);
  });

  it('exports 少 ./locale/*.json 时红 —— 这是宿主解析不到的那条（ERR_PACKAGE_PATH_NOT_EXPORTED）', () => {
    const dir = fixture((target) => {
      const manifest = readManifest(root);
      delete manifest.exports['./locale/*.json'];
      writeManifest(target, manifest);
    });
    const failure = inspectPluginMetadata(dir).failures;
    expect(
      failure.some((entry) => entry.includes('exports 暴露 dsh-zhihu-search/locale/en.json')),
    ).toBe(true);
  });

  it('exports 少 ./package.json 时红（包级回落与图标声明都经它读）', () => {
    const dir = fixture((target) => {
      const manifest = readManifest(root);
      delete manifest.exports['./package.json'];
      writeManifest(target, manifest);
    });
    expect(failureFor(dir, 'exports 暴露 ./package.json')).toBeDefined();
  });

  it('字段为空串、缺字段或 JSON 写坏时红（宿主只回落，不报错）', () => {
    const blank = fixture((target) =>
      writeFileSync(join(target, 'locale', 'zh.json'), JSON.stringify({ meta: { title: '   ' } })),
    );
    expect(failureFor(blank, 'locale/zh.json 有非空 meta.title')).toBeDefined();
    expect(failureFor(blank, 'locale/zh.json 有非空 meta.description')).toBeDefined();

    const broken = fixture((target) =>
      writeFileSync(join(target, 'locale', 'zh.json'), '{ "meta": '),
    );
    expect(failureFor(broken, 'locale/zh.json 不是合法 JSON')).toBeDefined();
  });

  it('文件名不是语言 id 时红，且不把缺语言的那条一起报出来', () => {
    const dir = fixture((target) =>
      writeFileSync(join(target, 'locale', 'not_a_language.json'), JSON.stringify({ meta: {} })),
    );
    const { failures } = inspectPluginMetadata(dir);
    expect(failures.some((entry) => entry.includes('not_a_language.json 是合法语言 id'))).toBe(
      true,
    );
    // 反向控制的反向：这一处改动不该让「随包」那几条跟着红 —— 否则红了也定位不到真正的原因。
    expect(failures.some((entry) => entry.includes('files 收录 locale/not_a_language.json'))).toBe(
      false,
    );
  });

  it('icon 声明越界或写成绝对路径时红，未声明则通过', () => {
    for (const icon of [
      '../assets/logo.svg',
      '/opt/logo.svg',
      'C:\\logo.svg',
      'https://example.com/logo.svg',
      '',
    ]) {
      const dir = fixture((target) => {
        const manifest = readManifest(root);
        manifest.icon = icon;
        writeManifest(target, manifest);
      });
      expect(failureFor(dir, 'icon 声明留在主清单目录内'), icon).toBeDefined();
    }

    // 未声明图标：这几条都不该红（图标是可选字段）。
    const none = fixture((target) => {
      const manifest = readManifest(root);
      delete manifest.icon;
      writeManifest(target, manifest);
    });
    expect(failureFor(none, 'icon 声明留在主清单目录内')).toBeUndefined();
    expect(failureFor(none, 'icon 文件在')).toBeUndefined();
    expect(failureFor(none, 'icon 扩展名在宿主名单内')).toBeUndefined();
    expect(failureFor(none, 'icon 不超过 256 KiB')).toBeUndefined();
  });

  it('声明了图标但文件不在 / 扩展名不认 / 没随包 / 超 256 KiB 时各红一条', () => {
    /**
     * 造一个副本：清单里声明 icon，并按需写（或不写）那个文件。
     *
     * @param icon - 清单里要声明的路径。
     * @param fill - 写文件的方式；`undefined` 表示故意不写（验「文件不在」那条）。
     * @param inFiles - 是否把该路径留在 `files` 里。
     * @returns 副本根目录。
     */
    const withIcon = (
      icon: string,
      fill: ((dir: string, path: string) => void) | undefined,
      inFiles = true,
    ): string =>
      fixture((target) => {
        const manifest = readManifest(root);
        manifest.icon = icon;
        const relative = icon.replace(/^\.\//u, '');
        if (!inFiles) manifest.files = manifest.files.filter((entry) => entry !== relative);
        writeManifest(target, manifest);
        // 副本基线里那份 icon.svg 先删掉：这个用例只留「被改的那一处」不成立。
        rmSync(join(target, 'icon.svg'), { force: true });
        if (fill !== undefined) fill(target, relative);
      });
    /** 写一个指定字节数的占位文件（内容对判定不重要，大小才是）。 */
    const bytes =
      (count: number) =>
      (dir: string, path: string): void => {
        writeFileSync(join(dir, path), 'x'.repeat(count));
      };

    // 两件事各自单独验：文件不在（files 里还留着）与没随包（文件在）。
    const missing = withIcon('./icon.svg', undefined);
    expect(failureFor(missing, 'icon 文件在（icon.svg）')).toBeDefined();
    expect(failureFor(missing, 'files 收录 icon.svg')).toBeUndefined();

    const present = withIcon('./icon.svg', bytes(16));
    expect(failureFor(present, 'icon 文件在（icon.svg）')).toBeUndefined();
    expect(failureFor(present, 'icon 不超过 256 KiB')).toBeUndefined();

    expect(failureFor(withIcon('./icon.ico', bytes(16)), 'icon 扩展名在宿主名单内')).toBeDefined();
    expect(
      failureFor(withIcon('./icon.svg', bytes(256 * 1024 + 1)), 'icon 不超过 256 KiB'),
    ).toBeDefined();
    expect(
      failureFor(withIcon('./icon.svg', bytes(16), false), 'files 收录 icon.svg'),
    ).toBeDefined();
  });
});
