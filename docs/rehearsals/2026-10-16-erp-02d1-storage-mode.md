# ERP 02D1 只读存储模式核验

日期：2026-10-16。依据[实施计划](../superpowers/plans/2026-10-16-erp-02d1-storage-mode.md)和已批准阶段02设计。

## 已交付

新增 `inspectBusinessStorage(pool, options)`，只接受显式连接池，在同一个 PostgreSQL16 repeatable-read/read-only 事务中读取模式。无erp schema返回legacy且不创建任何表；已存在erp schema则必须有安装及迁移记录、完整已知迁移历史和唯一有效安装记录。显式legacy/relational均保留服务器身份；可选expectedServerId只作核对，不改写身份。未知mode、缺结构或安装、初始化日期无效、身份不符、迁移缺失/不连续/未知高版本/hash或文件名变化均拒绝，连接失败原样传播，不回落JSONB。

迁移器原有逐行历史校验抽为共享 `assertMigrationHistory`，默认保持原先可补齐迁移的行为；只读inspector要求当前版本完整。未改SQL v1–v5，未改变正式启动或HTTP挂载。返回只含模式、结构版本和安装公开资料，不含凭据或业务数据。

## 实际验证

先增加隔离PG测试及suite入口，在模块尚不存在时观察到MODULE_NOT_FOUND失败，随后实现功能。以下均使用自动创建并核对归属的临时PG16 `/erp_02a_verify`，测试完成清理容器，未使用正式DATABASE_URL：

| 专项 | 通过 | 跳过 |
| --- | ---: | ---: |
| storage-mode | 15 | 0 |
| foundation回归 | 17 | 0 |
| core回归 | 9 | 0 |

共41项。storage-mode覆盖空库、精确旧JSONB原文保持、半建schema、空安装记录、显式两种模式、6次并发读取、身份不符、hash/文件名变化、缺末次迁移、未来版本、历史断档、非法mode、无效初始化日期、缺安装表以及关闭连接池。实际PG报告transaction_read_only=on，inspector发出的SQL仅BEGIN/SET/SELECT/COMMIT/ROLLBACK。失败前后比较旧原文、安装及迁移记录，均未改动。证据 `.tmp/erp-02d1/storage-mode-{red,green}.log`、foundation-regression.log、core-regression.log，标准suite摘要位于 `.tmp/erp-02a/`。

## 正式状态与边界

本包未挂载正式server，不创建正式erp schema、不切换账号或写业务。最近正式只读核对仍是02C收尾：原始app_store hash fdfc1fe167994afa8f06bb24df3aa11830b85686b526019e311cb9ad3634d078，业务/当前AI摘要一致。该摘要不是Git中的业务备份，原始记录与运行凭据继续留在忽略的runtime/.tmp目录。

02C测试专用Node、带runId标签的PG容器及ERP_02C_API_35无窗口AVD均在核对归属后停止/移除，临时凭据文件已删除，截图和报告保留，见 `.tmp/erp-02c/cleanup.json`。随后用户启动的模拟器在ADB显示emulator-5558；未把它当成专用AVD停止或清理，也未在其上冒充已执行本次02D验证。

## 推进判断

02D1范围达到约95%推进线，可以继续02D2运行入口接线。整个02D尚未完成：旧store及旧AI bridge的加载副作用必须先消除，关系模式不能继续挂旧写入口；还需系统/统计/文件/其余客户端接线、维护停写、完整备份恢复及批准历史映射后的切换验收。该只读模块本身不等于系统已经启动保护，更不等于正式迁移完成。
