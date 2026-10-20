# PR2 交付包应用与接收方复测

2026-10-20（Asia/Shanghai）在完整仓库、项目支持的 Node 24 环境中重新执行。此报告与本目录原交付报告属于不同次验收；原始依赖/HTTP 环境阻塞日志及历史结果全部保留。

## 交付和分支核对

- PR1 仍为未合并 Draft，分支 `repair/reliability-and-retrieval` 指向 `688b104c6bcebddcf27f59b603e0441da1ff144c`；`main` 指向 `dcde811a7df28d48bcc22ee1e51e1c6a04c62938`。
- `feat/query-evidence-stage2` 在操作前不存在，也没有同 head 的已有 PR。从包指定基线创建独立克隆中的新分支，PR2 以 PR1 分支为 base。
- 扁平化上传附件按原 SHA256 清单还原目录，51 项均校验一致。补丁 SHA-256：`2c487fd6249b4afe370bc8980a4085d5fab0972d4b4a0cd6cf1075bb6db5f357`。
- `verify-files.cjs before`、`git apply --check --whitespace=error-all`、实际应用及 `verify-files.cjs after` 全部成功；32 个交付文件均与清单一致。
- 原样补丁提交：`668b14fdbc5670c52dacb7309beee437afd5e063`，tree：`df5ff480ff9dd186ace85c2206a51723f55d3c84`，父提交为上述 PR1 基线。
- 后续提交适配一条原有浏览器断言，修复审查发现的外部图书结果截断回归并补测试，以及添加本次复测报告。冻结查询集、语料和评估判定规则未改变。

## 实际运行结果

环境：Windows、Node.js `v24.18.0`、Vitest `1.6.1`、Playwright `1.56.1`、Chromium `141.0.7390.37`。通过 `npm ci --ignore-scripts --no-audit --no-fund` 按原锁文件安装，无依赖升级。Playwright 使用工作目录已安装的 Chromium。

| 命令/验证层 | 本次结果 | 证据 |
| --- | --- | --- |
| `npm test`，真实 Express/API 与逻辑回归 | 42/42 通过，5 个文件，包含新增 3 条 HTTP 合约用例 | [Vitest](revalidation-2026-10-20/vitest.json) |
| `npm run test:stage2`，Node 内置测试 | 原包 45/45 通过；补充回归后的最终版本 46/46 通过 | [Node 输出](revalidation-2026-10-20/node-tests.tap) |
| `npm run test:stage2:dom`，离线 DOM 组件 | 8/8 通过，页面错误 0 | [DOM](revalidation-2026-10-20/dom-components.json) |
| `npm run test:stage2:browser`，原生 HTTP + 实际搜索服务 | 7/7 通过，页面错误 0；该 harness 不包含完整 Express/auth | [HTTP 合约](revalidation-2026-10-20/browser-contract.json) |
| `npm run test:browser`，完整 Express 站点登录/资料/检索/批注等流程 | 最终 7/7 通过，页面错误 0 | [完整站点流程](revalidation-2026-10-20/full-app-browser.json) |
| `npm run evaluate:evidence` | 执行成功，分组结果见下文 | [检索诊断](revalidation-2026-10-20/retrieval-contract.json) |
| `npm run audit:evidence` | 结构审计执行成功，内容质量门槛仍未满足 | [来源审计](revalidation-2026-10-20/source-audit.json) |
| `evaluate:evidence --strict` | 退出 1，符合保留失败项的预期 | [严格检索日志](revalidation-2026-10-20/retrieval-strict.log) |
| `audit:evidence --strict` | 退出 1，符合未完成核验的预期 | [严格审计日志](revalidation-2026-10-20/audit-strict.log) |

### 首次完整站点测试失败及适配

原样交付包首次执行旧 `scripts/smoke-browser.js` 时，前四个流程通过，空结果流程等待旧文案“暂无此意象”而超时；没有页面异常。PR2 的空状态已经改为“当前资料中没有得到支持的匹配；这不表示所有书籍或电影中都不存在。”

仅将该等待断言定位到 `#resultsContainer .empty-state` 并检查新文案，保留结果卡片数量为 0 的断言，未跳过任何流程、未增加超时、未修改页面行为。之后完整重新执行，7/7 通过。[首次失败记录](revalidation-2026-10-20/full-app-browser-initial-failure.json) 与最终通过记录分别保存。

### 独立审查发现的提供器截断回归

`searchBooks()` 依次聚合 Open Library 最多 5 条及 Google Books 最多 5 条；交付代码对聚合结果预先 `slice(0, 5)`，会在前者满额时完全丢弃 Google Books 返回值。改为在无效项过滤、去重后统一限制外部结果总额 10 条，恢复原有总额并允许后一个图书来源进入结果。

新增用例使用生产服务和内存 SQLite，注入两家各 5 条图书、前置无效/重复项及额外电影，验证两家图书均保留且总额不超过 10。修复前 [红测](revalidation-2026-10-20/provider-regression-red.tap) 得到 4 条而非 10 条；修复后 46 项 Node 测试及 42 项 Vitest 测试全部通过，三组浏览器流程也全部重跑通过。提供器响应为合成数据，不宣称真实外部服务验收。

## 检索与来源结论

同一冻结的 40 条查询，本次运行得到：

| 结果解释 | 通过 | 未通过 | 人工观察 |
| --- | --- | --- | --- |
| 保留的旧候选排序函数 | 36 | 3 | 1 |
| 新版仅主要结果 | 33 | 6 | 1 |
| 新版包含明确标记的部分候选 | 38 | 1 | 1 |

三种返回集合含义不同，不能作为同一准确率指标比较。部分候选不表示满足完整请求。主要结果未通过的查询为：茶与蛋糕的回忆；我想找茶水和小蛋糕让人突然想起往事的文字；一个把一生献给职责却没能说出感情的英国管家；英国庄园里黄昏的管家；有没有那种走过长廊和镜子、像陷在记忆迷宫里的电影；想看一位艺术家离开原来的生活去热带岛屿追求理想。

结构审计复现：16 条中文摘句未核验；台账记录 2 条已定位参考版本段落、1 对有来源的作品级改编关系、1 对编辑主题关联；14 对关系待核验；6 个视频均无真实镜头标注。审计不是自动事实核查，本次也未重新独立核验外部来源。真实外部提供方、生图、视频播放、语义模型和视觉模型未验收。

新证据单独保存，原始交付报告未覆盖。两个新浏览器脚本默认写入历史报告路径，运行后将新记录另存到本次目录，再恢复并核验原交付文件字节。[源码指纹](revalidation-2026-10-20/source-manifest.json) 和 [新证据校验清单](revalidation-2026-10-20/SHA256.json) 标识本次实际内容。

保持 Draft，供审阅；不合并 PR1/PR2，不部署。
