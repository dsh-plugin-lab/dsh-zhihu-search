# dsh-zhihu-search 架构说明

本文记不变的设计与约束。文件级清单归子 README，决策理由归 [.agents/notes/](../.agents/notes/)。

## 核心目标

把知乎开放平台的检索能力变成模型可用的语义化工具，且不泄露凭据、不污染模型上下文。

## 不可破坏的约束

- **模型不接触知乎原始语法**。`SortBy` 与 `Filter` 是字符串微语法，模型写错只得到 `10001`，且无法从错误中学会正确写法。编译器是唯一出口。
- **呈现三层分离**。模型可见文本、可持久化元数据、UI 卡片互不混入；混入即导致历史回放与实时结果不一致。三条推论：
  - 只有 Markdown 无法无损承载的结构才值得进 `presentationMeta`，所以搜索声明它、直答不声明（答案本身就是模型文本，复制进 meta 会让会话日志翻倍）。
  - `presentResult` 在失败时返回 `undefined`，交回 UI 渲染原始文本，避免同一句话写两遍后措辞漂移。
  - 因此呈现层必须无运行时依赖，才能被单测直接验证纯度。
- **无可变全局状态**。状态经 `ctx.effect()` 创建并随插件卸载释放；模块级单例在 HMR 下产生两代插件共用缓存的故障。
- **`@deepseek-ai/*` 只在 `peerDependencies` 与 `devDependencies`**。放进 `dependencies` 会让 Cordis Context 出现两个实例，破坏服务单例。
- **传输层不认识语义化参数**。`transport.ts` 只接受编译产物；编译规则随知乎文档变化，传输契约不变。

## 模块骨架与依赖方向

依赖单向流动，只有两个出口：

- `index.ts` 是**唯一**接触 Cordis 的模块，也是唯一创建状态的模块。其余模块都不认识框架，因此可脱离框架单测。
- `present/` 与 `utils/` 是**叶子**：不反向依赖任何模块，也不做运行时 `@deepseek-ai/*` 导入。前者的理由是纯度必须可测，后者同理。
- `utils/describe-error.ts` 是**零导入的叶子**，它存在的理由就是避开环：`utils/errors.ts` 值导入 `transport.ts` / `state.ts` / `compiler.ts` 取错误类做 `instanceof` 判定，若「异常 → 一行文本」住在那里，最上游的 `transport.ts` 就无法复用它。所以 `transport.ts` 可以依赖这个叶子，但**不得反向依赖 `utils/errors.ts`**。
- `transport.ts` 位于编译器的**下游**而非上游——它不认识语义化参数（见「不可破坏的约束」）。
- 浏览器半体 `client/` 与 Node 侧**不共享任何模块**：它通过 `ctx.slots` 的 `plugins.bundle.config` 槽与 Host 通信，表单则由它自己向 `ctx.configForms.get(<loader entry id>)` 取 —— **该槽的座位里没有 form**（见下方「两半体约束」）。它不 import `src/` 下的实现。

逐文件的箭头清单与职责见 [src/README.md](../src/README.md)。

## 请求生命周期（仅搜索路径）

直答不走这条链——它没有 `SortBy` / `Filter`，直接 POST 到 chat 端点并消费 SSE。

1. 工具收到语义化参数，先用编译器把它们转成 `SortBy` / `Filter` 字符串 —— 缓存键要用编译后的产物，这一步必须先于查缓存。
2. 按归一化参数算缓存键并查缓存；命中即返回，不消耗令牌与额度。
3. 未命中则过本地令牌桶；超限返回本地限流错误，不发出请求。
4. 客户端注入鉴权头并发出请求，拆开响应信封。
5. 文本层剥离高亮标签与跟踪参数，投影为 Canonical Output。
6. 成功结果写入缓存；`render` 产出模型文本，`presentationMeta` 产出 UI 元数据。

## 端点契约

两个搜索端点的 `Filter` 语法互不兼容：站内只认发布时间，全网才认域名。因此各自独立成工具，而不是一个工具的开关——合成一个意味着模型要记住「哪个参数在哪个模式下非法」，那是必然出错的负担。

- `zhihu_search`：站内检索，不接受站点过滤。`Count` **服务端上限 10**（与官方文档一致；实测传 15 / 20 / 30 都只回 10 条）。
- `zhihu_global_search`：全网索引检索，接受站点过滤但拒绝知乎域名。`Count` **服务端上限 20**（裸探针实测传 30 回 20；「传 0 回落 10」同属裸探针结论 —— 插件路径会把 `count` 先夹到 ≥1，永远发不出 0）。结果集另可由 `searchDb`（`all` / `realtime` / `static`）切换索引库，除此之外**没有翻页参数**。
- `zhihu_zhida`：SSE 流式，语义化档位映射为真实模型 id。
- **`SortBy` 的区间筛的是「本次检索到的候选」，不是全库**（2026-09-14 实测）：同一查询、同一 `minValue`，`count=3/5/10` 分别返回 1/1/3 条，且结果恰好等于「按相关性取前 `count` 条后筛出落在区间内的那些」。
  - **双边界语法确实可用**：`(,max)` / `(min,max)` / `(,)` / 裸字段全部 `code=0`，且返回项逐条满足边界。但两端都只是「筛候选」，不是全库排序。
  - 因此 `minValue` 的效果与 `count` 耦合，**空结果不等于知乎没有高赞内容** —— 同查询加时间过滤后曾取到 929/1166 赞的条目。
  - 插件对策：下限生效时**按端点上限取候选池**，再按模型要的条数截断（[src/tools/search.ts](../src/tools/search.ts) 的 `FILTERED_CANDIDATE_COUNT`），并在筛少时于模型可见文本里说明「下限只在本次候选内生效」。
  - 上界（`maxValue`）刻意不暴露：既然只是筛候选，`≤N 赞` 这类旋钮的收益远小于它给参数面带来的宽度。

上述上限是**上游契约**：实测得出，不是本项目可调的旋钮。

两个搜索端点还有两条共同的反直觉处（2026-09-13 实测）：

- **未知参数被静默忽略**。把响应里的 `SearchHashId` 分别以 `SearchHashId` / `HashId` / `Cursor` / `Offset` / `Page` / `Start` 传回，结果指纹逐一不变；连非法的 `SortBy` 都回 `code=0`。**所以判断「参数是否生效」不能看错误码，只能比结果指纹**——第一次探针正是栽在这里。
- **`HasMore` 从未观察到 `true`**。站内按文档恒为 false，全网在 12 个宽泛查询（各取 20 条）里也全部为 false。它既不能当翻页依据，也**未被证实**是「结果被截断」的信号；渲染层保留了一个 `hasMore` 守卫，按现有实测不会触发。

本项目自己的参数集合与输出 schema 不在本文重复，以源码常量与测试为准：[src/tools/](../src/tools/)、[src/utils/compiler.ts](../src/utils/compiler.ts)，由 [test/compiler.test.ts](../test/compiler.test.ts) 与 [test/tool.test.ts](../test/tool.test.ts) 固化。

## 错误契约

工具对模型的失败面是**数据结构，不是异常**：`execute` 永不 throw。

- 任何失败都收敛为 `{ok:false, error}`，`error.kind` 是模型判断「该不该换个做法重试」的唯一依据。
- 因此错误分类必须收敛到有限集合（源码里的 `ZhihuErrorKind`）：散落的 `try/catch` 迟早漏分支，漏掉的那个会以「未知错误」暴露给模型，模型据此做的判断就是错的。
- 参数错必须带 `hint` 且**可据以纠正**。模型看不到知乎的原始报错，只有我们给的补救建议——所以提示要指向正确做法，而不是复述失败。
- 只有 `90001` 与网络类错误值得重试；`10001`/`20001`/`30001` 是确定性错误，重试只花时间。
- **两套判错逻辑不可合并**：搜索端点的错误码是数字（`Code`），直答是 OpenAI 兼容形态 —— 成功时没有 `Code`，失败时 `error.code` 是**字符串**（`model_not_found`、`rate_limit_exceeded`）并带 `type`。只认数字会把「频率限制」「档位未授权」压成 `unknown` 且无 hint，模型据此无法决定该等待还是该换档位（实测踩到过）。
- **失败可能发生在流中途**（HTTP 200 已发出）：官方文档定义的中途失败帧为 `finish_reason: "error"` 加顶层 `error` 体，随后是 `[DONE]`。它必须终止整轮：半截回答被当成完整答案，比直接失败糟得多。

映射集中在 [src/utils/errors.ts](../src/utils/errors.ts)；工具侧的实现纪律见 [src/tools/README.md](../src/tools/README.md)。

## 缓存与限流

两层保护，防的是不同的东西，顺序不可颠倒：

- **缓存**防重复付费：知乎额度按自然日结算，同样的查询在 TTL 内只该发一次。额度实测充足之后（[探测笔记](../.agents/notes/2026-09-12-zhihu-api-capability-probe.md)），它的定位从「必需」降级为**性能优化**——省的是额度，不是正确性。具体额度随账号变化，不在此写死。
- **令牌桶**防突发：额度是全局的，而并发工具调用没有天然节流，一次对话就能打满。
- **缓存优先于令牌桶**：命中缓存既不该消耗令牌，也不该消耗额度。
- 缓存键掺入**凭据来源标识**，因此换账号即换缓存空间（见「密钥解析契约」）。
- 缓存**只写成功结果**：把一次偶发限流写进缓存会锁定整个 TTL。
- 本地限流不消耗任何知乎额度——它根本没发出请求。这条对模型很重要，所以错误信息里写明了。

## 密钥解析契约

DSH 的凭据契约只有一句：**设置存引用，provider 存值**。本插件照此实现，不自带字面量通道。

- 插件不持有密钥本体，只持有**解析器**；每次请求现取，所以换密钥不需要重启进程。
- **凭据服务只能经 `inject` + 属性访问取得**，不得走 `ctx.get('credentials')`。后者按 cordis 文档是「不受 inject 约束的读取」，绕过的是门禁而非服务发现本身 —— 实测它在 1.6.0 的线上装配里拿不到服务，而同一上下文里 `ctx.tools`（inject + 属性访问）一直正常。由 [test/redlines.test.ts](../test/redlines.test.ts) 静态拦下 → [复盘](postmortem/2026-09-15-credential-service-unreachable.md)。
- 取值链固定为 **凭据域 → 进程环境**。凭据域是唯一的取值口；环境变量那一段只在 provider 没挂载时才有意义 —— provider 自己已按 进程环境 > `.credentials.yaml` > 项目 `.env` > `$DSH_HOME/.env` 分层，插件再分一次是重复的。
- 引用名在卡片上是自由文本，而 seam 的语法是 POSIX shell 标识符。越界的名字（如 `my-key`）先经 `isCredentialRefName` 拦下、读作「未配置」，不让一个 typo 在请求路径上抛错。
- 缓存键掺入的是**凭据来源标识**（就是引用名），不是明文；换一个引用名即换一个缓存空间。
- 两条都空时抛出鉴权错误并指向设置位置，而不是发出一个空 Bearer 去换回难懂的 `20001`。

### `accessSecret` 为什么仍留在 schema 里

它**不是**取值来源 —— 插件不读它的值。留着只为**一件事**（2026-09-22 起）：

- **组合配置单向迁徙的入口。** 有人把明文写进活动 profile 的 `cordis.patch.yml`（`config.accessSecret`）时，启动期由 [src/migrate.ts](../src/migrate.ts) 把它搬进凭据域，然后告警请人手动删掉那一行。组合配置不属插件，插件没有也不该有改写它的口子。

**它曾经的作用是 redact 锚点，那一层已经随这次接缝换代（2026-09-22）消失**：客户端配置页只投影 **volatile** 字段（settings 包的 `volatileForm` + `projectForm`），而非 volatile 的 `accessSecret` 结构上不可能出现在发往浏览器的 value / base / user 里 —— 那条线路上已经没有保护对象。字段仍带 `role('secret')`（[test/redact-anchor.test.ts](../test/redact-anchor.test.ts) 钉住 redact 仍然认得这个槽位），但保留它的理由换成了上面那一条。

旧 `settings.yaml` 那半边是**结构性**不可达的，不是「暂时读不到」：宿主的 `importLegacyDocument()` 按 section 名当 entry id 导入，而它只映射三个官方 section；就算导进去了，`describe()` 也只投影 volatile 字段，`mutate()` 对非 volatile 路径直接抛。所以「先写后删」的次序纪律连同 `purge` 通道一起退场 —— 现在没有任何东西可删，「搬不动就原样保留」是结构性成立的。

将来清理时，这个字段与 `migrate.ts` 仍然必须一起删。迁徙的纪律与明文各层归属，见[决策记录](../.agents/notes/2026-09-15-credential-store-migration.md)。

## 两半体约束

插件在面板中出现，需要**两个半体同时存在**：

- Host 半体把配置标成**活引用**（volatile）：`accessSecretRef` 与 `disableNativeWebSearch` 两个字段带 `.volatile()`，插件因此不重新挂载就能读到新值（`.get()`），并用一条 `ctx.on('loader/volatile-update', …)` 做写入后的就地生效。它再用 `settings.configure({ auto: false }, ctx.fiber)` 声明「这一行自带页面」。
- 浏览器半体声明 `dsh.client`，并向插件页的 `plugins.bundle.config` 注册一张卡片，`key` 是**包名**（`package.json` 的 `name`）；页面把它内联渲染在 bundle 详情页的描述与「包含的组件」之间，**没有多一次 Configure**。
- **这个槽的座位里没有 `form`**（DSH 契约原文「Bundle configuration renders only `page`」，且渲染点只递 `view` 与 `entryKey`），所以卡片自己经客户端服务取：`ctx.configForms.get(<loader entry id>)` —— 该服务的命名空间就是 Host 插件条目的 id，取值即 `cordis.patch.yml` 那条 insert 的 `id`。
- 于是有**两个今天同串、却不是一回事**的 id：槽 key 取**包名**、`get()` 取**loader entry id**。写错前者 = 整块配置不出现（页面不报错）；写错后者 = 卡片照常出现、**永远只读且不报错**。这是本设计唯一新引入的静默耦合点，防线是 [test/settings-seam.test.ts](../test/settings-seam.test.ts) 从源码与 `cordis.patch.yml` 解析后对账。
- **`dsh-` 串的三层（命名耦合地图）**：

  | 层 | 字符串 | 谁定的 | 单真源 |
  | :--- | :--- | :--- | :--- |
  | 宿主强制 = 包名 | `package.json.name` / `cordis.patch.yml` 的 `name` / 槽 key `BUNDLE_NAME` / 信封 `BUNDLE_ID` | 宿主按包名索引 | `package.json`（构建脚本读它；测试断言源码字面量 = `readPackageName()`） |
  | 自选同串 | `ENTRY_ID` = patch 行 `id` = 设置命名空间 | 我们选的约定 | **独立手写字面量**（浏览器半体不 import package.json；由 settings-seam / client-bundle 对账） |
  | 故意不同 | 无（本仓 UI 不另设 slot id） | — | — |

  改名时：第一层跟着 `package.json` 走（构建自动）；第二层要**手动**改 `src/client/index.tsx` 与 `cordis.patch.yml` 两处字面量并迁移用户设置（旧命名空间的值不会自动搬）。

拿不到表单这条链上有**两环**，各自缺席都不报错 —— 界面**静默缺席**：

- `configForms` 服务不在（更早的宿主）：`ctx.inject(['configForms'], …)` 的回调不会来。
  **这个服务刻意不进模块级 `inject`** —— 那是**激活门禁**，写进去会让更早宿主上的整个客户端半体 pending，连控制台提示都发不出来。嵌套 `inject` 把降级限制在「卡片不注册」这一件事上。
- 槽 `plugins.bundle.config` 不在（宿主没装插件管理页，或本插件被当成普通 entry 挂载）：`ctx.slots.inject` 的回调不会来。

浏览器半体因此带一个超时的能力探测（不查版本号），**两环各给一个窗口、各报实际断掉的那一环**：超时后在客户端控制台留一条英文 WARN，那一环迟到再补一条 INFO 撤销；探测不改变注册语义，也不影响任何既有功能。分水岭与升级指引见根 [README.md](../README.md) 的「版本兼容」。

**为什么探测不能只盯槽名**：`plugins.bundle.config` 在接缝换代前后的两版宿主上**都不传 `form`**（该槽的座位始终只有 `view`），所以在这个槽上「槽在不在」与「拿不拿得到表单」结构性地无关 —— 只把槽名换一换会得到一个自相矛盾的探测。真正会断的那一环是**服务缺席**。（版本号现查 `package.json` 的 `engines.dsh` 与 `npm view @deepseek-ai/dsh dist-tags`，本文不抄。）

页面渲染的是三者同时在场：**配置表单**、已注册的条目、以及条目要的那个视图。**没有通用 schema 表单回退**，因此「注册了条目」与「页面里看得见」是两件事。包名是插件页取这个 bundle 配置的连接键，写错就是静默不显示。注册只给 `page`：该槽没有 `summary` 的渲染路径，所以不留那条回退文案。

**快照归卡片自己订阅**（这是换回本槽唯一的架构级行为变化）：`configForms.get()` 返回的 `ConfigForm` 有 `getSnapshot` 与 `subscribe`（DSH 保证快照引用在下次变化前稳定），所以卡片用 `useSyncExternalStore` 订阅；宿主在别处改了配置（或 `mutate` 把应答折回镜像）时卡片会自己更新，不必等页面重渲染。挂在 `plugins.row.config` 上时相反 —— 那里的 `form` 由页面在渲染期递进来，`form.state` 是一份「由页面 owner 刷新」的快照，页面重渲染才是推进源。

卡片文案走 DSH 的 locale 服务，不硬编码：字典在 [src/client/locales.ts](../src/client/locales.ts)，槽位注册声明 `locale:` 之后框架才把类型化的 `t` 座位注入组件 props。代价是一个**硬依赖**——声明了 `locale:` 的条目在渲染时要求已安装的 locale 面，缺席即报错而不是降级。标准 `dsh web` 装配必然带它（DSH `packages/bundle/web-app` 依赖 `dsh-client-locale`，多个核心客户端包也依赖它）。

**插件自己的名字与描述不走这条线**（2026-09-22 加）：宿主画插件页与设置时，插件**还没被加载**（禁用、加载失败、预设里的条目都要能显示），所以名字与描述由宿主按**包名**去读包根 [locale/](../locale/) 下的语言文件与 [package.json](../package.json) —— 不执行任何插件代码，也不需要浏览器半体在场。因此这里有**两条都能独立静默失败的线**：卡片能不能渲染是**半体接缝**问题（上文的两环，症状是配置区不出现，控制台有 WARN）；名字怎么显示是**清单资源**问题（`exports` 没暴露或 `files` 没收录，症状是退回技术名，**完全没有提示**）。后者由 [scripts/plugin-metadata.mjs](../scripts/plugin-metadata.mjs) 守卫，判定与 `npm run check:release` 同源。

## 工具描述约定

工具描述是模型选工具与填参数的主要依据，按固定三槽写，顺序不变：

1. **是什么**：检索或生成什么。
2. **什么时候选它**：含「该用别的工具时指向谁」。各工具互为路由，不让模型自行推断边界。
3. **结果形态或硬边界**：一句。

唯一禁止项：**工具描述不枚举自己参数的取值**。枚举属于参数描述，两边都写就是同一事实说两遍，而参数 schema 永远与描述一同进入上下文。

区分能力与枚举：`可按点赞数、评论数或时间排序` 是能力，有路由价值，保留；`fast / thinking / agent` 是枚举，删掉。

**结果形态槽要写明模型实际拿得到什么**，拿不到的也要点名 —— 两个搜索工具因此写明「结果不含图片」。不写，模型就会向用户承诺一张它看不到的图。

**为什么结果形态槽是硬要求**：函数调用模式下宿主只把 `{name, description, parameters}` 发给模型（DSH 的 `dsh-llm-deepseek` 与 `dsh-llm-pi-ai` 两个 provider 都是如此），`output.schema` **不进上下文**；只有 code runtime（PTC）模式才由它生成 `interface ToolOutputMap`。所以描述在首次调用前是模型唯一的预期来源，写漏了就只能靠第一次结果现学。

**参数说明里的字面语义必须等于物理行为**。已固化的反例：[src/tools/search.ts](../src/tools/search.ts) 的 `minValue` 曾写作「只要点赞数 ≥ 100 的结果」，而上游的区间只筛**本次检索到的候选** —— 模型据此会说出「知乎只有 3 篇高赞文章」。宁可写长，不可写偏。

**参数耦合只能落在描述里**：DSH 的值 schema DSL **拒绝** `minimum` / `maximum` / `dependentRequired`（实测报 `not supported by the value schema DSL`），因此 `order` / `minValue` 用 `[依赖 sortField]` 前缀标注，**并由 `execute` 本地拦截** —— 不合法组合不发请求，回 `kind: 'param'` 带可据以纠正的 hint。

## 模型可见文本的诚实性

工具描述解决「调用前」的预期，渲染文本解决「调用后」的理解。四条不变量以 [test/presentation.test.ts](../test/presentation.test.ts) 固化 —— 它们防的都是同一类错误：**把工具的边界说成世界的边界**。

- **到顶必说**：请求条数超过端点上限、且返回正好等于上限时，正文里写明「达到本工具的单次检索上限」。不写，模型会把 10 / 20 条当成全集。
- **来源构成分流**：全网搜索的头部按实际构成措辞 —— 纯站外写「（纯站外来源）」、混合写「（含 N 条知乎站内）」、纯知乎才写「的知乎结果」。写错会让模型把 github 的条目当知乎内容引用。
- **空态首句自带条件限定**：有筛选条件时写「当前筛选条件下未命中…」，无筛选条件才写「未找到…」。首句是首因效应的落点，写成「未找到」等于把「被筛掉了」说成「不存在」。
- **到顶与「被筛少」互斥**：两句同时出现会互相打架，渲染层二选一。

## 原生工具的可见性

「隐藏原生网页搜索」开关用 `tools.restrict()` 把 DSH 的 `web_search` / `web_fetch` 从**该 agent 的可见集**里摘掉 —— 不是执行期拦截，被 deny 的工具与不存在无法区分。

**这两个工具不在全局层**：web profile 关掉了 base bundle 的全局 `tool-web` 行（DSH `bundle/web-app/cordis.patch.yml:470`），改由 **agent preset 的 standing scope** 注册，agent 的 scope 再挂到那一层下面（`preset/agent-presets/src/index.ts:3-12`）。「它们存在吗」只能站在某个 agent 的 scope 链上问。

- restriction 必须装在 **agent 的 scoped ctx** 上：全局范围会被 DSH 直接拒绝（那会遮蔽每个 agent）。
- 取注册表要**免 inject 的 `agent.ctx.get('tools')`**，不能用属性访问 —— 后者要求 agent scope 自己声明过 `tools` 依赖（不由本插件决定），实测抛 `cannot get property "tools" without inject`。
- 名字过滤靠 `restrict()` 自己：它按**该 agent 的 scope 链**校验，存在即装、不存在即抛；逐个名字单独装、单独 catch，比"先查全局视图"正确且无需新依赖。
- 它沿 scope 链继承，因此该 agent 派生的子 agent 自动遵守同一套规则。
- 可见集在**每次模型请求**时重算，所以设置写入后从下一次请求起生效，无需重启或新窗口。
- `restrict()` 返回撤销它自己的那个 disposer：拨回开关与插件卸载都要用它，插件侧因此持有一份按 agent 索引的账。
- 只吞两种**预期**失败（无工具服务、名字不在链上）：`agent/created` 里的同步异常会**否决 agent 创建**，但把意外错误也吞掉就等于制造静默故障 —— v1.3.0 正是这样丢了一次发布，见[复盘](postmortem/2026-09-14-hidden-tool-restriction-noop.md)。

## 防错清单

### 上游行为（知乎侧，不随我们改）

- 知乎成功码是 `0`，失败时 `Data` 为 `null`。
- `SortBy` 的值含 `:` 与括号，必须 URL 编码。
- `SortBy` 的区间**支持双边界**：`(min,)` / `(,max)` / `(min,max)` / `(,)` 与裸字段全部有效（2026-09-14 补测）。旧记录写成「只支持下界」，那是一次探针覆盖不足的误判。
- `ContentType` 存在文档未列举的取值（热榜会混入 Question），类型不得写成封闭联合，否则读取分支变死代码。
- 全网搜索会返回**第三方网页**（同一查询里混着知乎回答与外部站点）。实测外站页面的 `ContentType` 是**空串**、`VoteUpCount` 是占位的 `0`——两个字段都在，只是值为空或无意义，30 条样本里上游一次都没省略过字段。所以投影层不得编造值，呈现层不得展示不适用的值：把广告页标成 `Article`、或把外站那个 0 渲染成「没人赞」，都是把「不知道」说成「知道」。
- 搜索结果**只有文字**：实测 30 条结果的 `ContentText` 既无 `<img>`、无 Markdown 图片语法、也无 URL —— 正文图片在摘要接口就被剥掉。模型拿不到图，也没有补救路径（`read_image` 只读本地文件，`web_fetch` 只回文本），所以描述必须点明这一点。
- 失败调用不消耗每日额度，因此重试只花时间；确定性错误（`10001`/`20001`/`30001`）重试无意义。
- 直答的中途失败帧是**官方定义的形态**，不是异常流量：按 SSE 规范它看起来像「空 delta 事件」，按内容丢弃就会交付半截答案。
- 直答错误体的 `code` 是字符串（如 `model_not_found`）；把它当数字读会静默退化成 `unknown`。
- 搜不到结果时 `Data` 会多出 `EmptyReason`，取值恒为「无相关内容」：有结果时字段整个缺席，被过滤空时也不解释原因。**零诊断价值**，因此不进类型也不透出（理由记在 [src/types.ts](../src/types.ts)）。
- 全网搜索的 `host` 过滤是**整串精确匹配**：`host=="qq.com"` 取不到 `news.qq.com` 的页面（实测根域 0 条、子域 10 条）。`host!=` 可用；`OR` + 括号也可用，但**表达式里只要出现知乎域名就整条回 `10001`**（实测 `(host=="github.com" OR host=="zhuanlan.zhihu.com")`）。

### 本实现（我们自己的坑）

- 工具输出有**三份副本**：`types.ts` 的 Canonical 类型、投影层的对象字面量、`output.schema`。
  前两份由 TypeScript 与单测照看，第三份**只被宿主照看**（`additionalProperties: false`）——
  前两份对了它不对，**整个调用被判非法**。v1.4.0 的回归正是如此，见[复盘](postmortem/2026-09-14-output-schema-drift.md)。
- **判定输入的语义必须与判定条件一致**：到顶判定要比的是模型**原始**请求条数；接线时传了夹取后的值（恒 ≤ 上限），条件永远为假、提示成了死代码 —— v1.5.1 的回归，见[复盘](postmortem/2026-09-14-dead-code-cap-note.md)。**判定函数与它的输入来源分离时，单测覆盖函数不等于覆盖接线**：必须补一条「execute → render」的接线级用例。
- **宿主参数 schema 是开放的**：DSH 的值 schema DSL 不接受 `additionalProperties: false`（实测报 `must be a value schema object`），未知键会被静默丢弃 —— 因此每个工具都要用 `assertKnownParams` 本地白名单拦截，否则模型传 `page=2` 拿到第一页却以为翻页成功。
- 字节流用 `TextDecoder({stream: true})` 解码；逐 chunk 解码会把跨边界的汉字变成 U+FFFD，且偶发。
- 标题可能含 `]` 与换行，进入 Markdown 链接前需转义。
- 无时区信息的日期按 UTC 解释；否则同一输入在不同机器产生不同缓存键。
- 缓存只写成功结果；失败结果入缓存会把一次偶发限流锁定整个 TTL。
- **密钥字段的角色是 schema 声明的**：`redactSecrets` 只认识带 `role('secret')` 的字段，摘掉角色等于停止脱敏。接缝换代后客户端配置页只投影 volatile 字段，所以非 volatile 的 `accessSecret` 已经不在这条线路上 —— 但它仍带角色，且**任何新加的密钥字段都要照同一规矩办**。见「密钥解析契约」与 [test/redact-anchor.test.ts](../test/redact-anchor.test.ts)。

### 宿主版本（DSH 侧，不随我们改）

- **声明面只有一个**：`package.json` 的 `peerDependencies`。它同时是安装器的判据与 npm 页面上的对外承诺 —— 改它等于改对外契约，因此必须与实测对齐，不能凭文档推断。
- **依赖的是运行时行为，不是 API 形状**：`schema.volatile()` 的活引用语义（`.get()`）、**只有 volatile 字段进配置页**、`settings.configure({ auto: false }, fiber)` 的页面策略、`ctx.on('loader/volatile-update', …)` 的就地对账、`role('secret')` 脱敏、**`ctx.inject` 的属性访问语义**（不是 `ctx.get`）、`remote.credentials` 的 `describe`/`set`、`plugins.bundle.config` 的 keyed 分派（key = 包名，且**该槽不传 `form`**）、客户端服务 `ctx.configForms` 的 `get`/`getSnapshot`/`subscribe`/`mutate`、客户端模块格式。任一处改动都可能在升级后**静默失效**（卡片不显示、开关不生效、密钥读不到）。
- **驱动版本用 dist-tag，不用版本号**：DSH 至今全是 prerelease。`latest` 在多数子包上指向过期版本（具体值现查 `npm view @deepseek-ai/dsh dist-tags`），**`next` 才是当前承诺线**（2026-09-24 起；在那之前是 `alpha`，而 `alpha` 现在不在我们的声明区间里）。三条线的语义与实测由 [compat.yml](../.github/workflows/compat.yml) 每周核对，处理链归 [docs/PUBLISHING.md](PUBLISHING.md) 的「兼容性」。
- **声明面是 `engines.dsh` 加全部 `@deepseek-ai/dsh-*`，逐字相同**：只改一半时，使用者按依赖段装出来的宿主可能不满足 `engines.dsh`（或反过来），而**接缝缺席是静默的**。由 [test/redlines.test.ts](../test/redlines.test.ts) 的「声明面自洽」一组断言钉住。
- **类型面会先于行为面动**：宿主收紧 API 签名时 `npm run typecheck` 先红，而全部测试仍然全绿。判断「兼容不兼容」不能只看测试结果。

### 契约纪律（破坏即改契约）

- 参数**不得静默失效**。`sortField` 为 `default` 或缺省时不下发 `SortBy`，此时 `minValue` 与非默认 `order` 没有落点，一律拒绝并给出改正提示。静默丢弃会让模型以为自己筛过了，然后照着未过滤的结果作答——比报错更糟。
- `HasMore` 不构成翻页依据，也不能读作「存在下一页」（见「端点契约」的实测）。

## 与知乎官方文档的偏差

以实测为准，记录在此避免重复踩坑。**每条都注明是哪个端点测的**——两个端点的行为并不一致。

| 文档说法 | 实测 |
|---|---|
| 站内搜索只接受 `Query`/`Count` | 接口识别 `SortBy` 与 `Filter`（`Filter` 限 `publish_time`） |
| 未记载 `SortBy` | **站内**：`SortBy` 是一等参数，字段非法时报 `10001 invalid SortBy field`；**全网**：排序整体被忽略，连非法字段名也照回 `code=0` |
| 未记载返回字段 `AuthorSignature` | 站内搜索实际返回该字段；本插件不读它，因此不进类型（未使用字段不进类型的惯例见 [src/types.ts](../src/types.ts)） |
| `AuthorityLevel` 类型未明确 | **站内**实测为字符串（`"4"`）；**全网侧未实测**，所以 [src/types.ts](../src/types.ts) 声明为 `string \| number`——要读它必须先补测 |
| `SortBy` 区间按说明是筛选条件 | **站内**：区间只筛「本次检索到的候选」，结果条数与 `Count` 耦合（见「端点契约」） |
| 直答错误体的 `code` 举例为字符串 | 与实测一致；此前实现按数字读，导致频率限制退化成 `unknown`（已修） |
| （未说明）`SortBy` 区间是否支持上界 | **站内**：支持。`(,10)` / `(10,100)` / `(,)` / 裸字段 / 空方向全部 `code=0` 且边界真的生效（2026-09-14 补测） |
| （未说明）`host` 是否匹配子域 | **全网**：整串精确匹配，根域不命中子域；`host!=` 与 `OR`+括号可用，但表达式含知乎域名即回 `10001` |
| `EmptyReason` 是「无结果时的原因说明」 | 只在 `Items` 为空时出现，取值恒为「无相关内容」；有结果时字段缺席，被过滤空时同样不解释原因 |

## 契约测试（API 防腐化）

上面的实测结论会随上游悄悄漂移。**防腐化机制 = 把结论写成会红的断言**，而不是指望有人记得回来复测。

- 位置：[test/contract-live-search.test.ts](../test/contract-live-search.test.ts)、[test/contract-live-global-search.test.ts](../test/contract-live-global-search.test.ts)，共用底座 [test/contract-helpers.ts](../test/contract-helpers.ts)。
- **不 import `src/`**：只用 `fetch` 直连上游。复用插件的传输层会让插件的解析 bug 同时污染被测对象与断言，变成自我印证。
- 底座另有一份**离线自检** [test/contract-helpers.test.ts](../test/contract-helpers.test.ts) 常驻日常 CI：指纹工具写错会让契约测试「假绿」，比没有契约测试更危险。
- 触发：每周一 UTC 01:00 由 [contract.yml](../.github/workflows/contract.yml) 跑一次，另支持手动 `workflow_dispatch`；本地 `npm run test:contract`（需 `ZHIHU_ACCESS_SECRET`）。**不进日常 CI** —— 它花真实配额（约 16 次/轮），而契约漂移是「周」级信号，不是「每次提交」级。
- 密钥缺席时**红**，不静默跳过：跳过等于这套机制不存在。
- **红了怎么办（顺序不可颠倒）**：① 重跑确认不是偶发 → ② 重跑探针确认上游到底变成了什么 → ③ 更新本文的「端点契约」「防错清单」「与知乎官方文档的偏差」 → ④ 最后才改实现与断言。反过来做，就会把「上游变了」记录成「测试过时了」。

## 相关

- 决策理由 → [.agents/notes/](../.agents/notes/)
- 维护规则与验证快照 → [AGENTS.md](../AGENTS.md)
