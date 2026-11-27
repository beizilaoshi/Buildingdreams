# Windows 安装与卸载

筑梦启动器使用自定义 Inno Setup 中文向导，安装界面、欢迎页、安装选项和卸载进度/完成页均由项目内的配置与脚本绘制，不使用 electron-builder 默认安装向导。

- 当前用户安装，默认目录为 `%LOCALAPPDATA%\Programs\筑梦启动器`，可在向导中更改。
- 安装包内含应用和运行时，安装过程不联网下载文件。
- 可选择开始菜单和桌面快捷方式；默认不创建桌面快捷方式，也不添加开机启动。
- 可选择安装完成后启动应用。
- 卸载只移除安装目录中的程序文件、快捷方式和卸载项；`%APPDATA%\筑梦启动器` 中的账号、设置、实例、游戏与存档保留。
- 安装器输出名保持 `Buildingdreams-{version}-x64-nsis.exe`，以兼容现有更新检查器的资产识别规则。

## 构建

需要 Windows 和 Inno Setup 6。请将 `ISCC.exe` 放入 `PATH`，或通过 `ISCC_PATH` 指定编译器路径。

`npm run dist` 会生成程序目录、便携版和自定义安装版。`npm run verify:installer-config` 验证安装器配置；`npm run installer:art` 按现有品牌背景与 Logo 重新生成安装向导图像。
