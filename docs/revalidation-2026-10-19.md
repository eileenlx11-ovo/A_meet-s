# 修复包应用与独立复测：2026-10-19

本报告记录在 Windows 上重新应用上传修复包并实际执行验证的结果。原交付包的历史验收见 [原验证报告](validation-2026-10-19.md)，本次新证据独立保存在 [rerun-2026-10-19](evaluation/rerun-2026-10-19/)。时间使用 Asia/Shanghai。

## 补丁与远端状态

- 目标仓库：`eileenlx11-ovo/A_meet-s`；修复分支：`repair/reliability-and-retrieval`。
- 开始时远端仅有 `main`，指向 `dcde811a7df28d48bcc22ee1e51e1c6a04c62938`；目标分支和对应 PR 均不存在。
- 上传包 `SHA256.json` 的 10 个文件校验全部一致；补丁 SHA-256 为 `682cbd42b1a96d59e601cdfc343ef4c8e9bf5dfe69551c72f00d76e44bfb72d2`。
- 在独立克隆中从指定基线创建修复分支，`git apply --check` 通过，再应用补丁。没有修改或推送 `main`。
- 原样应用补丁的提交为 `6c230e54f3c282b9ae539b569537f6c0c3a8a4d1`，父提交为上述基线，Git tree 为 `49a0634c90ab748babc2b7940b15248a4b529060`，与交付包声明完全一致。
- Windows 的全局 `core.autocrlf=true` 最初转换了工作副本换行符。仅对本克隆设置 `core.autocrlf=false` 并恢复 LF 后，49 个源文件与原指纹清单逐字节一致；Git tree 未改变。以下最终复测使用 LF 文件。
- 此提交之后只补充本报告及本次复测 JSON，不改变修复包源码、语料、查询或预期。

## 环境与测试

Node.js `v24.18.0`，npm `11.16.0`，Vitest `1.6.1`，Playwright `1.56.1`，Chromium `141.0.7390.37`。依赖使用 `npm ci --ignore-scripts --no-audit --no-fund` 安装；浏览器通过 `npx playwright install chromium --only-shell` 安装到工作目录。

| 检查 | 本次结果 | 新证据 |
| --- | --- | --- |
| 应用补丁前原有 API 套件 | 8/8 通过 | 本次命令执行输出 |
| 修补后 `npm test` | 5 个文件、39/39 通过 | [regression-tests.json](evaluation/rerun-2026-10-19/regression-tests.json) |
| `npm run test:browser` | 7/7 通过，未捕获页面错误 0 | [browser.json](evaluation/rerun-2026-10-19/browser.json) |
| 基线固定检索集 | 18 通过、11 失败、1 人工观察 | [retrieval-baseline.json](evaluation/rerun-2026-10-19/retrieval-baseline.json) |
| 修补后固定检索集 | 28 通过、1 失败、1 人工观察 | [retrieval-after.json](evaluation/rerun-2026-10-19/retrieval-after.json) |
| 修补后补充检索集 | 8 通过、2 失败 | [retrieval-supplement.json](evaluation/rerun-2026-10-19/retrieval-supplement.json) |
| 两组检索的 `--strict` 模式 | 分别返回退出码 1，符合保留失败项的预期 | 本次命令执行输出 |
| `git diff --check` | 通过 | 本次命令执行输出 |

基线检索在另一个独立克隆中检出 `dcde811`，只加入相同的评估脚本和固定查询文件，未替换基线检索代码。固定语料、查询文件哈希前后保持相同。基线检索实现 SHA-256 为 `c99473904d3505225ab910c8bc679c4b1a6667814994543df44097462eb59543`；修补后为 `4b673ae61dd0f7c4ded639ab2566ae909fa27750502a0b33d0be75b6340d159f`。

复测发生于修复提交创建之前，因此检索 JSON 的 `source.gitHead` 仍是基线；实际运行源码由 `worksRepositorySha256` 与 49 项源文件清单共同标识。新检索存档保留逐查询判定、排名、作品标识与指纹，只移除各结果重复的文字描述；[SHA256.json](evaluation/rerun-2026-10-19/SHA256.json) 可校验新证据文件。

## 检索结论与限制

本次重新运行复现了交付包报告的汇总结果。修复改善完整名称排序、长句召回、无关查询过滤和有限排除条件；以下能力探查仍未通过：

- `雪地里穿祖母绿裙子`：返回《赎罪》和《情书》，不能保证多个正向条件出现在同一场景。
- `绿色激光测距仪怎么校准`：颜色词使《赎罪》误召回。
- `粉色无线耳机怎么连接电脑`：颜色词使《昨日的世界》/《布达佩斯大饭店》记录误召回。
- `想找雨夜里没有说出口的告别` 继续作为人工观察，不计为通过。

默认诊断退出码为 0 不代表所有样例通过。本报告不将上述结果表述为总体准确率；样例仅覆盖 16 条固定作品记录。测试使用内存或合成临时数据库，浏览器关闭外部搜索、生图及外部页面请求；真实外部资料质量、视频播放、付费模型和跨模态检索均未验收。保留原报告中暂缓跨模态、先完善查询约束与内容依据的决定。

## 复现命令

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm test
npx playwright install chromium --only-shell
npm run test:browser -- --output browser.json
npm run evaluate:retrieval -- --output retrieval-after.json
npm run evaluate:retrieval -- --fixtures test/fixtures/retrieval-holdout-cases.json --output retrieval-supplement.json
npm run evaluate:retrieval -- --strict
npm run evaluate:retrieval -- --fixtures test/fixtures/retrieval-holdout-cases.json --strict
```

最后两条预期返回 1，失败项如上。创建 Draft PR 供审阅，不合并、不部署。
