# Hitokoto-EdgeOne

使用 EdgeOne Pages 搭建的一言（Hitokoto）API，简洁、快速还好用。数据集基于
[hitokoto-osc/sentences-bundle](https://github.com/hitokoto-osc/sentences-bundle)。

- 示例站点：<https://hitokotov2.wgh.me/>
- 仓库地址：<https://github.com/wgh208/Hitokoto-EdgeOne>

## 特性

- 支持 12 个一言分类，也支持不指定分类随机返回；
- 支持 `min_length` / `max_length` 长度筛选；
- 支持 JSON、纯文本、JSONP 和 JS 注入四种输出方式；
- 完整的 CORS 支持，可直接在浏览器中调用；
- 基于 EdgeOne Pages 边缘函数，全球边缘节点就近响应；
- 句子数据压缩后内置在函数包中，按分类懒解压，单函数包约 1.5 MB；
- GitHub Actions 每天自动同步官方句子，推送后自动触发 EdgeOne 重新部署。

## 目录结构

```text
.
├── functions/
│   └── index.js              # EdgeOne Pages Functions 入口
├── lib/
│   ├── hitokoto.js           # API 逻辑：参数校验、随机选择、解压、编码输出
│   ├── sentence-index.js     # 自动生成的分类长度索引，请勿手改
│   ├── data/
│   │   ├── index.js          # 自动生成的压缩数据索引，请勿手改
│   │   └── a.js ... l.js     # gzip + base64 句子数据，自动生成，请勿手改
│   └── vendor/
│       ├── fflate.js         # 纯 JS gzip 解压（MIT）
│       └── fflate.LICENSE
├── sentences/
│   ├── a.json ... l.json     # 官方句子原文（静态资源，可直接访问）
│   └── index.json            # 索引的 JSON 版本，便于调试
├── scripts/
│   ├── build-index.mjs       # 生成索引与 lib/data/*.js
│   ├── sync-sentences.mjs    # 从官方仓库同步句子
│   └── smoke-test.mjs        # 本地接口冒烟测试
├── .github/workflows/
│   └── sync-sentences.yml    # 每天自动同步官方句子
├── edgeone.json              # 静态句子文件的缓存配置
├── 404.html                  # 自定义 404 页面
├── robots.txt
├── LICENSE
└── package.json
```

## API 用法

接口与一言开发者中心保持一致，支持以下参数：

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `c` | 分类：`a` 动画、`b` 漫画、`c` 游戏、`d` 文学、`e` 原创、`f` 来自网络、`g` 其他、`h` 影视、`i` 诗词、`j` 网易云、`k` 哲学、`l` 抖机灵 | 随机 |
| `encode` | 输出格式：`json`、`text`、`js` | `json` |
| `callback` | JSONP 回调函数名 | 无 |
| `select` | `encode=js` 时写入的 CSS 选择器 | `.hitokoto` |
| `min_length` | 一言最小长度（包含） | `0` |
| `max_length` | 一言最大长度（包含） | `30` |

```bash
# 随机一句（JSON）
curl 'https://your-domain.com/'

# 指定分类
curl 'https://your-domain.com/?c=a'

# 纯文本
curl 'https://your-domain.com/?encode=text'

# 指定长度范围
curl 'https://your-domain.com/?min_length=10&max_length=20'

# JSONP
curl 'https://your-domain.com/?encode=json&callback=hitokoto'

# 输出到页面元素
curl 'https://your-domain.com/?encode=js&select=%23hitokoto'
```

返回示例：

```json
{
  "id": 1,
  "uuid": "9818ecda-9cbf-4f2a-9af8-8136ef39cfcd",
  "hitokoto": "与众不同的生活方式很累人呢，因为找不到借口。",
  "type": "a",
  "from": "幸运星",
  "from_who": null,
  "creator": "跳舞的果果",
  "creator_uid": 0,
  "reviewer": 0,
  "commit_from": "web",
  "created_at": "1468605909",
  "length": 22
}
```

## 部署到 EdgeOne Pages

1. 在 [EdgeOne Makers 控制台](https://console.cloud.tencent.com/edgeone/makers)
   导入本仓库，项目名填 `Hitokoto-EdgeOne`。
2. 构建配置保持默认即可：
   - 框架：`Other`
   - 根目录：`./`
   - 构建命令：空
   - 输出目录：空
3. 项目会识别根目录下的 `functions/` 为 Pages Functions，`sentences/` 为静态资源。
4. 在「域名管理」中添加自定义域名，按控制台提示到 DNS 服务商添加 CNAME 记录，
   并等待证书签发。
5. 之后每次推送到 `main`，EdgeOne 会自动重新构建并发布。

> 不需要设置环境变量。若需要让错误响应返回详细异常，可在项目环境变量中临时设置
> `DEV_ENV=true`，排查完建议删除。

## 自动同步官方句子

`.github/workflows/sync-sentences.yml` 每天 **03:17（Asia/Shanghai）** 运行一次，也支持
在 GitHub Actions 页面手动触发（`workflow_dispatch`）。流程：

1. 下载 `hitokoto-osc/sentences-bundle` 的 `categories.json`、`version.json` 和
   `sentences/*.json`；
2. 覆盖本仓库的 `sentences/`，删除官方已经移除的分类；
3. 重新生成 `sentences/index.json`、`lib/sentence-index.js` 和 `lib/data/*.js`；
4. 有变化时提交并推送，推送会自动触发 EdgeOne 重新部署。

工作流使用 GitHub 自动提供的 `GITHUB_TOKEN`，只需要仓库的
**Settings → Actions → General → Workflow permissions** 选择
**Read and write permissions**（工作流里也声明了 `contents: write`）。

本地也可以手动同步：

```bash
npm run sync:sentences
npm test
```

## 本地开发

```bash
npm install
npm test

npm install -g edgeone
edgeone login
edgeone makers link -n Hitokoto-EdgeOne
edgeone makers dev
```

`edgeone makers dev` 默认在 <http://127.0.0.1:8088/> 启动本地代理。函数不依赖任何
运行时网络请求，数据已经压缩进函数包，因此本地调试与线上行为一致。

如果直接修改了 `sentences/` 下的句子文件，需要重新生成索引和压缩数据：

```bash
npm run build:index
```

## 数据来源与许可

句子数据来源于
[hitokoto-osc/sentences-bundle](https://github.com/hitokoto-osc/sentences-bundle)，
数据著作权并非完全由本项目作者持有。如果您是原句作者且希望移除您的句子，请联系
[hitokoto-osc](https://github.com/hitokoto-osc)。

本程序采用 **AGPL-3.0** 许可证授权。

这意味着，如果您修改了代码并且将修改后的版本发布或部署（例如作为服务），那么您
必须公开源代码；如果您使用 AGPL-3.0 授权的代码构建服务，您的修改代码（如果有）
也应当可供用户获取，并且这些用户有权查看和获取修改后的代码。
