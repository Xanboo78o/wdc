#!/usr/bin/env python3
"""mz.py — talk to the MOZA base's serial port (protocol: boxflat's serial.yml).
   mz.py read  GROUP DEV ID[,ID..] [NBYTES]      a READ request (changes nothing)
   mz.py write GROUP DEV ID[,ID..] B[,B..]       a WRITE (only with --yes)
Frame: 0x7E, len(payload), group, device, id..., payload..., (sum+13)%256."""
import os, sys, termios, time, select
PORT = "/dev/ttyACM0"
def frame(group, dev, ids, payload):
    b = bytearray([0x7E, len(ids) + len(payload), group, dev]) + bytes(ids) + bytes(payload)      # the length counts the id bytes too
    b.append((sum(b) + 13) % 256)
    return bytes(b)
def open_port():
    fd = os.open(PORT, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    a = termios.tcgetattr(fd)
    a[0] = 0; a[1] = 0; a[3] = 0
    a[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
    a[4] = a[5] = termios.B115200
    termios.tcsetattr(fd, termios.TCSANOW, a)
    termios.tcflush(fd, termios.TCIOFLUSH)
    return fd
def listen(fd, secs):
    out = bytearray(); end = time.time() + secs
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.05)
        if r:
            try: out += os.read(fd, 256)
            except BlockingIOError: pass
    return bytes(out)
def frames(buf):
    i = 0; res = []
    while i < len(buf):
        if buf[i] != 0x7E or i + 4 > len(buf): i += 1; continue
        n = buf[i + 1]; end = i + 4 + n + 1
        if end > len(buf): break
        f = buf[i:end]
        if (sum(f[:-1]) + 13) % 256 == f[-1]: res.append(f); i = end
        else: i += 1
    return res
if __name__ == "__main__":
    mode, group, dev = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    ids = [int(x) for x in sys.argv[4].split(",")]
    if mode == "read":
        n = int(sys.argv[5]) if len(sys.argv) > 5 else 1
        payload = [0] * (n - 1) + [1] if n else []
    else:
        if "--yes" not in sys.argv: sys.exit("write needs --yes")
        payload = [int(x) for x in sys.argv[5].split(",")]
    fd = open_port()
    msg = frame(group, dev, ids, payload)
    os.write(fd, msg)
    got = listen(fd, 0.5)
    os.close(fd)
    print("sent", msg.hex(" "))
    for f in frames(got):
        g = f[2] ^ 0x80; d = ((f[3] & 0x0F) << 4) | (f[3] >> 4)
        if g != 142: print("  reply group %d device %d payload %s" % (g, d, f[4:-1].hex(" ")))
    if not [f for f in frames(got) if (f[2] ^ 0x80) != 142]: print("  no valid reply (%d raw bytes: %s)" % (len(got), got[:40].hex(" ")))
