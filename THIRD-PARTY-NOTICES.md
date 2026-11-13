# 第三方软件与素材说明

筑梦启动器，开发者：杯艺宣。

本项目采用 Electron/TypeScript 架构，并按用户授权选择性参考、移植 PCL 行为与少量图标；未整体替换为改名的 PCL 二进制。具体来源见 docs/pcl-source-references.md。素材逐项清单见 ASSET-SOURCES.md；复制后的文件随应用分发，构建和运行无需原始素材目录。

PCL 版本浏览器四个方块图标与分类规则的来源及权利归属见 notices/pcl-version-assets.txt；该通知并入应用第三方许可。未宣称原始档案或 Minecraft 美术采用 MIT 许可。

运行时软件的准确版本、仓库和许可位置由 `node scripts/licenses.mjs` 从实际解析的直接与传递依赖生成，见 `public/runtime-dependencies.json`。完整许可正文见 `public/licenses.txt`，应用“关于 → 第三方许可”读取同一份文件。发行版同时保留 `resources/notices/` 中的清单和许可。

- XMCL 系列（@xmcl/core、installer、unzip、task、file-transfer、asm、forge-site-parser）：MIT，来源 https://github.com/Voxelum/minecraft-launcher-core-node 。使用 npm 发布包，未复制其源文件到本项目实现。
- Undici：MIT；yazl：MIT；其余实际传递包及不同嵌套版本均列入生成清单，不能用直接依赖列表代替。
- pngjs：MIT，来源 https://github.com/pngjs/pngjs 。用于有大小限制的 Minecraft 皮肤 PNG 验证和重编码，完整许可已并入生成清单。
- Electron：MIT。随运行时保留根目录 `LICENSE.electron.txt` 和 `LICENSES.chromium.html`。后者包含 Chromium、Node.js、V8 及其组件的完整通知。Electron npm 下载器只用于构建，不在应用运行时依赖中。
- boolbase@1.0.0 npm 包缺少独立 LICENSE；按包内 ISC 声明，从 https://raw.githubusercontent.com/fb55/boolbase/master/LICENSE 保存上游正文至 `notices/boolbase-LICENSE`，生成许可时并入。作者 Felix Boehm。

生成清单可能包含上游生产依赖中的类型声明包；是否装入应用由 electron-builder 的生产依赖收集决定，许可清单保守覆盖这些依赖。

Minecraft、加载器和 Mod 不包含在启动器安装包内，由用户按需从官方或项目指定来源下载。其商标、游戏账户、软件与内容许可归各自权利人。启动器不提供 Minecraft 授权或游戏所有权。Modrinth/CurseForge 整合包导出优先保留下载链接与校验和；重新分发本地覆盖文件前应确认相应内容许可。

构建工具（TypeScript、Vite、Vitest、Playwright、electron-builder）保留 npm 安装目录中的原始许可，不作为应用运行时分发。开发依赖的准确解析版本见 package-lock.json。

PCL / MC百科中文名称快照与分类数据来源见 notices/pcl-content-data.txt；原始自定义权利指引全文原样保留于 notices/PCL-LICENCE，并并入应用第三方许可。快照无自动更新；不宣称其属于 MIT 许可。
