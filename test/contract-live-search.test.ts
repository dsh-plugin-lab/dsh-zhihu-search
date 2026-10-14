/**
 * 契约（真实上游）：`zhihu_search` 站内搜索的行为指纹。
 *
 * 这些断言**不是**在测我们的代码，而是在钉住「知乎答应过的事」。
 * 每条都来自 2026-09-14 的原始探针实测，红了通常意味着上游改了行为，而不是我们写错了。
 *
 * ⚠ 会花真实配额，因此**不进日常 CI**；跑法见 [README.md](README.md) 与
 * `pnpm run test:contract`。
 */

import { describe, expect, it } from 'vitest';
import {
  callApi,
  editTimesOf,
  fingerprintLine,
  hasCredential,
  idsOf,
  isSubsetOf,
  sameSequence,
  strField,
  votesOf,
} from './contract-helpers.js';

const SEARCH = '/api/v1/content/zhihu_search';
/** 宽泛且长期有结果的查询：契约测试要的是稳定，不是贴题。 */
const QUERY = 'ChatGPT';
const FIELD = 'VoteUpCount';
const DAY_SECONDS = 86_400;
/** 2100-01-01：用它把结果必然清空，以便观察空态字段。 */
const FAR_FUTURE = 4_102_444_800;

describe('契约测试的凭据', () => {
  it('必须能拿到 ZHIHU_ACCESS_SECRET，不允许静默跳过', () => {
    expect(
      hasCredential,
      '未设置 ZHIHU_ACCESS_SECRET：契约测试是防腐化机制，静默跳过等于没有保护。CI 里它来自 repo secret，本地请手动注入。',
    ).toBe(true);
  });
});

describe.skipIf(!hasCredential)('契约：zhihu_search 站内搜索', () => {
  it('信封结构未变：Data 含 Items / HasMore，成功码是 0', async () => {
    const r = await callApi(SEARCH, { Query: QUERY, Count: 5 });
    console.log(fingerprintLine('站内基线', r));
    expect(r.code).toBe(0);
    expect(r.dataKeys).toContain('Items');
    expect(r.dataKeys).toContain('HasMore');
  });

  it('Count 上限仍是 10：传 50 也只回 10 条', async () => {
    const r = await callApi(SEARCH, { Query: QUERY, Count: 50 });
    expect(r.code).toBe(0);
    expect(r.items.length).toBeGreaterThan(0);
    expect(
      r.items.length,
      '上限变了就要同步 tools/search.ts 的 MAX_COUNT 与 README 的 1–10',
    ).toBeLessThanOrEqual(10);
  });

  it('区间只筛「本次检索到的候选」：带下限的结果是同一候选池的子集', async () => {
    const baseline = await callApi(SEARCH, { Query: QUERY, Count: 10 });
    const filtered = await callApi(SEARCH, {
      Query: QUERY,
      Count: 10,
      SortBy: `${FIELD}:desc:(1,)`,
    });
    console.log(fingerprintLine('站内 下限1', filtered));
    expect(filtered.code).toBe(0);
    expect(
      isSubsetOf(idsOf(filtered.items), idsOf(baseline.items)),
      '若失败：上游可能改成了全库过滤 —— 那是好消息，但要同步 README「下限筛的是本次候选」的措辞与 tools/search.ts 的候选池逻辑',
    ).toBe(true);
  });

  it('双边界语法可用：下界、上界、闭区间都真的生效', async () => {
    const lower = await callApi(SEARCH, {
      Query: QUERY,
      Count: 10,
      SortBy: `${FIELD}:desc:(100,)`,
    });
    for (const votes of votesOf(lower.items)) expect(votes).toBeGreaterThanOrEqual(100);

    const upper = await callApi(SEARCH, { Query: QUERY, Count: 10, SortBy: `${FIELD}:desc:(,10)` });
    for (const votes of votesOf(upper.items)) expect(votes).toBeLessThanOrEqual(10);

    const closed = await callApi(SEARCH, {
      Query: QUERY,
      Count: 10,
      SortBy: `${FIELD}:desc:(10,100)`,
    });
    for (const votes of votesOf(closed.items)) {
      expect(votes).toBeGreaterThanOrEqual(10);
      expect(votes).toBeLessThanOrEqual(100);
    }
  });

  it('参数校验仍在：非法排序字段与负下限都回 10001', async () => {
    const bogus = await callApi(SEARCH, { Query: QUERY, Count: 5, SortBy: 'Bogus:desc' });
    expect(bogus.code).toBe(10001);

    const negative = await callApi(SEARCH, {
      Query: QUERY,
      Count: 5,
      SortBy: `${FIELD}:desc:(-5,)`,
    });
    expect(negative.code).toBe(10001);
    expect(negative.message.toLowerCase()).toContain('nonnegative');
  });

  it('未记载的 Filter=publish_time 仍在生效（插件的时间过滤依赖它）', async () => {
    const since = Math.floor(Date.now() / 1000) - 30 * DAY_SECONDS;
    const r = await callApi(SEARCH, {
      Query: QUERY,
      Count: 10,
      Filter: `publish_time>=${String(since)}`,
    });
    console.log(fingerprintLine('站内 时间过滤', r));
    expect(r.code, '若这里回 10001：知乎不再识别站内 Filter，插件的时间过滤已静默失效').toBe(0);
    const times = editTimesOf(r.items);
    expect(times.length).toBeGreaterThan(0);
    for (const time of times) expect(time).toBeGreaterThanOrEqual(since);
  });

  it('SearchHashId 仍不是游标：原样回传不改变结果', async () => {
    const first = await callApi(SEARCH, { Query: QUERY, Count: 10 });
    const echoed = await callApi(SEARCH, {
      Query: QUERY,
      Count: 10,
      SearchHashId: first.searchHashId ?? '',
    });
    expect(
      sameSequence(idsOf(echoed.items), idsOf(first.items)),
      '若失败：SearchHashId 变成了游标，「没有翻页」这个结论要重评',
    ).toBe(true);
  });

  it('空态字段 EmptyReason 仍是常量「无相关内容」', async () => {
    const r = await callApi(SEARCH, {
      Query: QUERY,
      Count: 5,
      Filter: `publish_time>=${String(FAR_FUTURE)}`,
    });
    expect(r.code).toBe(0);
    expect(r.items).toHaveLength(0);
    expect(
      r.emptyReason,
      '若失败：EmptyReason 可能开始携带真实原因 —— 那正是把它透出给模型的时候（types.ts 里记着这次删除的理由）',
    ).toBe('无相关内容');
  });

  it('结果里仍有 CommentCount / EditTime（插件新透出的两个字段靠它们）', async () => {
    const r = await callApi(SEARCH, { Query: QUERY, Count: 5 });
    const first = r.items[0];
    expect(first).toBeDefined();
    expect(strField(first ?? {}, 'ContentID')).toBeDefined();
    expect(typeof first?.['CommentCount']).toBe('number');
    expect(typeof first?.['EditTime']).toBe('number');
  });
});
