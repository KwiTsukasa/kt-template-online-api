# NapCat Chinese Desktop Runtime Image

Build from the locally inspected upstream digest:

```powershell
$baseImage = docker image inspect mlikiowa/napcat-docker:latest --format '{{index .RepoDigests 0}}'
if (-not $baseImage) { throw 'NapCat upstream image digest not found; pull and inspect the image before building.' }
docker build `
  --build-arg NAPCAT_BASE_IMAGE=$baseImage `
  -t kt-napcat-desktop-cn:desktop-cn-v1 `
  -f ci/napcat-desktop-cn/Dockerfile .
```

Verify:

```powershell
docker run --rm kt-napcat-desktop-cn:desktop-cn-v1 sh /ci/napcat-desktop-cn/verify.sh
```

Record the final digest in `QQBOT_NAPCAT_IMAGE`.
