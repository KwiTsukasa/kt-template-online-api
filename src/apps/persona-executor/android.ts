import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';
import { qrCameraFrame } from './media';

const execute = promisify(execFile);
const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export class AndroidScanner {
  private frameHash: string | undefined;
  constructor(private readonly serial: string) {}

  /**
   * 在 NAS 执行固定设备的 ADB 操作，输出限长且不经过本机或任意 shell 插值。
   * @param args - 程序内部构造的 ADB 参数。
   * @returns 当前命令的有界输出，不进入服务日志。
   */
  private async adb(...args: string[]) {
    const result = await execute('adb', ['-s', this.serial, ...args], {
      timeout: 12000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return result.stdout.trim();
  }

  /**
   * 读取当前手机 QQ 的可访问树，供确定点击目标而不猜测坐标。
   * @returns 界面节点的文本、描述及边界集合。
   */
  private async nodes(): Promise<Array<Record<string, string>>> {
    await this.adb(
      'shell',
      'uiautomator',
      'dump',
      '/data/local/tmp/kt-persona-ui.xml',
    );
    const xml = await this.adb(
      'shell',
      'cat',
      '/data/local/tmp/kt-persona-ui.xml',
    );
    const root = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
    }).parse(xml);
    const found: Array<Record<string, string>> = [];
    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      const node = value as Record<string, any>;
      if (typeof node.bounds === 'string') found.push(node);
      Object.values(node).forEach(visit);
    };
    visit(root);
    return found;
  }

  /**
   * 只点击可访问树中与固定文案完全一致的唯一节点。
   * @param nodes - 刚读取的界面节点。
   * @param label - 允许操作的固定文案。
   * @returns 是否找到并点击唯一目标。
   */
  private async tap(
    nodes: Array<Record<string, string>>,
    label: string,
  ): Promise<boolean> {
    const matches = nodes.filter(
      (node) => node.text === label || node['content-desc'] === label,
    );
    if (matches.length !== 1) return false;
    const bounds = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/u.exec(matches[0].bounds);
    if (!bounds) return false;
    const x = Math.floor((Number(bounds[1]) + Number(bounds[3])) / 2),
      y = Math.floor((Number(bounds[2]) + Number(bounds[4])) / 2);
    await this.adb('shell', 'input', 'tap', String(x), String(y));
    return true;
  }

  /**
   * 核对容器相机与目录权限，复用已打开的扫一扫或从手机 QQ 首页进入。
   * @throws 当前设备不是已适配虚拟相机或 QQ 尚未登录时停止自动确认。
   */
  async prepare() {
    if (!/^[a-zA-Z0-9.-]+:\d{1,5}$/u.test(this.serial))
      throw new Error('NAS Android 地址无效。');
    await execute('adb', ['connect', this.serial], {
      timeout: 12000,
      maxBuffer: 1024,
    });
    if (
      (await this.adb('get-state')) !== 'device' ||
      (await this.adb('shell', 'id', '-u')) !== '2000'
    )
      throw new Error('Android 设备身份不符。');
    if (
      (await this.adb('shell', 'getprop', 'ro.vendor.camera.config')) !== 'back'
    )
      throw new Error('Android 虚拟相机未启用。');
    if (
      (await this.adb(
        'shell',
        'stat',
        '-c',
        '%u:%g:%a',
        '/data/vendor/kt-camera',
      )) !== '2000:1000:2750'
    )
      throw new Error('Android 相机目录身份不符。');
    await this.adb(
      'shell',
      'am',
      'start',
      '-n',
      'com.tencent.mobileqq/.activity.SplashActivity',
    );
    await wait(700);
    const nodes = await this.nodes();
    if (
      nodes.some((node) => node.text === '请对准需要识别的二维码') &&
      nodes.some((node) => node['content-desc'] === '扫码')
    )
      return;
    if (!(await this.tap(nodes, '快捷入口')))
      throw new Error('手机 QQ 需要登录或界面处理。');
    await wait(300);
    if (!(await this.tap(await this.nodes(), '扫一扫')))
      throw new Error('手机 QQ 扫码入口不可用。');
  }

  /**
   * 将同一浏览器会话的新二维码原子投放到 NAS 虚拟摄像头。
   * @param png - 当前登录页的二维码截图。
   */
  async show(png: Buffer) {
    const temporary = '/tmp/kt-persona-camera.gray';
    const frame = await qrCameraFrame(png);
    await writeFile(temporary, frame, { mode: 0o600 });
    try {
      await this.adb(
        'push',
        temporary,
        '/data/vendor/kt-camera/input.persona.pending',
      );
      await this.adb(
        'shell',
        'chmod',
        '640',
        '/data/vendor/kt-camera/input.persona.pending',
      );
      await this.adb(
        'shell',
        'mv',
        '/data/vendor/kt-camera/input.persona.pending',
        '/data/vendor/kt-camera/input.gray',
      );
      this.frameHash = createHash('sha256').update(frame).digest('hex');
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  /**
   * 仅在识别出 QQ 开放平台登录确认页时确认，不自动处理额外身份验证。
   * @returns 是否已在当前手机 QQ 会话完成确认。
   */
  async confirm(): Promise<boolean> {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const nodes = await this.nodes();
      const platform = nodes.some((node) =>
        (node.text || node['content-desc'] || '').includes('QQ开放平台'),
      );
      if (platform && (await this.tap(nodes, '登录'))) return true;
      await wait(500);
    }
    return false;
  }

  /**
   * 清理本执行器投放的二维码及界面快照，不退出手机 QQ 或删除登录态。
   */
  async clear() {
    const current = await this.adb(
      'shell',
      'sha256sum',
      '/data/vendor/kt-camera/input.gray',
    ).catch(() => '');
    if (this.frameHash && current.split(/\s/u)[0] === this.frameHash) {
      await this.adb('shell', 'rm', '-f', '/data/vendor/kt-camera/input.gray');
    }
    this.frameHash = undefined;
    await this.adb(
      'shell',
      'rm',
      '-f',
      '/data/vendor/kt-camera/input.persona.pending',
      '/data/local/tmp/kt-persona-ui.xml',
    );
  }
}
