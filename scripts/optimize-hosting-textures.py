"""Recompress site textures without changing their URLs or dimensions."""
from pathlib import Path
from io import BytesIO
from PIL import Image, ImageFile
import json

ImageFile.MAXBLOCK = 2**24
before = after = changed = 0
for path in Path('public/assets/textures').rglob('*.jpg'):
    original = path.read_bytes()
    with Image.open(BytesIO(original)) as image:
        if image.mode not in ('RGB', 'L'):
            image = image.convert('RGB')
        output = BytesIO()
        image.save(output, 'JPEG', quality=88, subsampling=0, optimize=True)
    encoded = output.getvalue()
    before += len(original)
    if len(encoded) < len(original):
        path.write_bytes(encoded)
        changed += 1
    after += min(len(original), len(encoded))

beard = Path('public/assets/characters/bodyparts/makehuman/elvs_scruffy_beard1')
for path in beard.glob('*.webp'):
    if path.stat().st_size < 1024 * 1024:
        continue
    original = path.read_bytes()
    with Image.open(BytesIO(original)) as image:
        output = BytesIO()
        image.save(output, 'WEBP', quality=95, method=6, exact=True)
    encoded = output.getvalue()
    before += len(original)
    if len(encoded) < len(original):
        path.write_bytes(encoded)
        changed += 1
    after += min(len(original), len(encoded))
print(json.dumps({'changedTextures': changed, 'beforeBytes': before, 'afterBytes': after}))
