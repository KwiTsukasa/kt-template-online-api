import { Injectable } from '@nestjs/common';

@Injectable()
export class NapcatRuntimeProfileInspectionScriptService {
  /**
   * Builds the remote inspection script for Docker and in-container profile evidence.
   * @param containerName - Docker container name selected from the persisted NapCat container row.
   * @returns Shell script that collects runtime evidence without reading secret environment values.
   */
  buildInspectScript(containerName: string) {
    return `
set -eu
NAME=${this.sh(containerName)}
docker inspect "$NAME"
docker exec "$NAME" sh -lc 'locale -a; locale; date +%Z; fc-match "Noto Sans CJK SC"; test ! -e /.dockerenv; cat /proc/1/cgroup; id; ps -eo user,args | grep -E "qq|NapCat|Xvfb" | grep -v grep || true'
`;
  }

  /**
   * Quotes shell literals used by read-only inspection scripts.
   * @param value - Container name selected from trusted persistence.
   * @returns POSIX-safe single-quoted shell literal.
   */
  private sh(value: string) {
    return `'${`${value}`.replace(/'/g, `'\\''`)}'`;
  }
}
