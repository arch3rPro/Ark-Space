#!/usr/bin/env python3
"""Compatibility entry point for ArkSpace repository validation."""

from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
npm = shutil.which("npm")
if npm is None:
    print("npm is required to validate ArkSpace skills.", file=sys.stderr)
    raise SystemExit(1)

raise SystemExit(subprocess.run([npm, "run", "validate"], cwd=ROOT, check=False).returncode)
