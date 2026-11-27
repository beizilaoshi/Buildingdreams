; Branded offline installer and uninstaller for Zhumeng Launcher.
#ifndef AppVersion
  #error AppVersion must be supplied by scripts/build-installer.mjs
#endif
#ifndef AppVersionInfo
  #define AppVersionInfo "0.0.1.0"
#endif
#ifndef PayloadRoot
  #define PayloadRoot "..\..\validation\installer-build\win-unpacked"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\validation\installer-preview"
#endif
#define Product "筑梦启动器"
#define Exe "筑梦启动器.exe"

[Setup]
AppId={{E418C5CA-B46A-4EF7-A2AD-817F0E5E613A}
AppName={#Product}
AppVersion={#AppVersion}
AppVerName={#Product} {#AppVersion}
AppPublisher=杯艺宣
AppPublisherURL=https://github.com/beizilaoshi/Buildingdreams
VersionInfoVersion={#AppVersionInfo}
VersionInfoDescription=筑梦启动器安装程序
VersionInfoProductName={#Product}
VersionInfoProductVersion={#AppVersionInfo}
DefaultDirName={localappdata}\Programs\筑梦启动器
DefaultGroupName=筑梦启动器
DisableProgramGroupPage=yes
DisableDirPage=no
DisableWelcomePage=no
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
OutputDir={#OutputDir}
OutputBaseFilename=Buildingdreams-{#AppVersion}-x64-nsis
SetupIconFile=..\icon.ico
UninstallDisplayIcon={app}\{#Exe}
UninstallDisplayName={#Product}
Compression=lzma2/normal
SolidCompression=yes
LZMANumBlockThreads=2
WizardStyle=modern light windows11 excludelightcontrols hidebevels includetitlebar
WizardSizePercent=150,140
WizardImageFile=assets\wizard-light.png
WizardImageFileDynamicDark=assets\wizard-dark.png
WizardSmallImageFile=assets\wizard-logo.png
WizardImageStretch=yes
DisableReadyPage=no
CloseApplications=yes
RestartApplications=no
AllowCancelDuringInstall=yes
SetupLogging=yes
ShowLanguageDialog=no
UsePreviousAppDir=yes
UsePreviousTasks=yes
Uninstallable=yes

[Languages]
Name: "zhcn"; MessagesFile: "vendor\ChineseSimplified.isl"

[LangOptions]
DialogFontName=Microsoft YaHei UI
WelcomeFontName=Microsoft YaHei UI

[Messages]
WelcomeLabel1=让每一个世界，从梦开始。
WelcomeLabel2=欢迎使用筑梦启动器。%n%n为你的 Minecraft 世界管理版本、Mod、整合包与存档。%n%n安装程序离线运行，不会清空已有账号、设置或游戏数据。%n%n筑梦启动器 {#AppVersion} · Windows 10 / 11
WizardSelectDir=选择安装位置
SelectDirDesc=程序和你的游戏世界各自安放。
SelectDirLabel3=选择启动器程序的安装文件夹。账号、设置、游戏实例和存档保存在独立数据目录。
WizardSelectTasks=选择快捷入口
SelectTasksDesc=常用入口，由你决定。
SelectTasksLabel2=选择是否创建开始菜单和桌面快捷方式。不会添加开机自启。
WizardReady=一切就绪，准备启程
ReadyLabel1=确认安装位置和快捷方式，点击“开始安装”即可。
ButtonInstall=开始安装(&I)
WizardInstalling=正在准备筑梦启动器
InstallingLabel=正在安装应用文件，请稍候。
FinishedHeadingLabel=筑梦启动器已准备就绪。
FinishedLabel=安装完成。你的账号、设置、实例和存档会保留在独立数据目录。%n%n安装器不会添加开机自启；首次启动后可在设置中调整 Java、游戏目录和外观。
ConfirmUninstall=要卸载 %1 吗？%n%n卸载只移除启动器程序和快捷方式。账号、设置、游戏实例与存档会保留。
BeveledLabel=筑梦启动器  /  {#AppVersion}
UninstallStatusLabel=正在移除程序文件，你的账号、游戏与存档会保留。

[Tasks]
Name: "startmenu"; Description: "在开始菜单中添加筑梦启动器"; GroupDescription: "快捷方式"
Name: "desktopicon"; Description: "在桌面创建筑梦启动器快捷方式"; GroupDescription: "快捷方式"; Flags: unchecked

[Files]
Source: "assets\feature-*.png"; Flags: dontcopy
Source: "assets\banner-*.png"; Flags: dontcopy
Source: "assets\skin-*.png"; DestDir: "{app}\setup-art"; Flags: ignoreversion
Source: "assets\uninstall-hero.png"; DestDir: "{app}\setup-art"; Flags: ignoreversion
Source: "{#PayloadRoot}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\筑梦启动器\筑梦启动器"; Filename: "{app}\{#Exe}"; WorkingDir: "{app}"; Tasks: startmenu
Name: "{userprograms}\筑梦启动器\卸载筑梦启动器"; Filename: "{uninstallexe}"; Tasks: startmenu
Name: "{autodesktop}\筑梦启动器"; Filename: "{app}\{#Exe}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#Exe}"; Description: "现在启动筑梦启动器"; Flags: nowait postinstall skipifsilent unchecked

[Code]
#include "experience.iss"
