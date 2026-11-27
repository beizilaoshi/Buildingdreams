$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $root 'public/assets/moonlake.png'
$logoPath = Join-Path $root 'public/assets/logos/zhumeng-mengmiao.png'
$source = [System.Drawing.Image]::FromFile($sourcePath)
$logo = [System.Drawing.Bitmap]::new($logoPath)
$logo.MakeTransparent([System.Drawing.Color]::FromArgb(1, 1, 1))
function Draw-RoundedLogo($graphics, $image, $x, $y, $size) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $radius = [int]($size * 0.22)
  $path.AddArc($x, $y, $radius * 2, $radius * 2, 180, 90)
  $path.AddArc($x + $size - $radius * 2, $y, $radius * 2, $radius * 2, 270, 90)
  $path.AddArc($x + $size - $radius * 2, $y + $size - $radius * 2, $radius * 2, $radius * 2, 0, 90)
  $path.AddArc($x, $y + $size - $radius * 2, $radius * 2, $radius * 2, 90, 90)
  $path.CloseFigure()
  $graphics.SetClip($path, [System.Drawing.Drawing2D.CombineMode]::Intersect)
  $graphics.DrawImage($image, [System.Drawing.Rectangle]::new($x, $y, $size, $size))
  $graphics.ResetClip()
  $path.Dispose()
}

$installerAssets = Join-Path $root 'build/installer/assets'
New-Item -ItemType Directory -Force $installerAssets | Out-Null
$source = [System.Drawing.Image]::FromFile($sourcePath)
$logo = [System.Drawing.Bitmap]::new($logoPath)
$logo.MakeTransparent([System.Drawing.Color]::FromArgb(1, 1, 1))
$format = [System.Drawing.StringFormat]::new()
$format.Alignment = [System.Drawing.StringAlignment]::Center
$white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(248, 248, 252))
$softWhite = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(222, 226, 237, 255))
$darkFont = [System.Drawing.Font]::new('Microsoft YaHei UI', 32, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$smallFont = [System.Drawing.Font]::new('Microsoft YaHei UI', 22, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
try {
  foreach ($theme in @(@{Name='wizard-light'; Shade=72}, @{Name='wizard-dark'; Shade=142})) {
    $bitmap = [System.Drawing.Bitmap]::new(656, 1256, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $scale = [Math]::Max(656 / $source.Width, 1256 / $source.Height)
      $drawWidth = [int][Math]::Ceiling($source.Width * $scale)
      $drawHeight = [int][Math]::Ceiling($source.Height * $scale)
      $graphics.DrawImage($source, [int][Math]::Floor((656 - $drawWidth) / 2), [int][Math]::Floor((1256 - $drawHeight) / 2), $drawWidth, $drawHeight)
      $shade = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb($theme.Shade, 15, 27, 62))
      $graphics.FillRectangle($shade, 0, 0, 656, 1256)
      $shade.Dispose()
      Draw-RoundedLogo $graphics $logo 204 112 248
      $graphics.DrawString('筑梦启动器', $darkFont, $white, [System.Drawing.RectangleF]::new(32, 405, 592, 64), $format)
      $graphics.DrawString("让每一个世界`n从梦开始", $smallFont, $softWhite, [System.Drawing.RectangleF]::new(32, 490, 592, 84), $format)
      $graphics.DrawString('MINECRAFT  /  ZHUMENG', $smallFont, $softWhite, [System.Drawing.RectangleF]::new(24, 1160, 608, 40), $format)
      $bitmap.Save((Join-Path $installerAssets ($theme.Name + '.png')), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
  }

  $logoBitmap = [System.Drawing.Bitmap]::new(128, 128, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $logoGraphics = [System.Drawing.Graphics]::FromImage($logoBitmap)
  try { $logoGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias; Draw-RoundedLogo $logoGraphics $logo 0 0 128; $logoBitmap.Save((Join-Path $installerAssets 'wizard-logo.png'), [System.Drawing.Imaging.ImageFormat]::Png) }
  finally { $logoGraphics.Dispose(); $logoBitmap.Dispose() }

  foreach ($item in @(@{Name='uninstall-hero.png'; Head='你的游戏世界会留下'; Sub='账号、设置、实例和存档仍在本机'}, @{Name='banner-tools.png'; Head=''; Sub=''}, @{Name='banner-style.png'; Head=''; Sub=''})) {
    $width = 656; $height = 1256
    if ($item.Name.StartsWith('banner-')) { $width = 1920; $height = 360 }
    $bitmap = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $scale = [Math]::Max($width / $source.Width, $height / $source.Height)
      $drawWidth = [int][Math]::Ceiling($source.Width * $scale)
      $drawHeight = [int][Math]::Ceiling($source.Height * $scale)
      $graphics.DrawImage($source, [int][Math]::Floor(($width - $drawWidth) / 2), [int][Math]::Floor(($height - $drawHeight) / 2), $drawWidth, $drawHeight)
      $shade = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(96, 16, 31, 71))
      $graphics.FillRectangle($shade, 0, 0, $width, $height); $shade.Dispose()
      if ($item.Name -eq 'uninstall-hero.png') {
        Draw-RoundedLogo $graphics $logo 203 258 250
        $graphics.DrawString('筑梦启动器', $darkFont, $white, [System.Drawing.RectangleF]::new(24, 575, 608, 70), $format)
        $graphics.DrawString($item.Head + "`n" + $item.Sub, $smallFont, $softWhite, [System.Drawing.RectangleF]::new(28, 660, 600, 88), $format)
      } else {
        Draw-RoundedLogo $graphics $logo ($width - 316) 36 288
      }
      $bitmap.Save((Join-Path $installerAssets $item.Name), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
  }

  $browseFont = [System.Drawing.Font]::new('Microsoft YaHei UI', 48, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $browseFormat = [System.Drawing.StringFormat]::new()
  $browseFormat.Alignment = [System.Drawing.StringAlignment]::Center
  $browseFormat.LineAlignment = [System.Drawing.StringAlignment]::Center
  for ($state = 0; $state -lt 5; $state++) {
    $bitmap = [System.Drawing.Bitmap]::new(420, 144, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
      $path.AddArc(4, 4, 72, 72, 180, 90); $path.AddArc(344, 4, 72, 72, 270, 90); $path.AddArc(344, 68, 72, 72, 0, 90); $path.AddArc(4, 68, 72, 72, 90, 90); $path.CloseFigure()
      if ($state -eq 0) {
        $fill = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 247, 249, 255))
        $stroke = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(235, 183, 198, 255), 4)
        $textBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 49, 65, 101))
      } else {
        $fill = [System.Drawing.Drawing2D.LinearGradientBrush]::new([System.Drawing.Rectangle]::new(0, 0, 420, 144), [System.Drawing.Color]::FromArgb(255, 112 + ($state * 3), 139 + ($state * 2), 232), [System.Drawing.Color]::FromArgb(255, 157 + $state, 139 + ($state * 2), 232), [System.Drawing.Drawing2D.LinearGradientMode]::Horizontal)
        $stroke = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 216, 224, 255), 4)
        $textBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
      }
      $graphics.FillPath($fill, $path); $graphics.DrawPath($stroke, $path)
      $graphics.DrawString('浏览', $browseFont, $textBrush, [System.Drawing.RectangleF]::new(14, 12, 392, 120), $browseFormat)
      $bitmap.Save((Join-Path $installerAssets ('skin-browse-' + $state + '.png')), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose(); $path.Dispose(); $fill.Dispose(); $stroke.Dispose(); $textBrush.Dispose() }
  }
  $browseFormat.Dispose(); $browseFont.Dispose()

  $cardLabels = @(@('安装游戏', '选择版本与加载器'), @('管理实例', '模组、整合包与存档'), @('自定义外观', '背景、主题与启动动画'))
  for ($index = 0; $index -lt $cardLabels.Count; $index++) {
    foreach ($selected in @($false, $true)) {
      $bitmap = [System.Drawing.Bitmap]::new(540, 480, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
        $path.AddArc(6, 6, 80, 80, 180, 90); $path.AddArc(454, 6, 80, 80, 270, 90); $path.AddArc(454, 394, 80, 80, 0, 90); $path.AddArc(6, 394, 80, 80, 90, 90); $path.CloseFigure()
        $fill = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(250, 255, 255, 255))
        $stroke = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb($(if ($selected) { 150 } else { 220 }), 117, 140, 226), 4)
        $graphics.FillPath($fill, $path); $graphics.DrawPath($stroke, $path)
        $circle = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(232, 238, 255))
        $graphics.FillEllipse($circle, 221, 72, 98, 98)
        $numberFont = [System.Drawing.Font]::new('Segoe UI', 42, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $graphics.DrawString(('0' + ($index + 1)), $numberFont, [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(94, 113, 197)), [System.Drawing.RectangleF]::new(221, 83, 98, 64), $format)
        $labelFont = [System.Drawing.Font]::new('Microsoft YaHei UI', 42, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $detailFont = [System.Drawing.Font]::new('Microsoft YaHei UI', 29, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
        $ink = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(63, 78, 111))
        $muted = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(136, 147, 171))
        $graphics.DrawString($cardLabels[$index][0], $labelFont, $ink, [System.Drawing.RectangleF]::new(18, 238, 504, 62), $format)
        $graphics.DrawString($cardLabels[$index][1], $detailFont, $muted, [System.Drawing.RectangleF]::new(18, 314, 504, 50), $format)
        $suffix = if ($selected) { '-selected' } else { '' }
        $bitmap.Save((Join-Path $installerAssets ('skin-card-' + $index + $suffix + '.png')), [System.Drawing.Imaging.ImageFormat]::Png)
      } finally { $graphics.Dispose(); $bitmap.Dispose(); if ($path) { $path.Dispose() }; if ($fill) { $fill.Dispose() }; if ($stroke) { $stroke.Dispose() }; if ($circle) { $circle.Dispose() }; if ($numberFont) { $numberFont.Dispose() }; if ($labelFont) { $labelFont.Dispose() }; if ($detailFont) { $detailFont.Dispose() }; if ($ink) { $ink.Dispose() }; if ($muted) { $muted.Dispose() } }
    }
  }
} finally {
  $source.Dispose(); $logo.Dispose(); $format.Dispose(); $white.Dispose(); $softWhite.Dispose(); $darkFont.Dispose(); $smallFont.Dispose()
}

Write-Output "Generated Zhumeng installer artwork: $installerAssets"
