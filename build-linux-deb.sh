#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

command -v dpkg-deb >/dev/null || { echo "dpkg-deb is required to build a Debian package." >&2; exit 1; }
test -x node_modules/electron/dist/electron || { echo "Run npm install first." >&2; exit 1; }

VERSION="$(node -p "require('./package.json').version")"
ARCH="$(dpkg --print-architecture)"
OUTPUT="$ROOT/outputs/desktop"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

APP="$STAGE/raf-personal-library_${VERSION}_${ARCH}"
mkdir -p "$APP/opt/RAF/resources" "$APP/usr/share/applications" "$APP/usr/bin" "$STAGE/app"

cp -a node_modules/electron/dist/. "$APP/opt/RAF/"
chmod 0755 "$APP/opt/RAF/electron"

cp index.html style.css app.js package.json LICENSE README.md main.cjs preload.cjs "$STAGE/app/"
node_modules/.bin/asar pack "$STAGE/app" "$APP/opt/RAF/resources/app.asar"

cat > "$APP/usr/bin/raf-personal-library" <<'LAUNCHER'
#!/bin/sh
exec /opt/RAF/electron "$@"
LAUNCHER
chmod 0755 "$APP/usr/bin/raf-personal-library"

cat > "$APP/usr/share/applications/raf-personal-library.desktop" <<'DESKTOP'
[Desktop Entry]
Version=1.0
Type=Application
Name=RAF — Personal Media Library
Comment=Offline personal library for films, books, anime and manga
Exec=/usr/bin/raf-personal-library %U
Terminal=false
Categories=Utility;Office;
DESKTOP
chmod 0644 "$APP/usr/share/applications/raf-personal-library.desktop"

mkdir -p "$APP/DEBIAN"
cat > "$APP/DEBIAN/control" <<CONTROL
Package: raf-personal-library
Version: $VERSION
Section: utils
Priority: optional
Architecture: $ARCH
Maintainer: RAF contributors
Description: Offline-first personal media library
 Track films, series, anime, donghua, manga, light novels and books
 locally on your computer.
CONTROL
chmod 0644 "$APP/DEBIAN/control"
find "$APP" -type d -exec chmod 0755 {} +

mkdir -p "$OUTPUT"
dpkg-deb --root-owner-group -Zgzip -z6 --build "$APP" "$OUTPUT/raf-personal-library_${VERSION}_${ARCH}.deb"
echo "Built $OUTPUT/raf-personal-library_${VERSION}_${ARCH}.deb"
