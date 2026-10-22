# 模型下载保护与 Studio 显式交接实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 所有模型源文件入口执行统一下载授权；用户同意后由开源Windows助手拉取指定文件并打开Studio，打印由用户操作。

**Architecture:** 下载授权领域服务由旧store与关系PostgreSQL分别持久化，原文件读取入口统一调用授权检查。网页/安卓使用单文件短期授权；助手以一次性交接凭据兑换受限传输授权，不获得登录令牌或共享密码。助手源码与安装脚本保存在同一仓库，安装及真实Studio打开由用户显式触发。

**Tech Stack:** Node.js、Express、PostgreSQL、现有JSON/JSONB store、React Native/Expo Web、Windows PowerShell。

执行方式：本会话顺序执行；上述两个执行子技能当前未提供，不因此要求用户重选执行方式。不改正式数据，不自动发布、注册助手或启动Studio。

## 设计落实

首版Owner管理当前服务器组织的下载口令，Owner本人也验证。每次获取针对指定文件授权，短期传输可复用以支持Range；口令不跨任务缓存。当前单组织不扩展成多租户。源文件默认受保护，已登记的普通图片预览允许正常显示；未知文件保守保护。对象存储直链在保护开启时禁止签发，不能声称能收回既有公共对象。启用保护及提交口令需要HTTPS，测试只允许显式注入隔离测试传输选项。

### Task 1：持久化下载授权领域

Files: `backend/modules/modelDownloads/{service,postgresRepository,legacyRepository}.js`、`backend/business-db/migrations/0008_model_downloads.sql`、`tests/backend/model-downloads.test.cjs`。

- [x] 建立失败回归：匿名、错误口令、跨账号/文件、过期、口令轮换、禁用用户、交接重放、Range同任务读取、审计不含秘密。
- [x] 实现统一接口 `status(session)`、`configure(session,input)`、`authorize(session,input)`、`check(session,key,grant)`、`redeem(ticket)`、`transfer(grant)`，存储只保留随机凭据hash。
- [x] PostgreSQL使用独立policy/grants/attempts表；旧模式保存在`system.modelDownloads`并进入已有备份，不改变已有订单/模型/耗材。
- [x] 运行 `node --test tests/backend/model-downloads.test.cjs`，再用隔离PG验证事务及重放。
- [x] 精确暂存本任务文件，提交通过的实现与测试。

### Task 2：统一HTTP入口

Files: `backend/modules/modelDownloads/http.js`、`backend/application/{legacyRuntime,relationalRuntime}.js`、`backend/modules/adapters/files.js`、`backend/routes/files.js`、`backend/routes/oss.js`。

- [x] 添加 `/model-downloads/policy` GET/PUT、`/authorize` POST、`/handoff/redeem` POST和`/handoff/file` GET/HEAD。参数拒绝额外字段，所有响应no-store，错误不打印凭据。
- [x] 文件读取统一接受 `X-Model-Download-Grant`；转交下载只接受自己的不透明传输凭据，拒绝把其当登录凭据。
- [x] 旧files及旧`/uploads`别名不能绕过；保护开启时阻止OSS签发不受撤销约束的模型直链。导出元数据不附带授权凭据。
- [x] 真实HTTP覆盖无口令、直接旧链接、Range、匿名ticket兑换、跨文件、停用和轮换；允许普通已登记预览显示。

### Task 3：客户端下载与管理员设置

Files: `utils/{api,nativeDownload,modelDownloadsApi}.js`、`components/ModelDownloadDialog.js`、`screens/{ModelDetail,Settings}Screen.js`。

- [x] 文件下载在开始前显示本地拉取同意与安全密码输入；取消不发下载请求，校验失败不生成分享文件。
- [x] 为Web和安卓原生下载传递同一单文件授权header；会话/服务器改变后丢弃密码及授权。
- [x] Owner设置下载保护及轮换口令；版本冲突刷新状态，不明文回显已有密码。
- [x] 模型文件Web提供“在Bambu Studio中打开”；每次由明确点击触发，安装说明提供仓库入口，不在页面加载时探测/打开外部程序。

### Task 4：Windows助手

Files: `tools/model-handoff/{Install,Open-Model}.ps1`、`tools/model-handoff/README.md`、助手验证脚本。

- [x] 安装脚本由用户选择Studio路径及受信ERP HTTPS地址；仅注册独立自定义协议，不覆盖STL/3MF关联。
- [x] 处理协议时严格解析已配对服务器及随机ticket，不接受外部命令/任意URL/文件路径；禁止重定向到其他主机，不关闭证书验证。
- [x] 兑换ticket、下载到专用临时目录、校验size/SHA；可由用户选择另存；固定Studio可执行文件仅传本地文件参数，不传打印/切片命令。
- [x] 自动验证使用替身进程，不真实打开Studio。
- [ ] 正式HTTPS接入、助手安装注册和用户明确点击后的实际导入验收。

### Task 5：完整验收与交付记录

- [x] 用隔离PG、旧store、真实HTTP和独立文件验证统一保护；覆盖OSS失败关闭、撤销、失败限速、所有角色以及已有文件。
- [x] Web依次尝试Edge、Chrome、可用内置浏览器；全部不可用时暂停相关验收并告知用户。
- [x] 安卓只连接已指定的雷电实例，核对身份，不操作其他模拟器；输入测试账号，保留日常应用数据。
- [x] 记录实际通过项、剩余限制、源码commit与正式部署状态；源代码可审查不等于已发布安装包或已完成安全审计。

## 执行记录

2026-10-22：用户授权开始。Task1–3主体实现及Task4源码、替身验证完成；Task5已完成隔离PG/旧JSONB、Edge和指定雷电原生验证。剩余正式HTTPS发布、助手注册及用户手动触发的实际Studio导入；不自动启动软件代替用户验收。

实际证据及限制见[验收记录](../../rehearsals/2026-10-22-model-download-handoff.md)。未修改正式容器及其业务数据，Git仅本地提交。

最终自检补充：资源读取服务本身也校验授权；保护关闭时旧读取不改原始存储；精确字符串文件大小兼容；旧源配置过下载口令时明确阻断关系迁移，防止保护丢失。下载保护8项、文件44项、导入12项通过，均0跳过。尚未完成的正式发布及用户实际点击导入保持未勾选。
