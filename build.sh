#!/usr/bin/env bash
set -e

REGISTRY="localhost:5000"
REPO="bitwarden-srp"
REG_REPO="$REGISTRY/$REPO"

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo ""

if [ $# -gt 1 -a "$1" == "push" ]
then
    TAG=$2
    echo "# Pushing Web ($TAG)"
    echo ""
    docker push $REG_REPO/web:$TAG
elif [ $# -gt 1 -a "$1" == "tag" ]
then
    TAG=$2
    echo "Tagging Web as '$TAG'"
    docker tag $REPO/web $REG_REPO/web:$TAG
else
    echo "# Building Web"

    echo ""
    echo "Building app"
    echo "npm version $(npm --version)"
    npm install
    npm run sub:update
    npm run dist:selfhost

    echo ""
    echo "Building docker image"
    docker --version
    docker build -t bitwarden-srp/web $DIR/.
fi
