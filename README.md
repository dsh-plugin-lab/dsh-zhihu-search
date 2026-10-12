<p align="center">
  <img src="icon.svg" alt="dsh-zhihu-search" width="80" height="80">
</p>

<h1 align="center">dsh-zhihu-search</h1>

<p align="center">
  <img src="assets/banner.svg" alt="dsh-zhihu-search：给 DSH 装上知乎搜索" width="600">
</p>

<div align="center">
  <p><strong>赋予 DeepSeek Harness 检索知乎社区的能力</strong></p>
  <p><em>Empowering DeepSeek Harness with Zhihu Insights</em></p>

  <p>
    <a href="https://developer.zhihu.com/"><img src="https://img.shields.io/badge/Zhihu%20Open%20Platform-Official%20API-0084FF?style=flat&logo=zhihu&logoColor=white" alt="知乎开放平台官方 API"></a>
    <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/DeepSeek%20Harness-Plugin-4176E6?style=flat" alt="DeepSeek Harness Plugin"></a>
  </p>

  <p>
    <a href="https://github.com/dsh-plugin-lab/dsh-zhihu-search/actions/workflows/ci.yml"><img src="https://github.com/dsh-plugin-lab/dsh-zhihu-search/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
    <a href="https://www.npmjs.com/package/dsh-zhihu-search"><img src="https://img.shields.io/npm/v/dsh-zhihu-search.svg" alt="npm"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT 许可证"></a>
    <a href="https://www.npmjs.com/package/dsh-zhihu-search"><img src="https://img.shields.io/badge/SLSA-Build%20L2-green?logo=slsa" alt="SLSA Build L2"></a>
  </p>

  <p>
    <strong><a href="README.md">简体中文</a></strong> · <a href="README_en.md">English</a>
  </p>
</div>

---

> [!NOTE]
> **基于知乎开放平台官方 API 构建**，非爬虫抓取。所有检索结果均附带可引用的原始链接，知乎站内结果另附点赞数，让模型的每一次回答都有据可查。搜索结果为文字摘要，不含正文图片。

搜索不幻觉，引用有出处。给 DSH 装上知乎：站内检索、全网检索与直答三个工具，返回可引用的来源列表，而不是一段无法核对的摘要。

<p align="center">
  <img src="assets/settings-card.png" alt="插件详情页中的「知乎检索」配置卡片" width="600">
  <br>
  <em>在侧边栏 <strong>插件（Plugins）</strong> →「已安装（Installed）」组里点<strong>「知乎检索」</strong>进详情页（标题下方那行代码体是技术名 <code>dsh-zhihu-search</code>），
  Access Secret 就地填写、立即生效。</em>
</p>

## 工具一览

装上后模型多出三个工具：

| 工具 | 一句话说明 | 适用场景 |
|---|---|---|
| `zhihu_search` | 知乎站内问答与文章搜索，支持按点赞/评论/时间排序 | 中文经验、产品评测、行业讨论、技术实践 |
| `zhihu_global_search` | 知乎全网索引搜索，可按域名和时间过滤；结果会混入知乎站内内容 | 查找特定网站上的公开资料 |
| `zhihu_zhida` | 知乎直答，成体系的综合性回答 | 需要「先检索再总结」的复杂中文问题 |

下面三个小节是每个工具的完整参数与能力边界。模型只看到下表中的语义化参数，看不到知乎的原始查询语法。

### `zhihu_search` —— 站内检索

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `query` | string | **必填** | 搜索关键词，中文效果最好。 |
| `count` | integer | `5` | 返回条数，1–10。 |
| `sortField` | enum | `default` | `default` 沿用相关性排序；`voteUpCount` 点赞数 · `commentCount` 评论数 · `editTime` 时间（发布或最后编辑）。 |
| `order` | enum | `desc` | `desc` 降序 · `asc` 升序。仅在指定了 `sortField` 时生效。 |
| `minValue` | number | — | 排序字段的下限（含），**必须配合 `sortField`**，取非负整数。**只筛本次检索到的候选**：达标项少时返回条数会少于 `count`，不代表知乎没有高赞内容。 |
| `publishedAfter` | string | — | 只要该日期之后发布的内容，格式 `YYYY-MM-DD`。 |
| `publishedBefore` | string | — | 只要该日期之前发布的内容，格式 `YYYY-MM-DD`。 |

**边界**：不支持按站点域名过滤——站内结果本来就全来自知乎，要按站点找资料请用 `zhihu_global_search`。`minValue` 与非默认 `order` 必须配合 `sortField`，否则会被拒绝并提示改法。**没有翻页**：要更多结果请换关键词或换排序。**下限是候选内筛选**：筛少时结果里会说明，空结果不代表知乎没有高赞内容。

### `zhihu_global_search` —— 全网索引检索

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `query` | string | **必填** | 搜索关键词。 |
| `count` | integer | `8` | 返回条数，1–20，比站内宽。 |
| `site` | string | — | 只搜该域名，例如 `github.com`。传完整 URL 会被剥成主机名并去掉开头的 `www.`。 |
| `publishedAfter` | string | — | 只要该日期之后发布的内容，格式 `YYYY-MM-DD`。 |
| `publishedBefore` | string | — | 只要该日期之前发布的内容，格式 `YYYY-MM-DD`。 |
| `searchDb` | enum | `all` | `all` 全部 · `realtime` 偏最新 · `static` 偏长期收录。 |

**边界**：域名是**精确匹配**，子站要单独写（`qq.com` 取不到 `news.qq.com` 的页面），且不接受知乎域名。**没有排序参数**（该端点忽略排序），**也没有翻页参数**。结果里会混入知乎站内内容；要专搜知乎的问答和文章，用 `zhihu_search`。

### `zhihu_zhida` —— 直答

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `question` | string | **必填** | 要提问的问题，中文描述越具体越好。 |
| `mode` | enum | `thinking` | `fast` 快速回答 · `thinking` 深度思考 · `agent` 智能体多步检索。 |
| `includeReasoning` | boolean | `false` | 是否把推理过程一并返回。默认关闭以节省上下文，核对答案可靠性时可打开。 |

**边界**：它**不是搜索**——返回的是一段生成回答，不是来源列表。答案由知乎生成，可能有误，重要结论请自行核对。思维链默认不返回。

## 能力

- 三个工具职责不重叠：站内捞经验、全网捞资料、直答做综合，模型按问题类型自行选择。
- 搜索返回结构化来源条目（标题 / 链接 / 摘要 / 作者 / 点赞数 / 评论数 / 时间），每条都带 URL，可直接引用核对。
- 结果文本自带边界说明：返回条数触达单次上限、来源里混有外站页面、筛选条件筛掉多数候选时，都会在正文里写明 —— 不把工具的边界说成结果的边界。
- 结果同时渲染为来源卡片与纯 Markdown，任何界面都能读。

## 安装

### 前置

- **DSH 的区间见 [package.json](package.json) 的 `engines.dsh`** —— 那是唯一真源，它与全部 `@deepseek-ai/dsh-*` 声明**逐字相同**（不同形状时使用者装到的宿主可能缺接缝，而接缝缺席是**静默**的：配置界面不出现、宿主不报错）。声明面同时承诺了不止一族宿主版本，装哪一族由它说了算。本文件与 [README_en.md](README_en.md) 都不抄那个会漂的值。
- Node `>= 20`

装宿主时**要显式指定版本线**：本家族的 `latest` 标签不可靠（多数 `@deepseek-ai/dsh-*` 包上它指向很早的版本），按默认方式装可能落在声明范围之外 —— 现查 `npm view @deepseek-ai/dsh dist-tags`。

```bash
npm install -g @deepseek-ai/dsh@next    # 本插件承诺支持的线
```

兼容性不是推断出来的：每周由 [compat.yml](.github/workflows/compat.yml) 对 `next`（承诺线）与 `alpha`（**已低于我们声明的下限，只作记录**）两条线换包实跑一遍现有测试。当前结论与红了怎么办见 [docs/PUBLISHING.md](docs/PUBLISHING.md) 的「兼容性」。

### 从 npm 安装

```bash
dsh plugin --profile web add dsh-zhihu-search
```

`dsh plugin` 会把本包装进 profile 并挂进 `dsh.profile.bundles`。重启 `dsh --profile web` 后生效。

### 从源码安装

```bash
git clone https://github.com/dsh-plugin-lab/dsh-zhihu-search.git
cd dsh-zhihu-search
npm install && npm run build

dsh plugin --profile web add "$PWD"
```

同样重启 `dsh --profile web` 生效。

⚠️ 上面那步 `npm install` 不能省：`link:` 装法下依赖由仓库自己提供（见 [AGENTS.md](AGENTS.md)），
漏装则插件显示「未运行」（`ERR_MODULE_NOT_FOUND`）。

### 发现与安装

- **npm**：[`dsh-zhihu-search`](https://www.npmjs.com/package/dsh-zhihu-search)
- **GitHub**：[`dsh-plugin-lab/dsh-zhihu-search`](https://github.com/dsh-plugin-lab/dsh-zhihu-search)

仓库带有 GitHub topic [`dsh-plugin`](https://github.com/topics/dsh-plugin)，插件市场据此自动发现插件。

## 版本兼容

配置界面注册在宿主插件页的 `plugins.bundle.config` 槽上，分派 `key` 是**本插件的包名**（[package.json](package.json) 的 `name`）。这个槽**不把表单递给页面**，所以卡片自己向 `ctx.configForms.get(<loader entry id>)` 取 —— `configForms` 是这个接缝依赖的客户端服务，接缝因此要求宿主的设置接缝达到 `engines.dsh` 声明的**下限版本**；那份声明是唯一事实来源，本文件不抄版本号。

- **宿主够新**：插件页 →「已安装（Installed）」组 → **点「知乎检索」进它的详情页**（标题来自 [locale/zh.json](locale/zh.json)，中文界面下的显示名；技术名 `dsh-zhihu-search` 仍在标题下方），配置区就在描述下面，直接可改 —— **没有多一次 Configure**，密钥与开关都在那里改。
- **宿主更早（没有 `configForms`）**：三个工具照常工作，插件页里**不会出现配置入口** —— 静默，不报错。这就是分水岭。
- **需要就地配置**：把宿主升到 `engines.dsh` 声明**覆盖**的那条线 —— 那个范围带上下限、是唯一真源（上限之外的线不在声明范围内）；承诺线就是 `next`，装法 `npm install -g @deepseek-ai/dsh@next`；哪条线指向哪个版本现查 `npm view @deepseek-ai/dsh dist-tags`。

宿主版本线怎么装见[安装 → 前置](#前置)；每周的实测结论与红了怎么办见 [docs/PUBLISHING.md](docs/PUBLISHING.md) 的「兼容性」。

## 配置

配置界面挂在宿主插件页的**组合配置**槽（`plugins.bundle.config`，以包名为键）上；它在什么时候不出现、不出现时会发生什么，见[版本兼容](#版本兼容)。

### 在插件页填写

打开侧边栏 **插件（Plugins）** →「已安装（Installed）」组 → **点「知乎检索」**进它的详情页，配置区就在描述与「包含的组件」之间；填入 Access Secret 并保存。保存后立即生效，无需重启 DSH。

插件页与设置里显示的名字、以及那句描述，来自本包根目录的语言文件（[locale/zh.json](locale/zh.json) 与 [locale/en.json](locale/en.json) 的 `meta`）——
它们只是**展示元数据**：不参与加载、不改变任何配置与工具，宿主读不到时只会退回显示技术名（不报错）。因此本文件不复制那两句文案，改文案改语言文件即可。

密钥写进 DSH 的凭据存储（`~/.dsh/.credentials.yaml`），**不写进配置文件** —— 活动 profile 的 Cordis patch 里只有凭据引用名与开关，可以安全地截图或分享。

Access Secret 在[知乎开放平台个人中心](https://developer.zhihu.com/profile)获取；配置卡片里有同一个链接。

### 每日额度

额度按自然日结算，各接口的配额读数都在[知乎开放平台个人中心](https://developer.zhihu.com/profile) —— 与取 Access Secret 是同一个地方。下图是那个面板：

<p align="center">
  <img src="assets/zhihu-daily-quota.jpg" alt="知乎开放平台的「各接口剩余配额」面板" width="220">
</p>

### 改用别的凭据来源

卡片的「凭据引用名」默认是 `ZHIHU_ACCESS_SECRET`。填别的名字即可指向另一处。

密钥按 DSH 的分层解析，优先级从高到低：

- 进程环境变量（`export ZHIHU_ACCESS_SECRET=…`）
- 凭据存储（`~/.dsh/.credentials.yaml`）
- 项目目录下的 `.env`
- `~/.dsh/.env`

由只读来源（环境变量）提供时，卡片会禁用输入框并说明原因 —— 那里的值覆盖不了。

### 进阶：超时与限额

插件配置项以 [src/index.ts](src/index.ts) 的 `Config` 为唯一来源（改 `cordis.patch.yml` 里的插件配置即可）。两个超时项值得知道：

- `timeoutMs`（默认 15 秒）：搜索类请求的单次预算。
- `streamTimeoutMs`（默认 55 秒）：直答整轮读取的预算，直答工具的超时自动跟着它走。调大请求超时不会缩小它（取两者较大者），所以调大它才有效。

### 只用知乎检索

卡片里的「隐藏原生网页搜索（web_search / web_fetch）」开关默认关闭 —— 插件不擅自削宿主能力。打开并保存后，模型看不到 DSH 原生的 `web_search` 与 `web_fetch`，只用知乎的三个工具。

- 从**下一次模型请求**起生效，无需重启、无需新窗口。
- 该 agent 派生的子 agent 一并遵守同一套规则。
- 只控制模型可见性：tool-web 插件本身照常加载，关掉开关即恢复。

## 安全与边界

- Access Secret 只在配置卡片、凭据域与环境变量之间流转：不写日志、不以明文进入缓存键、不进仓库。
- 返回内容按外部不可信数据处理：摘要剥离 HTML 标签，链接剥离跟踪参数。
- 只访问 `developer.zhihu.com`，不代理、不转发其他流量。

## 许可

[MIT](LICENSE)。

## 贡献

缺陷与需求走仓库 Issues。

设计取向：工具参数与返回文本首先是**给模型用的 API**，其次才是给人读的文档 —— 写法规范见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 的「工具描述约定」与「模型可见文本的诚实性」。

维护者文档地图见 [AGENTS.md](AGENTS.md)；不变的设计约束见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)；发布流程见 [docs/PUBLISHING.md](docs/PUBLISHING.md)。
