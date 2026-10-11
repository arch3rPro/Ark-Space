"""Linux development-only native terminal check; registry/npm remain offline fixtures."""
import json
import os
import pty
import select
import subprocess
import sys
import termios
import time

command = json.loads(sys.argv[1])
answer = bytes.fromhex(sys.argv[2])
master, slave = pty.openpty()
before = termios.tcgetattr(slave)
process = subprocess.Popen(command, stdin=slave, stdout=subprocess.PIPE, stderr=slave)
os.close(slave)
terminal = b""
try:
    deadline = time.monotonic() + 10
    while b"[y/N]" not in terminal and process.poll() is None:
        if time.monotonic() >= deadline:
            raise RuntimeError("Native update prompt did not arrive.")
        if select.select([master], [], [], 0.1)[0]:
            terminal += os.read(master, 4096)
    if b"[y/N]" not in terminal:
        raise RuntimeError("CLI exited without the expected native prompt.")
    os.write(master, answer)
    output, _ = process.communicate(timeout=10)
    while select.select([master], [], [], 0)[0]:
        try:
            terminal += os.read(master, 4096)
        except OSError:
            break
    restored = termios.tcgetattr(master) == before
    print(json.dumps({"code": process.returncode, "stdout": output.decode(), "stderr": terminal.decode(errors="replace"), "restored": restored}))
finally:
    if process.poll() is None:
        process.kill()
        process.wait()
    os.close(master)
