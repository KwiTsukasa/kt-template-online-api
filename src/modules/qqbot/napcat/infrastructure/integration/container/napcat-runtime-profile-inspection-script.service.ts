import { Injectable } from '@nestjs/common';

@Injectable()
export class NapcatRuntimeProfileInspectionScriptService {
  /** 构建检查脚本。 */
  buildInspectScript(containerName: string) {
    return `
set -eu
NAME=${this.sh(containerName)}
docker inspect "$NAME"
docker exec "$NAME" sh -lc 'locale -a; locale; date +%Z; fc-match "Noto Sans CJK SC"; test ! -e /.dockerenv; cat /proc/1/cgroup; id; ps -eo user,args | grep -E "qq|NapCat|Xvfb" | grep -v grep || true'
`;
  }

  /** 返回Shell。 */
  private sh(value: string) {
    return `'${`${value}`.replace(/'/g, `'\\''`)}'`;
  }
}
