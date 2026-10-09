#!/usr/bin/env bash

set -euo pipefail

# Git Bash invoked from PowerShell may inherit Windows find.exe/sort.exe first.
if [[ "$OSTYPE" == msys* || "$OSTYPE" == cygwin* ]]; then
  export PATH="/usr/bin:$PATH"
fi

output_dir="${1:-_site}"
repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd -- "$repo_dir"
output_dir=$(node scripts/prepare-site.mjs "$output_dir")
node scripts/build.mjs

yaml_value() {
  local value="$1"
  value=${value//\'/\'\'}
  printf "'%s'" "$value"
}

ui_requires() {
  local manifest="$1"
  awk '
    /^[^[:space:]]/ {
      in_ui = ($0 ~ /^ui:[[:space:]]*$/)
      in_requires = 0
      next
    }
    in_ui && /^[[:space:]]+requires:[[:space:]]*$/ {
      in_requires = 1
      next
    }
    in_ui && in_requires && /^[[:space:]]*-[[:space:]]+/ {
      value = $0
      sub(/^[[:space:]]*-[[:space:]]+/, "", value)
      sub(/[[:space:]\r]+$/, "", value)
      gsub(/^['\''"]|['\''"]$/, "", value)
      print value
      next
    }
    in_ui && in_requires && $0 !~ /^[[:space:]]*$/ {
      in_requires = 0
    }
  ' "$manifest"
}

build_plugin() {
  local manifest="$1"
  local plugin_dir plugin_id name description manifest_version commit_version updated zip_path checksum required_plugin
  local -a package_requires=() source_metadata=()

  plugin_dir=$(dirname "$manifest")
  plugin_id=$(basename "$manifest" .yml)
  name=$(sed -n 's/^name:[[:space:]]*//p' "$manifest" | head -n 1 | tr -d '\r' | sed -e 's/^"//' -e 's/"$//')
  description=$(sed -n 's/^description:[[:space:]]*//p' "$manifest" | head -n 1 | tr -d '\r' | sed -e 's/^"//' -e 's/"$//')
  manifest_version=$(sed -n 's/^version:[[:space:]]*//p' "$manifest" | head -n 1 | tr -d '\r' | sed -e 's/^"//' -e 's/"$//')
  mapfile -t source_metadata < <(node scripts/package-metadata.mjs "$plugin_id")
  if ((${#source_metadata[@]} != 2)); then
    echo "Missing source build metadata for $plugin_id" >&2
    exit 1
  fi
  commit_version=${source_metadata[0]%$'\r'}
  updated=${source_metadata[1]%$'\r'}
  zip_path="$output_dir/$plugin_id.zip"
  mapfile -t package_requires < <(ui_requires "$manifest")

  echo "Packaging $plugin_id"
  (
    cd "$plugin_dir"
    zip -qr "$zip_path" .
  )

  checksum=$(sha256sum "$zip_path" | cut -d' ' -f1)

  {
    printf '%s\n' "- id: $(yaml_value "$plugin_id")"
    printf '%s\n' "  name: $(yaml_value "$name")"
    printf '%s\n' "  version: $(yaml_value "$manifest_version-$commit_version")"
    printf '%s\n' "  date: $(yaml_value "$updated")"
    if ((${#package_requires[@]})); then
      printf '%s\n' "  requires:"
      for required_plugin in "${package_requires[@]}"; do
        printf '%s\n' "  - $(yaml_value "$required_plugin")"
      done
    fi
    printf '%s\n' "  path: $(yaml_value "$plugin_id.zip")"
    printf '%s\n' "  sha256: $(yaml_value "$checksum")"
    printf '%s\n' "  metadata:"
    printf '%s\n' "    description: $(yaml_value "$description")"
    printf '\n'
  } >> "$output_dir/index.yml"
}

while IFS= read -r -d '' manifest; do
  build_plugin "$manifest"
done < <(find ./.build/plugins -mindepth 2 -maxdepth 2 -type f -name '*.yml' -print0 | sort -z)

if [[ ! -s "$output_dir/index.yml" ]]; then
  echo "No plugin manifests were found under ./.build/plugins" >&2
  exit 1
fi

echo "Package source written to $output_dir/index.yml"
