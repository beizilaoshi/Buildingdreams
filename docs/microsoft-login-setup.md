# 筑梦启动器 Microsoft 应用配置

## PCL 后台接入进度（2026-11-12）
用户已选择使用本机 PCL 提供正版认证，桌面指定程序已找到。独立后台已通过初始化隔离、实际设备码请求、取消和异常清理的实现及独立审阅；正在接入筑梦登录弹窗。此路线不要求用户自行注册客户端 ID。尚未完成真实账号网页授权、购买校验和刷新成功联调。下方自有客户端配置保留为历史兼容方案，并非当前用户的必做步骤。


当前状态（2026-11-11）：本机有效设置 microsoftClientId 为空。已有设备码申请、自动复制代码/打开微软验证页、轮询、Xbox/Minecraft 身份兑换、加密凭据保存及多账号交互；受控测试不代表真实授权已接通。

## 开发者一次性配置
1. 打开 https://entra.microsoft.com/ ，使用具备应用注册权限的账号进入对应目录；如没有可用目录/注册权限，需先取得它。不要假设所有个人微软账号都能直接注册应用。
2. Entra ID → 应用注册 → 新注册。名称填写“筑梦启动器”；支持账号类型选择个人 Microsoft 账号，或包含个人 Microsoft 账号的多租户选项。本项目使用 consumers authority，不应仅支持组织账号。
3. 注册后记录“应用程序(客户端) ID”。在“身份验证”的高级设置开启“允许公共客户端流”，保存。当前使用 device-code flow，无需为其新建浏览器回调 URI，也不需要客户端密钥。
4. 将客户端 ID 填入开发版“设置 → 高级配置 → Microsoft 客户端 ID”，保存。只填写 ID，不要填写密码/令牌/密钥。
5. 回到首页 → 微软正版 → 登录 Microsoft。申请设备码成功后，程序自动复制代码并打开官方验证网页；在网页完成授权后，程序继续验证 Xbox/Minecraft 身份、Java 版授权并读取玩家资料。首次真实联调需完整确认这一链路，不能只凭微软网页登录成功就认定可启动。

## Minecraft 服务可用性
仅注册得到 GUID 不保证整个 Minecraft 链路获准。若微软登录成功但 Minecraft 身份兑换遭服务拒绝，需依据响应核对客户端服务准入、Xbox 账号及购买授权。相关申请短链接 https://aka.ms/mce-reviewappid 当前重定向到 Microsoft Forms；本次抓取工具无法读取表单内容，不能确认其是否仍开放或承诺审核结果。以官方实际页面/反馈为准，不绕过服务拒绝。

## 官方参考
- 应用注册：https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app
- 公共客户端及设备码流配置：https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-configuration
- 设备授权协议：https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code

此文件仅为开发者配置说明，未注册任何远程应用、未修改本机账号凭据、未打包。

## 当前使用路线
PCL后台接入与独立审阅已完成（代码74c8161）：开发版首页选择微软正版并登录，自动查找系统桌面的 Plain Craft Launcher 2.exe；缺失或版本不支持时在弹窗选择文件。收到设备码后自动复制并打开Microsoft官方验证页。准备/授权/校验期间可以取消，等待较久会提示耐心等待。当前无需为此路线填写自有客户端ID。尚需真实网页授权完成后的正版校验、刷新及游戏启动验证；未打包。
