#!/usr/bin/env bash
# Mac/Linux launcher (Windows users: double-click start.bat instead).
set -e
cd "$(dirname "$0")/launcher"
echo "Starting the Naa here demo..."
echo "This window will show live server logs - including verification codes"
echo "during sign-up, since the mock email/SMS sender just logs them here."
echo
node start.js
