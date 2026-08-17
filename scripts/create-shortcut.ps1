# Create/refresh the desktop shortcut "Isla.lnk" with the Isla icon.
# No Chinese literals on purpose: called from a .bat, keep it encoding-proof.
# (bat path is found by globbing instead of hardcoding the Chinese filename.)
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$bat = (Get-ChildItem $root -Filter '*.bat' | Select-Object -First 1).FullName
$ico = Join-Path $root 'output\isla-20260815-120437\export\assets\icon.ico'
if ($bat -and (Test-Path $ico)) {
  $lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Isla.lnk'
  $s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
  $s.TargetPath = $bat
  $s.WorkingDirectory = $root
  $s.IconLocation = $ico
  $s.Description = 'Isla desktop pet'
  $s.Save()
  Write-Output ('shortcut OK: ' + $lnk)
} else {
  Write-Output ('shortcut skipped: bat=' + [bool]$bat + ' ico=' + (Test-Path $ico))
}
