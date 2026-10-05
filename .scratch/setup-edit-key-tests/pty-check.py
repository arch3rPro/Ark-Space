#!/usr/bin/env python3
"""Linux source/installed-entry checks, synthetic keys, fetch intercepted, owned homes."""
import argparse
import importlib.util
import json
import os
import pathlib
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('ui', ROOT / '.scratch/setup-tui-rebuild/pty-check.py')
assert spec and spec.loader
ui = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ui)
fixture = ui.fixture


def prepare(entry, home, count):
    home.mkdir()
    env = {**os.environ, 'ARKSPACE_HOME': str(home), 'HOME': str(home)}
    store = (entry.parent.parent / 'config/store.js').as_uri()
    code = 'const {initializeConfig}=await import(' + json.dumps(store) + ');await initializeConfig(' + json.dumps(str(home / 'config.json')) + ')'
    result = subprocess.run(['node', '--input-type=module', '--eval', code], cwd=ROOT, env=env, capture_output=True, timeout=10)
    assert result.returncode == 0, 'isolated init failed'
    config = json.loads((home / 'config.json').read_text())
    variables = ['EXA_API_KEY'] + [f'EXA_API_KEY_{i}' for i in range(1, count)]
    config['providers']['exa']['keyRefs'] = ['env:' + v for v in variables]
    config['providers']['exa']['enabled'] = True
    (home / 'config.json').write_text(json.dumps(config))
    values = [fixture.KEY] + [fixture.KEY + '-' + c for c in 'bcd'[:count-1]]
    credentials = home / 'credentials.json'
    credentials.write_text(json.dumps({'version': 1, 'values': dict(zip(variables, values, strict=True))}))
    credentials.chmod(0o600)


def run(entry):
    frames = {}
    with tempfile.TemporaryDirectory(prefix='arks-edit-all-pty-') as temporary:
        base = pathlib.Path(temporary)
        trace = base / 'attempts.txt'
        previous = {k: os.environ.get(k) for k in ['NODE_OPTIONS', 'ARKS_SETUP_FIXTURE_TRACE']}
        os.environ['NODE_OPTIONS'] = '--import=' + str(pathlib.Path(__file__).with_name('fake-fetch.mjs'))
        os.environ['ARKS_SETUP_FIXTURE_TRACE'] = str(trace)
        try:
            for rows, columns, lang in [(24, 80, 'en'), (16, 60, 'zh')]:
                home = base / ('all-' + lang)
                prepare(entry, home, 2)
                session = fixture.Session(entry, home, rows=rows, columns=columns, language=lang)
                try:
                    session.wait('Configuration' if lang == 'en' else '配置')
                    session.send('\x1b[C')
                    before = fixture.fingerprint(home)
                    session.send('e')
                    session.wait('Edit Exa' if lang == 'en' else '编辑 Exa')
                    session.wait(f'{len(fixture.KEY)} characters' if lang == 'en' else f'{len(fixture.KEY)} 字符')
                    fixture.check('existing key is preloaded but stays masked ' + lang, fixture.KEY not in session.screen())
                    session.send('\x13', 0.4)
                    session.wait('No changes.' if lang == 'en' else '没有修改。')
                    fixture.check('unchanged edit does not write ' + lang, fixture.fingerprint(home) == before)
                    session.send(' ')
                    session.send('\x1b[B')
                    session.send(' ')
                    before = fixture.fingerprint(home)
                    trace.write_text('')
                    session.send('t')
                    session.wait('Test all 2 keys individually' if lang == 'en' else '逐一测试全部 2 个 Key')
                    session.wait('fees/logging' if lang == 'en' else '可能计费')
                    frames['consent-' + lang] = session.screen()
                    session.send('\r')
                    fixture.check('test modal defaults Cancel ' + lang, trace.read_text() == '')
                    session.send('t')
                    session.send('\x1b[B\x1b[C\r', 0.5)
                    session.wait('Key results: 1/2 passed' if lang == 'en' else 'Key 结果：1/2 通过')
                    fixture.check('all requests target A then B exactly once ' + lang, trace.read_text().splitlines() == ['A', 'B'])
                    fixture.check('all diagnostics leave config/credentials/normal state unchanged ' + lang, fixture.fingerprint(home) == before)
                    fixture.check('no synthetic keys or hostile response body in results ' + lang, fixture.KEY not in session.screen())
                    frames['results-' + lang] = session.screen()
                    session.send('\r')
                finally:
                    session.finish()
            home = base / 'cancel'
            prepare(entry, home, 4)
            trace.write_text('')
            session = fixture.Session(entry, home)
            try:
                session.wait('Configuration')
                before = fixture.fingerprint(home)
                session.send('\x1b[C')
                session.send('t')
                session.wait('Test all 4 keys individually')
                session.send('\x1b[B\x1b[C\r', 0.4)
                session.wait('Testing keys 2/4')
                session.send('\x1b', 0.4)
                session.wait('Key results: 1/4 passed · stopped')
                fixture.check('Esc stops active key without sending pending D', trace.read_text().splitlines() == ['A', 'B', 'C'])
                session.wait('EXA_API_KEY_3 · not tested')
                fixture.check('partial diagnostic still does not mutate normal state', fixture.fingerprint(home) == before)
                frames['cancelled'] = session.screen()
                session.send('\r')
                fixture.check('Esc diagnostic cancel keeps Setup alive', session.process.poll() is None)
            finally:
                session.finish()
        finally:
            for k, value in previous.items():
                if value is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = value
    return {'entry': str(entry), 'assertions': fixture.checks, 'frames': frames,
            'scope': 'Linux PTY; fake fetch only; synthetic keys; owned processes/homes cleaned; no real-service or cross-platform claim'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--entry', type=pathlib.Path, default=ROOT / 'dist/cli/main.js')
    parser.add_argument('--report', type=pathlib.Path, required=True)
    args = parser.parse_args()
    report = run(args.entry.resolve())
    args.report.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print(f"{len(report['assertions'])} Linux PTY checks passed: {args.report}")
