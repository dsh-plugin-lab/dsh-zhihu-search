/**
 * 契约测试的共用底座：**直连**知乎开放平台，盯住上游行为指纹。
 *
 * ⚠ 刻意不 import `src/`：契约测试要回答的是「知乎还是不是我们以为的那个知乎」。
 * 若它复用插件的传输层，插件的解析 bug 会同时污染被测对象与断言，变成自我印证。
 * 因此这里只依赖 `fetch`，与实现完全解耦 —— 上游变了，它必须红。
 *
 * 运行方式：
 * - 本地：`ZHIHU_ACCESS_SECRET=xxx pnpm run test:contract`
 * - CI：每周一由 [.github/workflows/contract.yml](../.github/workflows/contract.yml) 跑
 *   （不进日常 CI：它花真实配额，见 [README.md](README.md)）
 *
 * 红了怎么办：**先别改测试**。重跑一次探针确认不是偶发，再去
 * [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的「与知乎官方文档的偏差」与
 * 「契约测试」两节更新事实，最后才动实现与断言。
 */

/** 接入域名；契约测试默认打生产，可用环境变量指向沙箱。 */
export const CONTRACT_BASE_URL =
  process.env['ZHIHU_CONTRACT_BASE_URL'] ?? 'https://developer.zhihu.com';

/** 生产凭据。CI 从 repo secret 注入；本地从环境变量注入。 */
export const CONTRACT_SECRET = (process.env['ZHIHU_ACCESS_SECRET'] ?? '').trim();

/** 是否具备跑真实探针的条件。 */
export const hasCredential = CONTRACT_SECRET !== '';

/** 一条原始结果；字段按官方文档命名，这里保持不透明以免把类型写死。 */
export type RawItem = Record<string, unknown>;

/** 一次调用的结构化观测结果。 */
export interface Envelope {
  /** HTTP 状态码。 */
  readonly http: number;
  /** 信封业务码：0 成功，10001 参数错误，20001 鉴权失败，30001 频率限制，90001 内部错误。 */
  readonly code: number;
  /** 信封消息原文。 */
  readonly message: string;
  /** `Data` 上的键，用于盯「字段增删」这类结构性变化。 */
  readonly dataKeys: readonly string[];
  readonly items: readonly RawItem[];
  readonly hasMore: boolean | undefined;
  /** 实测只在 `Items` 为空时出现；见 `contract-live-search.test.ts` 的同名断言。 */
  readonly emptyReason: string | undefined;
  readonly searchHashId: string | undefined;
}

/**
 * 调一次开放平台 GET 接口。
 *
 * @param path - 形如 `/api/v1/content/zhihu_search`。
 * @param params - Query 参数；`undefined` 的键会被跳过。
 * @returns 结构化观测结果；HTTP 层失败直接抛出（那是环境问题，不是契约问题）。
 */
export async function callApi(
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<Envelope> {
  const url = new URL(CONTRACT_BASE_URL + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${CONTRACT_SECRET}`,
      'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
      'Content-Type': 'application/json',
    },
  });
  const text = await response.text();

  let parsed: { Code?: unknown; Message?: unknown; Data?: unknown };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new Error(
      `知乎返回了非 JSON 响应（HTTP ${String(response.status)}）：${text.slice(0, 200)}`,
    );
  }
  const data = (
    typeof parsed.Data === 'object' && parsed.Data !== null ? parsed.Data : {}
  ) as Record<string, unknown>;

  return {
    http: response.status,
    code: typeof parsed.Code === 'number' ? parsed.Code : -1,
    message: typeof parsed.Message === 'string' ? parsed.Message : '',
    dataKeys: Object.keys(data),
    items: Array.isArray(data['Items']) ? (data['Items'] as RawItem[]) : [],
    hasMore: typeof data['HasMore'] === 'boolean' ? data['HasMore'] : undefined,
    emptyReason: typeof data['EmptyReason'] === 'string' ? data['EmptyReason'] : undefined,
    searchHashId: typeof data['SearchHashId'] === 'string' ? data['SearchHashId'] : undefined,
  };
}

/** 读一条结果里的数字字段；缺失或类型不符返回 `undefined`。 */
export function numField(item: RawItem, key: string): number | undefined {
  const value = item[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** 读一条结果里的字符串字段；缺失或类型不符返回 `undefined`。 */
export function strField(item: RawItem, key: string): string | undefined {
  const value = item[key];
  return typeof value === 'string' ? value : undefined;
}

/** 结果的内容标识序列；顺序敏感，是「指纹」的基本单位。 */
export function idsOf(items: readonly RawItem[]): string[] {
  return items.map((item, index) => strField(item, 'ContentID') ?? `#${String(index)}`);
}

/** 结果的域名序列（主机名小写）。 */
export function hostsOf(items: readonly RawItem[]): string[] {
  return items.map((item) => {
    const url = strField(item, 'Url');
    if (url === undefined) return '';
    try {
      return new URL(url).host.toLowerCase();
    } catch {
      return '';
    }
  });
}

/** 结果的赞同数序列。 */
export function votesOf(items: readonly RawItem[]): number[] {
  return items.map((item) => numField(item, 'VoteUpCount') ?? Number.NaN);
}

/** 结果的 `EditTime` 序列（秒级 Unix 时间戳）。 */
export function editTimesOf(items: readonly RawItem[]): number[] {
  return items.map((item) => numField(item, 'EditTime') ?? Number.NaN);
}

/** 两个指纹序列是否完全一致（含顺序）。 */
export function sameSequence(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** `subset` 是否被 `superset` 完全包含。 */
export function isSubsetOf(subset: readonly string[], superset: readonly string[]): boolean {
  const pool = new Set(superset);
  return subset.every((value) => pool.has(value));
}

/** `host` 是否是 `root` 的子域（严格子域，不含相等）。 */
export function isSubdomainOf(host: string, root: string): boolean {
  return host !== root && host.endsWith(`.${root}`);
}

/**
 * 生成一行可读指纹，写进测试输出。
 *
 * 契约测试的价值一半在断言，一半在**日志**：红了要能一眼看出上游变成了什么样。
 *
 * @param label - 本次调用的标签。
 * @param envelope - 观测结果。
 * @returns 单行摘要（不含结果正文，避免把内容写进 CI 日志）。
 */
export function fingerprintLine(label: string, envelope: Envelope): string {
  const hosts = [...new Set(hostsOf(envelope.items))];
  return [
    label,
    `code=${String(envelope.code)}`,
    `n=${String(envelope.items.length)}`,
    `hasMore=${String(envelope.hasMore)}`,
    `emptyReason=${String(envelope.emptyReason)}`,
    `hosts=[${hosts.slice(0, 4).join(',')}]`,
    `votes=[${votesOf(envelope.items).slice(0, 6).join(',')}]`,
  ].join(' ');
}
