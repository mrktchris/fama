# Generates desktop/icon.ico (multi-res, for the exe/taskbar/window) and
# desktop/icon.png (256x256, for the tray) purely with .NET System.Drawing,
# no external tools or paid image-gen credits needed. Draws the same mascot
# shape used in viewer/index.html so the app icon actually matches the UI.

Add-Type -AssemblyName System.Drawing

function New-MascotBitmap([int]$size) {
  # Chirp's mascot: a small round bird, matching viewer/index.html's SVG so the
  # app icon and the in-app mascot are visibly the same character, not two
  # unrelated logos.
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $s = $size / 64.0
  $panel = [System.Drawing.Color]::FromArgb(255, 0x17, 0x17, 0x1b)
  $border = [System.Drawing.Color]::FromArgb(255, 0x35, 0x35, 0x3c)
  $accent = [System.Drawing.Color]::FromArgb(255, 0x7a, 0xa2, 0xff)
  $tool = [System.Drawing.Color]::FromArgb(255, 0xff, 0xb4, 0x54)
  $eyeColor = [System.Drawing.Color]::FromArgb(255, 0xed, 0xed, 0xf0)

  function Pt([double]$x, [double]$y) {
    return New-Object System.Drawing.PointF(($x * $s), ($y * $s))
  }

  # wing, drawn first so the body overlaps its base
  $wing = [System.Drawing.PointF[]]@((Pt 18 32), (Pt 6 36), (Pt 11 50), (Pt 21 47), (Pt 23 36))
  $g.FillPolygon((New-Object System.Drawing.SolidBrush($panel)), $wing)
  $g.DrawPolygon((New-Object System.Drawing.Pen($border, [Math]::Max(1, 1.5 * $s))), $wing)

  # body: a soft rounded blob approximated with a filled ellipse, simplest
  # reliable way to get this shape out of System.Drawing without a full bezier path
  $bodyRect = New-Object System.Drawing.RectangleF (10 * $s), (6 * $s), (44 * $s), (54 * $s)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush($panel)), $bodyRect)
  $g.DrawEllipse((New-Object System.Drawing.Pen($border, [Math]::Max(1, 2 * $s))), $bodyRect)

  # crest
  $crest = [System.Drawing.PointF[]]@((Pt 27 6), (Pt 22 -3), (Pt 33 1))
  $g.FillPolygon((New-Object System.Drawing.SolidBrush($accent)), $crest)

  # beak
  $beak = [System.Drawing.PointF[]]@((Pt 50 30), (Pt 61 34), (Pt 50 39))
  $g.FillPolygon((New-Object System.Drawing.SolidBrush($tool)), $beak)

  # eye
  $g.FillEllipse((New-Object System.Drawing.SolidBrush($eyeColor)), (34.8 * $s), (21.8 * $s), (8.4 * $s), (8.4 * $s))

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
