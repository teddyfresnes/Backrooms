"""Losslessly package the original apartment for static hosting."""
from pathlib import Path
import hashlib
import json
import zlib

root = Path(__file__).resolve().parents[1]
source = root / '.asset-cache/apartment.json'
output = root / 'public/assets/imported-apartment'
output.mkdir(parents=True, exist_ok=True)
limit = 16 * 1024 * 1024
expected = '1b1864ff763676e6fa4bc0b66e0ae2d854a7bf9ef3e61990d2c9f6fce7067dda'
raw_hash, packed_hash = hashlib.sha256(), hashlib.sha256()
compressor = zlib.compressobj(6, zlib.DEFLATED, 31)
pending = bytearray()
parts = []
total = 0

def flush_part(size):
    block = bytes(pending[:size])
    del pending[:size]
    name = f'apartment-{len(parts):03d}.bin'
    (output / name).write_bytes(block)
    parts.append({'file': name, 'bytes': len(block), 'sha256': hashlib.sha256(block).hexdigest()})

def accept(block):
    packed_hash.update(block)
    pending.extend(block)
    while len(pending) >= limit:
        flush_part(limit)

with source.open('rb') as stream:
    while block := stream.read(2 * 1024 * 1024):
        raw_hash.update(block)
        total += len(block)
        accept(compressor.compress(block))
accept(compressor.flush())
if pending:
    flush_part(len(pending))
assert raw_hash.hexdigest() == expected and total == 349270200
manifest = {'version': 1, 'compression': 'gzip', 'bytes': total,
            'sourceSha256': raw_hash.hexdigest(), 'compressedSha256': packed_hash.hexdigest(), 'parts': parts}
(output / 'apartment.parts.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'originalBytes': total, 'compressedBytes': sum(p['bytes'] for p in parts),
                  'parts': len(parts), 'sourceVerified': True}), flush=True)
