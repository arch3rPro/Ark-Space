#!/usr/bin/env python3
"""Linux-only real-entry checks. Synthetic credentials, owned temporary HOME, local HTTP fixture."""
import argparse
import fcntl
import hashlib
import http.server
import json
import os
import pathlib
import pty
import re
import select
import struct
import subprocess
import tempfile
import termios
import threading
import time
import unicodedata
from urllib.parse import parse_qs, urlparse

ROOT = pathlib.Path(__file__).resolve().parents[2]
CLEAR = '\x1b[2J\x1b[H'
ANSI = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')
KEY = 'synthetic-pty?credential-only'
checks = []
screens = {}


def check(name, condition):
    if not condition:
        raise AssertionError(name)
    checks.append(name)


class Session:
    def __init__(self, entry, home, provider=None, rows=24, columns=80, colors=False, language='en'):
        self.master, self.slave = pty.openpty()
        self.original = termios.tcgetattr(self.slave)
        self.resize(rows, columns)
        env = {k: v for k, v in os.environ.items()
               if not k.startswith(('EXA_API_KEY', 'TAVILY_API_KEY', 'FIRECRAWL_API_KEY', 'SEARXNG_'))}
        env.update(ARKSPACE_HOME=str(home), HOME=str(home), XDG_CONFIG_HOME=str(home), TERM='xterm-256color', LANG='en_US.UTF-8', NO_COLOR='1')
        if colors:
            env.pop('NO_COLOR', None)
        args = ['node', str(entry), 'setup'] + ([provider] if provider else []) + ['--lang', language]
        self.process = subprocess.Popen(args, stdin=self.slave, stdout=self.slave, stderr=self.slave, env=env, cwd=ROOT, close_fds=True)
        self.raw = b''
        self.allowed_reveals = []
        self.read(0.35)

    def resize(self, rows, columns):
        fcntl.ioctl(self.slave, termios.TIOCSWINSZ, struct.pack('HHHH', rows, columns, 0, 0))
        if hasattr(self, 'process'):
            os.kill(self.process.pid, 28)  # SIGWINCH on Linux
            self.read(0.15)

    def read(self, duration=0.12):
        until = time.monotonic() + duration
        while time.monotonic() < until:
            ready, _, _ = select.select([self.master], [], [], min(0.03, max(0, until-time.monotonic())))
            if ready:
                try:
                    data = os.read(self.master, 65536)
                except OSError:
                    break
                if not data:
                    break
                self.raw += data
        return self.screen()

    def screen(self):
        return ANSI.sub('', self.raw.decode('utf-8', errors='replace').rsplit(CLEAR, 1)[-1])

    def send(self, keys, delay=0.15):
        # Individual keystrokes, not a paste containing several control characters.
        if isinstance(keys, str):
            tokens = re.findall(r'\x1b\[[0-9;]*[A-Za-z~]|[\x00-\x1f\x7f]', keys)
            if len(tokens) > 1 and ''.join(tokens) == keys:
                for token in tokens:
                    os.write(self.master, token.encode())
                    self.read(0.08)
                return self.read(delay)
        os.write(self.master, keys.encode() if isinstance(keys, str) else keys)
        return self.read(delay)

    def wait(self, text, timeout=4):
        until = time.monotonic() + timeout
        while text not in self.screen() and time.monotonic() < until:
            self.read(0.1)
        check('visible: ' + text, text in self.screen())

    def finish(self):
        if self.process.poll() is None:
            self.send('\x03')
        try:
            self.process.wait(timeout=4)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
            raise AssertionError('CLI exits and cleanup completes') from None
        self.read(0.1)
        flags = termios.ICANON | termios.ECHO
        check('terminal canonical/echo modes restored', termios.tcgetattr(self.slave)[3] & flags == self.original[3] & flags)
        check('alternate screen restored', b'\x1b[?1049l' in self.raw)
        outside_reveal = b''
        cursor = 0
        for begin, end in self.allowed_reveals:
            outside_reveal += self.raw[cursor:begin]
            cursor = end
        outside_reveal += self.raw[cursor:]
        check('synthetic secret absent outside explicitly authorized preview', KEY.encode() not in outside_reveal)
        os.close(self.master)
        os.close(self.slave)


def saved(home, name) -> dict:
    path = home / name
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError) as error:
        raise AssertionError('missing or invalid synthetic fixture: ' + name) from error
    if not isinstance(value, dict):
        raise AssertionError('synthetic fixture must be an object: ' + name)
    return value


def sgr_parameters(frame):
    return [{int(number) for number in match.split(b';') if number} for match in re.findall(rb'\x1b\[([0-9;]*)m', frame)]


def text_columns(text):
    # Independent of the renderer: structural markers are ASCII, CJK is double-cell.
    return sum(0 if unicodedata.combining(char) else 2 if unicodedata.east_asian_width(char) in ('W', 'F') else 1 for char in text)


def pane_columns(screen):
    positions = set()
    for line in screen.splitlines()[4:-3]:
        column = 0
        borders = []
        for char in line:
            if char == '│':
                borders.append(column)
            column += text_columns(char)
        if borders:
            positions.add(tuple(borders))
    return positions


def fingerprint(home):
    return {name: hashlib.sha256((home/name).read_bytes()).hexdigest()
            for name in ('config.json', 'credentials.json', 'state.json') if (home/name).exists()}


class Fixture(http.server.BaseHTTPRequestHandler):
    requests = []
    delay = 0.0

    def log_message(self, format: str, *args):
        pass

    def do_GET(self):
        type(self).requests.append(self.path)
        time.sleep(type(self).delay)
        body = json.dumps({'results': [{'title': 'Synthetic fixture', 'url': 'https://example.com/fixture', 'content': 'Owned local test only'}]}).encode()
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass


def run(entry):
    with tempfile.TemporaryDirectory(prefix='arks-workbench-pty-') as temporary:
        base = pathlib.Path(temporary)
        home = base/'keys'
        home.mkdir()
        session = Session(entry, home)
        try:
            session.wait('Search order')
            session.wait('Language')
            check('empty missing default key is not rendered', 'EXA_API_KEY' not in session.screen())
            check('full layout fits 80x24 rows', len(session.screen().splitlines()) <= 24)
            screens['workspace-80x24'] = session.screen()
            check('inactive toolbars have no focused button', not re.search(r'(?:▶|>)\[', session.screen()) and '[›' not in session.screen())
            session.send('\x1b[C')
            check('sidebar Right does not select the next provider', '>*Exa' in session.screen())
            session.send('\x1b[B')
            check('sidebar Down selects the next navigation cursor', '> Tavily' in session.screen())
            check('navigation selection does not prematurely open Tavily', '─ Exa ' in session.screen())
            before_help = fingerprint(home)
            session.send('?')
            session.wait('Help')
            check('navigation help describes explicit Enter activation', 'Enter opens' in session.screen())
            session.send('\x1b')
            check('help leaves navigation cursor and configuration unchanged', '> Tavily' in session.screen() and fingerprint(home) == before_help)
            check('bordered header and two panes have stable columns', pane_columns(session.screen()) == {(0, 17, 19, 78)})
            check('object table has real source and status columns', 'Source' in session.screen() and 'Status' in session.screen())
            session.send('\x1b[H')
            session.send('\r')  # empty provider -> Add action
            session.send('\r')
            session.wait('Plaintext storage')
            session.send(KEY)
            mask = re.search(r'\[(\*+)\].*characters', session.screen())
            check('key entry uses only stars in its horizontal input window', mask is not None and 1 <= len(mask.group(1)) <= len(KEY))
            check('key entry reports the entered length', f'{len(KEY)} characters' in session.screen())
            session.send('\x7f')
            check('backspace updates mask length', f'{len(KEY)-1} characters' in session.screen())
            session.send(KEY[-1])
            check('terminal form has no Agent-chat reminder', 'Agent chat' not in session.screen())
            session.send('\t\t\r', 0.4)
            session.wait('Saved')
            values = saved(home, 'credentials.json')['values']
            check('one explicit Save stores one synthetic key', list(values.values()) == [KEY])
            check('literal question mark is preserved as secret data, not help', '?' in list(values.values())[0])
            before = fingerprint(home)
            session.send('p')
            session.wait('Show full')
            check('preview defaults to masked value', KEY.encode() not in session.raw)
            check('preview modal has exactly one focused button', len(re.findall(r'(?:▶|>)\[', session.screen())) == 1)
            check('opening preview does not mutate credentials/config/state', fingerprint(home) == before)
            screens['preview-masked'] = session.screen()
            session.send('?')
            session.wait('Help')
            check('preview help remains masked and read-only', KEY not in session.screen() and fingerprint(home) == before)
            session.send('\x1b')
            check('returning from preview help preserves the masked preview', 'Show full' in session.screen() and KEY not in session.screen())
            session.send('\r')
            check('default Enter closes without revealing', KEY.encode() not in session.raw)
            session.send('p')
            session.wait('Show full')
            begin = len(session.raw)
            session.send('\x1b[H\r')
            check('explicit Show full reveals the synthetic stored key', KEY in session.screen())
            screens['preview-explicit-reveal'] = session.screen().replace(KEY, '<SYNTHETIC REVEAL REDACTED>')
            session.send('\x1b[C\r')
            check('Hide removes the full key from the current frame', KEY not in session.screen())
            session.allowed_reveals.append((begin, len(session.raw)))
            begin = len(session.raw)
            session.send('\x1b[H\r')
            check('a second deliberate Show reveals the stored key', KEY in session.screen())
            session.resize(8, 24)
            session.wait('Window too small')
            session.allowed_reveals.append((begin, len(session.raw)))
            session.resize(24, 80)
            session.wait('Show full')
            check('restoring a tiny preview remains masked', KEY not in session.screen())
            session.send('\x1b')
            check('closing preview restores a non-secret workspace', KEY not in session.screen())
            check('preview/reveal/hide are read-only', fingerprint(home) == before)
            session.send('d')
            session.wait('Delete')
            check('confirmation uses action buttons, not y/N', 'y/N' not in session.screen() and '[Y' not in session.screen())
            session.send('y')
            session.send('n')
            check('y/n neither dismisses nor accepts confirmation', 'Delete' in session.screen() and fingerprint(home) == before)
            screens['delete-default-cancel'] = session.screen()
            session.send('\r')
            check('Enter defaults to cancel deletion', fingerprint(home) == before)
            session.send('d')
            session.send('\x1b[C\r', 0.35)
            check('explicit Delete removes the selected synthetic key', saved(home, 'credentials.json')['values'] == {})
            # Add draft survives resizing; tiny windows cannot accept Save.
            session.send('a')
            session.wait('Plaintext storage')
            session.send(KEY)
            session.resize(8, 24)
            session.wait('Window too small')
            session.send('\t\t\r', 0.25)
            check('24x8 blocks hidden form submission', saved(home, 'credentials.json')['values'] == {})
            check('tiny fallback stays within eight rows', len(session.screen().splitlines()) <= 8)
            screens['blocked-24x8'] = session.screen()
            session.resize(16, 60)
            session.wait('Plaintext storage')
            check('60x16 compact form fits sixteen rows', len(session.screen().splitlines()) <= 16)
            screens['compact-60x16'] = session.screen()
            session.send('\x1b')
            check('Esc cancels retained secret draft without writes', saved(home, 'credentials.json')['values'] == {})
        finally:
            session.finish()
        # Many-item navigation, session drafts, and global language use the real controller.
        config = saved(home, 'config.json')
        variables = [f'FIXTURE_KEY_{n:02}' for n in range(1, 13)]
        config['providers']['exa']['keyRefs'] = ['env:' + variable for variable in variables]
        (home/'config.json').write_text(json.dumps(config))
        (home/'credentials.json').write_text(json.dumps({'version': 1, 'values': {variable: KEY + '-' + variable for variable in variables}}))
        session = Session(entry, home)
        try:
            session.wait('FIXTURE_KEY_01')
            session.send('\r')
            session.send('\x1b[C')
            check('resource Right does not move the vertical selection', '1/12' in session.screen())
            session.send('\x1b[B')
            session.wait('2/12')
            session.send('\x1b[F')
            session.wait('12/12')
            before = fingerprint(home)
            session.send('1')
            session.send('0')
            check('digits do not activate ambiguous numbered shortcuts', '12/12' in session.screen() and fingerprint(home) == before)
            session.send('\x1b[5~')
            session.wait('1/12')
            session.send('\x1b[6~')
            session.wait('12/12')
            screens['many12-last-item'] = session.screen()
            session.send('\x1b')
            session.send('\x1b[B' * 4)
            session.wait('Search order')
            session.send('\r\r\x1b[C\r')
            if 'unsaved' not in session.screen().lower():
                summary = session.screen().splitlines()
                raise AssertionError('order draft navigation: ' + '\n'.join(summary[:6] + summary[-3:]))
            check('order draft visibly indicates unsaved changes', True)
            check('draft reorder does not write configuration', fingerprint(home) == before)
            session.send('\x1b')
            session.send('\x1b[A' * 4)
            session.send('\r')
            session.wait('12/12')
            check('provider selection survives navigation', 'FIXTURE_KEY_12' in session.screen())
            session.send('\x1b')
            session.send('\x1b[B' * 4)
            session.send('\r')
            order_table = '\n'.join(session.screen().splitlines()[9:-3])
            check('order draft survives page navigation', 0 <= order_table.find('tavily') < order_table.find('exa'))
            screens['order-draft'] = session.screen()
            session.send('?')
            session.wait('Help')
            session.send('\x1b')
            check('order draft survives contextual help without writes', 'unsaved' in session.screen().lower() and fingerprint(home) == before)
            session.send('\t\x1b[F\r')
            check('explicit Cancel discards order draft without persistence', fingerprint(home) == before)
            session.send('\x1b\x1b[B\r\x1b[B\r')
            session.wait('语言')
            session.wait('已保存')
            check('global language is saved explicitly', saved(home, 'config.json')['setupLanguage'] == 'zh')
            screens['global-language-zh'] = session.screen()
        finally:
            session.finish()
        check('native cancellation uses the selected session language', '取消' in ANSI.sub('', session.raw.decode('utf-8')).splitlines()[-1])
        # Check the ANSI branch separately from the explicit no-color focus markers.
        colored = Session(entry, home, colors=True)
        try:
            colored.wait('FIXTURE_KEY_01')
            frame = colored.raw.rsplit(CLEAR.encode(), 1)[-1]
            check('ANSI inactive toolbars have no accent-background button', not any(30 in parameters and 46 in parameters for line in frame.split(b'\n')[4:7:2] for parameters in sgr_parameters(line.split('│'.encode())[3])))
            colored.send('\r\t')
            frame = colored.raw.rsplit(CLEAR.encode(), 1)[-1]
            check('ANSI active toolbar accents exactly one button', sum(30 in parameters and 46 in parameters for parameters in sgr_parameters(frame.split(b'\n')[4].split('│'.encode())[3])) == 1)
            check('focused pane has cyan bold border', any(36 in codes and 1 in codes for codes in sgr_parameters(frame)))
        finally:
            colored.finish()
        # Reproduce the reported Firecrawl return path, with independent cell measurement.
        for language in ('en', 'zh'):
            for colors in (False, True):
                return_home = base / f'return-{language}-{colors}'
                return_home.mkdir()
                returning = Session(entry, return_home, 'firecrawl', colors=colors, language=language)
                try:
                    returning.wait('Firecrawl')
                    returning.send('\r\r')
                    returning.wait('Plaintext storage' if language == 'en' else '明文保存')
                    returning.send('\x1b')
                    before_return = returning.screen()
                    returning.send('\x1b')
                    after_return = returning.screen()
                    for phase, frame in [('content', before_return), ('sidebar', after_return)]:
                        check(f'Firecrawl {language}/{colors} {phase} panes are aligned', pane_columns(frame) == {(0, 17, 19, 78)})
                    check('Esc return retains Firecrawl content', '─ Firecrawl ' in after_return)
                    check('unavailable buttons use no multiplication marker', '×' not in after_return)
                    returning.send('\t\t\t')
                    returning.wait('On' if language == 'en' else '供应商启用')
                    returning.send('\r')
                    returning.wait('Off' if language == 'en' else '供应商禁用')
                    check('provider switch commits disabled state', not saved(return_home, 'config.json')['providers']['firecrawl']['enabled'])
                    if colors:
                        parameters = sgr_parameters(returning.raw.rsplit(CLEAR.encode(), 1)[-1])
                        check('disabled provider status has red semantics', any(31 in codes for codes in parameters))
                        check('unavailable buttons are grey or dim', any(90 in codes or 2 in codes for codes in parameters))
                    else:
                        check('NO_COLOR has no SGR styles', not sgr_parameters(returning.raw.rsplit(CLEAR.encode(), 1)[-1]))
                    screens[f'firecrawl-return-{language}-{colors}'] = returning.screen()
                    returning.resize(16, 60)
                    returning.send('\t\t\t\x1b[F')
                    check('60x16 focused final action is visible in full', ('[Preview]' if language == 'en' else '[预览]') in returning.screen())
                    check('compact bordered panes align without overflow', pane_columns(returning.screen()) == {(0, 15, 17, 58)})
                    check('compact page stays within sixteen rows', len(returning.screen().splitlines()) <= 16)
                    screens[f'compact-actions-{language}-{colors}'] = returning.screen()
                finally:
                    returning.finish()
        # Opening existing setup and non-TTY invocation preserve bytes.
        before = fingerprint(home)
        env = dict(os.environ, ARKSPACE_HOME=str(home))
        result = subprocess.run(['node', str(entry), 'setup', '--lang', 'en'], env=env, cwd=ROOT, capture_output=True, timeout=5)
        check('non-TTY entry succeeds without interactive prompts', result.returncode == 0)
        check('non-TTY preserves existing config/credential/state bytes', fingerprint(home) == before)
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Fixture)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        home = base/'searxng'
        home.mkdir()
        session = Session(entry, home, 'searxng')
        try:
            session.wait('SearXNG')
            session.send('\r\r')
            session.wait('HTTP(S) URL')
            url = f'http://127.0.0.1:{server.server_port}'
            session.send(url)
            session.send('\t\t\t\r', 0.35)
            session.wait('Authorize')
            check('adding an instance makes no request before permission', not Fixture.requests)
            session.send('y')
            check('network permission ignores y', not Fixture.requests and url not in (home/'config.json').read_text())
            session.send('\x1b[C\r', 0.4)
            session.wait('Saved')
            instance = saved(home, 'config.json')['providers']['searxng']['instances'][0]
            check('explicit authorization saves only narrow instance permission', instance['allowRanges'] == ['127.0.0.1/32'])
            check('saving the instance is offline', not Fixture.requests)
            session.send('\t\t\x1b[C\r')
            session.wait('Test connection')
            session.send('\r')
            check('default-cancel test sends no request', not Fixture.requests)
            session.send('\r')
            session.send('\x1b[C\r', 0.5)
            session.wait('success')
            check('confirmed test uses shared real execution', len(Fixture.requests) == 1)
            query = parse_qs(urlparse(Fixture.requests[0]).query)
            check('test query is fixed and bounded', query.get('q') == ['Agent Skills documentation'] and query.get('format') == ['json'])
            screens['local-fixture-test'] = session.screen()
            session.send('\r')  # Close details
            Fixture.delay = 1.5
            session.send('\r')
            session.send('\x1b[C\r', 0.2)
            session.wait('Testing connection')
            session.send('\x03', 0.2)
        finally:
            session.finish()
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)
    return {'platform': 'Linux PTY; synthetic keys and owned local HTTP fixture only', 'entry': str(entry), 'checks': checks, 'screens': screens, 'cleanup': 'Temporary homes and HTTP listener closed; no global install or real service request'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--entry', type=pathlib.Path, default=ROOT/'dist/cli/main.js')
    parser.add_argument('--report', type=pathlib.Path, required=True)
    args = parser.parse_args()
    report = run(args.entry.resolve())
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print(f'{len(checks)} real-entry checks passed; report: {args.report}')
