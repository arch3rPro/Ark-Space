import os, sys, pty, time, select, fcntl, struct, re, json
ROWS, COLS = 30, 130
class PTY:
    def __init__(self, env):
        global pid, fd
        pid, fd = pty.fork()
        if pid == 0:
            os.environ.update(env); os.environ["TERM"]="xterm-256color"
            os.execvp("node",["node","dist/cli/main.js","setup"])
        fcntl.ioctl(fd, 0x5413, struct.pack("HHHH", ROWS, COLS, 0, 0))
        self.raw=bytearray()
    def pump(self, t=0.5):
        end=time.time()+t
        while time.time()<end:
            r,_,_=select.select([fd],[],[],0.05)
            if r:
                try: d=os.read(fd,65536)
                except OSError: return
                if not d: return
                self.raw.extend(d)
    def send(self, k, t=0.5):
        w={"TAB":b"\t","DOWN":b"\x1b[B","UP":b"\x1b[A","ENTER":b"\r","ESC":b"\x1b","CSS":b"\x13"}.get(k,k.encode())
        os.write(fd,w); self.pump(t)
    def stream(self): return bytes(self.raw).decode("utf8","replace")
    def grid(self):
        scr=[[" "]*COLS for _ in range(ROWS)]; row=col=0
        tok=re.finditer(r"\x1b\[(\??)([\d;]*)([A-Za-z])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|([^\x1b]+|\x1b)", self.stream())
        for m in tok:
            if m.group(3):
                priv, params, cmd = m.group(1), m.group(2), m.group(3)
                if priv: continue
                ps=[int(x) for x in params.split(";") if x]
                if cmd=="H": row=(ps[0]-1 if ps else 0); col=(ps[1]-1) if len(ps)>1 else 0
                elif cmd=="J": scr=[[" "]*COLS for _ in range(ROWS)]
                elif cmd=="K": scr[row][col:]=[" "]*(COLS-col)
            elif m.group(4):
                for ch in m.group(4):
                    if ch=="\x1b": pass
                    elif ch=="\r": col=0
                    elif ch=="\n": row=min(row+1,ROWS-1); col=0
                    elif ord(ch)<32: pass
                    else:
                        if 0<=row<ROWS and 0<=col<COLS: scr[row][col]=ch; col+=1
        return "\n".join("".join(r).rstrip() for r in scr)
    def expect(self, tag, cond):
        print(("PASS" if cond else "FAIL"), tag); self.tagged=tag
        if not cond: print("\n".join(self.grid().splitlines()[1:9]))
