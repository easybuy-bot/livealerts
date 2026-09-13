#!/usr/bin/env sh
# Called by MediaMTX on every publish. Authorizes against the PHP app.
# Args: $1 = full path (e.g. live/cam_abc123), $2 = query string (key=...)
set -eu
FULL_PATH="$1"; QUERY="${2:-}"
STREAM_PATH="${FULL_PATH#live/}"
# Extract key= from the RTMP/SRT query string.
KEY="$(printf '%s' "$QUERY" | tr '&' '\n' | sed -n 's/^key=//p' | head -n1)"

BODY="$(printf '{"event":"publish","path":"%s","key":"%s"}' "$STREAM_PATH" "$KEY")"
SIG="$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$MTX_WEBHOOK_SECRET" -r | cut -d' ' -f1)"

CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$MTX_WEBHOOK_URL" \
  -H "X-OVH-Signature: $SIG" -H 'Content-Type: application/json' -d "$BODY")"

# Non-zero exit tells MediaMTX to reject the publisher.
[ "$CODE" = "200" ] || { echo "publish denied ($CODE) for $STREAM_PATH" >&2; exit 1; }
