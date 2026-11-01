#!/usr/bin/env python3
"""Prepare an Android signing keystore for GitHub Actions without logging secrets."""

import argparse
import base64
import binascii
import os
import tempfile
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ci", action="store_true", required=True)
    parser.parse_args()

    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise SystemExit("This helper is intended for GitHub Actions only.")

    encoded = "".join(os.environ.get("HC_TV_JKS_BASE64", "").split())
    if not encoded:
        raise SystemExit("Missing HC_TV_JKS_BASE64 GitHub Actions secret.")

    try:
        keystore_bytes = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise SystemExit("HC_TV_JKS_BASE64 must contain valid Base64.") from None

    if len(keystore_bytes) < 32:
        raise SystemExit("Decoded Android signing keystore is unexpectedly small.")

    runner_temp = os.environ.get("RUNNER_TEMP")
    github_env = os.environ.get("GITHUB_ENV")
    if not runner_temp or not github_env:
        raise SystemExit("Missing GitHub Actions runner environment.")

    fd, path = tempfile.mkstemp(prefix="hc-tv-signing-", suffix=".jks", dir=runner_temp)
    try:
        with os.fdopen(fd, "wb") as key_file:
            key_file.write(keystore_bytes)
        os.chmod(path, 0o600)

        # The path is not a secret; the key and credentials are never printed.
        with Path(github_env).open("a", encoding="utf-8") as env_file:
            env_file.write(f"HC_TV_KEYSTORE_FILE={path}\n")
    except BaseException:
        Path(path).unlink(missing_ok=True)
        raise

    print("Android signing keystore prepared securely.")


if __name__ == "__main__":
    main()
