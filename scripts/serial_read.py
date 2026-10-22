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
        handle = serial.Serial(port, baudrate=115200, timeout=0.5)
    except serial.SerialException as exc:
        print(f"could not open port: {exc}", file=sys.stderr)
        return 1
    try:
        while True:
            chunk = handle.readline()
            if chunk:
                sys.stdout.buffer.write(chunk)
                sys.stdout.buffer.flush()
    finally:
        handle.close()


if __name__ == "__main__":
    raise SystemExit(main())
