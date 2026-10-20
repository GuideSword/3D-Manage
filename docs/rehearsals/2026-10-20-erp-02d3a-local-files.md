# ERP 02D3A5 本地文件接入进展

## 当前结果

本地存储及真实PG/HTTP共27项通过、0跳过；启动9项、适配19项回归通过。关系runtime已接入multipart上传、PG上传事实/回执及受保护GET/HEAD/Range，当前Task4页面接线；尚非完整文件模块交付。未更新正式Docker，也未操作任何模拟器。

## 已实现与验证

显式根目录，不读取旧JSONB/AI或全局storage配置。stage用pipeline逐块hash及大小检查，成功后返回内部token；publish重新核验完整内容，以namespace/SHA256.ext硬链接原子发布，相同内容只产生一个物理文件；discard只清理本实例临时副本，不删发布字节。根路径及暂存/发布目录均核对，读取做真实路径及句柄身份核对；根内历史目录链接保留可读，越界链接拒绝。

13项检查包括：显式配置和依赖隔离；原始chunks/SHA/size正确；不同暂存的并发同内容发布仅一文件；空/超限/中断/源错误不留暂存；不能伪造token删除外部路径；旧文件及精确范围字节；已存在坏内容不覆盖；越界目录替换拒绝；多种Range和416；暂存被改动后拒绝；根内目录链接兼容；实际32MiB生成上传/发布及两端读取；超限时不读取源剩余全部内容。没有把小文件测试称为500MB完整压力验收，32MiB是本轮实际检查大小。

测试清理在fs.rm递归调用前确认随机目录为系统临时根目录的直接子目录且前缀为erp-local-files-；不碰项目数据目录或用户文件。所有Node检查使用真实fs/streams，而非mock写入。

## 证据与余项

.tmp/erp-02d3a-files/local-storage-red.log起点缺模块失败；local-storage-green.log为13/13。代码backend/modules/files/localStorage.js、测试tests/backend/erp-local-files.test.cjs。角色/维护/回执/上传关联、预览、下载HTTP头/Range、客户端重试和平台验收均尚未由本轮证明，继续实施；A5未达95%，整个阶段02未完成。

## 服务端HTTP与PG补充证据

新增modules/files/service.js与adapters/files.js；runtime显式传uploadDirectory，不加载旧auth/store/AI。POST /uploads/:namespace要求PG当前Owner/Staff、业务头2及key，流式暂存后在领域事务内重新校验身份/维护，写object_uploads、审计与回执。签名检查覆盖PNG/JPEG/WebP/PDF基本头，不代表完整格式解码。相同内容原key回放、改内容409；JSON领域登记保持已读version，模型图片源文件被引用时不能删除，移除订单附件保留原字节。

GET/HEAD /files支持真实字节、mime、长度、私有无缓存、合法单段Range206和非法416，未认证401，缺文件404，私有目录/越界链接拒绝，维护允许读取。/oss与/agent仍503。

先运行http-red.log证明确实缺路由，再运行content-red.log证明伪图片曾被接受，修正后http-green.log为27通过0跳过；runtime-regression.log为9通过，adapters-regression.log为19通过。上传中途停用账号实际HTTP请求最终401，未产生上传记录/审计/回执，暂存为空；测试仅使用自有PG验证容器和核验路径后的临时目录。

不修改既有SQL迁移，不部署正式容器。发布文件与PG不是跨系统原子提交，PG失败可留未关联内容；不误删共享发布字节。未验证页面、平台预览、完整大文件压力；A5未达95%，继续客户端，02D2 Task6/正式切换保持待办。

## 客户端封装与真实丢响应重试

独立relationalFilesCore/Api已交付；multipart不强制JSON头，Blob显式携带文件名，原生uri对象保留。校验文件用途、扩展名/已知size及服务器返回SHA/路径/原名；JSON关联带已读version，移除用childId或position。客户端7项及目录协议6项共13通过。

新客户端实际请求隔离Express/PG，先真实提交上传并模拟丢响应，再以相同key/字节重试；关联同样在服务器提交后丢响应并原key重试。中文原名及下载字节一致，只新增1上传、1关联，审计和回执各2条，暂存为空。文件专项28通过0跳过，日志client-http-green.log。尚非UI验收，不证明页面已保持重试状态；页面及平台仍待完成。

## 模型详情实际页面结果

文件状态控制器已实现固定上传/登记key、未知结果冻结与原请求重试、已上传资料保留、显式冲突重载、移除身份/版本固定、会话失效中断。原生picker对象的name/uri保存副本，防止调用方修改污染重试。模型详情已接入；预先存在的图片大图/删除及手势依赖经审阅衔接，其他AI改动未合并。

纯文件流程9项，连协议22项；加受保护图片/路由回归31通过0跳过。真实构建+PG+后台浏览器8组通过，具体是上传后登记丢响应重试不重复、真实字节下载、图片上传、受保护PNG解码及大图开关、图片移除、版本冲突显式重载只登记、文件移除、Viewer权限。无pageerror。model-file-web-verification.json及截图留在.tmp/erp-02d3a-files。源码含其他未提交工作，当前验收不是纯HEAD发布验收。

已关闭后台浏览器，停止核对PID命令行后的本轮服务器，核对标签/runId删除自有PG容器并删除私有配置；留存model-file-cleanup.json及源SHA。未操作正式服务器/模拟器。不能把Web大图开关称为安卓双指缩放通过；也未强制实测文件选择器期间换会话。新建主体分步恢复、订单附件、自动预览和安卓仍待，A5未达到95%。

## 订单详情附件与最终源回归

订单详情关系分支接入附件上传/登记、下载、移除及失败反馈，按服务器position而非数组下标移除。复用同一PG身份、业务头、固定key及页面version；未知上传/登记结果分步重试，冲突保留上传资料、显式重载核对；未确认时冻结主体操作。下载复用既有作用域保护并保留原名。模型/订单选择器先固定原始运行作用域，回调核对该原始快照；未强制实测选择器期间换服务器。

真实服务器/PG/后台浏览器订单6组通过：上传和登记分别丢响应、原名及实际字节下载、冲突恢复、positions0/1存在空缺时准确移除、Staff390px上传、Viewer只读下载；无pageerror。PDF只验证字节，不称为渲染。模型详情8组在最终源上复验通过，相关Node37项通过0跳过，Web实际构建通过。

初版脚本误选底层首页客户同名文案造成点击等待，命中栈后改用当前列表唯一订单编号正常点击；没有force/脚本派发点击。另将Viewer就绪判断从无权限的编辑按钮改为订单总额。不是产品遮挡修复，原有通用订单全量smoke余项未据此关闭。

证据order-file-web-verification.json、order-file-web.log、order-file-staff-narrow.png、order-file-client-regression.log和order-web-build.log在.tmp/erp-02d3a-files；源码仍含既有未提交工作。后台浏览器、核对PID命令行后的本轮服务器及核对标签/runId后的PG容器已清理，私有配置删除，order-file-cleanup.json留摘要。未操作正式服务器或任何模拟器。新建/编辑表单的主体→附件恢复、自动预览与安卓仍待，A5未达95%。

## 新建/编辑表单分步恢复

主体结果确认后由savedRecordFilesCore队列接管；每次使用上一个已确认版本，重试只处理未完成文件。主体响应ID/版本不合约则按未知保留原key。模型新增/编辑可带文件和图片；订单新增/编辑可追加附件，仅加附件无字段修改时不发空PATCH。主体保存后冻结输入并明确显示剩余附件；未知必须确认，明确拒绝可进已保存主体稍后补附件。编辑时回原详情而非再叠一页。

纯队列6项、相关Node回归合计45项通过0跳过。实际构建+PG+完整服务器+后台Web表单6组通过：模型主体/第二文件上传/第二文件登记分别丢响应后恢复不重复；模型编辑追加保留原文件图片；编辑失败后稍后补附件正确返回路径；新建坏图片拒绝保留主体；新订单主体/附件登记丢响应后不重复且金额精确；编辑仅追加附件不空修改并在并发备注冲突时重载核对继续登记。无pageerror。首次脚本未等重载请求完成就读备注，改成等实际字段值，不是产品失败修复。

file-forms-web-verification.json、file-forms-web.log、forms-web-build.log、forms-client-regression.log、model-form-pending-files.png为证据；截图已检查。共享组件变更后模型详情8组和订单详情6组回归通过，末次导航小修补由最终6组表单覆盖。仍含其他未提交工作，不是纯HEAD发布验收。

后台浏览器/核对PID命令行后的服务器/核对runId标签后的PG容器与私有配置均已清理，file-forms-cleanup.json记录源SHA及结果。正式服务器、所有模拟器未操作。自动预览及源文件引用、emulator-5558原生选择/分享/缩放仍待，A5未达95%。

## 自动预览与引用保护

已接有界3MF内嵌缩略图提取、同命令生成object_uploads/图片关联/审计/回执，父版本只递增一次。图片保留服务器sourceFileId及previewSource，回放不重复；源被预览引用时409，先移除图后可移除源，物理字节保留。SQL生成事实失败实际注入后，源/图关联、父版本、上传事实、审计和回执全部回滚。无有效缩略图仍保存源；生成异常提示可手工添加。

实际PG/HTTP+文件专项40通过0跳过；目录回归12、启动9另行通过。Python标准ZIP独立样本覆盖压缩/存储/CRC/头/范围/加密/ZIP64/解压炸弹/伪小size及80MiB有界提取；仅预览部分读不足70KiB，不含上传/关联hash的完整流式读取。无SQL迁移变动。

Web4组通过实际3MF选择、自动图关联及PNG解码、源字节下载、删除顺序保护；无pageerror。截图已检查，内嵌图1×1，仅证明提取与实际字节解码，不是3D渲染。Windows沿用受控系统缩略图回退（测试进程显式禁用且恢复环境），没有声称实际Windows回退或Linux STL/STEP渲染通过。

证据preview-http-red.log/green.log、preview-parser.log、preview-catalog-regression.log、preview-runtime-regression.log、auto-preview-web-verification.json、auto-preview-web.log、preview-web-build.log、auto-preview-owner.png。源含其他未提交工作，非纯HEAD发布验收。指定emulator-5558已只读核对身份一致并记录日常包路径，尚未写设备。当前开始Task5独立安卓QA，后台自有服务器/PG留作验收后再按所有权清理；正式服务器未更新。A5未达95%。
