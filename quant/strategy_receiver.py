"""Native receiver for backtesting or staging one arbitrary AlphaZonai strategy."""
import argparse
import ast
from importlib.metadata import version
import json
import os
from pathlib import Path
import re
import selectors
import time
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

SCHEMA = 2
NAUTILUS = "1.231.0"
WORKER = Path(__file__).with_name("strategy_backtest.py")
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
CLASS = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,99}")


def package_definition(id_, plan):
    if not isinstance(plan, dict) or set(plan) != {"title", "source", "strategyClass", "configClass", "config"}:
        raise ValueError("Invalid generated strategy plan")
    if not isinstance(plan["title"], str) or not 1 <= len(plan["title"].strip()) <= 96:
        raise ValueError("Invalid strategy title")
    if not isinstance(plan["source"], str) or not 1 <= len(plan["source"].encode()) <= 256_000:
        raise ValueError("Invalid strategy module size")
    tree = ast.parse(plan["source"], filename="generated_strategy.py")
    definitions = {n.name for n in tree.body if isinstance(n, ast.ClassDef)}
    names = [plan["strategyClass"], plan["configClass"]]
    if any(not isinstance(n, str) or not CLASS.fullmatch(n) or n not in definitions for n in names) or names[0] == names[1]:
        raise ValueError("Two distinct top-level strategy and config classes required")
    if not isinstance(plan["config"], dict):
        raise ValueError("Strategy config must be an object")
    encoded = json.dumps(plan["config"], allow_nan=False).encode()
    if len(encoded) > 64_000:
        raise ValueError("Strategy config exceeds transport limit")
    module = "alpha_strategy_" + id_.replace("-", "")
    native = {"strategy_path": module + ":" + names[0], "config_path": module + ":" + names[1], "config": plan["config"]}
    return module, native


def normalize_time(text):
    value = datetime.fromisoformat(text)
    if value.tzinfo is None:
        raise ValueError("Explicit UTC time required")
    return value.astimezone(timezone.utc)


def isolated_result(command, payload, seconds=900):
    # Use a bounded stdio protocol. The sandbox need not have any writable host mount.
    output = bytearray()
    payload = memoryview(payload)
    deadline = time.monotonic() + seconds
    with subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as p, selectors.DefaultSelector() as sel:
        try:
            sel.register(p.stdin, selectors.EVENT_WRITE)
            sel.register(p.stdout, selectors.EVENT_READ)
            while sel.get_map():
                timeout = deadline - time.monotonic()
                if timeout <= 0:
                    raise subprocess.TimeoutExpired(command[0], seconds)
                events = sel.select(timeout)
                for key, _ in events:
                    if key.fileobj is p.stdin:
                        try:
                            payload = payload[os.write(p.stdin.fileno(), payload[:4096]):] if payload else payload
                        except BrokenPipeError:
                            payload = payload[:0]
                        if not payload:
                            sel.unregister(p.stdin)
                            p.stdin.close()
                    else:
                        chunk = os.read(p.stdout.fileno(), 65536)
                        if not chunk:
                            sel.unregister(p.stdout)
                        else:
                            output.extend(chunk)
                            if len(output) > 1_000_000:
                                raise ValueError("Native backtest exceeded response budget")
            if p.wait(timeout=max(0, deadline - time.monotonic())):
                try:
                    detail = json.loads(output).get("error", "")
                except (ValueError, AttributeError):
                    detail = ""
                raise ValueError("Native isolated backtest failed" + (": " + detail[:260] if isinstance(detail, str) and detail else ""))
            return json.loads(output)
        finally:
            if p.poll() is None:
                p.kill()


def run_backtest(profile, request):
    start, end, research_end = map(normalize_time, (request["start"], request["end"], request["research_end"]))
    if start < research_end or end <= start:
        raise ValueError("Use a later, non-overlapping backtest interval")
    module, native = package_definition(request["id"], request["plan"])
    catalog = Path(profile["catalog"]).resolve(strict=True)
    if not catalog.is_dir() or not isinstance(profile["run"], dict):
        raise ValueError("Invalid native backtest profile")
    with tempfile.TemporaryDirectory(prefix="alpha-backtest-") as tmp:
        temp = Path(tmp)
        source = temp / (module + ".py")
        source.write_bytes(request["plan"]["source"].encode())
        # Give the strategy engine only the selected Catalog and normalization inputs.
        # This process remains separate and never imports the generated strategy.
        bind = ["--ro-bind", "/usr", "/usr", "--ro-bind-try", "/lib", "/lib", "--ro-bind-try", "/lib64", "/lib64"]
        runtimes = sorted({str(Path(sys.prefix).resolve()), str(Path(sys.base_prefix).resolve())}, key=len)
        for path in runtimes:
            if path not in ("/usr", "/") and not path.startswith("/usr/"):
                bind.extend(["--ro-bind", path, path])
        library_paths = ":".join([p + "/lib" for p in runtimes if p != "/"] + ["/usr/local/lib"])
        sandbox = [
            "bwrap", "--unshare-all", "--die-with-parent", "--new-session", "--clearenv", *bind,
            "--setenv", "LD_LIBRARY_PATH", library_paths, "--setenv", "OPENBLAS_NUM_THREADS", "1",
            "--setenv", "OMP_NUM_THREADS", "1", "--setenv", "LANG", "C.UTF-8",
            "--dev", "/dev", "--size", "67108864", "--tmpfs", "/tmp", "--dir", "/work", "--dir", "/input",
            "--ro-bind", str(WORKER), "/work/strategy_backtest.py",
            "--ro-bind", str(source), "/work/" + source.name,
            "--ro-bind", str(catalog), "/input/catalog",
            "--chdir", "/work",
            sys.executable, "-I", "/work/strategy_backtest.py",
        ]
        try:
            metrics = isolated_result(sandbox, json.dumps({"run": profile["run"], "strategy": native,
                                      "start": start.isoformat(), "end": end.isoformat()}).encode())
        except (OSError, subprocess.TimeoutExpired):
            raise ValueError("Native isolated backtest unavailable") from None
        if type(metrics.get("filledOrders")) is not int or metrics["filledOrders"] < 1:
            raise ValueError("No executed orders in backtest")
    return {"schema": SCHEMA, "kind": "backtest", "id": request["id"], "nautilus": NAUTILUS,
            "strategy": native, "source": request["plan"]["source"], "metrics": metrics}


def stage(profile, request):
    bundle = request["bundle"]
    plan = bundle["plan"]
    module, native = package_definition(request["id"], plan)
    if (bundle["schema"], bundle["nautilus"], bundle["id"], bundle["strategy"]) != (SCHEMA, NAUTILUS, request["id"], native):
        raise ValueError("Unsupported or inconsistent strategy package")
    receipt = bundle["backtest"]
    if (receipt["schema"], receipt["kind"], receipt["id"], receipt["nautilus"], receipt["strategy"], receipt["source"]) != (SCHEMA, "backtest", request["id"], NAUTILUS, native, plan["source"]) or receipt["metrics"]["filledOrders"] < 1:
        raise ValueError("Source or config differs from evidence")
    # Compile only. Importing a Python module can execute top-level statements.
    # Inactive staging must not execute untrusted code on the deployment host.
    compiled_source = plan["source"].encode()
    compile(compiled_source, module + ".py", "exec")
    root = Path(profile["staging_dir"]).resolve(strict=True)
    dest = root / request["id"]
    expected = {
        module + ".py": compiled_source,
        "importable-strategy.json": json.dumps(native, sort_keys=True, ensure_ascii=False, allow_nan=False).encode(),
        "strategy-package.json": json.dumps(bundle, sort_keys=True, ensure_ascii=False, allow_nan=False).encode(),
    }
    with tempfile.TemporaryDirectory(prefix=".alpha-", dir=root) as tmp:
        work = Path(tmp) / "package"
        work.mkdir(mode=0o750)
        for name, content in expected.items():
            (work / name).write_bytes(content)
        try:
            work.rename(dest)
        except OSError:
            if not dest.is_dir() or dest.is_symlink() or any((dest / n).is_symlink() or (dest / n).read_bytes() != c for n,c in expected.items()):
                raise
    return {"schema": SCHEMA, "kind": "stage", "id": request["id"], "nautilus": NAUTILUS,
            "instance": profile["instance"], "status": "staged", "activated": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", type=Path, required=True)
    args = parser.parse_args()
    profile = json.loads(args.profile.read_text())
    request = json.load(sys.stdin)
    if version("nautilus_trader") != NAUTILUS or request.get("schema") != SCHEMA or not UUID.fullmatch(request.get("id", "")):
        raise ValueError("Unsupported NautilusTrader version or request")
    op = request.get("kind")
    if op not in profile["allow"]:
        raise ValueError("Operation not allowed by this instance")
    result = run_backtest(profile, request) if op == "backtest" else stage(profile, request) if op == "stage" else None
    if result is None:
        raise ValueError("Unsupported receiver operation")
    print(json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",",":")))


if __name__ == "__main__":
    main()
