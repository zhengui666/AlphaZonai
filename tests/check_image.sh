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
        curl --noproxy '*' -fsS --max-time 3 "http://$address/api/model-settings" >/dev/null
        status=$(curl --noproxy '*' -sS --max-time 3 -o /dev/null -w '%{http_code}' \
          -H "Origin: http://$address" -H 'Content-Type: application/json' \
          -d '{}' "http://$address/api/runs")
        test "$status" = 403
        docker exec -e ALPHAZONAI_URL=http://127.0.0.1:8787 "$container" alphazonai runs list |
          docker exec -i "$container" node -e 'let s="";process.stdin.on("data",b=>s+=b);process.stdin.on("end",()=>{if(JSON.parse(s).ok!==true)process.exitCode=1;});'
        # Node fetch adds Sec-Fetch-Mode even outside browsers. Check that a real
        # CLI POST reaches admission rather than being blocked as a UI action.
        if result=$(docker exec -e ALPHAZONAI_URL=http://127.0.0.1:8787 "$container" alphazonai runs start \
             --id 2c4afd86-ff5d-43fb-8ad9-7face4add156 --start 2026-01-01 --end 2026-01-02 \
             --horizon 5 --direction 'Check correct admission' 2>&1); then
          printf '%s\n' 'Research unexpectedly admitted without a model' >&2
          exit 1
        fi
        [[ "$result" == *MODEL_CREDENTIAL* ]]
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
