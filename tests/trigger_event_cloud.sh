#!/bin/bash
set -eu

# Usage: ./tests/trigger_event_cloud.sh [command]
COMMAND=${1:-"batch-update-books"}
TOPIC="my-cfapps-portal-event"

gcloud pubsub topics publish "$TOPIC" --message="{\"command\": \"$COMMAND\"}"
