#!/bin/bash
set -eu

# Usage: ./tests/trigger_event_local.sh [port] [command] [dry_run]
PORT=${1:-3000}
COMMAND=${2:-""}
DRY_RUN=${3:-"true"} # デフォルトは dry-run モード
TOPIC="myapps-portal-event"

# Base64 encode the data (matching the structure expected by the service)
DATA=$(echo -n "{\"topic\": \"$TOPIC\", \"command\": \"$COMMAND\", \"dryRun\": $DRY_RUN}" | base64)

curl "localhost:$PORT/api/events" \
    -H "ce-id: $(uuidgen 2>/dev/null || echo "1234567890")" \
    -H "ce-source: //pubsub.googleapis.com/projects/test-pj/topics/$TOPIC" \
    -H "ce-specversion: 1.0" \
    -H "ce-type: com.google.cloud.pubsub.topic.publish" \
    -H "Content-Type: application/json" \
    -d "{
        \"message\": {
          \"data\": \"$DATA\"
        },
        \"subscription\": \"projects/test-pj/subscriptions/$TOPIC\"
      }"
