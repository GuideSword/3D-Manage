# Web 订单通信与图片缩放修复

目标：实现用户指定的 Web 滚轮图片缩放，恢复订单列表、详情的状态和删除请求，并兼容 APP 和两种后端。

- [x] 浏览器回归脚本复现详情开始执行、取消、删除及图片滚轮问题。
- [x] `utils/platformAlert.js`：Web 使用浏览器确认/提示，APP 委托原生 Alert，保留按钮回调。
- [x] `utils/relationalOrdersApi.js` 与 `utils/useOrderMutation.js`：关系型写入携带精确版本、规则版本和幂等键，旧后端保持原协议，复用现有业务操作控制器。
- [x] `screens/OrdersScreen.js`、`screens/OrderDetailScreen.js`、`components/StatusActionSheet.js`：接入真实写入，使用返回记录刷新，失败/冲突/结果未知可见并可重试。
- [x] `components/ZoomableProtectedImage.js`：Web 视口绑定非被动 wheel 事件，以鼠标为缩放中心，限制 1–4 倍和拖动范围，卸载解绑；保留 APP 手势。兼容 Web 图片加载尺寸事件，确保放大后能拖动。
- [x] `screens/ModelDetailScreen.js`：Web 提示改为“滑动鼠标滚轮进行图片的放大和缩小”。
- [x] 验证：浏览器操作与请求协议回归、原生确认委托测试、客户端相关测试、后端 API 验证、Web/Android 打包检查。完整客户端套件存在一项原有聊天草稿测试失败，见验证记录。

本次只修复已明确的问题。新增功能在修复后按现有能力给出优先级建议。
