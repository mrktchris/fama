# Generates desktop/icon.ico (multi-res, for the exe/taskbar/window) and
# desktop/icon.png (256x256, for the tray) purely with .NET System.Drawing,
# no external tools or paid image-gen credits needed. Draws the Fama icon
# mark (bronze ring, verdigris waveform, oxide ground) so this matches
# viewer/icon-mark.svg, the same mark used for the app's own favicon.

Add-Type -AssemblyName System.Drawing

function New-IconMarkBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $s = $size / 64.0
  $oxide = [System.Drawing.Color]::FromArgb(255, 0x1a, 0x15, 0x10)
  $bronze = [System.Drawing.Color]::FromArgb(255, 0xb9, 0x85, 0x3f)
  $verdigris = [System.Drawing.Color]::FromArgb(255, 0x3f, 0xa8, 0x94)

  # oxide disc, fills the whole icon so it reads clearly on any Windows theme
  $g.FillEllipse((New-Object System.Drawing.SolidBrush($oxide)), 1 * $s, 0 * $s, 62 * $s, 60 * $s)

  # small wing ticks flanking the ring, and a bronze drop below, matching
  # the brand brief's Icon Mark reference image
  $wingPen = New-Object System.Drawing.Pen($bronze, [Math]::Max(1.2, 1.8 * $s))
  $wingPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $wingPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawLine($wingPen, (1 * $s), (26 * $s), (9 * $s), (25 * $s))
  $g.DrawLine($wingPen, (2 * $s), (31 * $s), (10 * $s), (31 * $s))
  $g.DrawLine($wingPen, (4 * $s), (36 * $s), (11 * $s), (34.5 * $s))
  $g.DrawLine($wingPen, (63 * $s), (26 * $s), (55 * $s), (25 * $s))
  $g.DrawLine($wingPen, (62 * $s), (31 * $s), (54 * $s), (31 * $s))
  $g.DrawLine($wingPen, (60 * $s), (36 * $s), (53 * $s), (34.5 * $s))

  # bronze ring, the artifact
  $ringPen = New-Object System.Drawing.Pen($bronze, [Math]::Max(1.5, 2.5 * $s))
  $g.DrawEllipse($ringPen, (11 * $s), (9 * $s), (42 * $s), (42 * $s))

  # verdigris waveform, the live signal, seven bars of varying height forming
  # a simple soundwave silhouette across the middle of the ring
  $barHeights = @(0, 5, 11, 18, 11, 5, 0)   # half-heights, mirrored above/below center
  $xs = @(15, 20, 25, 32, 39, 44, 49)
  $wavePen = New-Object System.Drawing.Pen($verdigris, [Math]::Max(1.4, 2.5 * $s))
  $wavePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $wavePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  for ($i = 0; $i -lt $xs.Count; $i++) {
    $x = $xs[$i] * $s
    $h = [Math]::Max(1, $barHeights[$i]) * $s
    $g.DrawLine($wavePen, $x, (30 * $s - $h), $x, (30 * $s + $h))
  }

  # bronze drop, the wax-seal-like anchor point below the ring
  $g.FillEllipse((New-Object System.Drawing.SolidBrush($bronze)), (29 * $s), (53 * $s), (6 * $s), (6 * $s))

  $g.Dispose()
  return $bmp
}

$outDir = $PSScriptRoot  # was hard-coded to one machine's path, broke for any contributor cloning elsewhere

# tray icon, flat PNG
$png256 = New-IconMarkBitmap 256
$png256.Save("$outDir\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)

# multi-res ICO, modern format embeds PNG-compressed frames directly
$sizes = @(16, 32, 48, 128, 256)
$pngBytesBySize = @{}
foreach ($sz in $sizes) {
  $bmp = New-IconMarkBitmap $sz
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
