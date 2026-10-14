/**
 * 发布流程不变量：**发布不得改写版本号**（跨仓规则 5b，2026-09-22 立）。
 *
 * 为什么要有它：界面上的版本 tag 显示的就是 `package.json` 里那个号。
 * 只要 workflow 在发布时自己 bump，工作树就永远停在「上一个已发布版本」——
 * **截图必然拍出旧号**。本仓 2026-09-22 就是这么翻的车：图里的 `v2.0.0-alpha.0` 是**上一个**
 * 已发布版本，而当时以为界面上会自己变成新号。
 *
 * 顺序因此定死（写进 [docs/PUBLISHING.md](../docs/PUBLISHING.md) 与
 * [assets/AGENTS.md](../assets/AGENTS.md)）：**bump → 提交 → 再拍截图 → 最后发布**。
 * 两步都在本地，workflow 只负责「把 `package.json` 里那个号发出去」。
 *
 * 判定本体在 [scripts/check-release.mjs](../scripts/check-release.mjs) 的 `findVersionWrites`
 * —— 守卫与测试读**同一份**，且这条守卫每次 `npm test` 都跑（跑 release.yml 只能在 main 上 dispatch）。
 * 下面那组反向控制喂的是**合成文本**，证明这个判据真的会红（不是空转）。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findVersionWrites } from '../scripts/check-release.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const workflow = readFileSync(root + '.github/workflows/release.yml', 'utf8');

describe('发布流程：版本驱动', () => {
  it('release.yml 里没有会改写版本号的命令行', () => {
    expect(findVersionWrites(workflow)).toEqual([]);
  });

  it('发布的版本号读自 package.json，没有 bump 步', () => {
    // 正向判据：workflow 必须有一处把清单里的版本读出来，而不是自己算一个。
    expect(workflow).toContain("require('./package.json').version");
    // 反向判据：不能有会**改写清单**的步骤（读版本号本身不算）。
    // 「有 dist_tag 输出」也顺带证明它走的不是自己算版本那条路。
    expect(workflow).toContain('dist_tag=');
  });

  it('dist-tag 由版本自己的预发布段推导，publish 与 Release 读同一个输出', () => {
    // 判据只此一处：publish 与 GitHub Release 两步都读 steps.version.outputs.dist_tag（各出现两次：
    // 一次判空、一次取值），都不按输入参数判。
    expect(
      (workflow.match(/steps\.version\.outputs\.dist_tag/g) ?? []).length,
    ).toBeGreaterThanOrEqual(2);
    expect(workflow).not.toContain('inputs.tier');
    expect(workflow).not.toContain('inputs.preid');
  });

  it('幂等判据仍在：该版本已在 npm 上就跳过 publish', () => {
    expect(workflow).toContain('npm view');
    expect(workflow).toContain('published=true');
  });

  it('tag 名带 v 前缀，与历史 tag 同形', () => {
    // 2026-09-22 实测踩过：版本号从 npm version 的输出（自带 v）改成读 package.json（没有 v）之后，
    // 那个字符串被直接当 tag 名用，建出 2.0.0-alpha.1 —— 与 v1.6.x / v2.0.0-alpha.0 全部不同形，
    // 而守卫用的是 git describe --match 'v[0-9]*'，**看不见它**。
    expect(workflow).toContain('tag="v${{ steps.version.outputs.version }}"');
    expect(workflow).toContain('gh release create "$tag"');
    expect(workflow).toContain('--title "$tag"');
    // 反向判据：不能有任何一处把裸版本号直接当 tag 名用。
    expect(workflow).not.toContain('gh release create "${{ steps.version.outputs.version }}"');
  });
});

describe('发布流程守卫：反向控制（喂合成文本）', () => {
  it('四种改版本的写法都会红', () => {
    // 上一版 workflow 里真实出现过的那种 case 分支。
    const oldBranch = [
      '          case "${{ inputs.tier }}" in',
      '            prerelease) version=$(npm version prerelease --preid=alpha --no-git-tag-version) ;;',
      '          esac',
    ].join('\n');
    expect(findVersionWrites(oldBranch)).toHaveLength(1);
    expect(findVersionWrites('run: npm version patch --no-git-tag-version')).toHaveLength(1);
    expect(findVersionWrites('run: npm pkg set version=2.0.0-alpha.1')).toHaveLength(1);
    // 直接改写清单里那一行也算。
    expect(findVersionWrites('  "version": "2.0.0-alpha.1",')).toHaveLength(1);
  });

  it('反向控制：裸版本号当 tag 名的写法判红（合成文本，模拟改回旧写法）', () => {
    // 上一轮真实存在过的那两行（没有 v 前缀），直接喂给同一条判据：
    const broken = [
      '          gh release create "${{ steps.version.outputs.version }}" \\',
      '            --title "${{ steps.version.outputs.version }}" \\',
    ].join('\n');
    expect(broken).toContain('gh release create "${{ steps.version.outputs.version }}"');
    expect(broken).not.toContain('tag="v${{ steps.version.outputs.version }}"');
    // 而修好之后的那两行必须过 —— 判据不是「永远为真」。
    expect(workflow).toContain('tag="v${{ steps.version.outputs.version }}"');
  });

  it('工作流文本里没有过期指针（head 注释承诺的入口与真实 input 集一致）', () => {
    // 2026-09-22 实测：head 注释还写着 `gh workflow run release.yml -f tier=patch`，
    // 而 tier 输入早被撤掉了 —— 文档漂移「不报错」，所以钉在这里。
    expect(workflow).not.toContain('-f tier=');
    expect(workflow).not.toContain('inputs.tier');
    expect(workflow).toContain('gh workflow run release.yml');
  });

  /**
   * 发布链的**行为底线**（跨仓一致）：手动与 tag 两个入口、正文读 Drafter 草稿、发完删草稿、OIDC 发包。
   *
   * 为什么要钉成断言而不是留在散文里：这四条漏掉时**都不报错** ——
   * tag 触发那道「只接受 main」的判定若没带事件守卫，红的是**每一次** tag 发布，
   * 而且红的原因离真正的原因很远；
   * 草稿没删，下一版读到的是上一批正文，而草稿看上去「有内容」；
   * 草稿读不到而没发 warning，则「发版成功但正文走了回落」与「一切正常」长得一模一样。
   */
  it('四条行为底线都在（入口 / 读草稿 / 删草稿 / OIDC）', () => {
    // ① 两个入口：手动 dispatch 与 tag 推送。
    expect(workflow, '没有手动触发入口').toMatch(/workflow_dispatch:/);
    expect(workflow, '没有 tag 触发入口').toMatch(/tags:\s*\n\s*-\s*'v\[0-9\]\*'/);

    // ② 正文读草稿，且**读不到时必须发 warning**（区分「读不到」与「读到但为空」）。
    expect(workflow, '没有读 Release Drafter 草稿的步骤').toContain('gh release view next');
    expect(workflow, '草稿读不到时没有 warning —— 那就成了静默回落').toMatch(
      /warning::读不到 Release Drafter 草稿/,
    );
    expect(workflow, '正文没有走草稿那一路').toContain('--notes-file');

    // ③ 发完删草稿，且只删草稿。
    expect(workflow, '没有删除草稿的步骤').toContain('gh release delete');
    // 删的**必须**只删草稿：--cleanup-tag 默认连带删 tag，而 tag 是守卫 `git describe --match` 读的东西。
    expect(workflow, '删草稿时没有关掉 --cleanup-tag，会连带删掉守卫依赖的 tag').toContain(
      '--cleanup-tag=false',
    );
    expect(workflow, '删草稿时没有限定 isDraft').toMatch(/select\(\.isDraft\)/);
    expect(workflow, '删草稿时没有排除 v 前缀的 tag').toMatch(/select\(startswith\("v"\) \| not\)/);

    // ④ OIDC：全程不传 token。
    expect(workflow, '没有 id-token: write，OIDC 换不出凭据').toMatch(/id-token:\s*write/);
    expect(workflow, '出现了 token 传递，底线要求全程不传 token').not.toMatch(
      /NODE_AUTH_TOKEN|NPM_TOKEN/,
    );
  });

  it('tag 触发的三道闸都在（缺一条时 tag 发布必红，且红的原因不明显）', () => {
    // ① 守卫的基线要**排除正在发的那个 tag**。少了它，tag 触发时 `describe` 解析出它自己，
    //    `<tag>..HEAD` 恒空，一次完全正常的发布被判成「没有可发布的内容」。
    expect(workflow, '守卫基线没有排除正在发的 tag').toMatch(
      /--exclude=\$\{\{\s*github\.ref_name\s*\}\}/,
    );

    // ② 「只接受 main」那道判定要带事件守卫。少了它，tag 触发时 github.ref 是 refs/tags/...，
    //    每一次 tag 发布都红。
    expect(workflow, '「只接受 main」的判定没有事件守卫').toMatch(
      /github\.event_name\s*==\s*'workflow_dispatch'\s*&&\s*github\.ref\s*!=\s*'refs\/heads\/main'/,
    );

    // ③ tag 名与清单版本一致那道闸。
    expect(workflow, '没有 tag/清单版本一致性那道闸').toMatch(
      /Verify the pushed tag matches the manifest version/,
    );
  });

  it('tag 触发时不推 main，建 Release 前先判存在', () => {
    // 推 main 只对手动触发有意义：tag 触发时那个提交已经在 main 上。而带 App token 去推受保护分支
    // 正是本仓当初引入那把 token 的原因 —— tag 那条路不该用它。
    const pushStep =
      /- name: Push the release commit\n\s+if: github\.event_name == 'workflow_dispatch'/;
    expect(workflow, '推 main 那步没有按事件分流').toMatch(pushStep);

    // 建 Release 之前必须判存在：tag 触发时重跑必然撞上已存在的 Release。
    expect(workflow, '建 Release 前没有幂等判断，重跑会撞 tag 已存在').toMatch(
      /gh release view "\$tag" >\/dev\/null 2>&1/,
    );
  });

  it('上面那几条有牙齿（拿缺了这些样的写法比对，必须不满足）', () => {
    // 反向控制一：没有 --exclude 的守卫。
    const noExclude =
      '      - name: Guard against release noise\n' +
      '        run: |\n' +
      "          base=$(git describe --tags --abbrev=0 --match 'v[0-9]*')\n";
    expect(noExclude).not.toMatch(/--exclude=\$\{\{\s*github\.ref_name\s*\}\}/);

    // 反向控制二：没有事件守卫的 main 判定。
    const noEventGuard = "        if: github.ref != 'refs/heads/main'\n";
    expect(noEventGuard).not.toMatch(
      /github\.event_name\s*==\s*'workflow_dispatch'\s*&&\s*github\.ref\s*!=\s*'refs\/heads\/main'/,
    );

    // 反向控制三：无条件建 Release（改造前就是那样）。
    const noExistsCheck =
      '          gh release create "$tag" \\\n' +
      '            --target "$(git rev-parse HEAD)" \\\n' +
      '            --title "$tag" \\\n' +
      '            --generate-notes $extra\n';
    expect(noExistsCheck).not.toMatch(/gh release view "\$tag" >\/dev\/null 2>&1/);

    // 而真文件里那几条必须满足 —— 判据不是「永远为真」。
    expect(workflow).toMatch(
      /github\.event_name\s*==\s*'workflow_dispatch'\s*&&\s*github\.ref\s*!=\s*'refs\/heads\/main'/,
    );
  });

  it('把真 workflow 改坏一处，判据就红（端到端反向控制）', () => {
    // 拿真文件做底、只插一行：证明「现在这条绿」不是因为正则匹配不到任何东西。
    const mutated = workflow.replace(
      '        id: version\n',
      '        id: version\n        run: npm version patch --no-git-tag-version\n',
    );
    expect(mutated).not.toBe(workflow);
    expect(findVersionWrites(mutated)).toHaveLength(1);
  });

  it('提示语与注释不算 —— 否则「提醒你先本地 bump」这句正确的话会判自己红', () => {
    expect(
      findVersionWrites(
        '# 换版本线在本地做：npm version premajor --preid=alpha --no-git-tag-version',
      ),
    ).toEqual([]);
    expect(
      findVersionWrites('          echo "bump with: npm version <version> --no-git-tag-version"'),
    ).toEqual([]);
    expect(
      findVersionWrites('            # 这里不是叫你在本地 bump：本 workflow 自己 bump'),
    ).toEqual([]);
  });
});
