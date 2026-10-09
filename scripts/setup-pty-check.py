#!/usr/bin/env python3
"""ArkSpace MIT; adapted from repository-owned setup PTY fixtures, not external code.
Linux real PTY qualification only. No scratch imports, services, or real credentials.
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
CLEAR = '\x1b[2J\x1b[H'
ANSI = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')
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


class Session:
    def __init__(self, entry, home, trace, rows=24, columns=80, language='en', service=None):
        self.master, self.slave = pty.openpty()
        self.process = None
        self.raw = b''
        self.original = termios.tcgetattr(self.slave)
        try:
            self.resize(rows, columns)
            # Both executable seams use the real CLI, never a controller import.
            command = [str(entry)] if entry.name == 'arks' else ['node', str(entry)]
            self.process = subprocess.Popen(command + ['setup'] + ([service] if service else []) + ['--lang', language],
                stdin=self.slave, stdout=self.slave, stderr=self.slave,
                env=environment(home, trace), cwd=home, start_new_session=True)
        except BaseException:
            os.close(self.master)
            os.close(self.slave)
            raise

    def resize(self, rows, columns):
        fcntl.ioctl(self.slave, termios.TIOCSWINSZ, struct.pack('HHHH', rows, columns, 0, 0))
        if self.process:
            os.kill(self.process.pid, signal.SIGWINCH)
            self.read(0.15)

    def read(self, duration=0.12):
        until = time.monotonic() + duration
        while time.monotonic() < until:
            if select.select([self.master], [], [], min(0.03, max(0, until-time.monotonic())))[0]:
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
        # Each control sequence is a separate raw write, not a multi-command paste.
        if isinstance(keys, str):
            tokens = re.findall(r'\x1b\[[0-9;]*[A-Za-z~]|[\x00-\x1f\x7f]', keys)
            if len(tokens) > 1 and ''.join(tokens) == keys:
                for token in tokens:
                    self.send(token, 0.08)
                return self.read(delay)
        os.write(self.master, keys.encode() if isinstance(keys, str) else keys)
        return self.read(delay)

    def until(self, probe, description, timeout=4):
        assert self.process is not None
        deadline = time.monotonic() + timeout
        while not probe() and time.monotonic() < deadline:
            self.read(0.05)
            if self.process.poll() is not None:
                break
        if not probe():
            raise AssertionError('Timed out: ' + description)

    def wait(self, text):
        frame = self.screen().replace(KEY, '<synthetic secret>').splitlines()
        self.until(lambda: text in self.screen(), text + '\n' + '\n'.join(frame[:7] + frame[-2:]))

    def wait_unchanged(self, language):
        def closed_frame():
            frame = self.screen()
            return (('No changes.' if language == 'en' else '没有修改。') in frame
                    and ('Reference' if language == 'en' else '引用') in frame
                    and ('Edit Exa' if language == 'en' else '编辑 Exa') not in frame)
        self.until(closed_frame, 'unchanged Save completed and edit page closed')

    def finish(self):
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
            check('alternate screen and cursor restored', b'\x1b[?1049l' in self.raw and b'\x1b[?25h' in self.raw)
            check('no synthetic secret or hostile response body in terminal history', KEY.encode() not in self.raw)
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
    values = [KEY] + [KEY + '-' + c for c in 'bcd'[:count-1]]
    credentials = home / 'credentials.json'
    credentials.write_text(json.dumps({'version': 1, 'values': dict(zip(variables, values, strict=True))}))
    credentials.chmod(0o600)


def run(entry):
    with tempfile.TemporaryDirectory(prefix='arks-setup-pty-') as temporary:
        base = pathlib.Path(temporary)
        trace = base / 'attempts.txt'
        for language, rows, columns in [('en', 24, 80), ('zh', 16, 60)]:
            home = base / language
            prepare(entry, home, trace, 2)
            session = Session(entry, home, trace, rows, columns, language)
            try:
                session.wait('Config' if language == 'en' else '配置')
                if language == 'en':
                    check('80-column default header shows all five services', all('[' + name + ']' in session.screen().splitlines()[0] for name in ['Exa', 'Tavily', 'Firecrawl', 'SearXNG', 'WeKnora']))
                before = fingerprint(home)
                session.send('\x1b[Z\x1b[C')
                check('raw Shift-Tab and Right select Tavily in Top', '*[Tavily]' in session.screen())
                session.send('\x1b[D\t\t')
                session.send('\n')
                session.wait('Edit Exa' if language == 'en' else '编辑 Exa')
                session.wait(f'{len(KEY)} characters' if language == 'en' else f'{len(KEY)} 字符')
                check('raw LF opens existing masked draft without writes', KEY not in session.screen() and fingerprint(home) == before)
                session.send('\r')
                session.send('X')
                session.send('\t')
                check('editing Tab cannot submit draft', fingerprint(home) == before)
                session.send('\x1b')
                session.wait(f'{len(KEY)} characters' if language == 'en' else f'{len(KEY)} 字符')
                check('field Esc restores masked preload without writes', fingerprint(home) == before)
                session.send('\x13')
                session.wait_unchanged(language)
                check('unchanged Save closes without overwrite consent or writes', fingerprint(home) == before)
                session.send('\r')
                session.wait('Edit Exa' if language == 'en' else '编辑 Exa')
                check('raw CR opens masked edit draft only', fingerprint(home) == before and KEY not in session.screen())
                session.send('\x13')
                session.wait_unchanged(language)
                session.send('d')
                session.wait('Delete' if language == 'en' else '删除')
                session.send('\r')
                check('delete confirmation defaults Cancel', fingerprint(home) == before)
                session.send(' ')
                session.send('\x1b[B')
                session.send(' ')
                session.send('\x1b[A')
                before = fingerprint(home)
                check('disabled references have persistent normal health state', (home / 'state.json').exists())
                session.send('t')
                session.wait('Test all 2 keys individually' if language == 'en' else '逐一测试全部 2 个 Key')
                session.wait('fees/logging' if language == 'en' else '可能计费')
                session.send('\r')
                check('provider test defaults Cancel and makes zero requests', trace.read_text() == '')
                session.send('t')
                session.send('\x1b[B\x1b[C\r')
                session.wait('Key results: 1/2 passed' if language == 'en' else 'Key 结果：1/2 通过')
                check('all-key test attempts A then B exactly once', trace.read_text().splitlines() == ['A', 'B'])
                check('all-key diagnostics preserve config/credentials/normal state', fingerprint(home) == before)
                check('results classify A success and B failure', ('passed' in session.screen() and 'failed' in session.screen()) if language == 'en' else ('通过' in session.screen() and '失败' in session.screen()))
                session.send('\r')
                session.send('i')
                session.wait('Effective source' if language == 'en' else '生效来源')
                detail_frames = session.screen()
                for _ in range(4):
                    session.send('\x1b[6~')
                    detail_frames += '\n' + session.screen()
                check('details separate normal manual disable from session success',
                      ('Key health: disabled' in detail_frames and 'manually disabled' in detail_frames and 'Last diagnostic: passed' in detail_frames)
                      if language == 'en' else ('密钥健康: 已禁用' in detail_frames and '手动禁用' in detail_frames and '最近诊断: 通过' in detail_frames))
                check('session detail includes diagnostic completion and duration',
                      ('Completed:' in detail_frames and 'Duration:' in detail_frames) if language == 'en' else ('完成时间:' in detail_frames and '耗时:' in detail_frames))
                check('session detail explicitly warns historical result is not current validation',
                      'Historical session result' in detail_frames if language == 'en' else '本次会话的历史结果' in detail_frames)
                check('detail readback does not write normal or credential state', fingerprint(home) == before)
                session.send('\r')
                session.send('e')
                session.wait('Edit Exa' if language == 'en' else '编辑 Exa')
                session.send('\r')
                session.send('X')
                session.resize(8, 24)
                session.wait('Window too small' if language == 'en' else '窗口过小')
                session.send('\x13\t\r')
                check('tiny resize blocks hidden Save and masks secret', fingerprint(home) == before and KEY not in session.screen())
                session.resize(rows, columns)
                session.wait(f'{len(KEY)+1} characters' if language == 'en' else f'{len(KEY)+1} 字符')
                session.send('\x1b')
                session.send('\x1b')
                check('resize retains draft and field/form Esc cancel without writes', fingerprint(home) == before)
            finally:
                session.finish()
            check('owned diagnostic temporary directories removed', not any(p.is_dir() for p in home.iterdir()))
        home = base / 'cancel'
        prepare(entry, home, trace, 4)
        session = Session(entry, home, trace)
        try:
            session.wait('Config')
            before = fingerprint(home)
            session.send('\x1b[C')
            session.send('t')
            session.wait('Test all 4 keys individually')
            session.send('\x1b[B\x1b[C\r', 0.05)
            # C is actually in flight; wording before the count may change independently.
            session.until(lambda: trace.read_text().splitlines() == ['A', 'B', 'C'] and '2/4' in session.screen(), 'A/B completed, C in flight with visible completed count')
            check('visible progress counts completed A/B, not C or pending D', '2/4' in session.screen())
            check('current diagnostic target is C while completed count remains two', 'Testing env:EXA_API_KEY_2' in session.screen())
            session.send('\x1b')
            session.wait('Key results: 1/4 passed · stopped')
            for reference, status in [('EXA_API_KEY ·', 'passed'), ('EXA_API_KEY_1 ·', 'failed'), ('EXA_API_KEY_2 ·', 'cancelled'), ('EXA_API_KEY_3 ·', 'not tested')]:
                check('partial result ' + reference + ' ' + status, any(reference in line and status in line for line in session.screen().splitlines()))
            check('Esc never submits pending D', trace.read_text().splitlines() == ['A', 'B', 'C'])
            check('partial diagnostics preserve normal state', fingerprint(home) == before)
            session.send('\r')
            assert session.process is not None
            check('diagnostic Esc cancellation keeps setup alive', session.process.poll() is None)
        finally:
            session.finish()
        check('cancelled diagnostic temporary directories removed', not any(p.is_dir() for p in home.iterdir()))
        home = base / 'weknora'
        prepare(entry, home, trace, 1)
        session = Session(entry, home, trace, columns=100, service='weknora')
        try:
            session.wait('WeKnora configuration')
            check('WeKnora primary list distinguishes two required and one optional setting', session.screen().count('Required ·') == 2 and session.screen().count('Optional ·') == 1)
            empty = fingerprint(home)
            session.send('\x1b[C\r')
            session.wait('*API URL')
            check('empty WeKnora edits only selected address', '*API key' not in session.screen() and 'KB ID' not in session.screen())
            session.send('\r')
            session.send('https://kb.example/prefix/api/v1')
            session.send('\r\x13')
            # Require the table label delimiter; "Setting" alone also matches menu "Settings".
            session.wait('│   Setting ')
            check('incomplete WeKnora address remains session-only without file changes', fingerprint(home) == empty and 'Draft · add key' in session.screen())
            session.send('\x1b[B')
            session.send('e')
            session.wait('*API key')
            check('empty WeKnora edits only selected key', '*API URL' not in session.screen() and 'KB ID' not in session.screen())
            session.send('\r')
            session.send(KEY)
            session.send('\r\x13')
            session.wait('│   Setting ')
            session.wait('Configured · not tested')
            session.send('\x1b[B')
            session.send('e')
            session.wait('KB ID')
            session.send('\r')
            session.send('kb-default')
            session.send('\r\x13')
            session.wait('│   Setting ')
            session.send('\x1b[A\x1b[A')
            connection = json.loads((home / 'config.json').read_text())['connections']['weknora']
            check('WeKnora real PTY saves explicit API prefix and offline default', connection['baseUrl'] == 'https://kb.example/prefix/api/v1' and connection['defaultKnowledgeBaseId'] == 'kb-default')
            check('WeKnora real PTY stores dedicated credential separately', json.loads((home / 'credentials.json').read_text())['values']['ARKSPACE_WEKNORA_API_KEY'] == KEY and KEY not in (home / 'config.json').read_text())
            check('WeKnora save stays offline and outside Web order', trace.read_text() == '' and 'weknora' not in json.loads((home / 'config.json').read_text())['providerOrder'])
            before = fingerprint(home)
            session.send('e')
            session.wait('*API URL')
            check('WeKnora selected address edit has one field', '*API key' not in session.screen() and 'KB ID' not in session.screen())
            session.send('\x13')
            session.wait('│   Setting ')
            check('WeKnora unchanged field save has no writes', fingerprint(home) == before)
            session.send('\x1b[B')
            session.send('e')
            session.wait('*API key')
            session.wait(str(len(KEY)) + ' characters')
            check('WeKnora selected key edit is masked and field-specific', '*API URL' not in session.screen() and 'KB ID' not in session.screen() and KEY not in session.screen())
            session.send('\x13')
            session.wait('│   Setting ')
            session.send('p')
            session.wait('API key preview')
            session.wait('Show full')
            check('WeKnora real PTY preview starts masked without requests or writes', KEY not in session.screen() and fingerprint(home) == before and trace.read_text() == '')
            session.send('\x1b')
            session.wait('│   Setting ')
            session.send('\x1b[B')
            session.send('e')
            session.wait('KB ID')
            check('WeKnora selected default edit has no address or secret field', '*API URL' not in session.screen() and '*API key' not in session.screen())
            session.send('\r\x05')
            session.send('\x7f' * len('kb-default'))
            session.send('kb-pty-new')
            session.send('\r\x13')
            session.wait('│   Setting ')
            updated = json.loads((home / 'config.json').read_text())['connections']['weknora']
            expected = dict(connection, defaultKnowledgeBaseId='kb-pty-new')
            check('WeKnora per-field save changes only default and keeps credential bytes', updated == expected and fingerprint(home)['credentials.json'] == before['credentials.json'])
            before = fingerprint(home)
            session.send('t')
            session.wait('Test connection')
            session.send('\r')
            session.wait('│   Setting ')
            check('WeKnora probe defaults Cancel without requests or writes', trace.read_text() == '' and fingerprint(home) == before)
            session.send('d')
            session.wait('Remove local connection')
            session.send('\r')
            check('WeKnora removal defaults Cancel', fingerprint(home) == before)
            session.send('d')
            session.wait('Remove local connection')
            session.send('\x1b[C\r')
            session.wait('Not configured')
            check('WeKnora confirmed removal unlinks local connection and unshared key', 'connections' not in json.loads((home / 'config.json').read_text()) and 'ARKSPACE_WEKNORA_API_KEY' not in json.loads((home / 'credentials.json').read_text())['values'])
            removed = fingerprint(home)
            session.send('\x1b[A')
            session.send('e')
            session.wait('*API key')
            session.send('\r')
            session.send(KEY)
            session.send('\r\x13')
            session.wait('│   Setting ')
            session.send('p')
            session.wait('API key preview')
            check('WeKnora pending key preview is masked and marked unsaved', 'not saved' in session.screen() and KEY not in session.screen() and fingerprint(home) == removed)
            session.send('\x1b')
            session.wait('│   Setting ')
            session.send('\x1b\x1b')
            session.wait('Discard unsaved drafts and exit?')
            session.send('\r')
            session.wait('│   Setting ')
            process = session.process
            assert process is not None
            check('WeKnora draft exit defaults Cancel and keeps the draft without writes', 'Draft · add address' in session.screen() and fingerprint(home) == removed and process.poll() is None)
            session.send('\x1b')
            session.wait('Discard unsaved drafts and exit?')
            session.send('\x1b[C\r')
            session.until(lambda: process.poll() is not None, 'confirmed draft discard exits')
            check('WeKnora confirmed exit discards incomplete secret without file writes', process.returncode == 0 and fingerprint(home) == removed)
        finally:
            session.finish()
    return {'status': 'passed', 'platform': 'linux', 'qualification': 'real PTY; synthetic fetch only; no real services or human UX acceptance',
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
        print(json.dumps(run(args.entry.absolute())))
    except (Exception, KeyboardInterrupt) as error:
        print('Setup PTY qualification failed: ' + str(error), file=sys.stderr)
        print(json.dumps({'status': 'failed', 'platform': 'linux', 'logicalChecks': len(checks), 'checks': checks}))
        sys.exit(1)
