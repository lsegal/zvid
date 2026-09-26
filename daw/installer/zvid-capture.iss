; Windows installer for ZVID Capture, compiled by `cargo xtask bundle
; --release --installer` with Inno Setup 6, which passes the defines below.
; It installs the VST3 bundle into the shared VST3 folder and keeps its
; uninstaller in Program Files\ZVID Capture.

#ifndef AppVersion
  #error Build with `cargo xtask bundle --release --installer`
#endif

[Setup]
AppId={{F8AE68C0-F063-493A-9C2A-3EAC5D0D86CF}
AppName=ZVID Capture
AppVersion={#AppVersion}
AppVerName=ZVID Capture {#AppVersion}
AppPublisher=ZVID
AppPublisherURL=https://github.com/lsegal/zvid
VersionInfoVersion={#NumericVersion}
DefaultDirName={commonpf64}\ZVID Capture
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
UninstallDisplayName=ZVID Capture

[InstallDelete]
; Replace the whole bundle so files from an older layout don't linger.
Type: filesandordirs; Name: "{commoncf64}\VST3\ZVID Capture.vst3"

[Files]
Source: "{#SourceDir}\ZVID Capture.vst3\*"; DestDir: "{commoncf64}\VST3\ZVID Capture.vst3"; Flags: ignoreversion recursesubdirs createallsubdirs

[Messages]
FinishedLabelNoIcons=Setup installed ZVID Capture in the VST3 folder. Rescan plug-ins in your host (in Live, Settings > Plug-Ins > Rescan) to load it.
