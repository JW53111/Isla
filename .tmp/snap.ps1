param([string]$Out = 'D:\J\正事\idea\isla\create-pet-skill\.tmp\desktop.png')
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bmp.Save($Out)
$g.Dispose()
$bmp.Dispose()
Write-Output "SAVED $($b.Width)x$($b.Height)"
