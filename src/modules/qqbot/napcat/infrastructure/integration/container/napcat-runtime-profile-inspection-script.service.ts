import { Injectable } from '@nestjs/common';

@Injectable()
export class NapcatRuntimeProfileInspectionScriptService {
  /**
   * 生成远程诊断脚本，用于采集 NapCat 容器元数据、区域设置、时区、字体和关键进程信息。
   * @param containerName - 要接受运行档案检查的 NapCat Docker 容器名称。
   * @returns 已安全引用容器名称、可交给远端 Shell 执行的只读检查脚本。
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
   * 把脚本参数中的单引号转义并包裹为安全的 Shell 单词，避免内容改变命令结构。
   * @param value - 参与把脚本参数中的单引号转义并包裹为安全的 Shell 单词，避免内容改变命令结构比较、格式化或输出的候选值。
   * @returns 按参数编码并拼接完成的sh。
   */
  private sh(value: string) {
    return `'${`${value}`.replace(/'/g, `'\\''`)}'`;
  }
}
