
## Minecraft version browser (Task 2)
Selectively adapted from the user-supplied, read-only `PCL-2.12.7.3.zip`, archive root `PCL-2.12.7.3/Plain Craft Launcher 2/`:
- `Pages/PageDownload/PageDownloadInstall.xaml.vb`, `LoadMinecraft`: release/snapshot/ancient/April-Fools categories, snapshot correction, explicit April-Fools IDs and UTC+2 April 1 rule, source release-date ordering, latest and expandable group presentation.
- `Modules/Minecraft/ModMinecraft.vb`, `GetMcFoolName`: identification reference (descriptive prose not copied).
- `Pages/PageDownload/ModDownloadLib.vb`, `McDownloadListItem`: four category icon mapping and version/date row.
- Only four small images copied: `Images/Blocks/{Grass,CommandBlock,CobbleStone,GoldBlock}.png` → `src/renderer/assets/pcl-blocks/`. These are PCL-distributed Minecraft block imagery; upstream Minecraft artwork belongs to Mojang/Microsoft, distinct from launcher code licensing.
The implementation retains official manifest IDs (including `20w14infinite`) for installation, instead of rewriting them for display, and exposes actual manifest `latest` IDs. Missing dates/latest metadata remain explicitly unknown. The original archive was not modified or fully extracted.

SHA-256 (archive bytes and copied asset bytes checked equal):

| File | SHA-256 |
| --- | --- |
| Grass.png | `f2a69811c4d596349b15643e7ae75870cfbc82cf5dc6d542c62de1f9792825ab` |
| CommandBlock.png | `3065e07b0777806c3f9b9460e9eb2b0539834122665fa6018d80cfc136db8e30` |
| CobbleStone.png | `718c6cca154325d7d53f45770a298f8c555114db40baffcb02ba3f1bdd080398` |
| GoldBlock.png | `4fc6dadce45d6a8564235c7651ae41ac5fd2d3edf24af880935358687356c5e8` |

## Mod and modpack browser (Task 3)

Selectively ported interaction rules from the same user-supplied read-only archive, without copying upstream credentials, binaries or branding:

- `Pages/PageDownload/Resource/PageResource.xaml(.vb)`: search facets, 40-result pages, retained search context; `Modules/Resource/ResourceSearcher.vb`, `SearchRequest.GetModrinthAddress` supplies actual Modrinth facet semantics. This task enables only the implemented Modrinth source, not fake CurseForge/combined results.
- `Modules/Resource/ResourceProject.vb`, `ToResourceItem` and `Controls/MyResourceItem.xaml.vb`, `MyResourceItem_Click`: real project identity/logo/author/summary/metrics and project drilldown instead of immediate installation.
- `Pages/PageDownload/Resource/PageDownloadCompDetail.xaml(.vb)` (class `PageDownloadResourceDetail`), `Load_OnFinish`, `GetGroupedVersionName`, `UpdateFilterResult`: identity/actions header, version-first screen, exact/minor/ancient filter reduction, Minecraft/loader groups, selected group pinned/open, independent expansion state.
- Same file `ResourceFilesCardPreload`, and `Controls/MyCard.vb`, `StackInstall` types 8/9: required dependency project rows above version files, nested Back, date-descending files, duplicate display-name disambiguation, Mod SaveAs versus named new-instance pack install and independent SaveAs. Ordinary settings remain visible cards.
- `Modules/Minecraft/ModMinecraft.vb`, `McVersion.NameToVersion` / `VersionToDrop`: numeric legacy 1.x and calendar 26.x ordering. Task 3 shares the comparator through `shared/minecraft-versions.ts`.

Implementation is independent TypeScript using existing TaskService/NetworkService install/dependency paths. Remote body remains bounded text data; no remote HTML is injected. Actual public API project/team schemas were checked against [project](https://docs.modrinth.com/api/operations/getproject/), [project versions](https://docs.modrinth.com/api/operations/getprojectversions/) and [team members](https://docs.modrinth.com/api/operations/getteammembers/) primary documentation. Public metadata/icon fixtures and capture attribution are in `tests/fixtures/content/README.md`; these fixtures are test-only. No measured wholesale reuse percentage or full PCL functionality parity is claimed.


## Resource packs, shaders and datapacks (Task4A)

Consulted the same read-only archive under `Plain Craft Launcher 2/` (only the following text sources were consulted):
- `Pages/PageDownload/Resource/PageDownloadResourcePack.xaml(.vb)`, `PageDownloadShader.xaml(.vb)`, `PageDownloadDataPack.xaml(.vb)`: distinct logical resource pages using shared `PageResource`, per-type names/tags, resourcepack style/core-shader tags, shader style/features and datapack world/game-mechanics categories.
- `Modules/Resource/ResourceSearcher.vb`, `SearchRequest.GetModrinthAddress` (lines 94–109): `project_type:<logical resource type>` search facet, separate Minecraft `versions` facet, loader/category facets only when applicable; 40-result shared search context. Only resource type and relevant Minecraft filters are enabled in this task; additional tag/Chinese search remains subsequent work.

Primary API documentation consulted: [search projects](https://docs.modrinth.com/api/operations/searchprojects/) and [list project versions](https://docs.modrinth.com/api/operations/getprojectversions/). Live production-service checks on 2026-11-04 verified Dark mode (`9wyd4FMB`, resourcepack/minecraft), Complementary Reimagined (`HVnmMxH1`, shader/iris+optifine) and Terralith (`8oi3bsk5`, direct project_type=mod but logical datapack with datapack-loader ZIP). Search accepts `project_type:datapack`; direct project metadata must remain faithful and version filtering uses `loaders=["datapack"]`. Fabric/Forge chips must not constrain ZIP resources. Captures and icon provenance are recorded in `tests/fixtures/content/README.md`.

The independently implemented resource installer resolves real game/world paths in main, verifies one selected ZIP, stages within the target filesystem, and exclusively publishes without replacing existing files. It does not extract archives, install shader environments, or claim dependency completion. Mod and pack installers remain separate. CurseForge, batch Mod import and full PCL parity remain open.

## PCL Chinese aliases and category search (Task4D)

Original source: the same user-supplied, read-only `PCL-2.12.7.3.zip`, root `PCL-2.12.7.3/Plain Craft Launcher 2/`. Consulted `Modules/Resource/WikiEntry.vb` (source-line MC百科 IDs, rank, CF/MR slug mapping, optional Chinese aliases and `*` suffix), `ResourceSearcher.vb` (`ChineseSearch`, alternate search terms and compatibility facets), `ResourceProject.vb` (`TranslatedName`, `WikiEntry`, Modrinth category badge mapping), and `Pages/PageDownload/Resource/PageDownload{Mod,Pack,DataPack,Shader,ResourcePack}.xaml` (exact category labels and `Tag="CFID/MRslug"` mappings).

Copied the **unmodified** `Resources/moddata.zip` to `public/data/pcl-moddata.zip` (394453 bytes; SHA-256 `12cd763062f0cc361f38db5f370e2725257a2a8d59f301a1fd1c5b59b63fb644`). Its only member, `moddata.txt`, is 791112 UTF-8 bytes: 25410 original source lines, 22109 entries, 11634 MR mappings and 8225 nonempty Chinese names. Empty source lines continue to count toward MC百科 IDs; multiple `¨` entries share that line ID. CF-only and MR-only mappings remain distinct. Raw aliases separated by `/`, English suffixes and source-derived `*` expansions are retained. Historical slug punctuation remains metadata; only candidates satisfying existing provider request-ID rules are sent to the API.

Main loads the packaged `dist/renderer/data/pcl-moddata.zip` via the guarded in-memory archive reader, verifies its SHA-256, limits compressed/uncompressed bytes (1 MiB), source lines (30000), entries (40000), individual lines (4096 characters), mapping text (256 characters) and numeric ranks (0–1000000). The parsed index is process-cached; recent display project lookups are capped at 128. Main still freshly validates upstream project/version metadata for installation. Missing, corrupt or unexpected snapshots visibly fall back to original-query search. No automatic database updates or machine-generated translations are used.

Chinese Mod/datapack queries rank exact aliases before partial/mixed matches, search at most eight mapped MR slugs through normal type/MC/loader/tag facets, accept only matching real slugs, deduplicate provider project IDs, and paginate the bounded candidate result set honestly. If no mapped hit matches, the original query is sent unchanged. Native Chinese pack names go directly to Modrinth; Mod dictionary names never decorate packs. The original upstream title, slug, IDs and file identities remain intact beside optional Chinese display metadata. The snapshot has historical coverage limits; users can continue with an English name.

Category IDs are canonical internal `mr-<slug>` / `cf-<ID>` values validated for the selected resource kind. Mod 科技 `412/technology` and pack 科技 `4472/technology` are distinct source mappings. Pack 空岛 `4736/` is visibly unavailable on Modrinth and rejected in main; pack 性能优化 `/optimization` remains MR-only. A selected tag adds a separate AND facet without replacing the query. Common/selected cards and a searchable, bounded “更多标签” dialog avoid an expanded tag wall. Badge translations follow `ResourceProject.vb`; unknown categories remain literal.

PCL / MC百科 attribution is preserved in `notices/pcl-content-data.txt`; the archive root `LICENCE` is copied byte-for-byte to `notices/PCL-LICENCE` (SHA-256 `0031dc3e32f22d926748ba4d65a856af5bb6508842d7dbbe0c2e2d7068317cf0`). This is the original author's custom rights guidance, not an inferred MIT/data license. The source database archive contains no separate notice. Both notices are included in generated app licenses and supplemental package notices. User-stated original-author selective-reuse permission is the selective-reuse authorization for this project; developer credit remains 杯艺宣.

Actual production-service public Modrinth query on 2026-11-04: `钠`, Mod + Minecraft `1.21.1` + Fabric + 性能优化 returned real Sodium `AANobbMI` / slug `sodium`, with Chinese display `钠 (Sodium)` and original title `Sodium`. The unmodified snapshot has 22109 entries; live metadata is separate and time-varying. No account credentials or installation/download completion are claimed by this metadata smoke.

## Java 自动选择与便携运行环境（Task6A）

继续参考用户授权、只读 `PCL-2.12.7.3.zip` 中 `Plain Craft Launcher 2/Modules/Minecraft/ModLaunch.vb` 的 `McLaunchJava`（1149–1276 行），及同目录 `ModJava.vb` 的 `JavaSelect`、`GetJavaDownloadLoader` / `JavaFileList`：最低/最高版本交集、Forge 8u320 更新限制、NeoForge beta 顺序、OptiFine/LiteLoader 限制、64 位优先与用户手动选择、失败/取消时清理未完成环境。只选择性读取两个文本文件，没有修改原始归档。

实现为独立 TypeScript 规则与公共解析器；不复制原 PCL 的下载服务、系统设置修改、品牌或凭据。相较源代码，显式手动选择不兼容时直接给出修正提示，不静默重置；空路径自动模式按实际版本重新选择，不把已选路径冻结到全局。26+ 与未知快照以实际 Mojang `javaVersion.majorVersion` 元数据为准，未知自定义版本明示未知而非虚构版本。Java 下载不代表余下 Task6 崩溃分析/生命周期功能完成。

官方供应方资料：
- [Adoptium OpenAPI](https://api.adoptium.net/q/openapi) 与 [API Swagger UI](https://api.adoptium.net/q/swagger-ui/)：`/v3/assets/latest/{feature_version}/hotspot`，`architecture=x64&image_type=jre&os=windows&vendor=eclipse`；JRE 空列表才回退同系列 JDK。实际 2026-11-04 响应证实 Java16 需 JDK 回退；8/17/21/25 有 JRE。元数据中 ZIP package 与 MSI installer 独立，应用只使用 ZIP package。
- [Eclipse Temurin 归档安装](https://adoptium.net/installation/archives/)：SHA-256 校验与便携归档、`java -version` 验证。运行环境 ZIP 的完整 legal/LICENSE 等文件原样保留。JVM 源码及发行许可归 Eclipse Adoptium/OpenJDK 与各自权利人；ZIP 不嵌入启动器 EXE。
- 仅允许 `api.adoptium.net`、`github.com/adoptium/temurin<major>-binaries/releases/download/` 及 GitHub 官方 release CDN 重定向。请求 major/OS/arch/vendor/HotSpot/image/filename/size/hash 均校验；SHA-256 + size 通过后才安全解压，之后实际版本/架构/build/映像验证与原子发布。库存记录每个文件 SHA-256，复用前再检查，旧或未通过校验的目录不覆盖。
- 下载在应用 userData/java 内；不用 MSI、脚本或系统范围 Java 安装，不修改 PATH/JAVA_HOME/注册表。Java7 与 Forge 要求的旧 8u320 自动源不提供时明确要求手动兼容环境，不把当前8误报兼容。

开发期间的独立实机检查（非 fixture，原始运行记录不随公开源码分发）覆盖官方17.0.21+9、43860024 bytes、SHA-256 `fe4656bd78fb09812dc38c49da777f79cc33e7ee435a254be82f9e7f40d9d117` 下载→安全解压→实际执行检查→原子发布→重启库存/生产解析器复用；`javaw.exe` 输入使用同安装目录 `java.exe` 并返回实际路径。另一次开发期间检查使用独立注册表、独立 gameDir、已有1.21.1实际资源的自动Java21选择和游戏初始化标记检查，只停止这次 LaunchService 返回的PID；不代表完整游戏游玩。UI fixture 测试对 fixture bytes 使用明确的测试 inspector，绝不执行 fixture 字节，与这些实机证据分开。

## Local Mod batch management (Task4C, 2026-11-05)

Read-only reference: original PCL-2.12.7.3.zip, `PCL-2.12.7.3/Plain Craft Launcher 2/Pages/PageInstance/PageInstanceMod.xaml.vb`: `BtnManageSelectAll_Click` (284), `BtnManageInstall_Click` (291), `CheckChanged` (362), `BtnSelectED_Click` (464), `BtnSelectUpdate_Click` (540), `BtnSelectDelete_Click` (678), `BtnSelectCancel_Click` (756), `SearchRun` (841). Selectively referenced selection, search, enable/disable, update and delete-confirmation behavior; no original archive mutation/repackaging or original service endpoints/branding copied.

Independent TypeScript implementation preserves filename + SHA1 identity and the existing main instance lock, directory snapshot/stage/rollback and provenance engine. Each selected item publishes a separate transaction, retaining independent successes and listing individual failures. Updates reuse the existing required-dependency install transaction, calling the unlocked internal installer while holding the instance lock to avoid self-deadlock. TaskService terminal status precedes retrieving per-file results; partial failure fails the tracked task, cancellation skips unpublished/pending items.

Metadata reads only `fabric.mod.json`, `quilt.mod.json`, `META-INF/mods.toml`, `META-INF/neoforge.mods.toml`, without extraction or execution. Limits: 20000 archive entries and 128 KiB metadata; ZIP path/symlink/total-size guards reused. TOML supports only single-line, unescaped quoted literal `displayName` / `version` fields in the first `[[mods]]` table. This is deliberately a conservative subset, with no interpolation, multiline-string or general escaping support. Malformed/unsupported data produces per-file warnings. Metadata names are not automatic translations; loader labels indicate metadata format, not universal Minecraft compatibility. Provenance accepts only known IDs with matching actual SHA1; it cannot override identity/enabled state or inject display metadata.

Native multi-picker creates a one-use ten-minute selection capability. Renderer receives chosen names and opaque ID; the new batch import command accepts no arbitrary paths. Each batch is bounded to 200 items, with unknown fields and case aliases rejected. Historical single-file import remains compatible. Task4B repeated-edge boundary minor is corrected: existing projects can repeat at 256, cycles and a real 257th project remain rejected, with actual transaction tests.

Task4C fix1 review correction: TOML multiline and unterminated strings now fail closed before field extraction; single-line field delimiters must match. This can leave otherwise valid multiline-description metadata unknown, which is preferable to inventing a field from description content. Retry attempts use their real TaskService execution IDs. Original reports remain immutable; a retry only applies unfinished items against the original reviewed hashes. Already published items are represented as `skipped` with `reason: previously-completed`, a benign outcome distinct from failed/cancelled unpublished work. A retry parent completes only when every unfinished target actually completes; ordinary failures and cancellation retain failed/cancelled status and their own reports. Attempts from the same batch are serialized without changing generic TaskService retry behavior.

## Account interaction (2026-11-11)
Selectively adapted interaction rules from the read-only user-provided PCL-2.12.7.3 archive: Modules/Minecraft/ModLaunch.vb MsLoginStep1New and Pages/PageLaunch/MyMsgLogin.xaml.vb Init/WorkThread. Explicit login opens a dedicated device-code dialog, automatically copies the user code and opens the official Microsoft verification page, offers manual retry/copy/reopen/cancel and polls for completion. Existing independent encrypted AccountService performs the Microsoft/Xbox/Minecraft authorization and refresh chain; upstream OAuth application identity, credentials, account data and branding were not copied. A valid launcher-owned application registration remains required. No live authorization is claimed by controlled tests. Offline rename is independently implemented using vanilla OfflinePlayer name-derived UUID, while retaining the launcher's stable account record ID and multiple-account management.
## Home identity modes (2026-11-11)
Read-only reference from the same user archive: Pages/PageLaunch/PageLaunchLeft.xaml.vb persisted LoginType and separate Legacy/Ms identity panes, PageLoginLegacy.xaml.vb saved local identities, PageLoginMs.xaml.vb Microsoft entry. Adapted visible offline/Microsoft mode selection and matching saved identity presentation into the existing scenic home. Independent per-kind multiaccount memory and shared renderer selection helpers preserve current launcher architecture; no upstream account data/client identity copied.
