#!/usr/bin/env python3
# ffb.py — force feedback for the wheel. Runs on the PC, holds the wheel.
#
# Why a bridge at all: the browser's Gamepad API can only RUMBLE a pad. It has
# no constant force, no spring, no damper — nothing a steering wheel is made
# of. The kernel does (hid-universal-pidff drives the MOZA R3 and advertises
# constant, periodic, spring, damper, friction, inertia, ramp and gain), but
# only to a program holding /dev/input/eventN. So this holds it, and the game
# sends it one small JSON message a frame over a WebSocket on localhost:
#
#   game  --{"f":0.31,"r":0.2,"d":0.1}-->  ffb.py  --EVIOCSFF-->  wheel
#
#   f  steering torque, -1..1, POSITIVE PULLS THE RIM LEFT (the game's own
#      convention: positive delta is a left turn)
#   r  road texture, 0..1 — kerbs, grass, gravel, a hit
#   d  damper, 0..1 — the weight a real rack has even with no load on it
#
# Standard library only: fcntl.ioctl + struct for the kernel, a forty-line
# WebSocket server for the game. Nothing to pip install.
#
# Run:   python3 tools/ffb.py            (then just drive — the game finds it)
# Test:  python3 tools/ffb.py --probe    (nudges the rim both ways, prints
#                                         which way it went — measured, not
#                                         guessed)
#
# SAFETY. If the game stops talking for a quarter of a second — tab closed,
# paused, crashed — every force goes to zero. A wheel left holding the last
# message is a wheel that yanks your wrist when you sit back down.

import argparse, asyncio, base64, errno, fcntl, glob, hashlib, json, os, re
import struct, sys, time

# ---- linux/input.h ---------------------------------------------------------
EV_FF = 0x15
FF_PERIODIC, FF_CONSTANT, FF_DAMPER = 0x51, 0x52, 0x55
FF_SINE = 0x5a
FF_GAIN, FF_AUTOCENTER = 0x60, 0x61
# struct ff_effect is 48 bytes on 64-bit (the periodic member carries a
# pointer, which aligns the union to 8). _IOW('E', 0x80, struct ff_effect).
EVIOCSFF = 0x40304580
EVIOCRMFF = 0x40044581
DIR = 0x4000          # the X axis. Which way + goes is what --probe is for.


def effect(kind, eid, body):
    head = struct.pack('<HhHHHHH2x', kind, eid, DIR, 0, 0, 0, 0)   # length 0 = forever
    return bytearray(head + body.ljust(32, b'\0'))


def constant(level):
    return struct.pack('<h4H', level, 0, 0, 0, 0)


def sine(mag, period_ms):
    return struct.pack('<HHhhH4H2xIQ', FF_SINE, period_ms, mag, 0, 0, 0, 0, 0, 0, 0, 0)


def damper(coeff):
    one = struct.pack('<HHhhHh', 0xffff, 0xffff, coeff, coeff, 0, 0)
    return one + one


def ev(fd, typ, code, value):
    os.write(fd, struct.pack('<qqHHi', 0, 0, typ, code, value))


# ---- finding the wheel -----------------------------------------------------
def find_wheel(want):
    """The first input device whose name matches and which can do a constant
    force. The R3 enumerates only after its POWER BUTTON is pressed, so a miss
    here is usually that, not a driver problem."""
    try:
        blocks = open('/proc/bus/input/devices').read().split('\n\n')
    except OSError:
        return None, None
    for b in blocks:
        name = re.search(r'N: Name="(.*)"', b)
        ev_ = re.search(r'H: Handlers=.*?\b(event\d+)', b)
        ff = re.search(r'B: FF=([0-9a-f ]+)', b)
        if not (name and ev_ and ff):
            continue
        words = ff.group(1).split()
        bits = 0
        for w in words:                       # highest word first
            bits = (bits << 64) | int(w, 16)
        if not (bits >> FF_CONSTANT) & 1:
            continue
        if want and want.lower() not in name.group(1).lower():
            continue
        return '/dev/input/' + ev_.group(1), name.group(1)
    return None, None


class Wheel:
    def __init__(self, path, name, maxf, invert):
        self.path, self.name, self.maxf, self.sign = path, name, maxf, -1 if invert else 1
        self.fd = os.open(path, os.O_RDWR)
        ev(self.fd, EV_FF, FF_GAIN, 0xffff)
        try:
            ev(self.fd, EV_FF, FF_AUTOCENTER, 0)   # the R3 doesn't list it; harmless
        except OSError:
            pass
        self.ids = {}
        self.last = {}
        self.upload('f', FF_CONSTANT, constant(0))
        self.upload('r', FF_PERIODIC, sine(0, 25))
        self.upload('d', FF_DAMPER, damper(0))
        for eid in self.ids.values():
            ev(self.fd, EV_FF, eid, 1)

    def upload(self, key, kind, body):
        buf = effect(kind, self.ids.get(key, -1), body)
        fcntl.ioctl(self.fd, EVIOCSFF, buf, True)   # the kernel writes the id back
        self.ids[key] = struct.unpack_from('<h', buf, 2)[0]

    def set(self, f=0.0, r=0.0, d=0.0):
        clamp = lambda x, lo, hi: max(lo, min(hi, x))
        f = int(clamp(f, -1, 1) * self.maxf * self.sign * 32767)
        r = int(clamp(r, 0, 1) * self.maxf * 32767)
        d = int(clamp(d, 0, 1) * 32767)
        # Every upload is a USB report. Skip the ones nobody could feel.
        if abs(f - self.last.get('f', 1e9)) > 40:
            self.upload('f', FF_CONSTANT, constant(f)); self.last['f'] = f
        if abs(r - self.last.get('r', 1e9)) > 200:
            self.upload('r', FF_PERIODIC, sine(r, 25)); self.last['r'] = r
        if abs(d - self.last.get('d', 1e9)) > 200:
            self.upload('d', FF_DAMPER, damper(d)); self.last['d'] = d

    def close(self):
        try:
            self.set(0, 0, 0)
            for eid in self.ids.values():
                ev(self.fd, EV_FF, eid, 0)
                fcntl.ioctl(self.fd, EVIOCRMFF, eid)
        except OSError:
            pass
        os.close(self.fd)


# ---- the probe: which way does a positive force turn the rim? --------------
def probe(args):
    path, name = find_wheel(args.device)
    if not path:
        sys.exit('no force-feedback wheel found — is it switched ON? (power button)')
    js = next((j for j in glob.glob('/dev/input/js*')
               if name in open(f'/sys/class/input/{os.path.basename(j)}/device/name').read()), None)
    print(f'{name}  at {path}  (axis read from {js})')
    print(f'THE RIM WILL TURN ON ITS OWN — left, then right, at {args.probe_force:.0%}. Starting in 3 s.')
    time.sleep(3)
    w = Wheel(path, name, 1.0, False)
    jfd = os.open(js, os.O_RDONLY | os.O_NONBLOCK)

    def axis0(dur):
        v, end = None, time.time() + dur
        while time.time() < end:
            try:
                while True:
                    _, val, typ, num = struct.unpack('<IhBB', os.read(jfd, 8))
                    if typ & 0x02 and num == 0:
                        v = val / 32767
            except BlockingIOError:
                pass
            time.sleep(0.01)
        return v

    try:
        start = axis0(0.3) or 0
        w.set(f=args.probe_force); a = axis0(0.6); w.set(f=0); axis0(0.6)
        w.set(f=-args.probe_force); b = axis0(0.6); w.set(f=0)
    finally:
        w.close()
    print(f'rest {start:+.3f}   after +force {a if a is None else round(a, 3)}   after -force {b if b is None else round(b, 3)}')
    # On the R3 raw axis 0 goes NEGATIVE turning LEFT (data/wheel.json).
    if a is None or b is None or abs(a - b) < 0.01:
        print('the rim did not move — hands on it? Try --probe-force 0.35')
    else:
        left = a < b
        print('+force turns the rim', 'LEFT  -> run WITHOUT --invert' if left else 'RIGHT -> run WITH --invert')


# ---- a WebSocket server, standard library only ------------------------------
GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'


async def serve(args):
    state = {'wheel': None, 'last': 0.0, 'clients': 0}

    def wheel():
        if args.dry:
            return None
        if state['wheel'] is None:
            path, name = find_wheel(args.device)
            if path:
                try:
                    state['wheel'] = Wheel(path, name, args.max, args.invert)
                    print(f'holding {name} at {path}  (max {args.max:.0%}{", inverted" if args.invert else ""})')
                except OSError as e:
                    print(f'found {name} but could not open {path}: {e}')
        return state['wheel']

    def drop():
        if state['wheel']:
            state['wheel'].close()
            state['wheel'] = None
            print('wheel gone — waiting for it (power button?)')

    def apply(**kw):
        w = wheel()
        if not w:
            return
        try:
            w.set(**kw)
        except OSError as e:
            if e.errno in (errno.ENODEV, errno.EIO):
                drop()
            else:
                raise

    async def watchdog():
        while True:
            await asyncio.sleep(0.05)
            if state['wheel'] and time.time() - state['last'] > 0.25:
                apply(f=0, r=0, d=0)
                state['last'] = float('inf')  # zeroed; don't re-send until a message
            if not state['wheel']:
                wheel()
                await asyncio.sleep(1.0)

    async def client(reader, writer):
        try:
            head = (await reader.readuntil(b'\r\n\r\n')).decode('latin-1')
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError):
            writer.close(); return
        key = re.search(r'Sec-WebSocket-Key:\s*(\S+)', head, re.I)
        if not key:
            # a plain GET: the health check
            w = state['wheel']
            body = json.dumps({'ok': True, 'wheel': w.name if w else None, 'clients': state['clients']})
            writer.write(f'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n'
                         f'Access-Control-Allow-Origin: *\r\nContent-Length: {len(body)}\r\n\r\n{body}'.encode())
            await writer.drain(); writer.close(); return
        acc = base64.b64encode(hashlib.sha1((key.group(1) + GUID).encode()).digest()).decode()
        writer.write(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n'
                      f'Connection: Upgrade\r\nSec-WebSocket-Accept: {acc}\r\n\r\n').encode())
        await writer.drain()
        state['clients'] += 1
        print('game connected')
        w = wheel()
        hello = json.dumps({'wheel': w.name if w else None})
        writer.write(bytes([0x81, len(hello)]) + hello.encode() if len(hello) < 126 else b'')
        try:
            while True:
                b0, b1 = await reader.readexactly(2)
                op, n = b0 & 0x0f, b1 & 0x7f
                if n == 126:
                    n = struct.unpack('>H', await reader.readexactly(2))[0]
                elif n == 127:
                    n = struct.unpack('>Q', await reader.readexactly(8))[0]
                mask = await reader.readexactly(4) if b1 & 0x80 else b'\0\0\0\0'
                data = bytes(c ^ mask[i % 4] for i, c in enumerate(await reader.readexactly(n)))
                if op == 0x8:
                    break
                if op == 0x9:                           # ping -> pong
                    writer.write(bytes([0x8a, len(data)]) + data); continue
                if op != 0x1:
                    continue
                try:
                    m = json.loads(data)
                except ValueError:
                    continue
                state['last'] = time.time()
                if args.dry:
                    state['n'] = state.get('n', 0) + 1
                    if state['n'] % 30 == 0:
                        print(f"f {m.get('f', 0):+.3f}  r {m.get('r', 0):.2f}  d {m.get('d', 0):.2f}")
                    continue
                apply(f=float(m.get('f', 0)), r=float(m.get('r', 0)), d=float(m.get('d', 0)))
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        finally:
            state['clients'] -= 1
            apply(f=0, r=0, d=0)
            print('game disconnected — forces zeroed')
            writer.close()

    if args.dry:
        print('DRY RUN — printing the forces, the wheel is never touched')
    elif not wheel():
        print('no force-feedback wheel yet — switch it on (power button); I will keep looking')
    srv = await asyncio.start_server(client, '127.0.0.1', args.port)
    print(f'ffb bridge on ws://127.0.0.1:{args.port}   Ctrl+C to stop')
    asyncio.create_task(watchdog())
    try:
        async with srv:
            await srv.serve_forever()
    finally:
        drop()


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='Force feedback bridge for the WDC wheel.')
    ap.add_argument('--port', type=int, default=8179)
    ap.add_argument('--device', default='', help='part of the wheel name (default: first FFB device)')
    ap.add_argument('--max', type=float, default=0.8, help='strongest force, 0..1 of what the base can do')
    ap.add_argument('--invert', action='store_true', help='flip the torque (see --probe)')
    ap.add_argument('--dry', action='store_true', help='print the forces the game sends; never touch the wheel')
    ap.add_argument('--probe', action='store_true', help='nudge the rim both ways and report which way + turns it')
    ap.add_argument('--probe-force', type=float, default=0.2)
    args = ap.parse_args()
    if not 0 < args.max <= 1:
        sys.exit('--max is a fraction, 0 < max <= 1')
    try:
        probe(args) if args.probe else asyncio.run(serve(args))
    except KeyboardInterrupt:
        print('\nstopped — forces released')
