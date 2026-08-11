# Builds the runtime PNG, Windows ICO frames, and small viewer brand asset
# from the approved ImageGen identity source. The source stays in docs/assets
# so portable packages contain only the optimized runtime derivatives.

Add-Type -AssemblyName System.Drawing

$sourcePath = Join-Path $PSScriptRoot '..\docs\assets\fama-signal-aperture-source.png'
if (-not (Test-Path -LiteralPath $sourcePath)) {
  throw "Missing identity source: $sourcePath"
}

$source = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $sourcePath))

function New-IconBitmap([int]$size) {
  $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.DrawImage($source, 0, 0, $size, $size)
  $graphics.Dispose()
  return $bitmap
}

$outDir = $PSScriptRoot
$viewerDir = Join-Path $PSScriptRoot '..\viewer'

$png256 = New-IconBitmap 256
$png256.Save((Join-Path $outDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$png256.Dispose()

$viewerMark = New-IconBitmap 320
$viewerMark.Save((Join-Path $viewerDir 'identity-signal.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$viewerMark.Dispose()

# Modern ICO files can embed PNG-compressed frames directly.
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$pngBytesBySize = @{}
foreach ($size in $sizes) {
  $bitmap = New-IconBitmap $size
  $memory = New-Object System.IO.MemoryStream
  $bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngBytesBySize[$size] = $memory.ToArray()
  $bitmap.Dispose()
  $memory.Dispose()
}

$icoPath = Join-Path $outDir 'icon.ico'
$stream = [System.IO.File]::Create($icoPath)
$writer = New-Object System.IO.BinaryWriter($stream)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]$sizes.Count)

$dataOffset = 6 + (16 * $sizes.Count)
$offsets = @()
foreach ($size in $sizes) {
  $offsets += $dataOffset
  $dataOffset += $pngBytesBySize[$size].Length
}

for ($index = 0; $index -lt $sizes.Count; $index++) {
  $size = $sizes[$index]
  $dimension = if ($size -ge 256) { 0 } else { $size }
  $writer.Write([Byte]$dimension)
  $writer.Write([Byte]$dimension)
  $writer.Write([Byte]0)
  $writer.Write([Byte]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]$pngBytesBySize[$size].Length)
  $writer.Write([UInt32]$offsets[$index])
}
foreach ($size in $sizes) { $writer.Write($pngBytesBySize[$size]) }

$writer.Flush()
$writer.Close()
$stream.Close()
$source.Dispose()

"Generated identity assets from $sourcePath"
Get-ChildItem (Join-Path $outDir 'icon.*'), (Join-Path $viewerDir 'identity-signal.png') | Select-Object Name, Length
