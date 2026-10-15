"""Import only the verified, owner-requested historical Git branch."""
from datetime import datetime
from pathlib import Path
import hashlib
import json
import os
import subprocess

def git(*args):
    return subprocess.check_output(['git', *args])

assert git('rev-parse', 'HEAD').decode().strip() == os.environ['GITHUB_SHA']
manifest = json.loads(git('show', 'HEAD:.history-import/manifest.json'))
assert manifest['branch'] == 'history/mouvements-aout-septembre-2026'
assert manifest['commits'] == 144
assert len(manifest['requestedDays']) == 44
ref = 'refs/heads/' + manifest['branch']
parts = manifest['parts']
assert parts == [f'.history-import/history.bundle.part-{i:03d}' for i in range(len(parts))]
payload = b''.join(git('show', 'HEAD:' + part) for part in parts)
assert hashlib.sha256(payload).hexdigest() == manifest['bundleSha256']
bundle = Path(os.environ['RUNNER_TEMP']) / 'verified-movement-history.bundle'
bundle.write_bytes(payload)
subprocess.run(['git', 'bundle', 'verify', str(bundle)], check=True)
heads = git('bundle', 'list-heads', str(bundle)).decode().splitlines()
assert heads == [manifest['tip'] + ' ' + ref]
subprocess.run(['git', 'fetch', '--no-tags', str(bundle), ref + ':' + ref], check=True)
assert git('rev-parse', ref).decode().strip() == manifest['tip']
assert int(git('rev-list', '--count', ref)) == 144
assert not git('rev-list', '--min-parents=2', ref).strip()
allowed = set(manifest['requestedDays'])
days = set()
timestamps = []
records = git('log', '--reverse', '--format=%H%x09%aI%x09%cI', ref).decode().splitlines()
for record in records:
    sha, author, committer = record.split('\t')
    assert author == committer
    stamp = datetime.fromisoformat(author)
    assert stamp.strftime('%z') == '+0200'
    day = stamp.date().isoformat()
    assert day in allowed
    days.add(day)
    timestamps.append(author)
    assert git('diff-tree', '--root', '--no-commit-id', '--name-only', '-r', sha).strip()
    assert b'Reconstructed-Dates: true' in git('show', '-s', '--format=%B', sha)
assert days == allowed
assert timestamps == sorted(set(timestamps))
assert timestamps[0] == manifest['first'] and timestamps[-1] == manifest['last']
assert b'144 snapshots d\xe2\x80\x99origine' in git('show', ref + ':HISTORIQUE_RECONSTITUE.md')
print(f'Verified {len(records)} nonempty commits over {len(days)} requested days; tip {manifest["tip"]}.')
existing = git('ls-remote', '--heads', 'origin', ref).decode().strip()
if existing:
    assert existing.split()[0] == manifest['tip'], 'Existing history branch differs; refusing replacement.'
    print('The matching historical branch already exists.')
else:
    askpass = Path(os.environ['RUNNER_TEMP']) / 'movement-git-askpass'
    askpass.write_text('#!/bin/sh\ncase "$1" in\n*Username*) printf %s x-access-token ;;\n*) printf %s "$GH_TOKEN" ;;\nesac\n')
    askpass.chmod(0o700)
    env = os.environ.copy()
    env.update(GIT_ASKPASS=str(askpass), GIT_TERMINAL_PROMPT='0')
    try:
        subprocess.run(['git', 'push', 'origin', ref + ':' + ref], env=env, check=True)
    finally:
        askpass.unlink(missing_ok=True)
    print('Historical branch imported. No existing branch was rewritten.')
