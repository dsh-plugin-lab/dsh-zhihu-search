import { defineConfig } from 'vitest/config';

/**
 * 日常测试配置（`pnpm test`）。
 *
 * **排除 live 契约测试**：它们打真实知乎接口、消耗每日配额，只由
 * `pnpm run test:contract` 与每周的 [contract.yml](.github/workflows/contract.yml) 跑
 * —— 见 [test/README.md](test/README.md) 的「契约测试」一节。
 *
 * 底座的离线自检（`test/contract-helpers.test.ts`）**留在**这里：它不碰网络，
 * 代价接近零，却能防止指纹工具写错导致契约测试「假绿」。
 *
 * `exclude` 必须抄全 vitest 的默认项：本字段是**替换**而不是追加。
 */
export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      'test/contract-live-*.test.ts',
    ],
  },
});
