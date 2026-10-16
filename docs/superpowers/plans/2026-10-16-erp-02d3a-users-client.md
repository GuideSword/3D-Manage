# ERP 02D3A3 用户管理与本人改密实施计划

**Goal:** 将已批准的02D3用户入口接到关系账号领域，补齐本人改密入口，保持旧服务器可用。

**Architecture:** 新增独立关系账号封装和关系用户页面，旧UsersScreen按能力分支保留。复用分页/会话作用域及固定操作键controller，不修改既有脏utils/api.js。全部写入显式携带已读version、业务版本2和key。本人改密先读auth/me获得版本，成功signOut；若已提交但丢响应，旧token已经失效，重试401后以新密码重新登录，不承诺旧token能重放成功。

**Tech Stack:** Expo/React Native，既有users领域、auth/change-password，Node纯函数测试和实际隔离PG/Web/安卓。

## Task1 独立客户端契约

Files: utils/relationalUsersCore.cjs、utils/relationalUsersApi.js、tests/client/relational-users.test.cjs。

- [x] 先运行失败测试：分页参数、用户姓名/email/Staff或Viewer创建、密码12字符/72 UTF-8字节、不截断/trim密码、严格字段、版本、业务头和key。
- [x] 实施getPage/getById/create/update/delete/resetPassword/me/changeOwnPassword；只依赖纯client core，不引入bcrypt/数据库环境。用户身份字段不从客户端随意篡改。
- [x] 运行专项及既有分页/账号controller回归，记录真实通过数并提交。

## Task2 用户页面

Files: screens/RelationalUsersScreen.js、screens/UsersScreen.js。

- [x] 关系Owner分页/搜索和错误重试；创建Staff/Viewer、编辑姓名（含Owner）、调整非Owner角色、确认启停/删除及重置非Owner密码。Owner保持受保护，后端末位Owner/当前用户/历史引用规则照常生效。
- [x] 共用mutation固定key/version/body；未知结果禁改/禁关闭，并可重试原命令。409重新读取目标后核对再提交，不能默默换version；重置成功以返回user更新版本。刷新失败保留明确错误。
- [x] 真实Web验收创建/编辑/角色/启停/重置/删除、丢响应重试及冲突；非Owner伪造管理请求仍403。

## Task3 本人改密

Files: screens/ChangePasswordScreen.js、screens/SettingsScreen.js、navigation/AppNavigator.js、constants/index.js。

- [x] 所有角色设置入口；当前密码、新密码、确认密码。先读本人版本，固定payload/key，密码不写日志/本地存储/文档。
- [x] 改密成功清理会话重新登录；错误旧密码不退出，冲突需重载本人资料；结果未知可重试或显式退出以新密码登录。旧服务器走原authAPI且未知结果不自动重复提交。
- [x] 实际Web验证旧密码失效、新密码有效、跨角色、维护/401及丢响应恢复，检查无密码出现在审计/回执正文。

## Task4 验收推进

- [x] 专项Node/实际PG、旧文件服务器与关系Web验收通过，独立安卓QA包验收并记录来源/安装；正式摘要只读比对，不更新正式Docker。
- [x] 清理自有隔离进程/容器/QA包/私有配置，保留日常app与用户模拟器；主要功能约95%再推进A4 CSV。整个阶段02和02D2 Task6继续待集成。

## 当前状态

库存A2已达约95%；本A3现已完成Tasks1–4并达约95%，下一项为A4 CSV。HTTP本人改密已有向旧客户端兼容的缺版本/键fallback，本子项客户端始终显式提供，不借此次UI接入任意修改后端兼容政策。02D3整体验收继续追踪既有通用订单UI smoke遮挡与A1延迟保存切会话用例。

## Task1结果（2026-10-16）

独立账号纯函数8项及库存/catalog/分页/主数据/command相关28项，共36项通过、0跳过。失败起点为模块缺失，证据.tmp/erp-02d3a-users/client-red.log和client-green.log。显式版本/key/业务头、严格字段、密码UTF-8长度及保留空格均通过；仅封装契约，不当作页面或真实HTTP验收。当前Task2用户页面，Task3本人改密页面和Task4集成仍待实施。正式没有更新。

## Tasks2–3结果（2026-10-16）

关系Web13组、旧文件服务器Web3组通过，均pageErrors为空；客户端53项、实际PG users18/adapters16/maintenance9/runtime9共52项，总105项Node检查通过、0跳过。Owner/Staff/Viewer本人改密及新密码登录、Owner维护拒写/丢响应重试401恢复均已实测。刷新登录红→绿定位到关系auth/me返回直接DTO，AuthContext原只取result.user；新增纯authUserCore兼容两种结构，服务端协议不改。

当前Task4独立安卓验收及最终正式摘要/清理；A3尚未宣称约95%，未进入CSV。初次创建密码清空断言抢在React更新前读取，已改为等待实际清空状态，再核对；未删除首次合法测试用户。Web fixture保留真实历史，不用重置数据库抹平已提交命令。

## Task4最终结果（2026-10-16）

独立安卓包com.anonymous.x3DManage.erp02d3ausers、名称“培根造物·账号验收”、版本1.0.0/code1、ABI x86_64，安装Success；源码fe6108d及已有未提交修改，不是正式包。emulator-5558原生6组通过：QA包强制结束重启恢复登录；创建成功丢响应和返回保护、同键同内容重试仅一个用户；姓名回填保存及启停最终版本4/审计4；错误当前密码可纠正；本人改密丢响应后原键重试401、新密码实际登录及重启恢复；改密仅一次version/tokenVersion增长，各成功键一回执、失败密码无回执，代理记录/审计/回执无明文密码。

补充当前构建390px Web2组：编辑已有用户保留未提交的新建草稿，表单/列表窄屏可操作；模态淡出结束后截图已检查。原生角色权限覆盖为Owner，Staff/Viewer本人改密及拒绝管理沿用实际Web，不夸大为三角色原生。

formal-after-users.json与库存formal-after-native.json完全一致，正式业务/AI未变且无erp schema。自有API/代理经进程归属核验、容器经runId标签核验后清理，私有配置/5837反向端口/独立QA包移除，日常应用与模拟器保留。

A3达到约95%推进门槛，转A4 CSV。02D3整体验收的订单旧smoke遮挡/A1延迟写切会话、文件/OSS/AI及02D4仍未完成，不能算整个阶段02完成。证据见验收记录。
