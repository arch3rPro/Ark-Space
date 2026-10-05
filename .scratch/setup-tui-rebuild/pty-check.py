#!/usr/bin/env python3
"""Whole-rebuild black-box qualification; synthetic homes and owned localhost only."""
import argparse
import http.server
import importlib.util
import json
import os
import pathlib
import subprocess
import tempfile
import threading
from urllib.parse import parse_qs, urlparse

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('fixture', HERE.parent / 'setup-workbench-verification/pty-check.py')
assert spec is not None and spec.loader is not None
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
Session, check, KEY = fixture.Session, fixture.check, fixture.KEY
screens = {}


def header(session):
    return next(line for line in session.screen().splitlines() if all(name in line for name in ('Exa', 'Tavily', 'Firecrawl', 'SearXNG')))


def add(session):
    session.send('a')
    session.wait('Plaintext storage')
    session.send('\r')


def frame_width(session, width):
    lines = session.screen().splitlines()
    return all(fixture.text_columns(line) == width for line in lines[:-2])


def run(entry):
    with tempfile.TemporaryDirectory(prefix='arks-full-tui-') as temporary:
        base = pathlib.Path(temporary)
        home = base / 'keys'
        home.mkdir()
        session = Session(entry, home)
        try:
            session.wait('Configuration')
            before = fixture.fingerprint(home)
            session.send('\x1b[Z')  # Menu -> real Top focus.
            session.send('\x1b[C')
            check('top has actual arrow-operated provider focus', '[Tavily]' in header(session))
            session.send('\x1b[D')
            check('top Left returns to Exa', '[Exa]' in header(session))
            check('top switching does not persist or contact services', fixture.fingerprint(home) == before)
            session.send('\t\t')  # Top -> Menu -> Content, not toolbar subfocus.
            session.send('\r')
            check('empty resource Enter does not add', 'Plaintext storage' not in session.screen())
            screens['main-rebuilt'] = session.screen()
            headings = [i for i, line in enumerate(session.screen().splitlines()) if 'Reference' in line and 'Source' in line]
            check('primary table is no longer pushed below two button bars', bool(headings) and headings[0] < 8)
            add(session)
            session.send(KEY)
            session.wait(f'{len(KEY)} characters')
            check('right-pane editor masks synthetic key', KEY not in session.screen())
            session.send('\x1b', 0.01)
            session.send('[D', 0.03)
            check('fragmented Left stays an editing action', f'{len(KEY)} characters' in session.screen())
            session.send('\x1b[C\t')
            check('editing Tab cannot enter a page toolbar', b'\x1b[?25h' in session.raw.rsplit(fixture.CLEAR.encode(), 1)[-1])
            session.send('\r')
            check('field commit cannot write', fixture.fingerprint(home) == before)
            screens['right-draft'] = session.screen()
            session.send('\x13', 0.4)
            session.wait('Saved')
            check('explicit draft Save round-trips exact synthetic value', list(fixture.saved(home, 'credentials.json')['values'].values()) == [KEY])
            before = fixture.fingerprint(home)
            session.send('\t')  # Content -> Top, NOT actions/controls.
            session.send('\x1b[C')
            check('Content Tab reaches top instead of old action bar', '[Tavily]' in header(session))
            session.send('\x1b[D\x1b[B')  # Exa and back to content.
            session.send('\x1b[D')
            check('Content Left always returns to menu', 'Configuration' in session.screen())
            session.send('\x1b[C')
            session.send('p')
            session.wait('Show full')
            check('row preview starts masked and read-only', KEY not in session.screen() and fixture.fingerprint(home) == before)
            start = len(session.raw)
            session.send('\x1b[H\r')
            check('preview Show is explicit', KEY in session.screen())
            screens['preview-redacted'] = session.screen().replace(KEY, '<SYNTHETIC REVEAL REDACTED>')
            session.resize(8, 24)
            session.wait('Window too small')
            session.allowed_reveals.append((start, len(session.raw)))
            session.resize(24, 80)
            session.wait('Show full')
            check('tiny preview resets disclosure', KEY not in session.screen())
            session.send('\x1b')
            session.send('d')
            session.wait('Delete')
            session.send('yn\r')
            check('Delete still defaults Cancel and ignores y/n', fixture.fingerprint(home) == before)
            session.send('\x1b[D\x1b[B\r')
            session.wait('Order ·')
            session.send('d')
            session.wait('unsaved')
            before = fixture.fingerprint(home)
            session.send(']')
            check('global order draft survives provider context', 'unsaved' in session.screen().lower() and fixture.fingerprint(home) == before)
            session.send('?')
            session.wait('Help')
            session.send('\x1b')
            check('global order draft survives overlay', 'unsaved' in session.screen().lower())
            screens['global-order'] = session.screen()
            session.send('\x1b')
            session.wait('Discard')
            session.send('\r')
            check('order discard defaults Cancel', 'unsaved' in session.screen().lower() and fixture.fingerprint(home) == before)
            session.send('\x1b')
            session.send('\x1b[C\r')
            check('explicit order discard does not persist', fixture.fingerprint(home) == before)
            session.send('\x1b[D\x1b[B\r')
            session.wait('Language')
            session.send('\x1b[B\r')
            session.wait('已保存')
            check('language stays globally persisted', fixture.saved(home, 'config.json')['setupLanguage'] == 'zh')
            screens['global-language'] = session.screen()
        finally:
            session.finish()
        before = fixture.fingerprint(home)
        r = subprocess.run(['node', str(entry), 'setup', '--lang', 'en'], cwd=fixture.ROOT, env={**os.environ, 'ARKSPACE_HOME': str(home)}, capture_output=True, timeout=5)
        check('non-TTY entry cannot mutate setup', r.returncode == 0 and fixture.fingerprint(home) == before)
        for language in ('en', 'zh'):
            for colors in (False, True):
                compact = base / f'compact-{language}-{colors}'
                compact.mkdir()
                session = Session(entry, compact, 'firecrawl', rows=16, columns=60, language=language, colors=colors)
                try:
                    session.wait('Firecrawl')
                    check('compact retains all top contexts', all(name in header(session) for name in ('Exa', 'Tavily', 'Firecrawl', 'SearXNG')))
                    check('compact whole-frame columns align', frame_width(session, 59))
                    check('unavailable does not use multiplication marker', '×' not in session.screen())
                    if not colors:
                        check('NO_COLOR suppresses SGR', not fixture.sgr_parameters(session.raw.rsplit(fixture.CLEAR.encode(), 1)[-1]))
                    screens[f'compact-{language}-{colors}'] = session.screen()
                finally:
                    session.finish()
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), fixture.Fixture)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        sx = base / 'searxng'
        sx.mkdir()
        session = Session(entry, sx, 'searxng')
        try:
            session.wait('Configuration')
            session.send('\t')  # Menu -> Content.
            session.send('a')
            session.wait('Add SearXNG')
            session.send('\r')
            url = f'http://127.0.0.1:{server.server_port}'
            session.send(url + '\r')
            session.send('\x13', 0.3)
            session.wait('Authorize')
            check('offline Save permission sends no requests', not fixture.Fixture.requests)
            session.send('\r')
            check('declined CIDR authorization retains right draft', 'Add SearXNG' in session.screen())
            session.send('\x13', 0.3)
            session.wait('Authorize')
            session.send('\x1b[C\r', 0.4)
            session.wait('Saved')
            instance = fixture.saved(sx, 'config.json')['providers']['searxng']['instances'][0]
            check('explicit per-instance narrow CIDR only', instance['allowRanges'] == ['127.0.0.1/32'] and not fixture.Fixture.requests)
            session.send('t')
            session.wait('Test connection')
            session.send('\r')
            check('provider test defaults Cancel', not fixture.Fixture.requests)
            session.send('t')
            session.wait('Test connection')
            session.send('\x1b[C\r', 0.5)
            session.wait('success')
            check('explicit test dispatches exactly once', len(fixture.Fixture.requests) == 1)
            query = parse_qs(urlparse(fixture.Fixture.requests[0]).query)
            check('test remains fixed and bounded', query.get('q') == ['Agent Skills documentation'] and query.get('format') == ['json'])
            screens['local-provider-test'] = session.screen()
            session.send('\r')
            fixture.Fixture.delay = 1.5
            session.send('t')
            session.wait('Test connection')
            session.send('\x1b[C\r', 0.2)
            session.wait('Testing connection')
            session.send('\x03', 0.2)
        finally:
            session.finish()
            server.shutdown()
            server.server_close()
            worker.join(timeout=3)
    return {'entry': str(entry), 'platform': 'Linux PTY; synthetic credentials and owned localhost only', 'checks': fixture.checks, 'screens': screens, 'cleanup': 'Owned homes/processes/listener/install removed; no user configuration/global install'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--entry', type=pathlib.Path, default=fixture.ROOT / 'dist/cli/main.js')
    parser.add_argument('--report', type=pathlib.Path, required=True)
    args = parser.parse_args()
    report = run(args.entry.resolve())
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(f'{len(fixture.checks)} whole-rebuild real-entry assertions passed; report: {args.report}')
