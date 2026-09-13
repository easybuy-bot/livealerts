#!/usr/bin/env sh
set -eu
STREAM_PATH="${1#live/}"
BODY="$(printf '{"event":"unpublish","path":"%s"}' "$STREAM_PATH")"
SIG="$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$MTX_WEBHOOK_SECRET" -r | cut -d' ' -f1)"
curl -s -o /dev/null -X POST "$MTX_WEBHOOK_URL" \
  -H "X-OVH-Signature: $SIG" -H 'Content-Type: application/json' -d "$BODY" || true
