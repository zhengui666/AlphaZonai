"""Use actual OpenSSH and two isolated, capability-specific Nautilus receivers."""
from pathlib import Path
import getpass
import json
import shlex
import socket
import subprocess
import sys


def exercise_ssh(root, backtest, deployment, request, expected_source):
    backend = Path(__file__).resolve().parents[1]
    receiver = backend / "quant" / "strategy_receiver.py"
    sshd = Path("/usr/sbin/sshd")
    if not sshd.is_file():
        raise RuntimeError("The OpenSSH round trip requires sshd")
    files = root / "ssh-compatibility"
    files.mkdir(mode=0o700)
    stage = files / "stage"
    stage.mkdir()
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    host = files / "host"
    subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(host)], check=True)
    known = files / "known_hosts"
    known.write_text(f"[127.0.0.1]:{port} " + host.with_suffix(".pub").read_text())
    auth = files / "authorized_keys"
    auth.touch(mode=0o600)
    client, targets = [], []
    for alias, role, profile in [
        ("alpha-history", "backtest", backtest),
        ("alpha-stage", "deploy", {**deployment, "staging_dir": str(stage)}),
    ]:
        identity = files / alias
        subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(identity)], check=True)
        config = files / (alias + ".json")
        config.write_text(json.dumps(profile))
        command = shlex.join([sys.executable, str(receiver), "--profile", str(config)])
        with auth.open("a") as f:
            f.write(f'restrict,command="{command}" ' + identity.with_suffix(".pub").read_text())
        client.append(f"Host {alias}\n  HostName 127.0.0.1\n  User {getpass.getuser()}\n  Port {port}\n"
                      f"  IdentityFile {identity}\n  UserKnownHostsFile {known}\n  GlobalKnownHostsFile /dev/null\n")
        targets.append({"id": alias, "label": alias, "kind": "ssh", "roles": [role], "alias": alias, "sshConfig": str(files / "client")})
    (files / "client").write_text("\n".join(client))
    pid = files / "pid"
    sshd_conf = files / "sshd.conf"
    sshd_conf.write_text(f"""
Port {port}
ListenAddress 127.0.0.1
AddressFamily inet
HostKey {host}
PidFile {pid}
AuthorizedKeysFile {auth}
AllowUsers {getpass.getuser()}
PermitRootLogin no
PubkeyAuthentication yes
AuthenticationMethods publickey
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM yes
StrictModes no
PermitTTY no
DisableForwarding yes
PermitUserEnvironment no
LogLevel ERROR
""")
    subprocess.run(["sudo", "-n", "install", "-d", "-m", "0755", "/run/sshd"], check=True)
    (files / "daemon.log").touch(mode=0o600)
    subprocess.run(["sudo", "-n", str(sshd), "-f", str(sshd_conf), "-E", str(files / "daemon.log")], check=True)
    try:
        js = """
        import {callTarget} from './src/strategy.ts';
        import {readFileSync} from 'node:fs';
        const {settings,request,expectedSource}=JSON.parse(readFileSync(0,'utf8'));
        const signal=new AbortController().signal;
        const report=await callTarget(settings,'alpha-history','backtest',request,signal);
        if(report.metrics.filledOrders<2||report.source!==expectedSource)throw new Error('Unexpected backtest evidence');
        const bundle={schema:2,id:request.id,nautilus:report.nautilus,plan:request.plan,strategy:report.strategy,backtest:report};
        const stage=await callTarget(settings,'alpha-stage','stage',{id:request.id,bundle},signal);
        if(stage.instance!=='separate-runtime'||stage.activated!==false)throw new Error('Incorrect stage receipt');
        console.log(JSON.stringify(stage));
        """
        result = subprocess.run(["node", "--input-type=module", "-e", js], cwd=backend,
                                input=json.dumps({"settings": {"targets": targets, "python": sys.executable},
                                                  "request": request, "expectedSource": expected_source}),
                                text=True, capture_output=True, timeout=45)
        if result.returncode:
            raise RuntimeError((files / "daemon.log").read_text() + result.stderr)
        if (stage / request["id"] / ("alpha_strategy_" + request["id"].replace("-", "") + ".py")).read_text() != expected_source:
            raise RuntimeError("Receiver did not stage the tested source")
    finally:
        if pid.exists():
            subprocess.run(["sudo", "-n", "kill", "-TERM", pid.read_text().strip()], check=True)
