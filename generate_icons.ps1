Add-Type -AssemblyName System.Drawing

$srcPath = "C:\Users\Usuario\Desktop\icon.png"
if (-not (Test-Path $srcPath)) {
    Write-Error "Source icon not found: $srcPath"
    exit 1
}

$srcBmp = [System.Drawing.Bitmap]::FromFile($srcPath)
Write-Output "Loaded image $($srcBmp.Width)x$($srcBmp.Height)"

$resDir = "c:\Users\Usuario\Desktop\Steven\proyectos personales\reproductor\reproductor-android\android\app\src\main\res"

# Define densities and sizes
# Standard launcher icon sizes (dp: 48)
$launcherSizes = @{
    "mipmap-mdpi" = 48
    "mipmap-hdpi" = 72
    "mipmap-xhdpi" = 96
    "mipmap-xxhdpi" = 144
    "mipmap-xxxhdpi" = 192
}

# Adaptive foreground icon sizes (dp: 108)
$foregroundSizes = @{
    "mipmap-mdpi" = 108
    "mipmap-hdpi" = 162
    "mipmap-xhdpi" = 216
    "mipmap-xxhdpi" = 324
    "mipmap-xxxhdpi" = 432
}

function Resize-Image($src, $targetW, $targetH, $destPath) {
    $destBmp = New-Object System.Drawing.Bitmap($targetW, $targetH, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($destBmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $g.DrawImage($src, 0, 0, $targetW, $targetH)
    $g.Dispose()

    $destBmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $destBmp.Dispose()
}

function Create-Foreground-Image($src, $targetSize, $destPath) {
    # In adaptive icons, foreground is 108dp, inner safe area is 66dp or 72dp (~66% to 72% of canvas)
    $destBmp = New-Object System.Drawing.Bitmap($targetSize, $targetSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($destBmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $innerSize = [int]($targetSize * 0.72)
    $offset = [int](($targetSize - $innerSize) / 2)

    $g.DrawImage($src, $offset, $offset, $innerSize, $innerSize)
    $g.Dispose()

    $destBmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $destBmp.Dispose()
}

foreach ($folder in $launcherSizes.Keys) {
    $dir = Join-Path $resDir $folder
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $size = $launcherSizes[$folder]
    $launcherPath = Join-Path $dir "ic_launcher.png"
    $roundPath = Join-Path $dir "ic_launcher_round.png"

    Resize-Image $srcBmp $size $size $launcherPath
    Resize-Image $srcBmp $size $size $roundPath
    Write-Output "Generated $folder/ic_launcher.png ($size x $size)"
}

foreach ($folder in $foregroundSizes.Keys) {
    $dir = Join-Path $resDir $folder
    $size = $foregroundSizes[$folder]
    $fgPath = Join-Path $dir "ic_launcher_foreground.png"

    Create-Foreground-Image $srcBmp $size $fgPath
    Write-Output "Generated $folder/ic_launcher_foreground.png ($size x $size)"
}

$srcBmp.Dispose()
Write-Output "All icons generated successfully!"
