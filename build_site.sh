#!/usr/bin/env bash

set -euo pipefail

output_dir="${1:-_site}"

case "$output_dir" in
  ""|"/"|".")
    echo "Refusing to replace unsafe output directory: '$output_dir'" >&2
    exit 1
    ;;
esac

rm -rf -- "$output_dir"
mkdir -p -- "$output_dir"

yaml_value() {
  local value="$1"
  value=${value//\'/\'\'}
  printf "'%s'" "$value"
}

build_plugin() {
  local manifest="$1"
  local plugin_dir plugin_id name description manifest_version commit_version updated zip_path checksum

  plugin_dir=$(dirname "$manifest")
  plugin_id=$(basename "$manifest" .yml)
  name=$(sed -n 's/^name:[[:space:]]*//p' "$manifest" | head -n 1 | tr -d '\r' | sed -e 's/^"//' -e 's/"$//')
  description=$(sed -n 's/^description:[[:space:]]*//p' "$manifest" | head -n 1 | tr -d '\r' | sed -e 's/^"//' -e 's/"$//')
  manifest_version=$(sed -n 's/^version:[[:space:]]*//p' "$manifest" | head -n 1 | tr -d '\r' | sed -e 's/^"//' -e 's/"$//')
  commit_version=$(git log -n 1 --pretty=format:%h -- "$plugin_dir")
  updated=$(TZ=UTC0 git log -n 1 --date='format-local:%F %T' --pretty=format:%ad -- "$plugin_dir")
  zip_path="$output_dir/$plugin_id.zip"

  echo "Packaging $plugin_id"
  (
    cd "$plugin_dir"
    zip -qr "$(realpath --relative-to=. "$OLDPWD/$zip_path")" .
  )

  checksum=$(sha256sum "$zip_path" | cut -d' ' -f1)

  {
    printf '%s\n' "- id: $(yaml_value "$plugin_id")"
    printf '%s\n' "  name: $(yaml_value "$name")"
    printf '%s\n' "  version: $(yaml_value "$manifest_version-$commit_version")"
    printf '%s\n' "  date: $(yaml_value "$updated")"
    printf '%s\n' "  path: $(yaml_value "$plugin_id.zip")"
    printf '%s\n' "  sha256: $(yaml_value "$checksum")"
    printf '%s\n' "  metadata:"
    printf '%s\n' "    description: $(yaml_value "$description")"
    printf '\n'
  } >> "$output_dir/index.yml"
}

while IFS= read -r -d '' manifest; do
  build_plugin "$manifest"
done < <(find ./plugins -mindepth 2 -maxdepth 2 -type f -name '*.yml' -print0 | sort -z)

if [[ ! -s "$output_dir/index.yml" ]]; then
  echo "No plugin manifests were found under ./plugins" >&2
  exit 1
fi

echo "Package source written to $output_dir/index.yml"
