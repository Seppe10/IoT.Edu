#!/usr/bin/env python3
"""Copy one serial port to stdout. This process sends no commands."""

import sys

import serial


def main() -> int:
    if len(sys.argv) != 3:
        print("expected port and baud", file=sys.stderr)
        return 2
    port = sys.argv[1]
    if int(sys.argv[2]) != 115200:
        print("unsupported baud", file=sys.stderr)
        return 2
    try:
        handle = serial.Serial()
        handle.port = port
        handle.baudrate = 115200
        handle.timeout = 0.5
        handle.dtr = False
        handle.rts = False
        handle.open()
        print("note: uart console open", flush=True)
    except serial.SerialException as exc:
        print(f"could not open port: {exc}", file=sys.stderr)
        return 1
    received = 0
    try:
        while True:
            chunk = handle.readline()
            if chunk:
                received += len(chunk)
                sys.stdout.buffer.write(chunk)
                sys.stdout.buffer.flush()
    finally:
        print(f"note: bytes received {received}", flush=True)
        handle.close()


if __name__ == "__main__":
    raise SystemExit(main())
