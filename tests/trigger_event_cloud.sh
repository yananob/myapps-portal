#!/bin/bash
set -eu

# Usage: ./tests/trigger_event_cloud.sh [command] [dry_run]
COMMAND=${1:-"batch-update-books"}
DRY_RUN=${2:-"true"} # デフォルトは dry-run モード
TOPIC="my-cfapps-portal-event"

gcloud pubsub topics publish "$TOPIC" --message="{\"command\": \"$COMMAND\", \"dryRun\": $DRY_RUN}"
