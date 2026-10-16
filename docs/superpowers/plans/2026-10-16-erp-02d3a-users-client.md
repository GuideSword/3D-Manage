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

- [ ] 关系Owner分页/搜索和错误重试；创建Staff/Viewer、编辑姓名（含Owner）、调整非Owner角色、确认启停/删除及重置非Owner密码。Owner保持受保护，后端末位Owner/当前用户/历史引用规则照常生效。
- [ ] 共用mutation固定key/version/body；未知结果禁改/禁关闭，并可重试原命令。409重新读取目标后核对再提交，不能默默换version；重置成功以返回user更新版本。刷新失败保留明确错误。
- [ ] 真实Web验收创建/编辑/角色/启停/重置/删除、丢响应重试及冲突；非Owner伪造管理请求仍403。

## Task3 本人改密

Files: screens/ChangePasswordScreen.js、screens/SettingsScreen.js、navigation/AppNavigator.js、constants/index.js。

- [ ] 所有角色设置入口；当前密码、新密码、确认密码。先读本人版本，固定payload/key，密码不写日志/本地存储/文档。
- [ ] 改密成功清理会话重新登录；错误旧密码不退出，冲突需重载本人资料；结果未知可重试或显式退出以新密码登录。旧服务器走原authAPI且未知结果不自动重复提交。
- [ ] 实际Web验证旧密码失效、新密码有效、跨角色、维护/401及丢响应恢复，检查无密码出现在审计/回执正文。

## Task4 验收推进

- [ ] 专项Node/实际PG、旧文件服务器与关系Web验收通过，独立安卓QA包验收并记录来源/安装；正式摘要只读比对，不更新正式Docker。
- [ ] 清理自有隔离进程/容器/QA包/私有配置，保留日常app与用户模拟器；主要功能约95%再推进A4 CSV。整个阶段02和02D2 Task6继续待集成。

## 当前状态

库存A2已达约95%，当前Task1。HTTP本人改密已有向旧客户端兼容的缺版本/键fallback，本子项客户端始终显式提供，不借此次UI接入任意修改后端兼容政策。02D3整体验收继续追踪既有通用订单UI smoke遮挡与A1延迟保存切会话用例。

## Task1结果（2026-10-16）

独立账号纯函数8项及库存/catalog/分页/主数据/command相关28项，共36项通过、0跳过。失败起点为模块缺失，证据.tmp/erp-02d3a-users/client-red.log和client-green.log。显式版本/key/业务头、严格字段、密码UTF-8长度及保留空格均通过；仅封装契约，不当作页面或真实HTTP验收。当前Task2用户页面，Task3本人改密页面和Task4集成仍待实施。正式没有更新。
