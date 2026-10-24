# Windows 本地模型助手发布复核

日期：2026-10-22

## 交付

- GitHub Release：<https://github.com/GuideSword/3D-Manage/releases/tag/model-handoff-v1.0.0>
- ZIP：`3d-manage-model-handoff-windows-v1.0.0.zip`
- 校验文件：`SHA256SUMS`
- ZIP SHA-256：`0df0dbc9a267ec0b2df132b758da2280f7b2e8762dc1dd897fce60a5387eba59`

网页交接弹窗现在提供下载助手、查看 SHA-256 和授权后打开本地助手三个入口。下载不会自动安装；用户打开 ZIP 中的安装脚本后由 Windows 单独确认权限。安装器只注册 `manage3d-model` 协议，不修改 STL/3MF 关联，不自动启动 Bambu Studio。

## 验证

- `tests/ops/model-handoff-package.verify.ps1`：ZIP 白名单、清单和 SHA-256 通过。
- `tests/client/model-handoff-install.test.cjs`：网页链接与 Release 清单一致。
- `tests/ops/model-handoff.verify.ps1`：协议绑定、服务器身份、授权数据、取消和覆盖保护通过；没有启动 Studio 或注册真实协议。
- `npx expo export --platform web`：Web 导出通过。

真实 Windows 安装、用户确认 UAC、协议打开和 Bambu Studio 导入仍需在用户电脑上手动验收；自动测试不会启动本机 Studio。
