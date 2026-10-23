<?php
// Generates placeholder app icons for Tauri: PNGs, icon.ico, icon.icns
// Run once: php gen-icons.php   (icons dir is created next to this script)

$iconsDir = __DIR__ . '/src-tauri/icons';
if (!is_dir($iconsDir)) {
    mkdir($iconsDir, 0777, true);
}

function makeIcon(int $size): GdImage {
    $im = imagecreatetruecolor($size, $size);
    imagealphablending($im, false);
    imagesavealpha($im, true);

    $transparent = imagecolorallocatealpha($im, 0, 0, 0, 127);
    imagefill($im, 0, 0, $transparent);

    // Rounded-ish blue background (filled ellipse approximation of squircle)
    $blue = imagecolorallocate($im, 74, 108, 247);
    $pad = (int)($size * 0.04);
    imagefilledellipse($im, (int)($size / 2), (int)($size / 2), (int)(($size - $pad * 2) * 1.15), (int)(($size - $pad * 2) * 1.15), $blue);
    imagefilledrectangle($im, $pad, (int)($size * 0.2), $size - $pad, (int)($size * 0.8), $blue);
    imagefilledrectangle($im, (int)($size * 0.2), $pad, (int)($size * 0.8), $size - $pad, $blue);

    // White crop frame corners
    $white = imagecolorallocate($im, 255, 255, 255);
    $t = max(2, (int)($size * 0.07));      // line thickness
    $m = (int)($size * 0.26);            // margin of crop frame
    $l = (int)($size * 0.16);            // corner arm length
    $r = $size - $m; $b = $size - $m;

    // top-left
    imagefilledrectangle($im, $m, $m, $m + $l, $m + $t, $white);
    imagefilledrectangle($im, $m, $m, $m + $t, $m + $l, $white);
    // top-right
    imagefilledrectangle($im, $r - $l, $m, $r, $m + $t, $white);
    imagefilledrectangle($im, $r - $t, $m, $r, $m + $l, $white);
    // bottom-left
    imagefilledrectangle($im, $m, $b - $t, $m + $l, $b, $white);
    imagefilledrectangle($im, $m, $b - $l, $m + $t, $b, $white);
    // bottom-right
    imagefilledrectangle($im, $r - $l, $b - $t, $r, $b, $white);
    imagefilledrectangle($im, $r - $t, $b - $l, $r, $b, $white);

    return $im;
}

function pngString(GdImage $im): string {
    ob_start();
    imagepng($im, null, 6);
    return ob_get_clean();
}

// --- source 1024 icon, resample for each size ---
$master = makeIcon(1024);

$pngs = ['32x32.png' => 32, '128x128.png' => 128, '128x128@2x.png' => 256];
foreach ($pngs as $name => $size) {
    $im = imagecreatetruecolor($size, $size);
    imagealphablending($im, false);
    imagesavealpha($im, true);
    imagecopyresampled($im, $master, 0, 0, 0, 0, $size, $size, 1024, 1024);
    file_put_contents("$iconsDir/$name", pngString($im));
    echo "wrote $name\n";
}

// --- icon.ico: PNG-compressed entries 16/32/48/256 ---
$icoSizes = [16, 32, 48, 256];
$entries = '';
$blobs = '';
$offset = 6 + 16 * count($icoSizes);
foreach ($icoSizes as $size) {
    $im = imagecreatetruecolor($size, $size);
    imagealphablending($im, false);
    imagesavealpha($im, true);
    imagecopyresampled($im, $master, 0, 0, 0, 0, $size, $size, 1024, 1024);
    $png = pngString($im);
    $w = $size === 256 ? 0 : $size;
    $h = $size === 256 ? 0 : $size;
    $entries .= pack('CCCCvvVV', $w, $h, 0, 0, 1, 32, strlen($png), $offset);
    $blobs .= $png;
    $offset += strlen($png);
}
$ico = pack('vvv', 0, 1, count($icoSizes)) . $entries . $blobs;
file_put_contents("$iconsDir/icon.ico", $ico);
echo "wrote icon.ico\n";

// --- icon.icns: PNG data in ic09 (512) + ic10 (1024) blocks ---
$blocks = '';
foreach (['ic09' => 512, 'ic10' => 1024] as $type => $size) {
    $im = imagecreatetruecolor($size, $size);
    imagealphablending($im, false);
    imagesavealpha($im, true);
    imagecopyresampled($im, $master, 0, 0, 0, 0, $size, $size, 1024, 1024);
    $png = pngString($im);
    $blocks .= $type . pack('N', 8 + strlen($png)) . $png;
}
file_put_contents("$iconsDir/icon.icns", 'icns' . pack('N', 8 + strlen($blocks)) . $blocks);
echo "wrote icon.icns\n";

echo "done\n";
