#!/usr/bin/env bash
# Puts a source video into the strix bucket and mints the URL a game is given for it.
#
#   scripts/r2-source.sh put <file> <key>   multipart upload of <file> to s3://strix/<key>
#   scripts/r2-source.sh url <key>          print a presigned GET URL for <key>, valid 7 days
#
# Needs the aws CLI and the Worker's R2 token in R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.
set -euo pipefail

ACCOUNT_ID=6624f09210327baade61004af0d9be84
BUCKET=strix
ENDPOINT="https://${ACCOUNT_ID}.r2.cloudflarestorage.com"
SEVEN_DAYS=604800

usage() {
  sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

: "${R2_ACCESS_KEY_ID:?set it to the R2 token access key id}"
: "${R2_SECRET_ACCESS_KEY:?set it to the R2 token secret access key}"
command -v aws >/dev/null || { echo "aws CLI not found (brew install awscli)" >&2; exit 1; }

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
unset AWS_SESSION_TOKEN AWS_PROFILE

case "${1:-}" in
  put)
    [ $# -eq 3 ] || usage
    aws s3 cp "$2" "s3://${BUCKET}/$3" --endpoint-url "$ENDPOINT" --content-type video/mp4
    ;;
  url)
    [ $# -eq 2 ] || usage
    aws s3 presign "s3://${BUCKET}/$2" --endpoint-url "$ENDPOINT" --expires-in "$SEVEN_DAYS"
    ;;
  *)
    usage
    ;;
esac
