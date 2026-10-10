#!/usr/bin/env python3
# sweep.py DEV — LIGHTS ONLY: fill the ten rev lights one by one, empty them, twice, then all off.
# One command is used: "old-send-telemetry" (group 65, id 253 222, a 4-byte mask of which lights are lit).
import os, sys, time
from mz import frame, open_port, listen
dev = int(sys.argv[1])
fd = open_port()
def lights(mask): os.write(fd, frame(65, dev, [253, 222], list(mask.to_bytes(4, "big"))))
for rep in range(2):
    for n in list(range(0, 11)) + list(range(10, -1, -1)):
        lights((1 << n) - 1); time.sleep(0.07)
lights(0)
print("sent sweep to device", dev, "| replies:", listen(fd, 0.3)[:24].hex(" "))
os.close(fd)
