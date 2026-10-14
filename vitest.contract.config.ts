import { defineConfig } from 'vitest/config';

/**
 * 契约测试配置（`pnpm run test:contract`）：只跑打真实上游的那几个文件。
 *
 * - `fileParallelism: false`：两个文件同时打接口会把限流与配额观测混在一起，
 *   而契约测试要的正是「一次干净的观测」。
 * - 超时放宽到网络量级：单次探针实测 0.5–1s，30s 是给知乎侧抖动留的余量。
 */
export default defineConfig({
  test: {
    include: ['test/contract-live-*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
