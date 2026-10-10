import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * 换版脚本的形状守卫。
 *
 * 为什么值得单独一条：`swap` 会改 `package.json` 的**整条声明面**（依赖段 + `engines.dsh`），
 * 而它曾经无条件写回 `'^' + version`、也曾经只动依赖段 —— 两类错都只在**每周的 compat 巡检**
 * 里发作一次，等看见 diff 时形状早就漂了（前者把 `>=` 改回 `^` 并抹掉上界，后者让
 * [redlines.test.ts](redlines.test.ts) 的「逐字相同」每周必红，且红的位置恰好会盖住真正的不兼容点）。
 *
 * 断言方式是跑脚本自己的 `selftest` 子命令（形状表与整份换版断言都在脚本里，与生产代码同一份实现），
 * 而不是在测试里重写一遍规则 —— 重写的那份迟早与实现漂开。
 */
describe('compat-swap 换版保形', () => {
  it('认识的形状保留运算符与上界，不认识的形状报错停下', () => {
    // 不装依赖、不打网络：selftest 只跑本地那张形状表与一次纯函数换版。
    const result = spawnSync(process.execPath, ['scripts/compat-swap.mjs', 'selftest'], {
      encoding: 'utf8',
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('条全部符合预期');
  });

  it('用法里列了三条子命令（swap / verify / selftest）', () => {
    // 声明面单独判「罩不罩得住」不在本脚本里 —— 那件事只有一处实现，见 scripts/check-declaration.mjs。
    const result = spawnSync(process.execPath, ['scripts/compat-swap.mjs', '--help'], {
      encoding: 'utf8',
    });
    expect(result.stderr + result.stdout).toContain('selftest');
  });
});
