$ErrorActionPreference = 'Stop'

$results = [System.Collections.Generic.List[object]]::new()
$installDir = Join-Path ([System.IO.Path]::GetTempPath()) ("itstudio-install-smoke-{0}" -f [guid]::NewGuid().ToString('N'))
$dataDir = Join-Path ([System.IO.Path]::GetTempPath()) ("itstudio-install-smoke-data-{0}" -f [guid]::NewGuid().ToString('N'))
$installer = $null
$appProcess = $null
$sidecarProcess = $null
$originalEnvironment = @{
    Path = $env:Path
    NodePath = $env:NODE_PATH
    NodeOptions = $env:NODE_OPTIONS
    AppData = $env:APPDATA
    LocalAppData = $env:LOCALAPPDATA
    ItStudioDataDir = $env:ITSTUDIO_DATA_DIR
}

function Add-Result {
    param([string]$Check, [bool]$Passed, [string]$Details)
    $results.Add([pscustomobject]@{ Check = $Check; Result = $(if ($Passed) { 'PASS' } else { 'FAIL' }); Details = $Details })
}

function Test-WithinDirectory {
    param([string]$Path, [string]$Directory)
    $fullPath = [System.IO.Path]::GetFullPath($Path).TrimEnd('\') + '\'
    $fullDirectory = [System.IO.Path]::GetFullPath($Directory).TrimEnd('\') + '\'
    return $fullPath.StartsWith($fullDirectory, [System.StringComparison]::OrdinalIgnoreCase)
}

try {
    $bundleDir = Join-Path (Get-Location) 'apps/desktop/src-tauri/target/release/bundle/nsis'
    $installer = Get-ChildItem -LiteralPath $bundleDir -Filter '*.exe' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($null -eq $installer) { throw "No NSIS installer found in $bundleDir" }
    Add-Result 'Newest NSIS installer found' $true $installer.FullName

    $installArgs = @('/S', "/D=$installDir")
    $install = Start-Process -FilePath $installer.FullName -ArgumentList $installArgs -Wait -PassThru
    if ($install.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $installDir)) { throw "Silent install failed (exit $($install.ExitCode))" }
    Add-Result 'Silent install' $true $installDir

    $exe = Join-Path $installDir 'itstudio-desktop.exe'
    if (-not (Test-Path -LiteralPath $exe)) { throw "Installed app not found: $exe" }
    New-Item -ItemType Directory -Path $dataDir | Out-Null
    $env:Path = "$env:SystemRoot\System32;$env:SystemRoot"
    Remove-Item Env:NODE_PATH -ErrorAction SilentlyContinue
    Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
    $env:APPDATA = $dataDir
    $env:LOCALAPPDATA = $dataDir
    $env:ITSTUDIO_DATA_DIR = $dataDir
    $appProcess = Start-Process -FilePath $exe -WorkingDirectory $installDir -PassThru
    $env:Path = $originalEnvironment.Path
    if ($null -ne $originalEnvironment.NodePath) { $env:NODE_PATH = $originalEnvironment.NodePath }
    if ($null -ne $originalEnvironment.NodeOptions) { $env:NODE_OPTIONS = $originalEnvironment.NodeOptions }
    if ($null -ne $originalEnvironment.AppData) { $env:APPDATA = $originalEnvironment.AppData }
    if ($null -ne $originalEnvironment.LocalAppData) { $env:LOCALAPPDATA = $originalEnvironment.LocalAppData }
    if ($null -ne $originalEnvironment.ItStudioDataDir) { $env:ITSTUDIO_DATA_DIR = $originalEnvironment.ItStudioDataDir }
    else { Remove-Item Env:ITSTUDIO_DATA_DIR -ErrorAction SilentlyContinue }

    $deadline = (Get-Date).AddSeconds(30)
    $readyLog = $null
    do {
        $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
        $sidecarInfo = $processes | Where-Object { $_.Name -like 'itstudio-sidecar*.exe' -and $_.ExecutablePath -and (Test-WithinDirectory $_.ExecutablePath $installDir) } | Select-Object -First 1
        if ($null -ne $sidecarInfo) {
            $sidecarProcess = Get-Process -Id $sidecarInfo.ProcessId -ErrorAction SilentlyContinue
            $dataLogs = Join-Path $dataDir 'logs'
            $readyLog = Get-ChildItem -LiteralPath $dataLogs -Filter 'sidecar-*.log' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
            if ($null -ne $readyLog -and (Get-Content -LiteralPath $readyLog.FullName -Raw).Contains('sidecar ready')) { break }
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline -and -not $appProcess.HasExited)

    $bundledSidecar = $null -ne $sidecarInfo -and (Test-WithinDirectory $sidecarInfo.ExecutablePath $installDir) -and $sidecarInfo.Name -like 'itstudio-sidecar*.exe'
    Add-Result 'Bundled sidecar executable' $bundledSidecar $(if ($bundledSidecar) { $sidecarInfo.ExecutablePath } else { 'No bundled itstudio-sidecar*.exe process found' })
    $logReady = $null -ne $readyLog -and (Get-Content -LiteralPath $readyLog.FullName -Raw).Contains('sidecar ready')
    Add-Result 'Sidecar ready log within 30 seconds' $logReady $(if ($logReady) { $readyLog.FullName } else { 'No ready message in the newest sidecar log' })

    $modulesClean = $false
    $moduleDetails = 'Sidecar process not available'
    if ($null -ne $sidecarProcess) {
        try {
            $outsideModules = @($sidecarProcess.Modules | Where-Object { $_.FileName -match '[\\/]node_modules[\\/]' -and -not (Test-WithinDirectory $_.FileName $installDir) })
            $repoModules = @($sidecarProcess.Modules | Where-Object { (Test-WithinDirectory $_.FileName (Get-Location).Path) })
            $modulesClean = $outsideModules.Count -eq 0 -and $repoModules.Count -eq 0
            $moduleDetails = if ($modulesClean) { 'No repository or external node_modules module paths' } else { (($outsideModules + $repoModules | ForEach-Object { $_.FileName }) -join '; ') }
        } catch { $moduleDetails = "Could not inspect sidecar modules: $($_.Exception.Message)" }
    }
    Add-Result 'Sidecar modules are self-contained' $modulesClean $moduleDetails

    if ($null -ne $appProcess -and -not $appProcess.HasExited) { [void]$appProcess.CloseMainWindow() }
    $exitDeadline = (Get-Date).AddSeconds(5)
    do {
        $appProcess.Refresh()
        if ($null -ne $sidecarProcess) { $sidecarProcess.Refresh() }
        if ($appProcess.HasExited -and ($null -eq $sidecarProcess -or $sidecarProcess.HasExited)) { break }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $exitDeadline)
    $exited = $appProcess.HasExited -and ($null -eq $sidecarProcess -or $sidecarProcess.HasExited)
    Add-Result 'App and sidecar exit gracefully within 5 seconds' $exited 'CloseMainWindow followed by process exit check'

    $uninstaller = Join-Path $installDir 'uninstall.exe'
    if (Test-Path -LiteralPath $uninstaller) {
        $uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
        Start-Sleep -Milliseconds 250
        $removed = $uninstall.ExitCode -eq 0 -and -not (Test-Path -LiteralPath $installDir)
    } else { $removed = $false }
    Add-Result 'Silent uninstall removes install directory' $removed $installDir
} catch {
    Add-Result 'Smoke execution' $false $_.Exception.Message
} finally {
    $env:Path = $originalEnvironment.Path
    foreach ($key in @(@{ Name = 'NODE_PATH'; Value = $originalEnvironment.NodePath }, @{ Name = 'NODE_OPTIONS'; Value = $originalEnvironment.NodeOptions }, @{ Name = 'APPDATA'; Value = $originalEnvironment.AppData }, @{ Name = 'LOCALAPPDATA'; Value = $originalEnvironment.LocalAppData }, @{ Name = 'ITSTUDIO_DATA_DIR'; Value = $originalEnvironment.ItStudioDataDir })) {
        if ($null -eq $key.Value) { Remove-Item "Env:$($key.Name)" -ErrorAction SilentlyContinue } else { Set-Item "Env:$($key.Name)" $key.Value }
    }
}

$results | Format-Table -AutoSize
if (@($results | Where-Object Result -eq 'FAIL').Count -gt 0) { exit 1 }
