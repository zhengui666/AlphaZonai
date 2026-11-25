#!/usr/bin/env bash
set -euo pipefail

image=${1:?image required}
check=${2:?check required}

case "$check" in
  http)
    container=$(docker run -d -p 127.0.0.1::8787 "$image")
    cleanup() {
      status=$?
      if ((status != 0)); then
        docker inspect --format '{{json .State}}' "$container" || true
        docker logs "$container" || true
      fi
      docker rm -f "$container" >/dev/null || true
    }
    trap cleanup EXIT
    address=$(docker port "$container" 8787/tcp | head -n1)
    for attempt in {1..20}; do
      if result=$(curl --noproxy '*' -fsS --connect-timeout 1 --max-time 2 "http://$address/api/runs") && [[ "$result" == '[]' ]]; then
        printf 'Ready after %d attempt(s): %s\n' "$attempt" "$result"
        exit 0
      fi
      if [[ $(docker inspect --format '{{.State.Running}}' "$container") != true ]]; then
        break
      fi
      sleep 1
    done
    printf '%s\n' 'The image never served the expected runs response' >&2
    exit 1
    ;;
  isolated)
    root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
    docker run --rm --network none \
      --security-opt seccomp=unconfined --security-opt apparmor=unconfined \
      --mount "type=bind,source=$root/tests/smoke_isolated.py,target=/app/tests/smoke_isolated.py,readonly" \
      --entrypoint python "$image" /app/tests/smoke_isolated.py
    ;;
  *) printf 'Unknown image check: %s\n' "$check" >&2; exit 2 ;;
esac
