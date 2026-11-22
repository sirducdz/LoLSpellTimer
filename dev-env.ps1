$ErrorActionPreference = "Stop"

$env:RUSTUP_HOME = "D:\DevTools\rustup"
$env:CARGO_HOME = "D:\DevTools\cargo"
$env:npm_config_cache = "D:\DevTools\npm-cache"
$env:TEMP = "D:\DevTools\temp"
$env:TMP = "D:\DevTools\temp"
$env:CARGO_TARGET_DIR = "D:\LoLQuickHub\src-tauri\target"

$setupBat = "D:\DevTools\msvc\setup_x64.bat"
if (Test-Path $setupBat) {
    $envLines = cmd /c "`"$setupBat`" >nul 2>&1 && set"
    foreach ($line in $envLines) {
        if ($line -match "^([^=]+)=(.*)$") {
            $name = $matches[1]
            $val = $matches[2]
            if ($name -in @("PATH", "Path", "INCLUDE", "LIB", "LIBPATH", "VCINSTALLDIR", "VSCMD_ARG_TGT_ARCH", "WindowsSdkDir", "WindowsSDKVersion")) {
                [Environment]::SetEnvironmentVariable($name, $val, "Process")
            }
        }
    }
}

$cargoBin = "D:\DevTools\cargo\bin"
if ($env:PATH -notlike "*$cargoBin*") {
    $env:PATH = "$cargoBin;$env:PATH"
}
