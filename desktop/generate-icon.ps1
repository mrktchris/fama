# Generates desktop/icon.ico (multi-res, for the exe/taskbar/window) and
# desktop/icon.png (256x256, for the tray) purely with .NET System.Drawing,
# no external tools or paid image-gen credits needed (no SVG rasterizer
# exists in this build environment, confirmed: no ImageMagick, no rsvg-convert,
# no Inkscape). Draws the exact geometry from the provided
# fama_claude_handoff/05_assets/fama-app-icon.svg (rounded-square deep-space
# background, four-facet crystal glyph, blue/iris/cyan gradient, soft glow),
# translated from its 1024-unit SVG coordinate space into System.Drawing
# calls (GraphicsPath polygons + LinearGradientBrush + a stacked-blur
# approximation for the glow, since System.Drawing has no native Gaussian
# blur filter).

Add-Type -AssemblyName System.Drawing

function New-IconMarkBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  # Source SVG is a 1024-unit grid; scale everything by size/1024 so the
  # geometry below is a direct copy of the real asset's coordinates, not a
  # reinterpretation at a different scale.
  $s = $size / 1024.0
  function P([double]$x, [double]$y) { return New-Object System.Drawing.PointF(($x * $s), ($y * $s)) }

  # --- background: rounded square, deep-space radial gradient (#1A2340 -> #080B12) ---
  $bgRectPx = 64 * $s
  $bgSizePx = 896 * $s
  $bgRadiusPx = [Math]::Max(2, 220 * $s)
  $bgPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $bgRadiusPx * 2
  $bgPath.AddArc($bgRectPx, $bgRectPx, $d, $d, 180, 90)
  $bgPath.AddArc($bgRectPx + $bgSizePx - $d, $bgRectPx, $d, $d, 270, 90)
  $bgPath.AddArc($bgRectPx + $bgSizePx - $d, $bgRectPx + $bgSizePx - $d, $d, $d, 0, 90)
  $bgPath.AddArc($bgRectPx, $bgRectPx + $bgSizePx - $d, $d, $d, 90, 90)
  $bgPath.CloseFigure()
  # PathGradientBrush gives a true radial gradient from a center point, matching
  # the SVG's radialGradient (center-out: lighter #1A2340 to dark #080B12 edge).
  $bgBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush($bgPath)
  $bgBrush.CenterColor = [System.Drawing.Color]::FromArgb(255, 0x1A, 0x23, 0x40)
  $bgBrush.SurroundColors = @([System.Drawing.Color]::FromArgb(255, 0x08, 0x0B, 0x12))
  $bgBrush.CenterPoint = (P 512 420)
  $g.FillPath($bgBrush, $bgPath)

  # --- crystal facet gradient (white -> aurora blue -> crystal iris -> aether cyan) ---
  $gradStart = P 310 236
  $gradEnd = P 706 800
  $facetBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($gradStart, $gradEnd, [System.Drawing.Color]::White, [System.Drawing.Color]::White)
  $blend = New-Object System.Drawing.Drawing2D.ColorBlend(4)
  $blend.Colors = @(
    [System.Drawing.Color]::FromArgb(255, 0xF4, 0xF7, 0xFB),
    [System.Drawing.Color]::FromArgb(255, 0x7C, 0x9D, 0xFF),
    [System.Drawing.Color]::FromArgb(255, 0x8B, 0x7C, 0xFF),
    [System.Drawing.Color]::FromArgb(255, 0x6E, 0xE7, 0xF2)
  )
  $blend.Positions = @(0.0, 0.35, 0.68, 1.0)
  $facetBrush.InterpolationColors = $blend

  # Soft glow behind the top facet: no native Gaussian blur in System.Drawing,
  # approximated by stacking the same shape several times at increasing size
  # and decreasing opacity, close enough at icon sizes.
  $topFacet = [System.Drawing.PointF[]]@((P 512 218), (P 714 340), (P 615 395), (P 512 331), (P 409 395), (P 310 340))
  for ($i = 6; $i -ge 1; $i--) {
    $growPx = $i * 6 * $s
    $grown = $topFacet | ForEach-Object { New-Object System.Drawing.PointF(($_.X), ($_.Y - $growPx * 0.15)) }
    $alpha = [int](10 + (6 - $i) * 3)
    $glowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($alpha, 0x7C, 0x9D, 0xFF))
    $g.FillPolygon($glowBrush, $grown)
    $glowBrush.Dispose()
  }

  # --- the four facets themselves ---
  $g.FillPolygon($facetBrush, $topFacet)
  $g.FillPolygon($facetBrush, [System.Drawing.PointF[]]@((P 310 340), (P 472 432), (P 472 786), (P 364 664)))
  $g.FillPolygon($facetBrush, [System.Drawing.PointF[]]@((P 714 340), (P 552 432), (P 552 786), (P 660 664)))
  $centerBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 0xF4, 0xF7, 0xFB))
  $g.FillPolygon($centerBrush, [System.Drawing.PointF[]]@((P 472 432), (P 512 456), (P 552 432), (P 552 786), (P 512 850), (P 472 786)))

  $facetBrush.Dispose(); $centerBrush.Dispose(); $bgBrush.Dispose(); $bgPath.Dispose()
  $g.Dispose()
  return $bmp
}

$outDir = $PSScriptRoot

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
