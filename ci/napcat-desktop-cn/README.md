# NapCat Chinese Desktop Runtime Image

This image consumes a source-built NapCatQQ Shell artifact staged from `D:\MyFiles\KT\GitHub\NapCatQQ`.

Build NapCatQQ first:

```powershell
corepack pnpm --dir D:\MyFiles\KT\GitHub\NapCatQQ install --frozen-lockfile
corepack pnpm --dir D:\MyFiles\KT\GitHub\NapCatQQ --filter napcat-webui-frontend run build
corepack pnpm --dir D:\MyFiles\KT\GitHub\NapCatQQ run build:shell
```

Stage Docker build context:

```powershell
node scripts/napcat-desktop-cn-stage-build.mjs `
  --napcat-root D:\MyFiles\KT\GitHub\NapCatQQ `
  --out .kt-workspace\napcat-desktop-cn-build
```

Build and verify:

```powershell
$baseImage = docker image inspect mlikiowa/napcat-docker:latest --format '{{index .RepoDigests 0}}'
if (-not $baseImage) { throw 'NapCat upstream image digest not found; pull and inspect the image before building.' }
docker build `
  --build-arg NAPCAT_BASE_IMAGE=$baseImage `
  -t kt-napcat-desktop-cn:desktop-cn-v8 `
  -f .kt-workspace/napcat-desktop-cn-build/ci/napcat-desktop-cn/Dockerfile `
  .kt-workspace/napcat-desktop-cn-build

$name = "kt-napcat-v6-verify-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
docker run -d --name $name kt-napcat-desktop-cn:desktop-cn-v8
docker exec $name sh /ci/napcat-desktop-cn/verify.sh
docker rm -f $name
```

Record the final image digest in `QQBOT_NAPCAT_IMAGE`.
