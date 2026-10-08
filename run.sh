#!/bin/sh
# Build the site: compiles jemdoc_files/*.jemdoc into HTML at the repo root.
cd "$(dirname "$0")/jemdoc_files" && python3 -W ignore::SyntaxWarning ../jemdoc -c mysite.conf -o ../ *.jemdoc
