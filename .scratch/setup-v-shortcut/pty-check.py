#!/usr/bin/env python3
"""V/v provider scope regression: owned homes only, no credentials/network."""
import argparse
import importlib.util
import json
import pathlib
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('ui', ROOT / '.scratch/setup-tui-rebuild/pty-check.py')
assert spec is not None and spec.loader is not None
ui = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ui)


def run(entry):
    results = []
    for focus, navigation in [('menu', ''), ('top', '\x1b[Z'), ('content', '\t')]:
        for key in ('V', 'v'):
            with tempfile.TemporaryDirectory(prefix='arks-v-check-') as directory:
                home = pathlib.Path(directory)
                session = ui.Session(entry, home)
                try:
                    session.wait('Configuration')
                    before = json.loads((home / 'config.json').read_text())
                    if navigation:
                        session.send(navigation)
                    session.send(key, 0.3)
                    disabled = json.loads((home / 'config.json').read_text())
                    assert not disabled['providers']['exa']['enabled'], (focus, key, 'disable failed')
                    assert disabled['providerOrder'] == before['providerOrder']
                    session.send(key, 0.3)
                    enabled = json.loads((home / 'config.json').read_text())
                    assert enabled['providers']['exa']['enabled'], (focus, key, 'enable failed')
                    assert enabled['providerOrder'] == before['providerOrder']
                    results.append({'focus': focus, 'key': key, 'disableEnable': 'passed', 'order': 'unchanged'})
                finally:
                    session.finish()
    return {'entry': str(entry), 'cases': results, 'scope': 'Linux PTY; owned homes; no credentials or network; processes/homes cleaned'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--entry', type=pathlib.Path, default=ROOT / 'dist/cli/main.js')
    parser.add_argument('--report', type=pathlib.Path, required=True)
    args = parser.parse_args()
    report = run(args.entry.resolve())
    args.report.write_text(json.dumps(report, indent=2) + '\n')
    print(f"{len(report['cases'])} real-entry V/v cases passed: {args.report}")
