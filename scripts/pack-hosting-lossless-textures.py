"""Create pixel-identical hosted variants; preserve source PNGs in the repository."""
from pathlib import Path
from io import BytesIO
from hashlib import sha256
from PIL import Image
import json

assets = Path('public/assets')
entries = []
for relative in ('blood/blood-decal-a.png', 'mpfb/textures/sss.png'):
    source = assets / relative
    original = source.read_bytes()
    image = Image.open(BytesIO(original)).convert('RGBA')
    output = BytesIO()
    image.save(output, 'WEBP', lossless=True, method=6, exact=True)
    encoded = output.getvalue()
    decoded = Image.open(BytesIO(encoded)).convert('RGBA')
    assert decoded.size == image.size
    assert decoded.tobytes() == image.tobytes(), relative
    assert len(encoded) < len(original), relative
    runtime = source.with_suffix('.webp')
    runtime.write_bytes(encoded)
    entries.append({
        'source': '/assets/' + relative,
        'runtime': '/assets/' + str(Path(relative).with_suffix('.webp')),
        'sourceBytes': len(original), 'runtimeBytes': len(encoded),
        'sourceSha256': sha256(original).hexdigest(),
        'runtimeSha256': sha256(encoded).hexdigest(),
        'rgbaSha256': sha256(image.tobytes()).hexdigest(),
        'dimensions': list(image.size), 'pixelsIdentical': True,
    })
report = {'encoding': 'WebP lossless, exact transparent RGB', 'textures': entries,
          'bytesSaved': sum(e['sourceBytes'] - e['runtimeBytes'] for e in entries)}
Path('docs/validation/hosting-lossless-textures.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'textures': len(entries), 'bytesSaved': report['bytesSaved']}))
