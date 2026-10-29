#!/bin/bash
# Generate app icons from the Octopus Shield brand marks in docs/brand/logos/
# Produces: resources/build/icon.icns, resources/build/icon.png, resources/build/icon.ico,
#           resources/icon.png, resources/icon-dev.png, resources/tray/shield-menu-barTemplate*.png
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
LOGOS_DIR="$PROJECT_DIR/docs/brand/logos"
BUILD_DIR="$PROJECT_DIR/resources/build"
RESOURCES_DIR="$PROJECT_DIR/resources"
TRAY_DIR="$RESOURCES_DIR/tray"
TMP_DIR=$(mktemp -d)

trap 'rm -rf "$TMP_DIR"' EXIT

MAGICK_BIN=$(command -v magick || true)
if [ -z "$MAGICK_BIN" ]; then
  echo "Error: ImageMagick is required to rasterize the brand SVGs." >&2
  echo "Install with: brew install imagemagick" >&2
  exit 1
fi

echo "Rasterizing brand marks from $LOGOS_DIR..."

# Packaged bundle master: mark-color (dark-tuned plate, glow, suckers).
"$MAGICK_BIN" -background none "$LOGOS_DIR/mark-color.svg" -resize 1024x1024 "$BUILD_DIR/icon.png"
echo "  -> resources/build/icon.png (1024x1024)"

# macOS/Linux bundle icon tiers: chromatic favicon silhouette, legible on light and dark.
ICONSET_DIR="$TMP_DIR/icon.iconset"
mkdir -p "$ICONSET_DIR"
render_favicon() { # <size> <iconset-name>
  "$MAGICK_BIN" -background none "$LOGOS_DIR/favicon.svg" -resize "${1}x${1}" "$ICONSET_DIR/$2"
}
render_favicon 16 icon_16x16.png
render_favicon 32 icon_16x16@2x.png
render_favicon 32 icon_32x32.png
render_favicon 64 icon_32x32@2x.png
render_favicon 128 icon_128x128.png
render_favicon 256 icon_256x256.png
render_favicon 256 icon_256x256@2x.png
render_favicon 512 icon_512x512.png
if command -v iconutil >/dev/null 2>&1; then
  iconutil -c icns "$ICONSET_DIR" -o "$BUILD_DIR/icon.icns"
  echo "  -> resources/build/icon.icns"
else
  echo "Warn: iconutil not found; skipped resources/build/icon.icns" >&2
fi

# Dev runtime icon: same favicon geometry tinted Ganglion Violet (existing token, no new palette).
"$MAGICK_BIN" "$BUILD_DIR/icon.png" -resize 256x256 -channel RGB -fill '#8250df' -colorize 100 "$RESOURCES_DIR/icon-dev.png"
"$MAGICK_BIN" -background none "$LOGOS_DIR/favicon.svg" -resize 256x256 "$RESOURCES_DIR/icon.png"
echo "  -> resources/icon.png, resources/icon-dev.png (256x256)"

# #5357: trim to the glyph bounds, re-square with 2% margin, emit multi-size PNG-in-ICO.
node "$PROJECT_DIR/config/scripts/trim-windows-icon-source.mjs"
echo "  -> resources/build/icon.ico (trimmed, filled multi-size ICO)"

# macOS menu-bar template: plate-only tray mark at 22x14 logical (1x/2x), black glyph for system tinting.
"$MAGICK_BIN" -background none "$LOGOS_DIR/tray.svg" -resize 14x14 -gravity center -extent 22x14 "$TRAY_DIR/shield-menu-barTemplate.png"
"$MAGICK_BIN" -background none "$LOGOS_DIR/tray.svg" -resize 28x28 -gravity center -extent 44x28 "$TRAY_DIR/shield-menu-barTemplate@2x.png"
echo "  -> resources/tray/shield-menu-barTemplate.png (+@2x)"

echo "Done! Brand icons generated in resources/build/, resources/ and resources/tray/"
