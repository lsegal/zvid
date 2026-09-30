; Windows installer for the ZVID Capture plugin, compiled by
; `cargo xtask bundle --release --installer` with Inno Setup 6, which passes
; the defines below. It installs the VST3 bundle into the shared VST3 folder
; and its uninstaller into Program Files\ZVID. With `--app <exe>` xtask also
; defines AppExe, and the installer then installs the zvid desktop app too,
; with a Start menu shortcut and the WebView2 Runtime it needs when missing
; (see [Code]). The AppId stays the same either way, so installing over an
; older installer upgrades it in place.

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
#ifdef AppExe
UninstallDisplayIcon={app}\{#AppExe}
#endif

[InstallDelete]
; Replace the whole bundle so files from an older layout don't linger.
Type: filesandordirs; Name: "{commoncf64}\VST3\ZVID Capture.vst3"

[Files]
#ifdef AppExe
Source: "{#SourceDir}\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
#endif
Source: "{#SourceDir}\ZVID Capture.vst3\*"; DestDir: "{commoncf64}\VST3\ZVID Capture.vst3"; Flags: ignoreversion recursesubdirs createallsubdirs

#ifdef AppExe
[Icons]
Name: "{autoprograms}\ZVID"; Filename: "{app}\{#AppExe}"

[Run]
Filename: "{app}\{#AppExe}"; Description: "Launch ZVID"; Flags: nowait postinstall skipifsilent

[Messages]
FinishedLabel=Setup installed ZVID and the ZVID Capture plug-in. Rescan plug-ins in your host (in Live, Settings > Plug-Ins > Rescan) to load the plug-in.
#else
[Messages]
FinishedLabel=Setup installed the ZVID Capture plug-in. Rescan plug-ins in your host (in Live, Settings > Plug-Ins > Rescan) to load it.
#endif

#ifdef AppExe
[Code]
// The desktop app is a Tauri app, which needs the Microsoft Edge WebView2
// Runtime. Windows 11 includes it; where it is missing, as on some Windows 10
// machines, setup downloads Microsoft's Evergreen bootstrapper after
// installing the files and runs it. If that fails, setup still finishes, since
// the plug-in doesn't need the runtime, and says where to get it.

const
  WebView2ClientKey = 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WebView2BootstrapperUrl = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703';
  WebView2DownloadPage = 'https://developer.microsoft.com/microsoft-edge/webview2/';

function HasWebView2Under(const RootKey: Integer): Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(RootKey, WebView2ClientKey, 'pv', Version)
    and (Version <> '') and (Version <> '0.0.0.0');
end;

// Microsoft's documented check: a per-machine runtime registers its version
// in the 32-bit view of HKLM, a per-user one in HKCU.
function WebView2Installed: Boolean;
begin
  Result := HasWebView2Under(HKLM32) or HasWebView2Under(HKCU);
end;

procedure InstallWebView2;
var
  ResultCode: Integer;
  Error: String;
begin
  Log('The WebView2 Runtime is missing; installing it');
  WizardForm.StatusLabel.Caption := 'Installing the Microsoft Edge WebView2 Runtime...';
  WizardForm.ProgressGauge.Style := npbstMarquee;
  try
    try
      DownloadTemporaryFile(WebView2BootstrapperUrl, 'MicrosoftEdgeWebview2Setup.exe', '', nil);
      if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '',
          SW_HIDE, ewWaitUntilTerminated, ResultCode) then
        Error := SysErrorMessage(ResultCode)
      else if not WebView2Installed then
        Error := Format('its installer exited with code %d', [ResultCode]);
    except
      Error := GetExceptionMessage;
    end;
  finally
    WizardForm.ProgressGauge.Style := npbstNormal;
  end;
  if Error = '' then
    Log('Installed the WebView2 Runtime')
  else begin
    Log('Installing the WebView2 Runtime failed: ' + Error);
    SuppressibleMsgBox('Setup could not install the Microsoft Edge WebView2 Runtime, which the ZVID app needs: '
      + Error + '.' + #13#10#13#10 + 'Download the Evergreen Bootstrapper from ' + WebView2DownloadPage
      + ' and run it, then start ZVID. The ZVID Capture plug-in works without it.',
      mbError, MB_OK, IDOK);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssPostInstall) and not WebView2Installed then
    InstallWebView2;
end;
#endif
