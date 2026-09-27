# Signs one file with Azure Artifact Signing.
#
# Tauri runs this through bundle.windows.signCommand (tauri.signing.conf.json, passed with
# --config by CI only) for the app exe, the NSIS installer and uninstaller, and the MSI, before
# it zips and minisigns the updater artifacts. CI's "Set up Azure Artifact Signing" step provides
# SIGNTOOL_PATH and ARTIFACT_SIGNING_DLIB; the Azure dlib signs in with AZURE_TENANT_ID,
# AZURE_CLIENT_ID and AZURE_CLIENT_SECRET from the environment.
#
# No $ErrorActionPreference = 'Stop' here: when Tauri pipes this script's output, Windows
# PowerShell turns any stderr line from signtool into a terminating error. signtool's exit code
# is the only verdict.
param([Parameter(Mandatory)][string]$File)

foreach ($name in 'SIGNTOOL_PATH', 'ARTIFACT_SIGNING_DLIB', 'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET') {
  if (-not [Environment]::GetEnvironmentVariable($name)) {
    [Console]::Error.WriteLine("sign.ps1: $name is not set. Windows signing only runs in CI, after its Azure Artifact Signing setup step.")
    exit 1
  }
}

$metadata = Join-Path $PSScriptRoot 'artifact-signing.json'
& $env:SIGNTOOL_PATH sign /v /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 `
  /d DebridDownloader /dlib $env:ARTIFACT_SIGNING_DLIB /dmdf $metadata $File
exit $LASTEXITCODE
