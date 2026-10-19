# A_meet-s · 帧与字 / Anchor & Shadow

从文学与电影中的意象出发，发现作品、留下批注、生成纪念品，并与同好交流。

当前是原生 HTML/CSS/JavaScript + Express + SQLite 的应用原型。检索根据文字元数据与人工整理的关键词提供作品级候选；实际图片/视频的内容分析和跨模态检索仍待评估。

## 本地启动

使用 **Node.js 24 或更高版本**；项目直接使用 `node:sqlite`，不需要另行安装 SQLite 服务。

```bash
npm ci
npm start
```

打开 <http://localhost:3000>。Express 同时提供页面和 `/api` 接口；只用静态文件服务器打开 HTML 时，账户、搜索、社区等交互不能完成。

默认数据库位于 `data/anchor-shadow.sqlite`，首次启动会初始化表并导入 16 条种子作品。已有数据不会因启动而清空。可通过 `DB_PATH` 指定其他数据库文件；其父目录应已存在。数据库与服务端文件不属于公开静态资源。

### 只验证站内功能

不配置模型密钥即可使用种子数据、账户、批注和社区。为了避免外部图书搜索，启动前设置：

```bash
# Bash / WSL
DISABLE_EXTERNAL_SEARCH=1 IMAGE_PROVIDER=none npm start
```

```powershell
# Windows PowerShell
$env:DISABLE_EXTERNAL_SEARCH = "1"
$env:IMAGE_PROVIDER = "none"
npm start
```

### 可选外部服务

按需把 `.env.example` 复制为 `.env` 并填写配置。普通正向查询在站内结果较少时会尝试外部资料；带明确排除条件的查询只检索站内数据，避免追加未验证约束的外部候选。

| 配置 | 作用 |
| --- | --- |
| `PORT` | 服务端口，默认 3000 |
| `DB_PATH` | 可选的 SQLite 文件路径 |
| `DISABLE_EXTERNAL_SEARCH=1` | 关闭所有外部图书和电影检索 |
| `GOOGLE_BOOKS_API_KEY` | 可选 Google Books 资料补充 |
| `TMDB_API_KEY` / `OMDB_API_KEY` | 可选电影资料补充 |
| `IMAGE_PROVIDER=none` | 关闭图片生成 |
| `IMAGE_PROVIDER=gemini` + `GEMINI_API_KEY` | 使用现有 Gemini 图片提供方代码 |
| `IMAGE_PROVIDER=openai_compatible` + `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_IMAGE_MODEL` | 使用兼容图片生成接口 |

外部图书搜索还包含无需本项目配置密钥的 Open Library。真实服务的可用性和生成效果不属于离线回归结果。图片生成关闭或未配置时，页面会显示原因并禁用生成按钮。

## 检查与验证

### 接口及逻辑回归

```bash
npm test
```

覆盖账户流程、静态资源边界、公开身份信息、个人资料、好友分享、检索逻辑和搜索 API 边界。测试使用内存数据库或专门创建的临时合成文件，不读写默认用户数据库。

### 真实浏览器流程

```bash
npx playwright install chromium --only-shell
npm run test:browser
```

脚本会自动启动一个临时本地服务并使用合成账号，验证登录、注册必填校验、个人资料保存、意象搜索、进入作品页和批注。外部搜索与实际生图被关闭，浏览器外部网络请求被阻断。可用 `--output` 保存本轮报告：

```bash
npm run test:browser -- --output /tmp/ameets-browser.json
```

### 检索工程诊断

```bash
npm run evaluate:retrieval
npm run evaluate:retrieval -- --output /tmp/ameets-retrieval.json
npm run evaluate:retrieval -- --fixtures test/fixtures/retrieval-holdout-cases.json
```

第一组包含预先固定的 30 条查询，第二组有 10 条不同措辞的补充查询。它们都基于同一份 16 条种子记录，用于发现回归和能力边界，不代表真实用户分布或正式准确率。默认报告失败样例但退出成功；`--strict` 可让失败诊断返回非零退出码，探索性查询不应直接作为已承诺功能的 CI 门槛。

实际修复、前后对照和跨模态决策见 [验证报告](docs/validation-2026-10-19.md)。

## 代码结构

| 路径 | 职责 |
| --- | --- |
| 根目录 HTML、`css/`、`js/` | 页面和浏览器交互 |
| `server/app.js` | Express 路由和公开静态资源白名单 |
| `server/db.js` | SQLite 表、种子初始化、用户身份输出结构 |
| `server/routes/` | 账户、作品、评论、图像、资料、社区、好友和分享接口 |
| `server/services/worksRepository.js` | 本地文字检索与作品数据读取 |
| `server/services/*Providers.js` | 外部图书、电影和视频资料适配 |
| `server/services/imageProvider.js` | 可配置的图片生成服务 |
| `data/seed-works.json` | 开发用作品、意象和示例文本 |
| `test/`、`scripts/` | 回归测试、浏览器验收和检索诊断 |

## 当前内容边界

- 命中的是作品记录，尚不能证明某个画面、动作或多个属性同时出现在同一镜头。
- 种子中的文学、电影配对并未统一区分改编、灵感来源与氛围联想；摘句尚未附上可核验的版本、页码或段落位置。
- 6 条种子记录附有视频链接；链接不等同于已标注镜头、可用时间戳或经过验收的播放服务。
- 生图模块根据作品文字信息生成票券、书签、海报。它与“从真实影像中检索匹配画面”是两个独立能力。

后续先补充可核验段落、作品关联类型和带时间戳的真实镜头，再用新的标注数据决定是否引入文字语义检索或跨模态检索。
