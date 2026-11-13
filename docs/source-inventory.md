# 来源与文件清单

本项目采用新的 Electron / TypeScript 架构。导入游戏的数据目录兼容规则参考 PCL 2.12.7.3 的 PathIndie 与 PCL/Setup.ini 设置语义（VersionArgumentIndieV2 与旧值 1/2），在 instances.ts 中以 TypeScript 实现；这是少量兼容规则参考，未整份搬运上游项目、VB 实现、品牌或二进制。细节见 [兼容规则参考](source-references.md)。未测算代码复用百分比。原始压缩包与原美术目录未修改。

自有实现：src/main 的 Electron 窗口/IPC/路由，src/main/services 的设置、实例、Java、启动、下载、安装、加载器、账户、Mod 与整合包服务；src/shared 的类型/验证；src/renderer 的八个页面、UI、样式与开场动画。测试位于 tests，发行与验收脚本位于 scripts。

直接与全部解析传递依赖（含嵌套不同版本）及仓库/许可字段以 public/runtime-dependencies.json 为准确清单，具体项数随锁定依赖变化；完整正文为 public/licenses.txt。Electron/Chromium/Node/V8 自带组件以发行根目录 LICENSE.electron.txt 和 LICENSES.chromium.html 为准。构建工具与依赖锁定版本见 package-lock.json。MIT XMCL 与 pngjs 作为独立 npm 依赖使用，无上游实现代码复制。首页头像参考的 PCL 路径和方法见 source-references.md。

下列美术来自用户许可的既有素材，逐个 SHA256 用于核对复制结果。原始来源与文件角色见 [美术来源](../ASSET-SOURCES.md)。当前 build/icon.ico 从生成的 public/assets/logos/zhumeng-generated.png 缩放生成，脚本为 scripts/make-icon.cjs。

| 文件 | SHA256 |
| --- | --- |
| public/assets/aurora.png | f26ec473f1ceca66bd63215cbbdc561e181a2c5005f4bc6247fc3944cc41a8eb |
| public/assets/bloom-dark.png | 332bfaec0b77d6e1c911770272114e2bc3e1088aba94921facf369396c223c2e |
| public/assets/bloom-light.png | fa4ef7d4b6bdda8689c2d6266cac8bf35149539df3f053db9a7bedaf2aee9a7c |
| public/assets/dunes.png | e14317d19a8358daa2aa701b2b7405864fff4f09b0a65943b70b2596727e4903 |
| public/assets/garden.png | d18a39cad43f0b8d58c696ed1fa828a5353c24d0b7e29e2fe3cef3b14cbde3fa |
| public/assets/logos/academy.svg | 786e782213ec254de2cb57f0152cea309a932e430d320c6d4bc40af166c01ebf |
| public/assets/logos/liquid.svg | c347cec29c481c7408f765b2583a1096d97b0ba55e0ec93f9a7221a52ce42802 |
| public/assets/logos/lunar.svg | f60a28ec7e2fcf03f3d3887e30105e190f4cbd67b32922d8ee289b86d9e00ffa |
| public/assets/moonlake.png | afec2d829f0953a192e7d528e26c8cfdfc1eefa1f8b845642bd77d3b84f83f3b |
| public/assets/opening-liquid.png | a97c4e7a301525cdc7ba3cd3c774de81396c818dda6b34bc4919939b244a5e1d |
| public/assets/opening-lunar.png | fb5e6241f1a7bc4149be8d066d24ab9db4c3dda905eaea10c18960333499a4bd |
