# 2026-09-29 ERP 阶段 01 执行记录

状态：执行中；没有宣布 ERP 全部阶段完成。

依据：用户已批准编辑方案，并要求按 [优先级计划](../superpowers/plans/2026-09-29-erp-priority-plan.md) 的执行顺序实施。当前先完成编辑与库存基础的验收、升级和交付。第二阶段只准备 [数据基础设计](../superpowers/specs/2026-09-29-erp-data-foundation-design.md)，未实施关系迁移。

## 本次发布前修复

- 发布清单从后端 runtime 读取 API/schema 版本，当前为 API 1/schema 3，标记工作区存在未提交修改，不把 Git HEAD 当作全部源代码的版本证明。
- 备份读取来源数据库实际 schema，支持自定义 STORE_TABLE/STORE_ID，记录所有数组集合，包括 commandReceipts 与 objectUploads。
- 恢复统一校验 manifest、文件 hash、来源 schema、服务器身份和集合计数；保留 schema 2 备份兼容，拒绝未知未来版本。
- 空目标参数不能绕过已有组织数据保护；保护备份必须是另一份身份/hash 验证通过的备份；配置表不存在但数据库有其他业务表时拒绝视为空库。
- 未取得操作锁的进程不删除他人的锁；恢复前备份相对路径在切换工作目录前解析；停机状态备份不再对空输出调用 Trim。
- 恢复归档必须含 data/uploads，拒绝链接与特殊文件；PowerShell `-WhatIf` 在目标变更前返回。
- EAS 上传排除 runtime、备份和签名材料。
- 真机打开库存列表发现 `LotCard` 使用 Button 但缺少导入，补齐导入；界面回归新增从库存列表进入编辑与取消返回，390px / 1280px 均通过。

元数据脚本只读 PostgreSQL，不调用业务初始化或隐式迁移。脚本与 runtime 以只读挂载进入 Compose 一次性容器，使新备份工具可以检查升级前的旧镜像。

## 自动化验证

| 验证 | 结果 |
| --- | --- |
| `npm run verify:edit` | 9/9 通过 |
| `npm run verify:erp` | 16/16 通过 |
| `npm run verify:erp:postgres` | 隔离 PostgreSQL 16，12/12 通过 |
| `npm run verify:client` | 地址检查及 25/25 通过 |
| `npm run verify:release` | 会话、runtime、API、自托管验证及 Web 导出通过 |
| `npm run verify:backup` | schema、身份、计数、文件 hash，4/4 通过 |
| Linux 备份/恢复脚本 | 容器内 `sh -n` 通过；未计作独立 Linux 主机完整演练 |
| PowerShell 解析 | 备份和恢复脚本解析通过 |
| `tests/ops/package-release.verify.cjs` | APK 内容变化、版本不符、空 ABI 清单被拒绝，原发布归档保留 |

## schema 3 冷备份与恢复

全部业务测试只针对 `.tmp/erp-release-acceptance`，Compose project `erp-release-acceptance`，端口 5812。测试数据库配置为 `erp_release_store/release-test`，与日常 manage3d 数据库/目录隔离。使用随机测试密钥，假账号与固定测试密码，不使用日常账号凭据。

基线：3 个用户、1 个订单、1 个模型、1 个耗材、1 个 500g 批次、1 笔期初流水、1 个命令回执、8 笔审计和 1 个订单附件。

- serverId：`5d61020d-2ec0-4be1-aa07-a143b5885df5`。
- 镜像：`sha256:e637daac34586091a7707cd0b441a2871c1248d64671af1d8f488793432399f2`，Linux/amd64。
- 基线备份：`.tmp/erp-release-backups/20260929T145237Z`，schema 3。
- manifest SHA-256：`566c3eada12b76f3fc07a6c5084370096ac97c4ace565faa08b7de61418f5423`。
- 附件 SHA-256：`79dd401e0fc32d396166624518f413816c4d38eea391faef582de3d1b562dd0f`。
- 修改订单备注、出库 100g 使余额变为 400g，并实际追加附件文件内容。
- 恢复前保护备份：`.tmp/erp-release-backups/20260929T145346Z`。
- 通过隔离数据库验证后完整恢复。HTTP 验证订单、模型、耗材、用户及批次对象与基线相同，余额恢复 500g，附件字节 hash 一致。

恢复守卫演练：已有目标使用 AllowEmptyTarget 且不提供保护备份被拒绝；另一个进程持有锁时备份/恢复被拒绝，原锁保留；WhatIf 未取得操作锁或替换业务数据。演练后再次确认业务对象和附件与基线一致。

复核入口：`tests/ops/release-fixture.cjs`、`tests/ops/release-recovery.verify.cjs`、`tests/ops/restore-guards.verify.ps1`。fixture 脚本固定隔离端口和组织名称，拒绝向无关已初始化环境写入；会话上下文保留在忽略目录，不写入发布归档。

## schema 2 → 3

在同一一次性测试环境构造旧格式 500g 批次，保留订单、用户和附件，移除新账本字段。备份时 app 已停止；来源元数据没有触发隐式迁移。

- 旧格式备份：`.tmp/erp-legacy-backups/20260929T150509Z`，manifest 正确记录 schema 2。
- manifest SHA-256：`7c620a6c27c339ee3409fa2a0a475c739f2513f8f2de2602738b527a3e29f90c`。
- 恢复前隔离检查按 schema 2 核对；新后端启动后迁移为 schema 3。
- HTTP 验证：qty=500、qtyMg=500000、ledgerBaselineQtyMg=500000、balanceStatus=legacy_unverified；没有把旧余额重新累加为期初入库。
- 升级后保护备份：`.tmp/erp-legacy-upgraded-backups/20260929T150636Z`。

## Android 与正式目标

已连接物理 Android PJA110。保留了当前 APK，当前包名为 `com.anonymous.x3DManage`，versionName 1.0.0/versionCode 1。已有签名 SHA-256 为 `c8564429e6412cc51ab3e2a078e546e3ab25f9957a072ac6b9ef1c6384a9dd90`，已与 EAS 默认签名核对一致。

曾提交 EAS preview 构建：[270a0c02-86b2-4461-9b7b-f6e1bedf7d29](https://expo.dev/accounts/guidesword/projects/3D-Manage/builds/270a0c02-86b2-4461-9b7b-f6e1bedf7d29)，排队期间本地同签名构建完成，随后取消该重复构建。没有把它记为云端构建成功。

本机构建遇到旧版 Ninja 的 Windows 长路径限制，使用临时短路径、外置 CMake 目录及 [Ninja 官方 1.12.1](https://github.com/ninja-build/ninja/releases/tag/v1.12.1) 编译原生库，再由 Gradle 复用原生产物封装安装包。Gradle assembleRelease 成功，apksigner 校验通过，签名与旧包一致；`adb install -r` 返回 Success，没有卸载旧应用。临时盘符已移除。

- 安装包：`output/3D-Manage-20260929-edit-forms-arm64.apk`，仅 ARM64。
- 最终 APK SHA-256：`2aa55d5a160b5d00a2e3b23b0ab891cd49c5e9d39bdcfc3c26335b9878ad6694`；修复库存页导入后重新构建覆盖安装。
- 客户端身份记录：`output/android-artifact-20260929.json`，包含签名、ABI、hash、构建日期及覆盖安装证据。
- 后端源码归档与联合发布清单：`output/3D-Manage-backend-20260929.tar.gz`、`output/release-manifest-20260929.json`。
- 重打包命令：`node deploy/package-release.mjs --android-manifest output/android-artifact-20260929.json`；输入 APK hash 必须与已验证身份清单一致。

签名凭据只保存在忽略的本地临时目录，不显示在日志、不提交到 Git、不进入 EAS 或后端发布归档。清理临时签名文件时自动审批返回 blocked by policy，文件保留；没有绕过该拒绝。

覆盖升级后确认原服务器地址 `http://100.99.230.4:8080/api` 和组织“培根造物”保留。用户解锁后将地址手动切换到隔离测试服务 `http://127.0.0.1:5812`，ADB USB reverse 连接 5812。原日常账号邮箱、密码均未修改。

最终覆盖安装返回 Success；从手机重新拉取已安装 base.apk，其 SHA-256 与最终产物一致，系统记录 lastUpdateTime 为 2026-09-29 23:43:29。此次版本仍为 1.0.0/versionCode 1，以 hash 和 buildId 区分这次测试构建。测试登录、测试服务器地址在第二次覆盖安装后保留。

### 物理设备表单验收

只对隔离假数据操作，通过真实原生页面和 HTTP 后端核对结果。微信输入法下 adb 键盘注入会改变字符，临时测试辅助 instrumentation 使用原生输入框的 ACTION_SET_TEXT；没有切换系统输入法或修改日常账号密码。

- 订单：原值回填；修改后取消没有写入；保存后返回详情刷新。名称变为 `ERP-Native-Order`，备注清空、日期为 null，金额仍为 30，附件仍为 1 个，行 ID `line-1` 和 layerHeightMm `0.2` 保留。
- 模型：空描述被必填校验拒绝且已输入的新名称保留；补填后保存成功，名称 `ERP-Native-Model`、描述 `native-model-description`。
- 耗材：品牌 `ERP-Native-Material`、单价 28、备注清空；PLA、1.75mm、蓝色、kg 保留，列表返回刷新。
- 批次：库位和备注回填；先通过独立 HTTP 请求将版本 1 更新为 2，再从手机提交旧版本。原输入 `A-2` 保留，页面提示冲突，后端仍保留并发修改。重新加载最新资料后保存，库位 A-2、备注为空、版本 3、qty=500/qtyMg=500000。
- 断网：移除该测试端口的 USB reverse 后保存库位 `A-3-offline-retry`，界面显示网络失败及“重试原保存”，后端版本仍为 3。恢复连接后重试成功，版本仅增至 4、余额仍 500g。本案例没有模拟服务端已提交但响应丢失，也没有执行断网扣减；不能据此宣称这两项真机验收完成。
- 用户：Owner 在原生用户页面将普通 Viewer 姓名改为 Native-Viewer，返回用户列表刷新。
- Staff：可以看到批次编辑，没有盘点入口和用户管理入口；实际登录/退出成功。
- Viewer：没有批次编辑、出库、停用、盘点及用户管理入口，订单详情没有编辑入口；实际登录/退出成功。库存卡片中的“入库”是日期字段标题，并非操作按钮。

本轮表单测试改变了隔离 fixture，不能再直接以原始冷恢复基线对比这些已修改对象。已通过的冷备份/恢复证据保留，需重建基线后才能重跑原始快照核对。

日常后端 `manage3d-app-1` 位于本机 8080，检查时仍运行 schema 2。手机保存的 100.99.230.4:8080 为本机 Tailscale 地址；正式发布目标已请求用户选择。在收到选择前保留日常服务，所有可变测试仅在隔离环境进行。

未完成的发布门槛：真机受保护文件访问、断网扣减/响应丢失后的单次过账、明确目标环境部署及发布后检查。独立 Linux/HTTPS/OSS 的专项验收根据实际部署方式处理，不能用本次本地 Compose 演练代替。
