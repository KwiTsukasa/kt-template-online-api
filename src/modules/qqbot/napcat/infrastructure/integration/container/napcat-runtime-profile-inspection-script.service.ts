import { Injectable } from '@nestjs/common';

@Injectable()
export class NapcatRuntimeProfileInspectionScriptService {
  buildInspectScript(containerName: string) {
    return `
set -eu
NAME=${this.sh(containerName)}
docker inspect "$NAME"
docker exec "$NAME" sh -lc 'locale -a; locale; date +%Z; fc-match "Noto Sans CJK SC"; test ! -e /.dockerenv; cat /proc/1/cgroup; id; ps -eo user,args | grep -E "qq|NapCat|Xvfb" | grep -v grep || true'
`;
  }

  private sh(value: string) {
    return `'${`${value}`.replace(/'/g, `'\\''`)}'`;
  }
}
