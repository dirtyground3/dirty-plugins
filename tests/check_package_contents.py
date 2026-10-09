"""Check existing ZIPs against staging. Run through npm run test:packages."""
import json
import re
import sys
import zipfile
from pathlib import Path

from plugin_paths import ROOT, runtime_path

# Installs need no source, tooling, tests or runtime data (the build's allowlist rule).
FORBIDDEN = re.compile(r"(^|/)(src|runtime|__pycache__|node_modules|tests)(/|$)|\.sqlite|\.(pyc|pyo|bak|ts|tsx|map)$", re.I)


def check(directory):
    registry = json.loads((ROOT / "scripts/plugin-registry.json").read_text(encoding="utf-8"))
    for plugin in registry:
        staged = runtime_path(plugin["directory"])
        expected = {path.relative_to(staged).as_posix(): path for path in staged.rglob("*") if path.is_file()}
        with zipfile.ZipFile(directory / (plugin["id"] + ".zip")) as archive:
            files = [item.filename for item in archive.infolist() if not item.is_dir()]
            assert len(files) == len(set(files)), "Duplicate ZIP members: " + plugin["id"]
            assert set(files) == set(expected), "ZIP contents differ from staging: " + plugin["id"]
            assert plugin["id"] + ".yml" in files, "Manifest must be at the ZIP root"
            assert not [name for name in files if FORBIDDEN.search(name)], "Source or runtime data in package: " + plugin["id"]
            for name in files:
                assert archive.read(name) == expected[name].read_bytes(), "Different ZIP bytes: " + name
                # Packages ship release bundles; development maps stay local.
                assert not (name.endswith(".js") and b"sourceMappingURL" in archive.read(name)), "Source map in package: " + name
        print(plugin["id"] + ": " + str(len(expected)) + " staged files verified")


if __name__ == "__main__":
    check(Path(sys.argv[1]).resolve())
