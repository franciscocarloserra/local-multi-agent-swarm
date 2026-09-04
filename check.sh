#!/bin/sh
# Syntax check for ES modules (node --check alone misses const redeclarations in module scope).
for f in ui/*.js; do node --input-type=module --check < "$f" || { echo "FAIL $f"; exit 1; }; done
python3 -c "import ast,sys;[ast.parse(open(f).read()) for f in ('orch.py','server.py','supervisor.py')]" && echo OK
