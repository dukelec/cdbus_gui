#!/bin/bash

which gnome-terminal > /dev/null && TERM=gnome-terminal
which xfce4-terminal > /dev/null && TERM=xfce4-terminal

cd "$(dirname "$(realpath "$0")")"

$TERM --title "${name}" -e "./main.py"

