# JavaScript → TypeScript 渐进迁移接手计划

- 最后更新：2026-07-16
- 当前进度：第 0–6 批已完成，渐进迁移收尾
- 原则：只做类型化和必要拆分，不顺带改变业务规则、API、数据库或部署行为

## 当前基线

- 浏览器主应用 `src/` 已使用严格 TypeScript，现有 `tsconfig.json` 只检查 `src/`。
- 应用、服务端、共享逻辑、41 个测试和 7 个运维脚本均已使用 TypeScript，并进入各自的严格类型检查。仓库只保留 `public/theme-init.js` 与 `public/recorder.worklet.js` 两个有意原样执行的浏览器脚本；`server/data/` 内的历史备份脚本不计入迁移基线，也不得修改。
- 原 `server/index.js` 的 5912 行逻辑已拆出认证路由、PDF 解析、PDF 产物存储和课程构建模块；严格 TypeScript 入口 `server/index.ts` 约 3500 行，后续仍可继续按业务域缩小。
- 仓库中的 systemd 启动命令仍执行 `npm run start`，该脚本现已切换为 `node .server-build/server/index.js`；正式服务器尚未部署本批变更，部署前仍须完整备份和构建。
- Node 版本下限目前写为 `>=22.5.0`。正式环境应运行 TypeScript 编译产物，不依赖 Node 的实验性类型剥离功能。

## 第 0 批完成情况

- 已新增独立 `tsconfig.server.json`，使用 `NodeNext`、严格检查和 `.server-build/` 输出目录；现有 JavaScript 仅参与复制，不开启 `checkJs`，新增 TypeScript 必须通过严格检查。
- 已拆分 `typecheck:client`、`typecheck:server`、`build:client`、`build:server`，总 `build` 同时生成前端与服务端产物；正式 `start` 仍保持 `node server/index.js`，尚未切换。
- 已为家长、孩子、备案体验会话和课程同步认证补充公共类型，并为 Express 请求扩展建立统一声明。
- 测试运行器已切换为 `tsx --test`，现有 126 项测试全部通过，可在后续批次直接执行 `.test.ts`。
- 已增加 `npm run smoke:server-build`：使用 `.server-build/` 中的编译结果、随机本机端口和 `.tmp-build/` 下的临时空库验证 `/api/health`，不会读取或写入 `server/data/`。

## 第 1 批完成情况

- 已迁移 `shared/assessmentMetrics`、`shared/automaticPractice`、`shared/sequentialAudio`，并新增共享的 `assessmentTypes`；旧的同名 JavaScript 和独立声明文件已移除。
- 已迁移 `assessmentValidity`、`candidateSelection`、`passGate`、`scoringPolicy`、`noiseQuality`、`audioSignal` 六个低副作用服务端模块，并用公共类型明确评测结果、逐词结果、过关结果和候选结构。
- 本地 API 改用 `node --import tsx server/dev.ts`，`scripts/startDev.mjs` 使用相同加载方式，保证迁移中的源码和 Worker 能解析 `.ts`；本阶段未部署正式环境。
- 评分阈值和业务分支均保持不变；新增 TypeScript 中没有 `any`。现有 126 项测试、前后端严格类型检查、完整构建和编译产物健康检查全部通过。

## 第 2 批完成情况

- 已迁移 `authCrypto`、`parentAuth`、`db`、`courseLibrary`、`courseSync`、`attemptCalibration` 六个认证、存储与课程数据模块，并新增 `server/types/data.ts` 统一描述家长、会话、注册 Key 和孩子配对记录。
- SQLite 查询结果在数据库边界完成显式收窄，认证会话、课程资源、同步快照和人工校准记录均建立明确 DTO；新增 TypeScript 中没有 `any`，SQL、事务、认证策略和业务数据均未改变。
- Vite 开发服务忽略 `.tmp-build/`、`.server-build/`、`server/data/` 和 `dist/`，避免构建或数据产物触发文件监听错误；本地仍只运行 5173 + 4175。
- 现有 126 项测试、前后端严格类型检查、完整构建和编译产物健康检查全部通过；4175 已使用迁移后源码重启并验证健康、未登录会话和认证保护。

## 第 3 批完成情况

- 已迁移 Azure、腾讯和讯飞语音评测，腾讯/OpenAI TTS、音色目录、主评分/影子评分编排，以及 HunyuanOCR、PaddleOCR、讯飞 OCR provider；云端和本地服务的原始 JSON/XML 均从 `unknown` 边界显式收窄后再进入标准化结果。
- 已迁移 GTCRN 降噪编排与 worker、attempt 回放音频裁剪，并新增 provider/OCR 公共类型；13 个服务端 JavaScript 文件转为严格 TypeScript，新增源码中没有 `any` 或类型检查抑制指令。
- 已分别真实运行源码和 `.server-build/` 编译产物中的 GTCRN worker，验证 `.js` worker URL、模型路径回退、ArrayBuffer 传输和 WAV 输出；本机 HunyuanOCR/PaddleOCR 状态探测保持正常。
- 语音/OCR/音频专项 27 项测试及全部 126 项测试通过，前后端严格类型检查、完整构建和编译产物健康检查通过；4175 已重启并保持认证保护，未启动旧本机 4174。

## 第 4 批完成情况

- 已迁移 `pdfLayout`、`pdfOcrAudit`、`pdfImportQuality`、`pdfImportArtifacts`、`pdfImportVerification` 五个 PDF 布局、OCR 审计、质量报告、导入产物和多通道复核模块，并新增 `server/types/pdf.ts` 统一描述版面、文字层、OCR 差异、课程结构、质量问题、页面资产和导入快照。
- HunyuanOCR、PaddleOCR 和讯飞 OCR provider 已接入共享审计类型；新增 TypeScript 中没有 `any` 或类型检查抑制指令，章节/栏目/句子识别、OCR 门禁、质量阈值和业务数据均未改变。
- PDF 导入流水线 33 项测试及全部 126 项测试通过；生产构建、编译产物健康检查和实际一页 PDF 的编译产物解析小样均通过。4175 已使用迁移后源码重启并验证健康、未登录会话和认证保护，旧本机 4174 保持关闭。

## 第 5 批完成情况

- 已将 `server/index.js` 迁移为严格 TypeScript，并把安全与认证路由拆到 `server/http/authRoutes.ts`，把 PDF 结构解析、课程章节构建和 PDF 导入产物存储分别拆到 `server/pdfImportParser.ts`、`server/lessonBuilder.ts` 与 `server/pdfImportStorage.ts`；`dev`、环境加载和备案体验沙箱也已迁移。
- 服务端与共享业务源码已不再保留 `.js`；新增 TypeScript 中没有显式 `any` 或类型检查抑制指令。SQLite 行、课程同步包、PDF 快照、评分候选和绘本导入数据均在边界显式收窄，路由、错误码、评分阈值、解析规则和数据库结构保持不变。
- `npm run start` 与 `npm run server` 已切换到 `.server-build/server/index.js`，开发环境继续通过 `tsx` 运行 `server/dev.ts`。本批没有部署正式环境，正式服务器仍须在用户授权后按完整备份、构建和回滚流程更新。
- 客户端与服务端严格类型检查、全部 126 项测试、完整构建、编译产物健康检查和差异检查均通过；4175 已使用 `server/dev.ts` 重启并验证健康接口与未登录认证保护，5173 保持运行，旧本机 4174 未启动。

## 第 6 批完成情况

- 已将 41 个 Node 测试和 7 个 `scripts/*.mjs` 运维脚本迁移为 TypeScript；`tsx --test` 仍自动发现原有 126 项测试，开发启动、编译产物健康检查、注册 Key、OCR 控制、视觉测试和课程修复命令均已切换到 `.ts` 入口。
- 新增 `tsconfig.tools.json` 与 `tsconfig.browser-tests.json`：Node/服务端测试与少量依赖 DOM 的浏览器逻辑测试分开使用正确的运行环境类型，并由 `npm run typecheck:tools` 统一严格检查；测试 API JSON、TCP 端口、OCR 响应和 PDF 夹具均在边界显式收窄，没有加入类型检查抑制指令。
- `public/theme-init.js` 明确保留为原样 JavaScript，因为它由 `index.html` 在 React 与首屏绘制前同步执行，避免主题闪烁；`public/recorder.worklet.js` 明确保留为原样 JavaScript，因为 AudioWorklet 通过固定 URL 在线程环境直接加载。两者在没有专用的编译与复制验证链路前不盲目改扩展名，现有 URL、执行时序和 CSP 行为保持不变。
- 客户端、服务端、测试和运维脚本严格类型检查以及全部 126 项测试通过；本批不改变 API、数据库、评分、PDF 规则或正式部署状态。

## 自部署验证情况

- 编译入口已按完整数据备份、编译产物健康检查和失败自动回滚流程完成自部署验证。
- 首次切换暴露并修复了编译目录下默认数据、静态资源和本机 OCR 运行目录的项目根解析问题；新增回归测试同时覆盖源码目录与 `.server-build/server/` 编译目录，正式服务现在只运行 `.server-build/server/index.js`。
- 最终严格类型检查、127 项测试、服务端编译健康检查、公网页面/认证/PWA/构建号检查全部通过；正式数据未迁移、重置或覆盖，部署前后与完整备份的数据目录字节数一致。

## 目标形态

1. 新增独立的服务端 TypeScript 配置，例如 `tsconfig.server.json`，采用 `NodeNext` 模块解析、严格检查和独立输出目录；不要与 Vite 的 `dist/` 混用。
2. TypeScript 源文件中的 Node ESM 相对导入继续写 `.js` 后缀，由编译器解析到 `.ts` 并输出可由 Node 直接加载的 `.js`。
3. 开发和测试可以引入 `tsx` 提高迁移效率；正式 systemd 只运行经过 `tsc` 编译并验证的 JavaScript。
4. 客户端构建、服务端构建、类型检查和测试使用明确分开的 npm scripts，并由总 `build`/`test` 流程统一调用。
5. 最终让服务端、共享逻辑、测试和运维脚本都进入类型检查；`public/recorder.worklet.js` 与 `public/theme-init.js` 只有在建立明确的编译/复制链路后再迁移。

## 推荐批次

### 第 0 批：迁移基础设施（已完成）

- 建立服务端 tsconfig、输出目录和 `typecheck:server` / `build:server`。
- 补齐 Express、Multer、Node、SQLite 请求上下文等公共类型；为 `req.parentSession` 等扩展建立统一声明。
- 选择并验证测试运行方案。若使用 `tsx --test`，必须先证明现有 126 项测试全部保持通过。
- 此阶段不切换正式 `start`，先验证编译产物可以独立启动并通过 `/api/health`。

### 第 1 批：纯函数和共享评分逻辑（已完成）

- 优先迁移 `shared/assessmentMetrics.js`、`shared/automaticPractice.js`、`shared/sequentialAudio.js`。
- 再迁移 `assessmentValidity`、`candidateSelection`、`passGate`、`scoringPolicy`、`noiseQuality`、`audioSignal` 等低副作用模块。
- 对应测试随模块一起迁移或至少改为通过新 TypeScript 源码执行。

### 第 2 批：认证、存储和课程数据（已完成）

- 迁移 `authCrypto`、`parentAuth`、`db`、`courseLibrary`、`courseSync`、`attemptCalibration` 等模块。
- 明确 SQLite 行结构、家庭作用域、会话种类和 API DTO；不得借迁移机会重建或批量修改数据库。

### 第 3 批：语音、TTS、OCR 与 worker（已完成）

- 迁移腾讯、讯飞、Azure、TTS、PaddleOCR、HunyuanOCR、降噪和影子评分模块。
- 为云服务原始响应与标准化结果分开建类型，保留未知字段的安全边界，不能用大面积 `any` 掩盖 provider 差异。
- worker 路径、动态导入、WebSocket 事件和二进制 Buffer 是重点回归项。

### 第 4 批：PDF 与导入流水线（已完成）

- 迁移 PDF 布局、OCR 审计、质量报告、导入产物和多通道复核调度。
- 用现有 PEP 样本和测试锁定章节、栏目、句子数量与 OCR 门禁结果，不在类型迁移中调整识别规则。

### 第 5 批：拆分并迁移服务入口（已完成）

- 先把 `server/index.js` 按认证、学生、家长、评分、TTS、PDF、平台管理和静态服务拆成有界路由模块，再完成入口迁移。
- 每次拆分只移动已有逻辑；不要同时重写路由、错误码或权限规则。
- 编译产物连续通过本地 4175 回归后，才把 `npm run start` 与 systemd 切换到编译入口。

### 第 6 批：测试、运维脚本和原样浏览器脚本收尾（已完成）

- 将剩余 `.test.js` 和 `scripts/*.mjs` 转入类型检查。
- `theme-init` 必须继续在 React 和首屏绘制前执行；录音 worklet 的 URL、线程环境和 CSP 必须保持不变。没有可靠打包链路时，应明确保留为少量有意的 JavaScript，而不是盲目改扩展名。

## 每批必须遵守

- 一批一个独立提交，工作区有其他用户修改时不覆盖、不混入。
- 不改评分阈值、课程解析结果、认证策略、环境变量含义、数据库结构或业务数据。
- 至少运行 `npx tsc --noEmit`、服务端类型检查、`npm test`、`git diff --check` 和 `npm run build`。
- 涉及页面布局时再运行 `npm run test:visual`；涉及后端时自动重启并验证 4175，绝不启动旧本机 4174。
- 切换生产启动入口前，增加“编译产物可启动、健康检查、认证保护、TTS、评分提交”的浏览器/API 回归。
- 只有部署维护者明确授权时，才备份正式 `server/data/` 并更新其自有环境。

## 完成判定

- 应用和测试中除有明确理由保留的原样浏览器脚本外，不再存在未受类型检查的业务 JavaScript。
- 客户端与服务端严格类型检查、126+ Node 测试、生产构建和关键浏览器流程全部通过。
- 正式启动只依赖编译产物，并保留上一版本源代码、前端构建和完整数据备份的回滚路径。
