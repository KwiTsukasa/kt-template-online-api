# NapCat Chinese Desktop Runtime Image

This image consumes a source-built NapCatQQ Shell artifact staged from `D:\MyFiles\KT\GitHub\NapCatQQ`.

Build NapCatQQ first:

```powershell
corepack pnpm --dir D:\MyFiles\KT\GitHub\NapCatQQ install --frozen-lockfile
corepack pnpm --dir D:\MyFiles\KT\GitHub\NapCatQQ --filter napcat-webui-frontend run build
corepack pnpm --dir D:\MyFiles\KT\GitHub\NapCatQQ run build:shell
```

Resolve release evidence before staging. Production and release builds must use an immutable upstream base image digest, not an unpinned tag:

```powershell
docker pull mlikiowa/napcat-docker:latest
$napcatBaseImageDigest = docker image inspect mlikiowa/napcat-docker:latest --format '{{index .RepoDigests 0}}'
if (-not $napcatBaseImageDigest -or $napcatBaseImageDigest -notmatch '@sha256:') {
  throw 'NapCat upstream image digest not found; release builds must use repo@sha256:... evidence.'
}

$upstreamReleaseTag = 'v4.8.100'
$upstreamReleaseCommit = '0123456789abcdef0123456789abcdef01234567'
$jenkinsBuildUrl = 'https://jenkins.example/job/NapCatQQ/123/'
```

Stage Docker build context:

```powershell
node scripts/napcat-desktop-cn-stage-build.mjs `
  --napcat-root D:\MyFiles\KT\GitHub\NapCatQQ `
  --out .kt-workspace\napcat-desktop-cn-build `
  --upstream-release-tag $upstreamReleaseTag `
  --upstream-release-commit $upstreamReleaseCommit `
  --napcat-base-image-digest $napcatBaseImageDigest `
  --jenkins-build-url $jenkinsBuildUrl
```

The staged context must contain `NapCat.Shell` and `ci/napcat-desktop-cn/fork-artifact.json`. The API repo does not commit `NapCat.Shell.zip`; it is rebuilt from the staged `NapCat.Shell` directory inside the Docker image. `fork-artifact.json` must carry complete marker metadata for the fork commit, upstream base commit, upstream release tag, upstream release commit, Jenkins build URL, `napcatMjsSha256`, dist SHA256, and `napcatBaseImageDigest`.

Build and verify:

```powershell
docker build `
  --build-arg NAPCAT_BASE_IMAGE=$napcatBaseImageDigest `
  -t kt-napcat-desktop-cn:desktop-cn-v10 `
  -f .kt-workspace/napcat-desktop-cn-build/ci/napcat-desktop-cn/Dockerfile `
  .kt-workspace/napcat-desktop-cn-build

$name = "kt-napcat-v10-verify-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
docker run -d --name $name `
  --cap-add SYS_ADMIN `
  --security-opt apparmor=unconfined `
  --security-opt seccomp=unconfined `
  -e NAPCAT_REQUIRE_DEVICE_PROFILE=1 `
  kt-napcat-desktop-cn:desktop-cn-v10
docker exec $name sh /ci/napcat-desktop-cn/verify.sh
docker rm -f $name
```

Record the final image digest in `QQBOT_NAPCAT_IMAGE`, and keep the matching `fork-artifact.json` with the release evidence. For local Windows rehearsal, placeholder `$upstreamReleaseTag`, `$upstreamReleaseCommit`, and `$jenkinsBuildUrl` values are acceptable only if the image is not promoted.
