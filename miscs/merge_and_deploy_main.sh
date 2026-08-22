#!/bin/bash

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

git checkout main
git pull --rebase
git merge test -m "Merge branch 'test'"
git push

git checkout ${CURRENT_BRANCH}
