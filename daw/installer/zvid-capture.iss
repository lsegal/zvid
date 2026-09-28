; Windows installer for the zvid desktop app and the ZVID Capture plugin,
; compiled by `cargo xtask bundle --release --installer --app <exe>` with Inno
; Setup 6, which passes the defines below. It installs the app and its
; uninstaller into Program Files\ZVID with a Start menu shortcut, and the VST3
; bundle into the shared VST3 folder. The AppId is the plugin-only
; installer's, so installing over one upgrades it in place.

#ifndef AppVersion
  #error Build with `cargo xtask bundle --release --installer`
#endif

[Setup]
AppId={{F8AE68C0-F063-493A-9C2A-3EAC5D0D86CF}
AppName=ZVID
AppVersion={#AppVersion}
AppVerName=ZVID {#AppVersion}
AppPublisher=ZVID
AppPublisherURL=https://github.com/lsegal/zvid
VersionInfoVersion={#NumericVersion}
DefaultDirName={commonpf64}\ZVID
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
MinVersion=10.0
OutputDir={#OutputDir}
OutputBaseFilename={#OutputBaseFilename}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=ZVID
UninstallDisplayIcon={app}\{#AppExe}

[InstallDelete]
; Replace the whole bundle so files from an older layout don't linger.
Type: filesandordirs; Name: "{commoncf64}\VST3\ZVID Capture.vst3"

[Files]
Source: "{#SourceDir}\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\ZVID Capture.vst3\*"; DestDir: "{commoncf64}\VST3\ZVID Capture.vst3"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\ZVID"; Filename: "{app}\{#AppExe}"

[Run]
Filename: "{app}\{#AppExe}"; Description: "Launch ZVID"; Flags: nowait postinstall skipifsilent

[Messages]
FinishedLabel=Setup installed ZVID and the ZVID Capture plug-in. Rescan plug-ins in your host (in Live, Settings > Plug-Ins > Rescan) to load the plug-in.
