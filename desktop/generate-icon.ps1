# Generates desktop/icon.ico (multi-res, for the exe/taskbar/window) and
# desktop/icon.png (256x256, for the tray) purely with .NET System.Drawing,
# no external tools or paid image-gen credits needed. Draws the same mascot
# shape used in viewer/index.html so the app icon actually matches the UI.

Add-Type -AssemblyName System.Drawing

function New-MascotBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $s = $size / 64.0
  $panel = [System.Drawing.Color]::FromArgb(255, 0x17, 0x17, 0x1b)
  $border = [System.Drawing.Color]::FromArgb(255, 0x35, 0x35, 0x3c)
  $accent = [System.Drawing.Color]::FromArgb(255, 0x7a, 0xa2, 0xff)
  $eyeColor = [System.Drawing.Color]::FromArgb(255, 0xed, 0xed, 0xf0)

  # rounded body
  $bodyRect = New-Object System.Drawing.RectangleF (8 * $s), (10 * $s), (48 * $s), (44 * $s)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $r = 12 * $s
  $path.AddArc($bodyRect.X, $bodyRect.Y, $r * 2, $r * 2, 180, 90)
  $path.AddArc($bodyRect.Right - $r * 2, $bodyRect.Y, $r * 2, $r * 2, 270, 90)
  $path.AddArc($bodyRect.Right - $r * 2, $bodyRect.Bottom - $r * 2, $r * 2, $r * 2, 0, 90)
  $path.AddArc($bodyRect.X, $bodyRect.Bottom - $r * 2, $r * 2, $r * 2, 90, 90)
  $path.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush($panel)), $path)
  $g.DrawPath((New-Object System.Drawing.Pen($border, [Math]::Max(1, 2 * $s))), $path)

  # eyes
  $eyeBrush = New-Object System.Drawing.SolidBrush($eyeColor)
  $g.FillRectangle($eyeBrush, (20 * $s), (26 * $s), (8 * $s), (10 * $s))
  $g.FillRectangle($eyeBrush, (36 * $s), (26 * $s), (8 * $s), (10 * $s))

  # mouth
  $g.FillRectangle((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 0x8a, 0x8a, 0x92))), (24 * $s), (42 * $s), (16 * $s), (4 * $s))

  # antenna
  $pen = New-Object System.Drawing.Pen($border, [Math]::Max(1, 2 * $s))
  $g.DrawLine($pen, (32 * $s), (7 * $s), (32 * $s), (12 * $s))
  $g.FillEllipse((New-Object System.Drawing.SolidBrush($accent)), (29 * $s), (1 * $s), (6 * $s), (6 * $s))

  $g.Dispose()
  return $bmp
}

$outDir = "C:\Users\User\Documents\Claude\Projects\claude-narrator\desktop"

# tray icon, flat PNG
$png256 = New-MascotBitmap 256
$png256.Save("$outDir\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)

# multi-res ICO, modern format embeds PNG-compressed frames directly
$sizes = @(16, 32, 48, 128, 256)
$pngBytesBySize = @{}
foreach ($sz in $sizes) {
  $bmp = New-MascotBitmap $sz
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngBytesBySize[$sz] = $ms.ToArray()
  $bmp.Dispose()
  $ms.Dispose()
}

$icoPath = "$outDir\icon.ico"
$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)

# ICONDIR header
$bw.Write([UInt16]0)      # reserved
$bw.Write([UInt16]1)      # type = icon
$bw.Write([UInt16]$sizes.Count)

$dataOffset = 6 + (16 * $sizes.Count)
$offsets = @()
foreach ($sz in $sizes) { $offsets += $dataOffset; $dataOffset += $pngBytesBySize[$sz].Length }

for ($i = 0; $i -lt $sizes.Count; $i++) {
  $sz = $sizes[$i]
  $wByte = if ($sz -ge 256) { 0 } else { $sz }
  $bw.Write([Byte]$wByte)   # width, 0 means 256
  $bw.Write([Byte]$wByte)   # height
  $bw.Write([Byte]0)        # color palette
  $bw.Write([Byte]0)        # reserved
  $bw.Write([UInt16]1)      # color planes
  $bw.Write([UInt16]32)     # bits per pixel
  $bw.Write([UInt32]$pngBytesBySize[$sz].Length)
  $bw.Write([UInt32]$offsets[$i])
}
foreach ($sz in $sizes) { $bw.Write($pngBytesBySize[$sz]) }

$bw.Flush(); $bw.Close(); $fs.Close()

"icon.ico and icon.png written to $outDir"
Get-ChildItem "$outDir\icon.*" | Select-Object Name, Length
