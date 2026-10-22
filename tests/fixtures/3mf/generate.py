"""Generate independent ZIP/3MF containers for local preview tests; no external files/network."""
import base64
import pathlib
import sys
import zipfile

root = pathlib.Path(sys.argv[1]).resolve()
root.mkdir(parents=True, exist_ok=True)
png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM7sAAAAASUVORK5CYII=')
model = b'<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources/><build/></model>'
for name, compression in [('deflated', zipfile.ZIP_DEFLATED), ('stored', zipfile.ZIP_STORED)]:
    with zipfile.ZipFile(root / (name + '.3mf'), 'w', compression=compression) as archive:
        archive.writestr('3D/3dmodel.model', model)
        archive.writestr('Metadata/thumbnail.png', png)
with zipfile.ZipFile(root / 'no-thumbnail.3mf', 'w') as archive:
    archive.writestr('3D/3dmodel.model', model)
with zipfile.ZipFile(root / 'traversal.3mf', 'w') as archive:
    archive.writestr('../Metadata/thumbnail.png', png)
with zipfile.ZipFile(root / 'bomb.3mf', 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('Metadata/thumbnail.png', png + b'0' * (12 * 1024 * 1024))
with zipfile.ZipFile(root / 'large.3mf', 'w', compression=zipfile.ZIP_STORED) as archive:
    with archive.open('3D/3dmodel.model', 'w') as entry:
        chunk = b'0' * (1024 * 1024)
        for _ in range(80):
            entry.write(chunk)
    archive.writestr('Metadata/thumbnail.png', png)
(root / 'expected.png').write_bytes(png)
