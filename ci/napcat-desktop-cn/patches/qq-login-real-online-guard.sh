#!/bin/sh
set -eu

ROOT="${NAPCAT_PATCH_ROOT:-/app/napcat}"
PATCHED_LIST="$(mktemp)"
PERL_PATCH="$(mktemp)"
trap 'rm -f "$PATCHED_LIST" "$PERL_PATCH"' EXIT

cat > "$PERL_PATCH" <<'PERL'
use strict;
use warnings;

my ($file) = @ARGV;
open my $in, '<', $file or die "read $file failed: $!";
local $/;
my $source = <$in>;
close $in;

exit 0 if index($source, 'QQ Is Logined') < 0;
exit 0 if index($source, 'RefreshQRcode') < 0;
exit 0 if index($source, 'getQQLoginStatus') < 0;

my ($runtime) = $source =~ /([A-Za-z_\$][\w\$]*)\.getOneBotContext\(\)\?\.core\?\.selfInfo\?\.online,\s*[A-Za-z_\$][\w\$]*\s*=\s*\1\.getQQLoginStatus\(\)/;
die "Unable to identify NapCat WebUI runtime guard symbols in $file\n" unless $runtime;

my ($send_error) = $source =~ /return\s+([A-Za-z_\$][\w\$]*)\(e,\s*"QQ Is Logined"\)/;
die "Unable to identify NapCat sendError helper in $file\n" unless $send_error;

my $count = 0;
$count += $source =~ s/if \(\Q$runtime\E\.getQQLoginStatus\(\)\)\n(\s*)return \Q$send_error\E\(e, "QQ Is Logined"\);/
  "if ($runtime.getQQLoginStatus() && $runtime.getOneBotContext()?.core?.selfInfo?.online !== false)\n"
  . "$1return $send_error(e, \"QQ Is Logined\");\n"
  . "  if ($runtime.getQQLoginStatus() && $runtime.getOneBotContext()?.core?.selfInfo?.online === false)\n"
  . "$1$runtime.setQQLoginStatus(false);"
/ge;

my $refresh_pattern = qr/\Q$runtime\E\.getQQLoginStatus\(\) \? \Q$send_error\E\(e, "QQ Is Logined"\) : \(await \Q$runtime\E\.refreshQRCode\(\),/;
my $refresh_replacement =
  "$runtime.getQQLoginStatus() && $runtime.getOneBotContext()?.core?.selfInfo?.online !== false "
  . "? $send_error(e, \"QQ Is Logined\") "
  . ": ($runtime.getQQLoginStatus() && $runtime.getOneBotContext()?.core?.selfInfo?.online === false && $runtime.setQQLoginStatus(false), await $runtime.refreshQRCode(),";
$count += $source =~ s/$refresh_pattern/$refresh_replacement/g;

exit 0 if $count == 0;
open my $out, '>', $file or die "write $file failed: $!";
print {$out} $source;
close $out;
print "$file\n";
PERL

find "$ROOT" \
  -type f \( -name '*.js' -o -name '*.mjs' \) \
  ! -path '*/node_modules/*' \
  ! -path '*/static/*' \
  -size -20M \
  -print | while IFS= read -r file; do
    perl "$PERL_PATCH" "$file" >> "$PATCHED_LIST"
  done

if [ ! -s "$PATCHED_LIST" ]; then
  echo 'No NapCat WebUI login guard file was patched' >&2
  exit 1
fi

printf 'Patched NapCat WebUI real-online login guard in %s file(s).\n' "$(wc -l < "$PATCHED_LIST" | tr -d ' ')"
