#!/bin/sh
set -eu

ENTRYPOINT=/app/entrypoint.sh

if grep -q 'KT device profile patch defaults' "$ENTRYPOINT"; then
  exit 0
fi

grep -q 'mount --bind "$FAKE_CMDLINE" /proc/1/cmdline' "$ENTRYPOINT"

cat >/tmp/kt-device-profile-defaults.sh <<'EOF'

# KT device profile patch defaults.
: "${NAPCAT_REQUIRE_DEVICE_PROFILE:=0}"
: "${NAPCAT_DMI_PRODUCT_NAME:=imini Pro}"
: "${NAPCAT_DMI_PRODUCT_UUID:=00000000-0000-0000-0000-000000000000}"
: "${NAPCAT_DMI_SYS_VENDOR:=MECHREVO}"
: "${NAPCAT_DMI_BOARD_VENDOR:=MECHREVO}"
: "${NAPCAT_DMI_BOARD_NAME:=imini Pro}"
: "${NAPCAT_DMI_BIOS_VENDOR:=American Megatrends International, LLC.}"
: "${NAPCAT_DMI_BIOS_VERSION:=imini Pro 1.10}"
: "${NAPCAT_DMI_MODALIAS:=dmi:bvnAmericanMegatrendsInternational,LLC.:bvriminiPro1.10:bd03/31/2024:br1.10:efr1.10:svnMECHREVO:pniminiPro:pvrStandard:rvnMECHREVO:rniminiPro:rvrStandard:cvnMECHREVO:ct3:cvrDefaultstring:skuStandard:}"
: "${NAPCAT_DEVICE_BOOT_ID:=00000000-0000-4000-8000-000000000000}"
: "${NAPCAT_DEVICE_KERNEL_RELEASE:=6.8.0-60-generic}"
: "${NAPCAT_DEVICE_KERNEL_VERSION:=#63-Ubuntu SMP PREEMPT_DYNAMIC Tue Apr 15 19:04:15 UTC 2025}"
: "${NAPCAT_DEVICE_PROC_VERSION:=Linux version 6.8.0-60-generic (buildd@lcy02-amd64-001) (x86_64-linux-gnu-gcc (Ubuntu 13.3.0-6ubuntu2~24.04) 13.3.0, GNU ld (GNU Binutils for Ubuntu) 2.42) #63-Ubuntu SMP PREEMPT_DYNAMIC Tue Apr 15 19:04:15 UTC 2025}"
: "${NAPCAT_DEVICE_CPU_MODEL:=AMD Ryzen 7 8845H w/ Radeon 780M Graphics}"
: "${NAPCAT_DEVICE_UPTIME:=7200.00 14400.00}"
: "${NAPCAT_DEVICE_TTY_ACTIVE:=tty1}"
: "${NAPCAT_DEVICE_MOUNTINFO_GUARD_ENABLED:=1}"
: "${NAPCAT_DEVICE_MOUNTINFO_GUARD_INTERVAL:=1}"

kt_fake_file() {
    kt_target="$1"
    kt_content="$2"
    kt_name="$(echo "$kt_target" | tr '/' '_')"
    kt_fake="$FAKE_CGROUP_DIR/kt_device_profile_$kt_name"
    printf '%s\n' "$kt_content" > "$kt_fake"
    mount --bind "$kt_fake" "$kt_target" 2>/dev/null || true
}
EOF

cat >/tmp/kt-device-profile-dmi.sh <<'EOF'

# KT device profile DMI overrides for files QQCore opens.
kt_fake_file /sys/class/dmi/id/product_name "$NAPCAT_DMI_PRODUCT_NAME"
kt_fake_file /sys/class/dmi/id/product_uuid "$NAPCAT_DMI_PRODUCT_UUID"
kt_fake_file /sys/class/dmi/id/sys_vendor "$NAPCAT_DMI_SYS_VENDOR"
kt_fake_file /sys/class/dmi/id/board_vendor "$NAPCAT_DMI_BOARD_VENDOR"
kt_fake_file /sys/class/dmi/id/board_name "$NAPCAT_DMI_BOARD_NAME"
kt_fake_file /sys/class/dmi/id/bios_vendor "$NAPCAT_DMI_BIOS_VENDOR"
kt_fake_file /sys/class/dmi/id/bios_version "$NAPCAT_DMI_BIOS_VERSION"
kt_fake_file /sys/class/dmi/id/modalias "$NAPCAT_DMI_MODALIAS"
EOF

cat >/tmp/kt-device-profile-proc.sh <<'EOF'

# KT device profile proc/sys files QQCore opens.
kt_fake_file /proc/sys/kernel/random/boot_id "$NAPCAT_DEVICE_BOOT_ID"
kt_fake_file /proc/sys/kernel/version "$NAPCAT_DEVICE_KERNEL_VERSION"
kt_fake_file /proc/version "$NAPCAT_DEVICE_PROC_VERSION"
kt_fake_file /proc/uptime "$NAPCAT_DEVICE_UPTIME"
if [ -f /proc/cpuinfo ]; then
    KT_FAKE_CPUINFO="$FAKE_CGROUP_DIR/kt_device_profile_proc_cpuinfo"
    awk -v model="$NAPCAT_DEVICE_CPU_MODEL" '
        /^model name[[:space:]]*:/ { $0 = "model name\t: " model }
        /^flags[[:space:]]*:/ {
            gsub(/(^| )hypervisor( |$)/, " ")
            gsub(/[[:space:]]+/, " ")
        }
        { print }
    ' /proc/cpuinfo > "$KT_FAKE_CPUINFO" 2>/dev/null || true
    mount --bind "$KT_FAKE_CPUINFO" /proc/cpuinfo 2>/dev/null || true
fi
if [ -f /proc/devices ]; then
    KT_FAKE_DEVICES="$FAKE_CGROUP_DIR/kt_device_profile_proc_devices"
    grep -Ev 'trim-trashbin|zvol' /proc/devices > "$KT_FAKE_DEVICES" 2>/dev/null || true
    mount --bind "$KT_FAKE_DEVICES" /proc/devices 2>/dev/null || true
fi
if [ -f /sys/devices/virtual/tty/tty0/active ]; then
    kt_fake_file /sys/devices/virtual/tty/tty0/active "$NAPCAT_DEVICE_TTY_ACTIVE"
fi
if [ -f /etc/hosts ]; then
    KT_FAKE_HOSTS="$FAKE_CGROUP_DIR/kt_device_profile_hosts"
    {
        printf '127.0.0.1\tlocalhost\n'
        printf '::1\tlocalhost ip6-localhost ip6-loopback\n'
        printf 'fe00::\tip6-localnet\n'
        printf 'ff00::\tip6-mcastprefix\n'
        printf 'ff02::1\tip6-allnodes\n'
        printf 'ff02::2\tip6-allrouters\n'
    } > "$KT_FAKE_HOSTS"
    mount --bind "$KT_FAKE_HOSTS" /etc/hosts 2>/dev/null || true
fi

# KT device profile mountinfo guard for long-lived QQ/NapCat processes.
KT_MOUNTINFO_HOST_LEAK_PATTERN='overlay|/vol1/docker|docker-init|/docker/containers|napcat-instances|btrfs|/dev/mapper/trim'
KT_FAKE_MOUNTINFO="$FAKE_CGROUP_DIR/kt_device_profile_mountinfo"
cat > "$KT_FAKE_MOUNTINFO" <<'KT_MOUNTINFO_EOF'
22 1 259:2 / / rw,relatime - ext4 /dev/nvme0n1p2 rw,errors=remount-ro
23 22 0:6 / /proc rw,nosuid,nodev,noexec,relatime - proc proc rw
24 22 0:22 / /dev rw,nosuid,relatime - tmpfs udev rw,size=4096000k,nr_inodes=1024000,mode=755,inode64
25 24 0:23 / /dev/pts rw,nosuid,noexec,relatime - devpts devpts rw,gid=5,mode=620,ptmxmode=000
26 22 0:24 / /sys rw,nosuid,nodev,noexec,relatime - sysfs sysfs rw
27 22 0:25 / /run rw,nosuid,nodev,relatime - tmpfs tmpfs rw,mode=755,inode64
28 22 259:2 /home/napcat/.config /app/.config rw,relatime - ext4 /dev/nvme0n1p2 rw,errors=remount-ro
29 22 259:2 /home/napcat/.cache /app/.cache rw,relatime - ext4 /dev/nvme0n1p2 rw,errors=remount-ro
30 22 259:2 /home/napcat/.local/share /app/.local/share rw,relatime - ext4 /dev/nvme0n1p2 rw,errors=remount-ro
KT_MOUNTINFO_EOF

kt_mask_mountinfo_target() {
    kt_mountinfo="$1"
    if [ -f "$kt_mountinfo" ] && grep -E "$KT_MOUNTINFO_HOST_LEAK_PATTERN" "$kt_mountinfo" >/dev/null 2>&1; then
        mount --bind "$KT_FAKE_MOUNTINFO" "$kt_mountinfo" 2>/dev/null || true
    fi
}

kt_is_mountinfo_target() {
    kt_target_comm="$1"
    kt_target_cmdline="$2"
    kt_target_argv0="${kt_target_cmdline%% *}"
    kt_target_argv0_base="${kt_target_argv0##*/}"

    case "$kt_target_comm" in
        qq|QQ|NapCat|napcat|Xvfb)
            return 0
            ;;
    esac
    case "$kt_target_argv0_base" in
        qq|QQ|NapCat|napcat|Xvfb)
            return 0
            ;;
    esac
    case "$kt_target_cmdline" in
        /opt/QQ/*|/app/napcat/*|/app/NapCat*|*/NapCat.Shell*|*/napcat.mjs*)
            return 0
            ;;
    esac
    return 1
}

kt_mountinfo_guard_once() {
    for kt_mountinfo_pid_dir in /proc/[0-9]*; do
        [ -d "$kt_mountinfo_pid_dir" ] || continue
        kt_mountinfo_pid="${kt_mountinfo_pid_dir#/proc/}"
        kt_mountinfo_comm="$(cat "$kt_mountinfo_pid_dir/comm" 2>/dev/null || true)"
        kt_mountinfo_cmdline="$(tr '\000' ' ' < "$kt_mountinfo_pid_dir/cmdline" 2>/dev/null || true)"
        if kt_is_mountinfo_target "$kt_mountinfo_comm" "$kt_mountinfo_cmdline"; then
            kt_mask_mountinfo_target "/proc/$kt_mountinfo_pid/mountinfo"
        fi
    done
}

kt_mountinfo_guard_loop() {
    while :; do
        kt_mountinfo_guard_once
        sleep "${NAPCAT_DEVICE_MOUNTINFO_GUARD_INTERVAL:-1}"
    done
}

kt_mask_mountinfo_target /proc/1/mountinfo
kt_mask_mountinfo_target /proc/self/mountinfo
if [ "${NAPCAT_DEVICE_MOUNTINFO_GUARD_ENABLED:-1}" = "1" ]; then
    kt_mountinfo_guard_loop >/dev/null 2>&1 &
fi
EOF

cat >/tmp/kt-device-profile-verify.sh <<'EOF'

if [ "${NAPCAT_REQUIRE_DEVICE_PROFILE:-0}" = "1" ]; then
    kt_require_device_profile() {
        kt_device_profile_label="$1"
        shift
        "$@" || {
            echo "NapCat device profile check failed: $kt_device_profile_label" >&2
            exit 78
        }
    }

    kt_require_device_profile proc1-cmdline sh -c "tr '\\000' ' ' </proc/1/cmdline | grep -q '/sbin/init'"
    kt_require_device_profile proc1-sched grep -q 'systemd' /proc/1/sched
    kt_require_device_profile proc1-status grep -q '^NSpid:[[:space:]]*1' /proc/1/status
    kt_require_device_profile proc1-stat grep -q '(systemd)' /proc/1/stat
    kt_require_device_profile dmi-product grep -q "$NAPCAT_DMI_PRODUCT_NAME" /sys/class/dmi/id/product_name
    kt_require_device_profile dmi-product-uuid grep -q "$NAPCAT_DMI_PRODUCT_UUID" /sys/class/dmi/id/product_uuid
    kt_require_device_profile dmi-sys-vendor grep -q "$NAPCAT_DMI_SYS_VENDOR" /sys/class/dmi/id/sys_vendor
    kt_require_device_profile dmi-bios-vendor grep -q "$NAPCAT_DMI_BIOS_VENDOR" /sys/class/dmi/id/bios_vendor
    kt_require_device_profile dmi-bios-version grep -q "$NAPCAT_DMI_BIOS_VERSION" /sys/class/dmi/id/bios_version
    kt_require_device_profile dmi-modalias grep -q "$NAPCAT_DMI_MODALIAS" /sys/class/dmi/id/modalias
    kt_require_device_profile boot-id grep -q "$NAPCAT_DEVICE_BOOT_ID" /proc/sys/kernel/random/boot_id
    kt_require_device_profile kernel-version grep -q "$NAPCAT_DEVICE_KERNEL_VERSION" /proc/sys/kernel/version
    kt_require_device_profile proc-version grep -q "$NAPCAT_DEVICE_KERNEL_RELEASE" /proc/version
    kt_require_device_profile proc-uptime grep -q "$NAPCAT_DEVICE_UPTIME" /proc/uptime
    kt_require_device_profile proc-cpuinfo grep -q "$NAPCAT_DEVICE_CPU_MODEL" /proc/cpuinfo
    if grep -q 'hypervisor' /proc/cpuinfo; then
        echo "NapCat device profile check failed: cpuinfo-hypervisor-flag" >&2
        exit 78
    fi
    if [ -f /sys/devices/virtual/tty/tty0/active ]; then
        kt_require_device_profile tty-active grep -q "$NAPCAT_DEVICE_TTY_ACTIVE" /sys/devices/virtual/tty/tty0/active
    else
        echo "NapCat device profile check failed: tty0-active-missing" >&2
        exit 78
    fi
    KT_MOUNTINFO_HOST_LEAK_PATTERN='overlay|/vol1/docker|docker-init|/docker/containers|napcat-instances|btrfs|/dev/mapper/trim'
    for kt_mountinfo in /proc/1/mountinfo; do
        if grep -E "$KT_MOUNTINFO_HOST_LEAK_PATTERN" "$kt_mountinfo" >/dev/null 2>&1; then
            echo "NapCat device profile check failed: mountinfo-host-leak:$kt_mountinfo" >&2
            exit 78
        fi
    done
    if [ "$(hostname)" != "localhost" ] && grep -q "$(hostname)" /etc/hosts; then
        echo "NapCat device profile check failed: hosts-still-contains-hostname" >&2
        exit 78
    fi
    if grep -E 'trim-trashbin|zvol' /proc/devices >/dev/null 2>&1; then
        echo "NapCat device profile check failed: proc-devices-host-leak" >&2
        exit 78
    fi
fi
EOF

sed -i '/FAKE_CGROUP_DIR="\/tmp\/fake_cgroup"/r /tmp/kt-device-profile-defaults.sh' "$ENTRYPOINT"
sed -i '/# Docker Socket/r /tmp/kt-device-profile-dmi.sh' "$ENTRYPOINT"
sed -i '/# \/proc\/1\/sched/r /tmp/kt-device-profile-proc.sh' "$ENTRYPOINT"
sed -i '/: ${NAPCAT_UID:=0}/r /tmp/kt-device-profile-verify.sh' "$ENTRYPOINT"

rm -f \
  /tmp/kt-device-profile-defaults.sh \
  /tmp/kt-device-profile-dmi.sh \
  /tmp/kt-device-profile-proc.sh \
  /tmp/kt-device-profile-verify.sh
