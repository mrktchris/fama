#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
source_png="$repo_root/docs/assets/fama-signal-aperture-source.png"
iconset_dir="$repo_root/desktop/icon.iconset"
output_icns="$repo_root/desktop/icon.icns"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[generate-mac-icon] iconutil and sips require macOS." >&2
  exit 1
fi

rm -rf "$iconset_dir"
mkdir -p "$iconset_dir"

for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$source_png" --out "$iconset_dir/icon_${size}x${size}.png" >/dev/null
  double_size=$((size * 2))
  sips -z "$double_size" "$double_size" "$source_png" --out "$iconset_dir/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns "$iconset_dir" -o "$output_icns"
rm -rf "$iconset_dir"
echo "[generate-mac-icon] wrote $output_icns"
