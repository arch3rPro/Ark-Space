#!/usr/bin/env python3
"""Approved three-axis UI checks; synthetic keys, owned homes and localhost only."""
import argparse
import http.server
import importlib.util
import json
import os
import pathlib
import re
import subprocess
import tempfile
import threading
from urllib.parse import parse_qs, urlparse

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('fixture', HERE.parent/'setup-workbench-verification/pty-check.py')
assert spec is not None and spec.loader is not None
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
Session = fixture.Session
check = fixture.check
KEY = fixture.KEY
screens = {}


def left_menu(screen):
    return '\n'.join(line.split('│')[1] for line in screen.splitlines()[3:-3] if line.count('│') >= 4)


def aligned_frame(screen, width):
    return all(fixture.text_columns(line) == width for line in screen.splitlines()[:-2])


def begin_add(session):
    session.send('a')
    session.wait('Plaintext storage')
    session.send('\r')  # Select field -> field editing, not persistence.


def run(entry):
    with tempfile.TemporaryDirectory(prefix='arks-approved-ui-') as temporary:
        base = pathlib.Path(temporary)
        home = base/'keys'
        home.mkdir()
        session = Session(entry, home)
        try:
            session.wait('Configuration')
            menu = left_menu(session.screen())
            check('left pane is a functional menu', all(word in menu for word in ['Providers', 'Configuration', 'Settings', 'Exit']))
            check('provider names are absent from left menu', all(word not in menu for word in ['Exa', 'Tavily', 'Firecrawl', 'SearXNG']))
            check('all provider labels appear in the top strip', all(word in session.screen().splitlines()[1] for word in ['Exa', 'Tavily', 'Firecrawl', 'SearXNG']))
            check('header and panes share independent 79-cell geometry', aligned_frame(session.screen(), 79))
            screens['main-three-axis'] = session.screen()
            session.send(']')
            check('top context switches without changing function', '─ Tavily ' in session.screen() and 'Configuration' in left_menu(session.screen()))
            session.send('[')
            session.send('\x1b[C')
            before = fixture.fingerprint(home)
            session.send('\r')
            check('empty resource Enter does not add or import', 'Plaintext storage' not in session.screen() and fixture.fingerprint(home) == before)
            begin_add(session)
            session.send(KEY)
            session.wait(f'{len(KEY)} characters')
            check('editing is masked', KEY not in session.screen() and '*' in session.screen())
            session.send('\x1b', 0.01)
            session.send('[D', 0.03)
            check('fragmented Left arrow does not undo the edited field', f'{len(KEY)} characters' in session.screen())
            session.send('\x1b', 0.01)
            session.send('[C', 0.03)
            session.send('\t')
            session.send('\x1b[D')
            check('Tab during field editing neither commits nor changes region', f'{len(KEY)} characters' in session.screen() and b'\x1b[?25h' in session.raw.rsplit(fixture.CLEAR.encode(), 1)[-1])
            session.send('\x1b[C')
            session.send('\r')
            check('field Enter commits only an in-memory draft', fixture.fingerprint(home) == before)
            session.send('\x13', 0.4)
            session.wait('Saved')
            check('Ctrl-S saves exactly the entered synthetic key', list(fixture.saved(home, 'credentials.json')['values'].values()) == [KEY])
            session.send(']')
            check('switching provider changes the right settings title', '─ Tavily ' in session.screen())
            session.send('[')
            check('returning provider restores its selected resource', '1/1' in session.screen())
            session.send('\r')
            session.wait('Plaintext storage')
            before = fixture.fingerprint(home)
            session.send('\r')
            session.send('synthetic-field-undo')
            session.send('\x1b')
            check('field Esc restores the pre-edit draft without writes', '0 characters' in session.screen() and fixture.fingerprint(home) == before)
            session.send('\x1b')
            check('unchanged form Esc returns to its resource list', 'Plaintext storage' not in session.screen())
            session.send('p')
            session.wait('Show full')
            check('saved-key preview remains masked/read-only', KEY not in session.screen() and fixture.fingerprint(home) == before)
            session.send('?')
            session.wait('Help')
            check('preview help never discloses values', KEY not in session.screen())
            session.send('\x1b')
            begin = len(session.raw)
            session.send('\x1b[H\r')
            check('explicit preview Show reveals only synthetic value', KEY in session.screen())
            screens['explicit-preview-redacted'] = session.screen().replace(KEY, '<SYNTHETIC REVEAL REDACTED>')
            session.resize(8, 24)
            session.wait('Window too small')
            session.allowed_reveals.append((begin, len(session.raw)))
            session.resize(24, 80)
            session.wait('Show full')
            check('tiny transition resets preview disclosure', KEY not in session.screen())
            session.send('\x1b')
            check('preview leaves all files unchanged', fixture.fingerprint(home) == before)
            session.send('d')
            session.wait('Delete')
            session.send('yn')
            session.send('\r')
            check('delete confirmation ignores Y/N and defaults Cancel', fixture.fingerprint(home) == before)
            session.send('\x1b[D')
            session.send('\x1b[B\r')
            session.wait('Search order')
            session.send('\t\x1b[C\r')
            session.wait('unsaved')
            order = fixture.fingerprint(home)
            session.send(']')
            check('top context change preserves global order draft', 'unsaved' in session.screen().lower() and fixture.fingerprint(home) == order)
            session.send('?')
            session.wait('Help')
            session.send('\x1b')
            check('help preserves global draft', 'unsaved' in session.screen().lower())
            screens['global-order-draft'] = session.screen()
            session.send('\x1b[F\r')
            check('explicit order Cancel has no persistence', fixture.fingerprint(home) == order)
            session.send('\x1b')
            session.send('\x1b[B\r')
            session.wait('Language')
            session.send('\x1b[B\r')
            session.wait('已保存')
            check('language remains one global saved preference', fixture.saved(home, 'config.json')['setupLanguage'] == 'zh')
            screens['global-language'] = session.screen()
        finally:
            session.finish()
        before = fixture.fingerprint(home)
        result = subprocess.run(['node', str(entry), 'setup', '--lang', 'en'], env={**os.environ, 'ARKSPACE_HOME': str(home)}, cwd=fixture.ROOT, capture_output=True, timeout=5)
        check('non-TTY preserves configuration and state', result.returncode == 0 and fixture.fingerprint(home) == before)
        # Compact/ANSI and direct-provider entry: no user settings are involved.
        for language in ('en', 'zh'):
            for colors in (False, True):
                narrow_home = base/f'compact-{language}-{colors}'
                narrow_home.mkdir()
                session = Session(entry, narrow_home, 'firecrawl', rows=16, columns=60, colors=colors, language=language)
                try:
                    session.wait('Firecrawl')
                    check('60x16 retains all top provider names', all(name in session.screen().splitlines()[1] for name in ['Exa', 'Tavily', 'Firecrawl', 'SearXNG']))
                    check('compact frame fits row budget', len(session.screen().splitlines()) <= 16)
                    check('compact header and panes align at 59 cells', aligned_frame(session.screen(), 59))
                    check('no unavailable multiplication marker', '×' not in session.screen())
                    if not colors:
                        check('NO_COLOR has no SGR', not fixture.sgr_parameters(session.raw.rsplit(fixture.CLEAR.encode(), 1)[-1]))
                    screens[f'compact-{language}-{colors}'] = session.screen()
                    if language == 'en' and not colors:
                        session.send('\x1b[C')
                        before = fixture.fingerprint(narrow_home)
                        begin_add(session)
                        session.send(KEY)
                        frame = session.raw.rsplit(fixture.CLEAR.encode(), 1)[-1]
                        cursor = re.findall(rb'\x1b\[(\d+);(\d+)H', frame)
                        check('compact staged caret stays on field row six', bool(cursor) and cursor[-1] == (b'6', b'40'))
                        screens['compact-staged-editor'] = session.screen()
                        session.resize(8, 24)
                        session.send('\x13', 0.3)
                        check('undersized editor blocks Ctrl-S persistence', fixture.fingerprint(narrow_home) == before)
                        session.resize(16, 60)
                        session.wait(f'{len(KEY)} characters')
                        session.send('\r')  # Commit retained field after blocked undersized Save.
                        session.send('\x1b')
                        if 'Discard' not in session.screen():
                            session.send('\x1b')
                        session.wait('Discard')
                        session.send('\r')
                        check('dirty discard defaults Cancel and retains editor', 'Plaintext storage' in session.screen())
                        session.send('\x1b')
                        session.send('\x1b[C\r')
                        check('explicit discard exits without changing files', fixture.fingerprint(narrow_home) == before)
                        session.send('\x1b')
                        session.send('\x1b')
                        session.wait('Exit')
                        session.send('\r')
                        check('root exit defaults Cancel and keeps CLI alive', session.process.poll() is None)
                finally:
                    session.finish()
        # Owned local SearXNG fixture; saving remains offline, test requires consent.
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), fixture.Fixture)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        sx_home = base/'searxng'
        sx_home.mkdir()
        session = Session(entry, sx_home, 'searxng')
        try:
            session.wait('Configuration')
            session.send('\x1b[C')
            session.send('a')
            session.wait('Add SearXNG')
            session.send('\r')
            url = f'http://127.0.0.1:{server.server_port}'
            session.send(url)
            session.send('\r')
            check('URL field commit stays offline', not fixture.Fixture.requests)
            session.send('\x13', 0.3)
            session.wait('Authorize')
            session.send('y')
            check('private permission ignores y', not fixture.Fixture.requests and url not in (sx_home/'config.json').read_text())
            session.send('\x1b[C\r', 0.4)
            session.wait('Saved')
            instance = fixture.saved(sx_home, 'config.json')['providers']['searxng']['instances'][0]
            check('only narrow per-instance CIDR is persisted', instance['allowRanges'] == ['127.0.0.1/32'])
            check('instance save sends no request', not fixture.Fixture.requests)
            session.send('t')
            session.wait('Test connection')
            session.send('\r')
            check('default Cancel makes no network attempt', not fixture.Fixture.requests)
            session.send('t')
            session.wait('Test connection')
            session.send('\x1b[C\r', 0.5)
            session.wait('success')
            check('explicit Test uses exactly one shared dispatch', len(fixture.Fixture.requests) == 1)
            query = parse_qs(urlparse(fixture.Fixture.requests[0]).query)
            check('fixed bounded test query is unchanged', query.get('q') == ['Agent Skills documentation'] and query.get('format') == ['json'])
            screens['local-test-evidence'] = session.screen()
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
            thread.join(timeout=3)
    return {'platform': 'Linux PTY; synthetic keys and owned localhost only', 'entry': str(entry), 'checks': fixture.checks, 'screens': screens, 'cleanup': 'Owned homes, CLI processes, terminal state, HTTP listener and installation cleaned'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--entry', type=pathlib.Path, default=fixture.ROOT/'dist/cli/main.js')
    parser.add_argument('--report', type=pathlib.Path, required=True)
    args = parser.parse_args()
    report = run(args.entry.resolve())
    args.report.write_text(json.dumps(report, indent=2, ensure_ascii=False)+'\n')
    print(f"{len(report['checks'])} approved-flow real-entry checks passed; report: {args.report}")
