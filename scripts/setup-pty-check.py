#!/usr/bin/env python3
"""ArkSpace MIT; adapted from repository-owned setup PTY fixtures, not external code.
Linux real PTY qualification for the v2 workbench (ADR 0023/0024) only.
No scratch imports, services, or real credentials. Grid reconstruction mirrors the
differential renderer: assertions read the visible terminal picture, not escape spew.
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import signal
import subprocess
import sys
import tempfile
import time

KEY = 'synthetic-pty?credential-only'
ANSI = re.compile(r'\x1b\[(\??)([\d;]*)([A-Za-z])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|([^\x1b]+|\x1b)')
checks = []


def check(name, condition):
    if not condition:
        raise AssertionError(name)
    checks.append(name)


def fingerprint(home):
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
            for p in home.iterdir() if p.is_file()}


def environment(home, trace):
    # Deliberate allowlist: no inherited keys, NODE_OPTIONS, proxies or user config.
    return {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'HOME': str(home),
            'XDG_CONFIG_HOME': str(home), 'ARKSPACE_HOME': str(home),
            'TMPDIR': str(home), 'TERM': 'xterm-256color', 'LANG': 'C.UTF-8',
            'NO_COLOR': '1', 'ARKS_SETUP_FIXTURE_TRACE': str(trace),
            'NODE_OPTIONS': '--import=' + pathlib.Path(__file__).with_name('setup-pty-fetch-fixture.mjs').as_uri()}


class Grid:
    """Terminal picture reconstructed from the differential output stream."""

    def __init__(self, rows, columns):
        self.rows, self.columns, self.raw = rows, columns, b''

    def feed(self, data):
        self.raw += data

    def text(self):
        scr = [[' '] * self.columns for _ in range(self.rows)]
        row = col = 0
        for m in ANSI.finditer(self.raw.decode('utf-8', errors='replace')):
            if m.group(3):
                if m.group(1):
                    continue
                ps = [int(x) for x in m.group(2).split(';') if x]
                cmd = m.group(3)
                if cmd == 'H':
                    row = (ps[0] - 1 if ps else 0)
                    col = (ps[1] - 1) if len(ps) > 1 else 0
                elif cmd == 'J':
                    scr = [[' '] * self.columns for _ in range(self.rows)]
                elif cmd == 'K':
                    scr[row][col:] = [' '] * (self.columns - col)
            elif m.group(4):
                for ch in m.group(4):
                    if ch == '\x1b':
                        pass
                    elif ch == '\r':
                        col = 0
                    elif ch == '\n':
                        row = min(row + 1, self.rows - 1); col = 0
                    elif ord(ch) < 32:
                        pass
                    else:
                        if 0 <= row < self.rows and 0 <= col < self.columns:
                            scr[row][col] = ch
                            col += 1
        return '\n'.join(''.join(r).rstrip() for r in scr)


class Session:
    def __init__(self, entry, home, trace, rows=24, columns=80, language='en', service=None, kitty=False):
        self.kitty = kitty
        self.kitty_answered = False
        self.master, self.slave = pty.openpty()
        self.process = None
        self.grid = Grid(rows, columns)
        self.original = termios.tcgetattr(self.slave)
        try:
            command = [str(entry)] if entry.name == 'arks' else ['node', str(entry)]
            argv = ['setup'] + ([service] if service else []) + ['--lang', language]
            fcntl.ioctl(self.slave, termios.TIOCSWINSZ, struct.pack('HHHH', rows, columns, 0, 0))
            env = environment(home, trace)
            if kitty:
                env['PI_PROGRAM_STATUS'] = '0'  # keep negotiation to the keyboard-protocol query only
            self.process = subprocess.Popen(command + argv,
                stdin=self.slave, stdout=self.slave, stderr=self.slave,
                env=env, cwd=home, start_new_session=True)
        except BaseException:
            os.close(self.master)
            os.close(self.slave)
            raise

    @property
    def proc(self):
        assert self.process is not None
        return self.process

    def read(self, duration=0.12):
        until = time.monotonic() + duration
        while time.monotonic() < until:
            if select.select([self.master], [], [], min(0.03, max(0, until - time.monotonic())))[0]:
                try:
                    data = os.read(self.master, 65536)
                except OSError:
                    break
                if not data:
                    break
                self.grid.feed(data)
                if self.kitty and not self.kitty_answered and b'\x1b[?u' in self.grid.raw:
                    # answer the kitty push like a flags-7 terminal, then the trailing DA1 query
                    self.kitty_answered = True
                    os.write(self.master, b'\x1b[?7u\x1b[?1;2c')
        return self.screen()

    def key(self, press, release):
        """Send a press and its kitty release event back to back, like flag-2 terminals do."""
        self.send(press + release)

    def screen(self):
        return self.grid.text()

    def send(self, keys, delay=0.18):
        # Each control sequence is a separate raw write, not a multi-command paste.
        if isinstance(keys, str):
            tokens = re.findall(r'\x1b\[[0-9;]*[A-Za-z~]|[\x00-\x1f\x7f]', keys)
            if len(tokens) > 1 and ''.join(tokens) == keys:
                for token in tokens:
                    self.send(token, 0.08)
                return self.read(delay)
        os.write(self.master, keys.encode() if isinstance(keys, str) else keys)
        return self.read(delay)

    def until(self, probe, description, timeout=6):
        assert self.process is not None
        deadline = time.monotonic() + timeout
        while not probe() and time.monotonic() < deadline:
            self.read(0.05)
            if self.process.poll() is not None:
                break
        if not probe():
            raise AssertionError('Timed out: ' + description + '\n' + self.screen())

    def wait(self, text):
        self.until(lambda: text in self.screen(), text)

    def finish(self, typed_secrets, revealed=False):
        assert self.process is not None
        try:
            if self.process.poll() is None:
                self.send('\x03')
            try:
                self.process.wait(timeout=4)
            except subprocess.TimeoutExpired:
                os.killpg(self.process.pid, signal.SIGKILL)
                self.process.wait()
                raise AssertionError('CLI cleanup deadline exceeded') from None
            self.read()
            flags = termios.ICANON | termios.ECHO
            check('terminal canonical/echo restored', termios.tcgetattr(self.slave)[3] & flags == self.original[3] & flags)
            raw = self.grid.raw
            check('alternate screen, cursor, mouse and paste restored', all(s.encode() in raw for s in ['\x1b[?1049l', '\x1b[?25h', '\x1b[?1000l', '\x1b[?1003l', '\x1b[?2004l']))
            for secret in typed_secrets + [KEY + '-b']:
                check('secret/hostile body absent from output stream', secret.encode() not in raw)
            if not revealed:
                check('no synthetic secret in terminal history', KEY.encode() not in raw)
        finally:
            if self.process.poll() is None:
                os.killpg(self.process.pid, signal.SIGKILL)
                self.process.wait()
            os.close(self.master)
            os.close(self.slave)


def prepare(entry, home, trace, count):
    home.mkdir(mode=0o700)
    trace.write_text('')
    command = [str(entry)] if entry.name == 'arks' else ['node', str(entry)]
    result = subprocess.run(command + ['setup'], cwd=home, env=environment(home, trace),
                            capture_output=True, timeout=10)
    check('non-TTY real entry initializes owned configuration offline', result.returncode == 0 and trace.read_text() == '')
    try:
        config = json.loads((home / 'config.json').read_text())
    except (OSError, ValueError):
        raise AssertionError('Real entry did not create valid owned config') from None
    variables = ['EXA_API_KEY'] + [f'EXA_API_KEY_{n}' for n in range(1, count)]
    config['providers']['exa']['enabled'] = True
    config['providers']['exa']['keyRefs'] = ['env:' + v for v in variables]
    (home / 'config.json').write_text(json.dumps(config))
    values = [KEY] + [KEY + '-' + c for c in 'bcd'[:count - 1]]
    credentials = home / 'credentials.json'
    credentials.write_text(json.dumps({'version': 1, 'values': dict(zip(variables, values, strict=True))}))
    credentials.chmod(0o600)


def run(entry):
    with tempfile.TemporaryDirectory(prefix='arks-setup-pty-') as temporary:
        base = pathlib.Path(temporary)
        trace = base / 'attempts.txt'

        # ---- main English session: six contexts, keys, tests, instances, order, exit ----
        home = base / 'en'
        prepare(entry, home, trace, 2)
        session = Session(entry, home, trace)
        try:
            session.wait('[UseGPT]')
            first = session.screen().splitlines()[0]
            check('top strip shows all six contexts', all('[' + n + ']' in first for n in ['Exa', 'Tavily', 'Firecrawl', 'SearXNG', 'WeKnora', 'UseGPT']))
            check('menu lists the four pages', all(x in session.screen() for x in ['Providers', 'Order', 'Diagnostics']))
            session.send('\t\t')
            check('Tab focuses top then menu then content', 'env:EXA_API_KEY' in session.screen() and '[a] add' in session.screen())

            # add key: masked entry persists a new reference with 0600 credentials
            session.send('a')
            session.wait('Add key')
            session.send(KEY + '-z')
            session.send('\r\x13')
            session.wait('key added: env:EXA_API_KEY_2')
            creds = json.loads((home / 'credentials.json').read_text())
            check('added key persists and stays masked', 'EXA_API_KEY_2' in creds['values'] and KEY + '-z' not in session.screen())
            check('credential file mode remains 0600', (home / 'credentials.json').stat().st_mode & 0o777 == 0o600)

            # replace with overwrite consent; cancel default must not write
            before = fingerprint(home)
            session.send('\x1b[B\x1b[B')   # down to the new env:EXA_API_KEY_2 row
            session.send('e')
            session.wait('Edit key')
            session.send(KEY + '-y')       # edit form opens already typing
            session.send('\r\x13')
            session.wait('Overwrite env:EXA_API_KEY_2? (cancel default)')
            session.send('\r')
            check('overwrite defaults Cancel and keeps the form open', fingerprint(home) == before and 'Edit key' in session.screen())
            session.send('\x13\x1b[B\r')
            session.wait('key replaced: env:EXA_API_KEY_2')

            # toggle enable/disable on row 0
            session.send('\x1b[A\x1b[A ')
            session.wait('env:EXA_API_KEY disabled')
            session.send(' ')
            session.wait('env:EXA_API_KEY enabled')

            # preview: masked by default, r reveals, leaving clears
            session.send('p')
            session.wait('Key preview')
            check('preview starts masked', KEY not in session.screen())
            session.send('r')
            session.wait(KEY)
            session.send('\x1b')
            session.wait('env:EXA_API_KEY')
            check('preview value cleared on leave', KEY not in session.screen())

            # remove the synthetic third key again (its secret is unknown to the fixture)
            session.send('\x1b[B\x1b[B')
            session.send('d')
            session.wait('Remove env:EXA_API_KEY_2? (cancel default)')
            session.send('\x1b[B\r')
            session.wait('env:EXA_API_KEY_2 removed/its diagnostics invalidated')
            check('confirmed remove deletes the reference', 'env:EXA_API_KEY_2' not in (home / 'config.json').read_text())

            # chooser cancel default makes zero requests
            session.send('t')
            session.wait('Test connection')
            check('test consent mentions billing/logging', 'billed and logged' in session.screen())
            session.send('\r')
            check('test chooser defaults Cancel with zero requests', trace.read_text() == '')

            # all-keys run: A passes, B fails 401 once each, nothing else mutated
            before = fingerprint(home)
            session.send('t\x1b[B\x1b[B\r')
            session.wait('Keys: 1/2 passed')
            check('all-key test attempts A then B exactly once', trace.read_text().splitlines() == ['A', 'B'])
            check('all-key diagnostics preserve config/credentials/normal state', fingerprint(home) == before)

            # diagnostics page keeps the failure rows (pool would clear them by design)
            session.send('\t\t\x1b[B\x1b[B\x1b[B\r')
            session.wait('env:EXA_API_KEY_1')
            check('diagnostics classify failure with a reason only', 'failure' in session.screen() and KEY + '-b' not in session.screen())

            # back to Providers, then the pool e2e sample through the real registry
            session.send('\t\t\x1b[A\x1b[A\x1b[A\r')
            session.wait('[a] add')
            session.send('t\x1b[B\r')
            session.wait('Connection success')
            session.wait('exa success')
            check('pool run issues exactly one request', trace.read_text().splitlines()[-1] == 'A')

            # order draft: swap shows unsaved, Ctrl-S persists
            session.send('\t\t\x1b[B\r')   # menu: Providers -> Order
            session.wait('1.')
            session.send('\x1b[A')                 # cursor onto the first row
            before_order = json.loads((home / 'config.json').read_text())['providerOrder']
            session.send('d')
            session.wait('unsaved')
            session.send('\x13')
            session.wait('routing order saved')
            after_order = json.loads((home / 'config.json').read_text())['providerOrder']
            check('order save changed the persisted sequence', after_order != before_order)

            # searxng private endpoint requires an explicit per-instance grant
            session.send('\t\t\x1b[A\r')   # menu cursor: Order -> Providers page
            session.send('\x1b[C')
            session.send('\x1b[C')
            session.send('\x1b[C')
            session.wait('no instances')
            session.send('a')
            session.send('http://127.0.0.1:8080')
            session.send('\r\x13')
            session.wait('Authorize 127.0.0.1/32')
            check('CIDR gate defaults Cancel', 'cancel' in session.screen().lower())
            session.send('\x1b[B\r')
            session.wait('instance added')
            instances = json.loads((home / 'config.json').read_text())['providers']['searxng']['instances']
            check('grant writes the exact /32 only', instances == [{'baseUrl': 'http://127.0.0.1:8080', 'allowRanges': ['127.0.0.1/32']}])

            # exit confirmation defaults Cancel, then restores cleanly
            before = fingerprint(home)
            session.send('q')
            session.wait('Exit ArkSpace Setup? (cancel default)')
            session.send('\r')
            check('exit defaults Cancel with no further writes', session.proc.poll() is None and fingerprint(home) == before)
            session.send('q\x1b[B\r')
            session.until(lambda: session.proc.poll() is not None, 'confirmed exit')
            check('confirmed exit returns 0', session.proc.returncode == 0)
            session.finish([KEY + '-z', KEY + '-y'], revealed=True)
        finally:
            if session.process and session.process.poll() is None:
                session.finish([KEY + '-z', KEY + '-y'], revealed=True)

        # ---- mid-run Esc keeps partial results and never submits pending keys ----
        home = base / 'cancel'
        prepare(entry, home, trace, 4)
        session = Session(entry, home, trace)
        try:
            session.wait('[UseGPT]')
            session.send('\t\t')
            before = fingerprint(home)
            session.send('t\x1b[B\x1b[B\r')
            session.until(lambda: trace.read_text().splitlines() == ['A', 'B', 'C'] and '2/4' in session.screen(),
                          'A/B completed, C in flight with visible completed count')
            check('current diagnostic target is C while completed count remains two', 'Testing EXA_API_KEY_2' in session.screen())
            session.send('\x1b')
            session.wait('Keys: 1/4 passed/stopped')
            session.send('\t\t\x1b[B\x1b[B\x1b[B\r')  # menu -> Diagnostics page
            session.wait('env:EXA_API_KEY_3')
            screen = session.screen()
            for reference, status in [('env:EXA_API_KEY', 'success'), ('env:EXA_API_KEY_1', 'failure'),
                                      ('env:EXA_API_KEY_2', 'cancelled'), ('env:EXA_API_KEY_3', 'not tested')]:
                check('partial result ' + reference + ' ' + status,
                      any(reference in line and status in line for line in screen.splitlines()))
            check('Esc never submits pending D', trace.read_text().splitlines() == ['A', 'B', 'C'])
            check('partial diagnostics preserve normal state', fingerprint(home) == before)
            session.send('q\x1b[B\r')
            session.until(lambda: session.proc.poll() is not None, 'exit after cancellation')
        finally:
            session.finish([KEY + '-z', KEY + '-y'])

        # ---- WeKnora deep link: masked chain save, guards, consented verify cancel ----
        home = base / 'weknora'
        prepare(entry, home, trace, 1)
        session = Session(entry, home, trace, columns=100, service='weknora')
        try:
            session.wait('API endpoint')
            check('weknora deep link opens content focus directly', 'verify connection' in session.screen() and '[a] add' not in session.screen())
            empty = fingerprint(home)
            session.send('\x1b[B\r')
            session.wait('WeKnora API key')
            session.send(KEY)
            session.send('\r\x13')
            session.wait('WeKnora is not configured yet')
            check('key without endpoint fails safely, masked, unwritten', KEY not in session.screen() and fingerprint(home) == empty and trace.read_text() == '')
            # the failed form already closed itself; move up and start with the endpoint
            session.send('\x1b[A')
            session.send('\r')
            session.send('\r')          # start typing in the prefilled field
            session.send('https://kb.example/api/v1')
            session.send('\r\x13')       # save chains straight into the key field
            session.wait('WeKnora API key')  # chained second field, one write
            session.send(KEY)
            session.send('\r\x13')
            session.wait('WeKnora connection saved')
            connection = json.loads((home / 'config.json').read_text())['connections']['weknora']
            check('chained setup stores prefix endpoint', connection['baseUrl'] == 'https://kb.example/api/v1')
            check('credential stored separately from config', json.loads((home / 'credentials.json').read_text())['values']['ARKSPACE_WEKNORA_API_KEY'] == KEY and KEY not in (home / 'config.json').read_text())
            session.send('\x1b[B\x1b[B\r')   # knowledge base row
            session.send('\r')                # prefilled edit: Enter starts typing
            session.send('kb-pty')
            session.send('\r\x13')
            session.wait('WeKnora connection saved')
            check('knowledge base row updates only the default', json.loads((home / 'config.json').read_text())['connections']['weknora']['defaultKnowledgeBaseId'] == 'kb-pty')
            before = fingerprint(home)
            session.send('\x1b[B\r')
            session.wait('GET /auth/me')
            session.send('\r')
            check('verify defaults Cancel with zero requests and no writes', trace.read_text() == '' and fingerprint(home) == before)
            session.send('\x1b[B\r')          # remove connection row
            session.wait('Remove the local WeKnora connection')
            session.send('\r')                # cancel default
            check('remove defaults Cancel and keeps the connection', fingerprint(home) == before and 'removed' not in session.screen())
            session.send('q\x1b[B\r')
            session.until(lambda: session.proc.poll() is not None, 'weknora exit')
        finally:
            session.finish([])

        # ---- UseGPT deep link: status, diagnosis, start consent defaults Cancel ----
        home = base / 'usegpt'
        prepare(entry, home, trace, 1)
        session = Session(entry, home, trace, columns=100, service='usegpt')
        try:
            session.wait('Hub artifact store')
            check('usegpt page lists services and actions', all(x in session.screen() for x in ['Tunnel service', 'Start services', 'Stop services', 'Diagnose']))
            check('usegpt page exposes the retired-shell config surface', all(x in session.screen() for x in ['Tunnel ID', 'Data directory', 'API key', 'Unlink configuration']))
            session.send('\x1b[B\x1b[B\x1b[B\x1b[B\r')
            session.wait('configuration_incomplete')
            session.send('\x1b[A\x1b[A\r')   # up from Diagnose to Start services
            session.wait('Start the Hub and Tunnel')
            session.send('\r')
            check('start defaults Cancel: no processes spawned', trace.read_text() == '' and not any((home / p).exists() for p in ['tunnel.pid', 'hub.pid']))
            empty = fingerprint(home)
            session.send('\x1b[B\x1b[B\x1b[B\r')   # row 2 (after Start) -> down 3 = Tunnel ID row
            session.wait('UseGPT Tunnel ID')
            session.send('\r')                 # start typing
            session.send('nope')
            session.send('\r\x13')
            check('invalid tunnel id is refused without writing', 'must be tunnel_' in session.screen() and fingerprint(home) == empty)
            session.send('\r')                 # resume typing on the retained draft
            session.send('\x7f\x7f\x7f\x7f')     # backspace over 'nope'
            session.send('tunnel_pty_00000001')
            session.send('\r\x13')
            session.wait('UseGPT configuration saved')
            check('valid tunnel id persists offline', json.loads((home / 'config.json').read_text())['connections']['usegpt']['tunnelId'] == 'tunnel_pty_00000001' and trace.read_text() == '')
            session.send('\x1b[B\x1b[B\r')   # API key row
            session.wait('UseGPT API key')
            session.send(KEY)                   # secret form opens mid-typing
            check('secret entry never echoes', KEY not in session.screen())
            session.send('\x1b\x1b')          # leave without saving
            session.send('q\x1b[B\r')
            session.until(lambda: session.proc.poll() is not None, 'usegpt exit')
        finally:
            session.finish([])

        # ---- kitty keyboard protocol session: press+release pairs and CSI-u printables ----
        home = base / 'kitty'
        prepare(entry, home, trace, 2)
        session = Session(entry, home, trace, kitty=True)
        try:
            session.wait('[UseGPT]')
            check('kitty negotiation was answered and activated', session.kitty_answered)
            session.key('\t', '\x1b[9;1:3~')       # top -> menu
            session.key('\x1b[B', '\x1b[1;1:3B')   # one down step; the release must not move again
            time.sleep(0.2)
            check('kitty release events do not double-step the menu',
                  '> Order' in session.screen() and '> Settings' not in session.screen())
            session.key('\t', '\x1b[9;1:3~')       # menu -> content
            session.key('\x1b[97u', '\x1b[97;1:3u')  # 'a' as kitty sends it with flag 1
            session.wait('Add key')
            check('CSI-u printable letters drive the form', True)
            for cp in (115, 107, 45, 116, 121, 45, 57):  # "sk-tyy09"-ish via CSI-u: s k - t y y 0 9
                session.key('\x1b[' + str(cp) + 'u', '\x1b[' + str(cp) + ';1:3u')
            check('CSI-u typing counts characters without echo', '7 characters' in session.screen())
            session.send(KEY[:24])  # mixed legacy bytes are still plain printables
            session.send('\r')
            session.key('\x1b[115;5u', '\x1b[115;5:3u')  # ctrl+s press+release saves exactly once
            session.wait('key added')
            refs = json.loads((home / 'config.json').read_text())['providers']['exa']['keyRefs']
            check('kitty save wrote exactly one new reference', len(refs) == 3)
            session.send('q')
            session.wait('Exit ArkSpace Setup? (cancel default)')
            session.key('\x1b[B', '\x1b[1;1:3B')
            session.key('\r', '\x1b[13;1:3u')
            session.until(lambda: session.proc.poll() is not None, 'kitty confirmed exit')
            check('kitty confirmed exit returns 0', session.proc.returncode == 0)
            session.finish([KEY[:24]], revealed=True)
        finally:
            if session.process and session.process.poll() is None:
                session.finish([KEY[:24]], revealed=True)

        # ---- Chinese session at a small terminal: geometry holds and labels localize ----
        home = base / 'zh'
        prepare(entry, home, trace, 2)
        session = Session(entry, home, trace, rows=16, columns=60, language='zh')
        try:
            session.wait('[Exa]')
            check('窄屏下六上下文条优雅截断', '[Firecrawl]' in session.screen())
            check('中文菜单渲染', '路由顺序' in session.screen() and '诊断' in session.screen())
            session.send('\t\t')
            session.wait('env:EXA_API_KEY')
            session.send('a')
            session.wait('添加密钥')
            check('小尺寸表单不溢出', len(max(session.screen().splitlines(), key=len)) <= 60)
            session.send('\x1b\x1b')
            session.send('q\x1b[B\r')
            session.until(lambda: session.proc.poll() is not None, 'zh exit')
        finally:
            session.finish([KEY + '-z'])
    return {'status': 'passed', 'platform': 'linux', 'qualification': 'real PTY against the v2 default entry; synthetic fetch only; no real services or human UX acceptance',
            'unverified': ['Windows real TTY', 'macOS real TTY'], 'logicalChecks': len(checks), 'checks': checks}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--entry', type=pathlib.Path, required=True)
    args = parser.parse_args()
    if sys.platform != 'linux':
        print(json.dumps({'status': 'skipped', 'platform': sys.platform, 'logicalChecks': 0, 'reason': 'Only Linux PTY qualified; Windows/macOS real TTY UNVERIFIED'}))
        sys.exit(0)
    import fcntl
    import pty
    import select
    import struct
    import termios
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt('PTY qualification interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    try:
        print(json.dumps(run(entry=args.entry.absolute())))
    except (Exception, KeyboardInterrupt) as error:
        print('Setup PTY qualification failed: ' + str(error), file=sys.stderr)
        print(json.dumps({'status': 'failed', 'platform': 'linux', 'logicalChecks': len(checks), 'checks': checks}))
        sys.exit(1)
