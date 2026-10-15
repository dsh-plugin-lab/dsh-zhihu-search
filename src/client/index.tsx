/**
 * 浏览器半体：侧边栏「插件（Plugins）」→「已安装（Installed）」组 → **点 dsh-zhihu-search
 * 进它的详情页**，配置卡片就内联在描述与「包含的组件」之间 —— 没有多一次 Configure。
 *
 * 挂载点是插件管理页声明的 `plugins.bundle.config` 槽，key 是**包名**。
 * 这个槽**只渲染 `view: 'page'`，且座位里没有任何 `form`**（DSH `slot-contract.ts:12-16`
 * 「Bundle configuration renders only `page`」；`PluginManagerPage.tsx:579` 只递 `view` 与
 * `entryKey`）—— 表单因此由卡片自己向 `ctx.configForms.get(<loader entry id>)` 取，
 * 这也是该槽唯一的官方取表单路径。
 *
 * 于是有两个**今天同串、却不是一回事**的 id：
 * - 槽 key = [package.json](../../package.json) 的 `name`（包名）；
 * - `get()` 的实参 = [cordis.patch.yml](../../cordis.patch.yml) 那条 insert 的 `id`（loader entry id）。
 *
 * 写错前者 = 整块配置不出现；写错后者 = 卡片照常出现、**永远只读且不报错**。
 * 两者都由 [test/settings-seam.test.ts](../../test/settings-seam.test.ts) 解析那两个文件对账。
 *
 * 外壳对齐原生配置表单（0.1.7 起它的等价物是 `ui-primitives/src/settings-form/` 的 SettingsForm + fields）：不可折叠、无外框，
 * 一列控件直接落在插件页的 `data-plugin-config` 区里；只读提示行 + 字段行（标签 / 状态标记 / 重置）
 * + 底部「失败诊断 + 单一保存按钮」（无分割线，按钮左对齐）。
 * 草稿随卸载丢弃，只有保存才写；保存成功由 Host 回读确认。
 *
 * 文案全部走 DSH 的 locale 服务（`ctx.locale`），不硬编码 —— 字典在 [locales.ts](./locales.ts)，
 * 注册时用 `locale:` 声明命名空间，框架据此把类型化的 `t` 座位注入组件 props。
 * 切语言无需重挂载：字典注册会推进 locale 版本号，已挂载的出口自动重取。
 *
 * 密钥**不经过配置文件**：它按引用名写进 `ctx.remote.credentials`（即 `.credentials.yaml`），
 * 与官方 web 搜索卡片同一套做法。配置里只留引用名，因此活动 profile 的 Cordis patch
 * 被截图或上传时不泄任何凭据。
 *
 * 复用 `@deepseek-ai/dsh-client-ui-primitives` 的 `Input`、`Button`、`Switch` 与 `Tag`：
 * 那是公共基础库，不是别的插件 —— 被 bundle-purity gate 禁止的是跨插件值导入。
 * 行布局（label / badge / hint 的排布）仍是内联样式，取值只用 `--dsw-alias-*` 语义令牌。
 */

import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Button, Input, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import type { Context } from '@deepseek-ai/cordis';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
// 类型导入即声明：`plugins.bundle.config` 槽由插件管理页的浏览器半体合并进共享的 SlotMap，
// 结构类型复制不出来，所以这条类型边必须留（`dsh.client.inject` 提供运行时）。
// 表单则**不欠** `dsh-client-ui-settings` 任何类型边：它经 `ctx.configForms` 拿，
// 形状在本文件用结构类型就地收窄（见 ConfigFormFace）。
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
// 类型导入即声明：`ctx.locale` 由 locale 包的浏览器半体合并进 Context。
import type {} from '@deepseek-ai/dsh-client-locale/client';
// 类型导入即声明：ctx.slots 由 ui-renderer 的浏览器半体合并进 Context。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import {
  createCredentialStore,
  type CredentialView,
  type CredentialsRemoteFace,
} from './credential-store.js';
import { LOCALE_NS, ZHIHU_LOCALES } from './locales.js';

/**
 * `ctx.remote` 在本卡片用到的最小面。
 *
 * 收窄类型用**结构类型**而不是 `import type {} from '@deepseek-ai/dsh-api-remotes/client'`：
 * 那是客户端的装配包，只为声明 `ctx.remote` 就把它加进 `peerDependencies` 不划算，
 * 而本卡片只碰 `credentials` 一个命名空间。
 *
 * 类型与运行时是两件事：这里的收窄只解决类型，**能不能属性访问由 {@link inject} 决定**。
 */
interface ClientRemoteFace {
  readonly credentials: CredentialsRemoteFace;
  /** 订阅宿主广播的凭据变更；返回撤销函数。 */
  $on(event: 'credentials/reference-updated', listener: (ref: string) => void): () => void;
}

/**
 * 取 `ctx.remote` 并收窄到 {@link ClientRemoteFace}。
 *
 * 属性访问**要求服务名逐字出现在本 fiber 的 `inject` 里** —— 见 {@link inject} 的说明。
 *
 * @param ctx - 浏览器端 Cordis 上下文。
 * @returns 收窄后的 Remote 面。
 */
function remoteOf(ctx: Context): ClientRemoteFace {
  return (ctx as unknown as { remote: ClientRemoteFace }).remote;
}

/**
 * 依赖的浏览器端服务。
 *
 * `locale` 是硬依赖：注册时声明了 `locale:`，渲染就需要已安装的 locale 面，
 * 缺席时 DSH 会直接报错而不是降级。标准 web 装配必然带它
 * （DSH `packages/bundle/web-app` 依赖 `dsh-client-locale`）。
 *
 * **`remote` 与 `remote.credentials` 两个都要写，缺一不可**：
 * - `remote.credentials` 是点号服务名（gateway 按 `remote.<namespace>` 提供），负责等命名空间就绪；
 * - `remote` 负责让 `ctx.remote` 这个**属性访问**合法。
 *
 * Cordis 的判据是「服务名逐字出现在某个 fiber 的 `inject` 里」，点号键**不会**展开成父级。
 * 只写点号键的后果不是降级而是整块装不上：`cannot get property "remote" without inject`（v1.6.0 的回归）。
 * 官方 `ui-settings-plugins` 同样两个都写。
 */
export const inject = ['slots', 'remote', 'remote.credentials', 'locale'];

/**
 * 槽 key：bundle 的**包名** = [package.json](../../package.json) 的 `name`。
 *
 * 插件页按包名寻址一个 bundle 的配置（DSH `PluginManagerPage.tsx:1298` 的
 * `ledger.bundles.has(openPkg.name)`），写错的表现是整块配置不出现、页面也不报错。
 * **真源是 package.json 的 name**；本处手写一份字面量是因为浏览器半体不 import
 * package.json，由 [test/settings-seam.test.ts](../../test/settings-seam.test.ts)
 * 断言与 `readPackageName()` 逐字相等 —— 不写死在测试里，免得哪天包名改了常量悄悄失配。
 */
const BUNDLE_NAME = 'dsh-zhihu-search';

/**
 * loader entry id = [cordis.patch.yml](../../cordis.patch.yml) 那条 insert 的 `id`。
 *
 * 它是 `ctx.configForms.get()` 的实参：该服务按**设置命名空间**取表单，而命名空间就是
 * Host 插件条目的 id（DSH `ui-settings/src/client/config-form.ts:293,297` 的
 * `get(entryId)` → `{ namespace: entryId }`）。
 *
 * ⚠️ **与 {@link BUNDLE_NAME} 今天同串，但是两个不同的东西**：改 patch 的 `id` 时槽 key
 * 仍然对得上（卡片照常出现），`get()` 却查不到命名空间 —— 卡片永远只读，**且不报错**。
 * 这是本设计唯一新引入的静默耦合点，防线是
 * [test/settings-seam.test.ts](../../test/settings-seam.test.ts) 里「`get()` 的实参取自 patch 的 id」
 * 那一组（源码字面量与 `cordis.patch.yml` 逐字相等）。
 */
const ENTRY_ID = 'dsh-zhihu-search';

/** 凭据引用名字段，对应 Host 侧 `Config.accessSecretRef`。 */
const REF_FIELD = 'accessSecretRef';

/** 隐藏原生网页搜索开关的字段名，对应 Host 侧 `Config.disableNativeWebSearch`。 */
const HIDE_FIELD = 'disableNativeWebSearch';

/** 拿密钥的地方；与根 README 用的是同一个链接名。 */
const PROFILE_URL = 'https://developer.zhihu.com/profile';

/** 引用名在不被覆盖时的默认值；与 Host 侧 `DEFAULT_ACCESS_SECRET_REF` 一致。 */
const DEFAULT_REF = 'ZHIHU_ACCESS_SECRET';

/**
 * 能力探测的窗口。
 *
 * 探测的是**能力**不是版本号：版本在插件侧取不到，而「拿不拿得到表单」这条链上有两环、
 * 各自当场可观测 —— 服务 `configForms` 在不在（{@link apply} 的嵌套 `ctx.inject` 回调来不来），
 * 以及槽 `plugins.bundle.config` 在不在（`ctx.slots.inject` 回调来不来）。两者缺席都不报错（静默）。
 *
 * **为什么不能只盯槽名**：`plugins.bundle.config` 在 0.1.6 与 0.1.7 上**都不传 `form`**
 * （DSH `PluginManagerPage.tsx` 两版同形），所以在这个槽上「槽在不在」推不出「拿不拿得到表单」。
 * 只换槽名会得到一个自相矛盾的探测，而它盯的那个真实故障是**服务缺席**（更早的宿主里没有
 * `configForms`）：那种宿主上卡片整个不注册，界面静默缺席。
 *
 * 窗口刻意给宽：迟到的声明只多留一条撤销提示，窗口太短反而会打扰正常装配上的用户。
 */
const PROBE_TIMEOUT_MS = 10_000;

/**
 * `configForms` 服务缺席时的提示。英文、`[WARN]` 前缀、无 emoji；落点是**客户端控制台** ——
 * 本插件唯一的界面（这张卡片）就长在缺席的那个槽里，没有跨版本的 UI 面可落。
 */
const SERVICE_MISSING_WARNING =
  '[WARN] dsh-zhihu-search: this Host provides no client configuration service (configForms), so the settings card cannot be registered and the three tools keep working without an in-place configuration UI. Upgrade the Host to the version range this package declares in engines.dsh.';

/** 提示必须可撤销：服务迟于窗口才到账时补一条，声明前一条作废。 */
const SERVICE_LATE_INFO =
  '[INFO] dsh-zhihu-search: the client configuration service appeared after the probe window, so the earlier warning is withdrawn and the settings card is registered.';

/**
 * 槽缺席时的提示。`configForms` 在、槽不在 —— 那是**另一个**故障，所以文案里点名的槽
 * 必须是实际注册的那一个：探测说要装 A、卡片装进 B，是最坏的一种说谎。
 */
const SLOT_MISSING_WARNING =
  '[WARN] dsh-zhihu-search: this Host renders no plugins.bundle.config entry, so the settings card cannot be shown. The three tools keep working. Mount the plugin as a bundle (dsh plugin --profile web add) to configure it in place.';

/** 槽迟到：同上，补一条撤销。 */
const SLOT_LATE_INFO =
  '[INFO] dsh-zhihu-search: plugins.bundle.config appeared after the probe window, so the earlier warning is withdrawn and the settings card is registered.';

/** 框架注入的 `t` 座位类型，绑定到本卡片的字典命名空间。 */
type CardTranslate = TranslateNS<typeof LOCALE_NS>;

/** 本卡片的 section 形状。 */
interface ZhihuSection {
  accessSecretRef?: string;
  disableNativeWebSearch?: boolean;
}

/** 是不是普通对象（`null` 与数组都不算）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 把不透明的 user 层收窄为可查键的对象。 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

// 取值逐条对齐官方配置表单的样式表（`ui-primitives/src/settings-form/{SettingsForm,fields}.module.css`；
// 旧那份 `ui-settings-plugins/PluginConfigForm.module.css` 在接缝换代之后的线上已不存在）：无外框、无圆角、无底色、无内边距 ——
// 一列控件直接铺在插件页的 `data-plugin-config` 区里；没有折叠头（标题与面包屑由插件页自己画）。
const S = {
  form: { display: 'flex', flexDirection: 'column' },
  readOnly: {
    margin: '12px 0 0',
    fontSize: 12,
    lineHeight: 1.5,
    color: 'var(--dsw-alias-label-tertiary)',
  },
  field: { display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0' },
  fieldDivider: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '12px 0',
    borderTop: '0.5px solid var(--dsw-alias-border-l2)',
  },
  head: { display: 'flex', alignItems: 'center', gap: 8 },
  label: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: 500,
    lineHeight: 1.5,
    color: 'var(--dsw-alias-label-primary)',
  },
  badges: { display: 'inline-flex', alignItems: 'center', gap: 8 },
  hint: { margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
  // 开关行：逐条对齐官方 SubagentModelSelectionCard.module.css 的 .toggleRow / .toggleLabel，
  // 右侧放原生 `Switch`（同一个 ui-primitives 包），因此外观与官方卡片一致。
  toggleRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    fontSize: 13,
    lineHeight: 1.5,
    color: 'var(--dsw-alias-label-primary)',
  },
  toggleLabel: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.5 },
  // 状态行：比说明行重一档（secondary 对 tertiary），一行说清开关当前的含义。
  stateNote: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.5,
    color: 'var(--dsw-alias-label-secondary)',
  },
  // 说明句里的外链：只用卡片既有的语义令牌，颜色取自 ui-theme 的 --dsw-alias-link。
  // 卡片是纯内联样式、无法写 :hover，所以常驻下划线作为静态可点提示。
  link: {
    color: 'var(--dsw-alias-link)',
    textDecoration: 'underline',
    textUnderlineOffset: 2,
  },
  // 原生 .footer：无分割线、无右推 —— 失败文本占满剩余宽度（flex:1），没有失败文本时按钮就靠左。
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    paddingTop: 16,
  },
  // 错误色用有定义的那个令牌：原生照抄来的那一个在 harness 里从未定义，写了不会生效（见 [AGENTS.md](./AGENTS.md)）。
  failed: {
    flex: 1,
    minWidth: 0,
    margin: 0,
    fontSize: 12,
    lineHeight: 1.5,
    color: 'var(--dsw-alias-state-error-primary)',
  },
  // 保存按钮：逐条对齐官方 SettingsForm 的 `.save`（SettingsForm.module.css:32-53）——
  // 官方设置页不用 Button 组件（md 档 36px 高），是这一款紧凑定制按钮。
  // 注意错误色那条例外对这里同样成立：focus ring 令牌取 ui-theme 里真实存在的别名。
  save: {
    appearance: 'none',
    border: '1px solid transparent',
    borderRadius: 'var(--dsw-radius-md)',
    padding: '5px 14px',
    font: 'inherit',
    fontSize: 13,
    lineHeight: 1.5,
    cursor: 'pointer',
    background: 'var(--dsw-alias-label-primary)',
    color: 'var(--dsw-alias-bg-layer-3)',
  },
  // 官方 `.save:disabled` 的 opacity 0.4 与默认光标，等价改写成对象形式。
  saveDisabled: {
    opacity: 0.4,
    cursor: 'default',
  },
} satisfies Record<string, CSSProperties>;

/**
 * 浏览器计时器没有 `unref`；Node 里有 —— 产物契约测试会在 Node 里求值本模块，
 * 不 unref 就有一条计时器吊着事件循环。有就调，没有就跳过。
 *
 * @param timer - `setTimeout` 的返回值（浏览器是数字，Node 是带 `unref` 的对象）。
 */
function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  const candidate: unknown = timer;
  if (
    typeof candidate === 'object' &&
    candidate !== null &&
    'unref' in candidate &&
    typeof candidate.unref === 'function'
  ) {
    candidate.unref();
  }
}

/** 一条字段写入操作里能出现的 JSON 值（形状见 DSH `settings/src/types.ts:52-54`）。 */
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * 一条字段写入操作。
 *
 * 用**结构类型**就地收窄，不引 `@deepseek-ai/dsh-api-remotes` 或
 * `@deepseek-ai/dsh-client-ui-settings` 的类型边（会为几个字段的形状多背一个客户端装配包）
 * —— 与 {@link ClientRemoteFace} 同一套做法。**`path` 必须是可变的 `string[]`**，
 * 写成 `readonly` 就不可赋值给服务的方法参数。
 */
type PathOp = { op: 'set'; path: string[]; value: JsonValue } | { op: 'unset'; path: string[] };

/** 卡片用到的那部分表单快照（DSH `config-form-types.ts:8-34` 的子集）。 */
interface ConfigFormSnapshotFace {
  readonly status: 'loading' | 'ready' | 'unavailable';
  readonly value: ZhihuSection | undefined;
  readonly user: unknown;
  readonly revision: number | undefined;
  readonly writable: boolean;
}

/**
 * 卡片用到的配置表单面：一个 Host 插件条目的共享表单值与写入队列。
 *
 * 结构类型而非 `import type` —— 见 {@link PathOp}。`getSnapshot` 必须返回**稳定引用**
 * （DSH 原文「stable reference until the next change」，`config-form-types.ts:40`），
 * 否则 {@link ZhihuCard} 的 `useSyncExternalStore` 会陷入重渲染。
 */
interface ConfigFormFace {
  getSnapshot(): ConfigFormSnapshotFace;
  /** 订阅快照替换；返回撤销函数。 */
  subscribe(listener: () => void): () => void;
  /** 一次原子写入；`expectedRevision` 是栅栏，false = 宿主拒绝。 */
  mutate(ops: readonly PathOp[], expectedRevision?: number): Promise<boolean>;
}

/**
 * `ctx.configForms` 在本卡片用到的最小面。
 *
 * 用结构类型取服务（与 {@link remoteOf} 同一写法）：**类型转换只在编译期**，
 * 运行时仍是 Cordis 的属性代理，`inject` 那道门禁照旧生效。
 */
interface ConfigFormsFace {
  get(entryId: string): ConfigFormFace;
}

/**
 * 取 `ctx.configForms` 并收窄到 {@link ConfigFormsFace}。
 *
 * 属性访问同样要求服务名逐字出现在某个 fiber 的 `inject` 里 —— 本文件用的是**嵌套**
 * `ctx.inject(['configForms'], …)`，理由见 {@link apply}。
 *
 * @param ctx - 浏览器端 Cordis 上下文。
 * @returns 收窄后的配置服务面。
 */
function configFormsOf(ctx: Context): ConfigFormsFace {
  return (ctx as unknown as { configForms: ConfigFormsFace }).configForms;
}

/** 卡片 props；`t` 由框架按注册时声明的 locale 命名空间注入。 */
interface CardProps {
  /**
   * 为**本插件的 loader 条目**取到的表单读写面（{@link ENTRY_ID}）。
   *
   * `configForms.get()` 从不返回 undefined，所以这里**必有**；命名空间不在册时
   * 快照的 `status` 是 `'unavailable'`、`writable` 是 false，卡片按既有只读文案渲染 ——
   * 「宿主不提供这个命名空间」与「描述还没回来」对用户是同一件事，因此不新增可见状态。
   */
  readonly form: ConfigFormFace;
  readonly store: ReturnType<typeof createCredentialStore>;
  /** 把当前**生效**的引用名交回 apply —— 卡片是唯一看得到它的地方（`apply` 期拿不到表单值）。 */
  readonly trackSavedRef: (ref: string) => void;
  readonly t: CardTranslate;
}

/**
 * 一张配置卡片：字段就地编辑，底部一次性写入。
 *
 * 草稿只活在组件本地状态里 —— 卸载即丢弃（原生表单同款语义），因此没有「放弃」控件；
 * 保存成功同时清空草稿，失败则保留草稿与诊断供修正。
 *
 * **快照归卡片自己订阅**：`plugins.bundle.config` 的座位里**没有** `form`（页面只递 `view`），
 * 所以没有「页面重渲染把新值推进来」这条路 —— 卡片自己 `getSnapshot` + `subscribe`，
 * 宿主在别处改了配置（或 `mutate` 把应答折回镜像，`config-form.ts` 的 `acceptView`）
 * 时卡片就会更新。这也是它与挂在 `plugins.row.config` 上时的**行为差异**所在。
 *
 * @param props - 本插件条目的表单面、凭据状态源、引用名回传口，以及框架注入的翻译座位。
 * @returns 卡片元素。
 */
function ZhihuCard({ form, store, trackSavedRef, t }: CardProps): JSX.Element {
  const snapshot = useSyncExternalStore(
    (onChange) => form.subscribe(onChange),
    () => form.getSnapshot(),
  );
  const section = snapshot.value ?? {};
  const credentialState = useSyncExternalStore(
    (onChange) => store.subscribe(onChange),
    () => store.getSnapshot(),
  );

  const [secret, setSecret] = useState('');
  const [refDraft, setRefDraft] = useState<string | undefined>(undefined);
  const [hideDraft, setHideDraft] = useState<boolean | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState('');

  const writable = snapshot.status === 'ready' && snapshot.writable;
  const disabled = !writable || saving;
  const effectiveRef = typeof section[REF_FIELD] === 'string' ? section[REF_FIELD] : '';
  const refText = refDraft ?? effectiveRef;
  const refOverridden = asRecord(snapshot.user)?.[REF_FIELD] !== undefined;
  const refDirty = refText !== effectiveRef;
  const hideEffective = section[HIDE_FIELD] === true;
  const hideText = hideDraft ?? hideEffective;
  const hideDirty = hideDraft !== undefined && hideDraft !== hideEffective;
  const dirty = secret !== '' || refDirty || hideDirty;

  // 状态只对它所描述的那个引用名有效。引用名刚改、状态还没跟上时说「未配置」，
  // 而不是拿上一条记录的答案冒充 —— 徽标说谎比徽标迟到更糟。
  const credential: CredentialView =
    credentialState.ref === effectiveRef ? credentialState : { configured: false, writable: true };
  const secretDisabled = disabled || !credential.writable;
  const blocked = !dirty || disabled;

  // 引用名一变就交回 apply 并重读 —— 徽标描述的是**现实**（配置里存下来的那个名字），
  // 不是编辑中的草稿。只在这里回传：`apply` 拿不到 `form`，卡片是唯一看得到生效值的窗口。
  // 顺序不能换：先交回名字，`store.refresh()` 才问得对。
  useEffect(() => {
    trackSavedRef(effectiveRef === '' ? DEFAULT_REF : effectiveRef);
    void store.refresh();
  }, [effectiveRef, store, trackSavedRef]);

  const save = async (): Promise<void> => {
    setSaving(true);
    setFailed('');
    try {
      // 一次**原子**写：引用名与开关攒成同一批 ops，共用同一个 revision 栅栏。
      // 旧版是两三次独立写入，中间态在界面上可见（引用名已落、开关还没落）。
      const ops: PathOp[] = [];
      if (refDirty) {
        ops.push(
          refText === ''
            ? { op: 'unset', path: [REF_FIELD] }
            : { op: 'set', path: [REF_FIELD], value: refText },
        );
      }
      if (hideDirty) ops.push({ op: 'set', path: [HIDE_FIELD], value: hideText });
      if (ops.length > 0) {
        // `mutate` 返回 boolean：false = 宿主拒绝（多半是 revision 冲突），传输错误仍然 reject，
        // 由下面的 catch 一起收口。拒绝必须说出来 —— 悄悄丢弃草稿等于让用户以为保存成功了。
        if (!(await form.mutate(ops, snapshot.revision))) throw new Error(t('saveRejected'));
      }
      // 空白密钥表示「不修改」：凭据域拒收空值，清空得走 unset，不做成隐式副作用。
      // 凭据写入**排在配置之后**：失败的配置写入不该留下一个指向不存在记录的引用。
      if (secret !== '') await store.write(refText === '' ? DEFAULT_REF : refText, secret);
      setSecret('');
      setRefDraft(undefined);
      setHideDraft(undefined);
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={S.form}>
      {/* 命名空间不在册（`status === 'unavailable'`）或宿主不可写时落到这里：读作「不可写」，
          不新增可见状态。描述还没回来（`loading`）时不显示，免得闪一行假提示。 */}
      {!writable && snapshot.status !== 'loading' ? (
        <p style={S.readOnly} role="status">
          {t('readOnly')}
        </p>
      ) : null}

      <div style={S.field}>
        <div style={S.head}>
          <label style={S.label} htmlFor="zhihu-access-secret">
            {t('secretLabel')}
          </label>
          <span style={S.badges}>
            <Tag tone={credential.configured ? 'neutral' : 'quiet'}>
              {credential.configured ? t('secretConfigured') : t('secretMissing')}
            </Tag>
          </span>
        </div>
        <Input
          id="zhihu-access-secret"
          type="password"
          autoComplete="off"
          value={secret}
          disabled={secretDisabled}
          onChange={(event) => {
            setSecret(event.target.value);
          }}
        />
        <p style={S.hint}>
          {t('secretHintBefore')}
          <a style={S.link} href={PROFILE_URL} target="_blank" rel="noopener noreferrer">
            {t('secretHintLink')}
          </a>
          {t('secretHintAfter')}
        </p>
        {credential.writable ? null : <p style={S.hint}>{t('secretShadowed')}</p>}
      </div>

      <div style={S.fieldDivider}>
        <div style={S.head}>
          <label style={S.label} htmlFor="zhihu-access-secret-ref">
            {t('refLabel')}
          </label>
          {refOverridden ? (
            <span style={S.badges}>
              <Tag tone="neutral">{t('refOverridden')}</Tag>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  setRefDraft('');
                }}
              >
                {t('reset')}
              </Button>
            </span>
          ) : null}
        </div>
        <Input
          id="zhihu-access-secret-ref"
          type="text"
          spellCheck={false}
          value={refText}
          disabled={disabled}
          onChange={(event) => {
            setRefDraft(event.target.value);
          }}
        />
        <p style={S.hint}>{t('refHint')}</p>
      </div>

      <div style={S.fieldDivider}>
        <div style={S.toggleRow}>
          <span style={S.toggleLabel}>{t('hideNativeWebLabel')}</span>
          <Switch
            checked={hideText}
            label={t('hideNativeWebLabel')}
            disabled={disabled}
            onChange={(next) => {
              setHideDraft(next);
            }}
          />
        </div>
        {/* 状态行：与官方 SubagentModelSelectionCard 同款写法 —— 拨动即换文案，
            用户不必从开关位置猜它到底做了什么。 */}
        <p style={S.stateNote}>{t(hideText ? 'hideNativeWebOn' : 'hideNativeWebOff')}</p>
        <p style={S.hint}>{t('hideNativeWebHint')}</p>
      </div>

      <div style={S.footer}>
        {failed !== '' ? (
          <p style={S.failed} role="status">
            {failed}
          </p>
        ) : null}
        <button
          type="button"
          style={blocked ? { ...S.save, ...S.saveDisabled } : S.save}
          disabled={blocked}
          onClick={() => {
            void save();
          }}
        >
          {saving ? t('saving') : t('save')}
        </button>
      </div>
    </div>
  );
}

/**
 * 注册配置卡片与它的字典。
 *
 * 槽是插件管理页的 `plugins.bundle.config`，`key` 是**包名**（见 {@link BUNDLE_NAME}）：
 * 页面按它寻址一个 bundle 的配置，写错即整块不出现。**只给 `page`** ——
 * 该槽只渲染 `page`（DSH `slot-contract.ts:12-16`），`summary` 没有任何渲染路径，
 * 所以不留那条死文案。
 *
 * `configForms` 走**嵌套 `ctx.inject`** 而不是写进模块级 {@link inject}：
 * 后者是**激活门禁**，把一个 0.1.7 才有的服务写进去，会让更早宿主上的整个客户端半体 pending
 * —— 字典、凭据订阅、探测连发声机会都没有。嵌套的代价只是「卡片可选」，而且这个缺席**可观测**
 * （探测的那条 WARN 正是报它），符合「可选服务必须把门 + 留降级路径」。
 *
 * 字典注册进 `ctx.effect`，插件卸载时随之注销（`register` 返回 disposer）。
 *
 * @param ctx - 浏览器端 Cordis 上下文。
 */
export function apply(ctx: Context): void {
  const remote = remoteOf(ctx);
  // 读的是**生效**的引用名（配置里存下来的那个），不是编辑中的草稿 ——
  // 徽标描述的是现实，草稿只是表单值。
  //
  // 这个名字只能由卡片回传：`apply` 期拿不到表单值（表单是按 `ENTRY_ID` 取的，
  // 但值要等镜像回来）。初值先用默认名，卡片一挂载就会把真实值交回来并触发一次重读。
  let savedRef = DEFAULT_REF;
  const trackSavedRef = (ref: string): void => {
    savedRef = ref;
  };
  const store = createCredentialStore(
    () => remote.credentials,
    () => savedRef,
  );

  ctx.effect(
    () => ctx.locale.register(LOCALE_NS, ZHIHU_LOCALES),
    'zhihu-search: card dictionaries',
  );

  // 密钥在别处被写（手改 `.credentials.yaml`、或别的页面写了同名引用）时重读，
  // 否则徽标会一直报告宿主早已替换掉的状态。
  ctx.effect(
    () =>
      remote.$on('credentials/reference-updated', (ref: string) => {
        if (ref === store.getSnapshot().ref) void store.refresh();
      }),
    'zhihu-search: credential refresh on host update',
  );

  // 能力探测：**只新增提示路径**，注册的槽名 / key / 时机一字不动。
  //
  // 「拿不到表单」这条链上有两环，各自会独立地断、表现都是静默，所以**各给一个窗口**：
  // 一个盯服务 `configForms` 到没到，一个盯槽 `plugins.bundle.config` 到没到。
  // 分开计时是为了让「哪一环缺席」这件事本身不含糊 —— 合用一个窗口时，
  // 服务迟到会把槽那一条提示一起撤掉，而槽可能压根不会来（那正是要报的另一种缺席）。
  //
  // 两个窗口都在 `apply` 期开：**探测不改变注册时机**，只是给这段时间加一个观察者。
  // 槽那一个在 `ctx.inject` 里开只是为了拿到那个作用域，尺度对判决没有影响 ——
  // 判据是「窗口内到没到」，不是「相对于谁到」。
  //
  // 状态活在 apply 的闭包里（模块顶层不得有状态），计时器由 ctx.effect 拥有并释放。
  let serviceDeclared = false;
  let slotDeclared = false;

  /** 一环的探测状态：一个窗口、一个「窗口已过、正等它到账」的标记、一个撤销口。 */
  interface ProbeRing {
    timer: ReturnType<typeof setTimeout> | undefined;
    /** 窗口过去了而它还没到 —— 无论当时报没报（不值得报的那一环会是静默的）。 */
    announced: boolean;
    /** 到账时调用：停掉窗口；窗口已过就补一条 INFO（当时没报过的环也是——它迟到了）。 */
    settle: () => void;
  }

  /**
   * 给一环开窗口。
   *
   * 到点时仍没到账就发一条 WARN（不值得报的那一环只记下「窗口过了」）；到账则停掉窗口，
   * 窗口已过就补一条 INFO。两环**各自**持有窗口与标记，所以一环迟到不会误撤另一环的提示。
   *
   * @param relevant - 这一环还值不值得**报**；缺省恒真。槽那一个用它把自己压住 ——
   *   服务都没到时就报「槽缺席」是在替另一环说话（而且一次超时会变成两条，噪音）。
   *   注意它只压住「报」，不压住「撤」：到点时还不值得报的环仍然保持待命，
   *   之后真到账了照样补一条 INFO —— 迟到的到账本来就该有回音。
   */
  const armProbe = (
    warning: string,
    info: string,
    isDeclared: () => boolean,
    relevant: () => boolean = () => true,
  ): ProbeRing => {
    const ring: ProbeRing = { timer: undefined, announced: false, settle: () => undefined };
    ring.timer = setTimeout(() => {
      ring.timer = undefined;
      if (isDeclared()) return;
      ring.announced = true;
      if (relevant()) console.warn(warning);
    }, PROBE_TIMEOUT_MS);
    unrefTimer(ring.timer);
    ring.settle = () => {
      if (ring.timer !== undefined) clearTimeout(ring.timer);
      ring.timer = undefined;
      if (!ring.announced) return;
      ring.announced = false;
      console.info(info);
    };
    return ring;
  };

  let serviceProbe: ProbeRing | undefined;

  ctx.effect(() => {
    serviceProbe = armProbe(SERVICE_MISSING_WARNING, SERVICE_LATE_INFO, () => serviceDeclared);
    return () => {
      if (serviceProbe?.timer !== undefined) clearTimeout(serviceProbe.timer);
      serviceProbe = undefined;
    };
  }, 'zhihu-search: configuration service probe');

  let slotProbe: ProbeRing | undefined;

  ctx.effect(() => {
    // 服务缺席时这一环不发声：那时「槽在不在」还没到判的时候，报出来是替服务那一环说话。
    slotProbe = armProbe(
      SLOT_MISSING_WARNING,
      SLOT_LATE_INFO,
      () => slotDeclared,
      () => serviceDeclared,
    );
    return () => {
      if (slotProbe?.timer !== undefined) clearTimeout(slotProbe.timer);
      slotProbe = undefined;
    };
  }, 'zhihu-search: configuration slot probe');

  ctx.inject(['configForms'], (scoped) => {
    serviceDeclared = true;
    serviceProbe?.settle();

    // 表单在这个作用域里取一次即可：服务按 entry id 缓存（`config-form.ts:294-295`），
    // 返回同一个对象，所以不必每次渲染重取。
    const form = configFormsOf(scoped).get(ENTRY_ID);

    ctx.slots.inject('plugins.bundle.config', () => {
      slotDeclared = true;
      slotProbe?.settle();

      return ctx.slots.register(
        { name: 'plugins.bundle.config', key: BUNDLE_NAME, locale: LOCALE_NS },
        (seat: { t: CardTranslate; view: 'page' }) => (
          <ZhihuCard form={form} store={store} trackSavedRef={trackSavedRef} t={seat.t} />
        ),
      );
    });
  });
}
