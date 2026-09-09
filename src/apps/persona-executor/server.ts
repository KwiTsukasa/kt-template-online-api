import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rename, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isPersonaName } from '../../modules/plugins/persona-switch/src/command';
import type { ProfileJobStatus } from '../../modules/plugins/persona-switch/src/profile-client';
import { BrowserSession } from './webdriver';
import { AndroidScanner } from './android';
import { avatarsMatch, imageHash, normalizeAvatar } from './media';

type Job = {
  id: string;
  name: string;
  avatarHash: string;
  status: ProfileJobStatus;
  stage: 'queued' | 'login' | 'upload' | 'submit' | 'verify' | 'done';
  detail: string;
  uploadId?: string;
};
type Options = {
  root: string;
  token: string;
  appId: string;
  adminQq: string;
  androidSerial: string;
};
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const JOB_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const HASH = /^[a-f0-9]{64}$/u;

export class PersonaExecutor {
  private active: string | null = null;
  private unresolved: string | null = null;
  private storageFault = false;
  constructor(private readonly options: Options) {}

  /**
   * 启动唯一任务并收束持久化异常，磁盘故障后停止新任务而不丢弃错误。
   * @param job - 已保存且获得独占执行权的操作。
   */
  private launch(job: Job): void {
    void this.execute(job).catch(() => {
      this.storageFault = true;
    });
  }

  /**
   * 原子写入执行记录，使进程退出后仍能区分已提交与尚未提交的任务。
   * @param job - 已校验且属于当前执行器的操作记录。
   */
  private async persist(job: Job) {
    const path = join(this.options.root, 'jobs', job.id + '.json');
    await this.persistBytes(path, Buffer.from(JSON.stringify(job)));
  }

  /**
   * 在 Linux 上同步临时文件、原子替换并同步目录，确保外部提交之前执行阶段已落盘。
   * @param path - 私有数据目录内的固定内容或操作路径。
   * @param bytes - 待持久化的完整字节。
   */
  private async persistBytes(path: string, bytes: Buffer) {
    const file = await open(path + '.pending', 'w', 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(path + '.pending', path);
    const directory = await open(dirname(path), 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }

  /**
   * 从固定任务目录读取记录并拒绝身份或内容异常的数据。
   * @param id - API 已持久化的 UUID 操作身份。
   * @returns 经核验的记录；不存在时为空。
   * @throws 损坏记录或非法身份时停止操作。
   */
  private async readJob(id: string): Promise<Job | undefined> {
    if (!JOB_ID.test(id)) throw new Error('操作身份无效。');
    let bytes: string;
    try {
      bytes = await readFile(
        join(this.options.root, 'jobs', id + '.json'),
        'utf8',
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    const job = JSON.parse(bytes) as Job;
    if (
      job.id !== id ||
      !isPersonaName(job.name) ||
      !HASH.test(job.avatarHash) ||
      ![
        'queued',
        'running',
        'applied',
        'failed',
        'needs_login',
        'uncertain',
      ].includes(job.status) ||
      !['queued', 'login', 'upload', 'submit', 'verify', 'done'].includes(
        job.stage,
      ) ||
      (job.status === 'uncertain' && !['submit', 'verify'].includes(job.stage))
    )
      throw new Error('执行记录损坏。');
    return job;
  }

  /**
   * 初始化私有资产和记录目录，只恢复一个尚未完成的原操作。
   * @throws 配置无效或检测到多个未完成记录时拒绝自动执行。
   */
  async initialize() {
    if (
      this.options.token.length < 32 ||
      !/^\d{5,12}$/u.test(this.options.appId) ||
      !/^\d{5,12}$/u.test(this.options.adminQq)
    )
      throw new Error('NAS 人格执行器配置无效。');
    await mkdir(join(this.options.root, 'avatars'), {
      recursive: true,
      mode: 0o700,
    });
    await mkdir(join(this.options.root, 'jobs'), {
      recursive: true,
      mode: 0o700,
    });
    const pending: Job[] = [];
    for (const entry of await readdir(join(this.options.root, 'jobs'))) {
      if (!entry.endsWith('.json')) continue;
      const job = await this.readJob(entry.slice(0, -5));
      if (job && ['queued', 'running', 'uncertain'].includes(job.status))
        pending.push(job);
    }
    if (pending.length > 1)
      throw new Error('存在多个未完成操作，需要核对执行记录。');
    if (pending.length === 1) {
      if (pending[0].status === 'uncertain') {
        this.unresolved = pending[0].id;
        return;
      }
      this.active = pending[0].id;
      this.launch(pending[0]);
    }
  }

  /**
   * 在固定内容地址读取并核对头像字节，防止路径注入或磁盘漂移。
   * @param hash - API 保存的内容摘要。
   * @returns 与该摘要一致的 PNG 字节。
   * @throws 标识非法或字节摘要不符时拒绝上传。
   */
  private async avatar(hash: string) {
    if (!HASH.test(hash)) throw new Error('头像内容身份无效。');
    const bytes = await readFile(
      join(this.options.root, 'avatars', hash + '.png'),
    );
    if (imageHash(bytes) !== hash) throw new Error('头像字节校验失败。');
    return bytes;
  }

  /**
   * 核验新版平台返回的 Bot 与管理员身份，仅保留资料所需字段。
   * @param browser - 当前 NAS 浏览器会话。
   * @returns 已绑定目标身份的名称和头像；会话过期时为空。
   * @throws 非登录错误或身份不符时拒绝修改。
   */
  private async query(
    browser: BrowserSession,
  ): Promise<{ name: string; avatar: string } | null> {
    const result = await browser.profileApi('/cgi-bin/v2/info/query', {
      bot_appid: Number(this.options.appId),
      filter: {
        base_info: 1,
        developer_info: 1,
        private_proto: 0,
        online_state: 0,
      },
    });
    if (
      result.status === 401 ||
      [-10001, -10002, 10004].includes(result.data.retcode)
    )
      return null;
    if (result.status !== 200 || result.data.retcode !== 0)
      throw new Error('新版平台资料读取未成功。');
    const base = result.data.data?.base_info,
      developer = result.data.data?.developer_info;
    if (
      String(base?.bot_appid) !== this.options.appId ||
      String(developer?.admin_uin) !== this.options.adminQq ||
      typeof base.bot_name !== 'string' ||
      typeof base.bot_avatar !== 'string'
    )
      throw new Error('当前 Bot 或管理员身份不符。');
    return { name: base.bot_name, avatar: base.bot_avatar };
  }

  /**
   * 在浏览器和手机 QQ 的同一授权周期内扫码，额外身份验证返回待处理状态。
   * @param browser - NAS 独立登录会话。
   * @param scanner - NAS 已适配的 Android 扫码设备。
   * @returns 是否完成并读回目标 Bot 身份。
   */
  private async login(
    browser: BrowserSession,
    scanner: AndroidScanner,
  ): Promise<boolean> {
    try {
      await scanner.prepare();
      await browser.navigate('https://q.qq.com/#/apps');
      const deadline = Date.now() + 30000;
      let frame = await browser.find('iframe[src*="ptlogin"]');
      while (!frame && Date.now() < deadline) {
        await pause(500);
        frame = await browser.find('iframe[src*="ptlogin"]');
      }
      if (!frame) return false;
      await browser.frame(frame);
      let qr = await browser.find('img[src*="ptqrshow"]');
      while ((!qr || !(await browser.imageReady(qr))) && Date.now() < deadline) {
        await pause(400);
        qr = await browser.find('img[src*="ptqrshow"]');
      }
      if (!qr || !(await browser.imageReady(qr))) return false;
      await scanner.show(await browser.screenshot(qr));
      if (!(await scanner.confirm())) return false;
      await browser.frame(null);
      for (let attempt = 0; attempt < 12; attempt++) {
        // 部分已有开发者账号需要在扫码后确认归属，按钮不唯一时保持待处理。
        await browser.confirmDeveloper(this.options.adminQq);
        await browser.clickText('登录');
        await browser.clickText('确认');
        await pause(700);
        const profile = await this.query(browser).catch(() => null);
        if (profile) return true;
      }
      return false;
    } finally {
      await browser.frame(null).catch(() => undefined);
      await scanner.clear();
    }
  }

  /**
   * 从可信 QQ 头像域限量读回图片，不跟随重定向或转发登录凭据。
   * @param address - 已通过目标 Bot 查询取得的头像地址。
   * @returns 限量读取的当前头像字节。
   * @throws 域名、响应或实际流量超限时拒绝确认。
   */
  private async readPublicAvatar(address: string) {
    const url = new URL(address);
    const allowed = [
      '.qpic.cn',
      '.qlogo.cn',
      '.gtimg.com',
      '.myqcloud.com',
      '.ugcimg.cn',
    ];
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !allowed.some((suffix) => url.hostname.endsWith(suffix))
    )
      throw new Error('Bot 头像域名不受信任。');
    const response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok || !response.body) throw new Error('Bot 头像读取失败。');
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        size += item.value.byteLength;
        if (size > 2 * 1024 * 1024) throw new Error('Bot 头像响应过大。');
        chunks.push(item.value);
      }
    } finally {
      await reader.cancel();
    }
    return Buffer.concat(chunks);
  }

  /**
   * 读回名称并逐像素比较头像，禁止只凭提交成功码声称资料已生效。
   * @param browser - 当前登录浏览器。
   * @param job - 目标资料身份。
   * @param avatar - 目标头像字节。
   * @returns 两项资料是否均已读回一致。
   */
  private async matches(browser: BrowserSession, job: Job, avatar: Buffer) {
    const profile = await this.query(browser);
    if (!profile || profile.name !== job.name) return false;
    return avatarsMatch(avatar, await this.readPublicAvatar(profile.avatar));
  }

  /**
   * 执行持久操作并在提交前标记不可盲目重试阶段，登录态和业务状态分别保存。
   * @param job - 已通过 API 条件写入登记的目标记录。
   * @throws 头像预上传或上传失败时在本方法内捕获并登记失败；记录无法持久化时向启动边界传播。
   */
  private async execute(job: Job) {
    const browser = new BrowserSession(),
      scanner = new AndroidScanner(this.options.androidSerial);
    const possiblySubmitted = ['submit', 'verify'].includes(job.stage);
    try {
      job.status = 'running';
      job.detail = 'NAS 正在核对浏览器登录态。';
      await this.persist(job);
      await browser.start();
      await browser.navigate(
        'https://q.qq.com/qqbot/dashboard/manage/' + this.options.appId,
      );
      if (!(await this.query(browser))) {
        if (!(await this.login(browser, scanner))) {
          job.status = 'needs_login';
          job.detail =
            'NAS 手机 QQ 或开发者归属需要确认；完成后可重新执行切换。';
          if (possiblySubmitted) {
            job.status = 'uncertain';
            job.detail =
              '原操作可能已提交，需恢复 NAS 登录后继续核对，不能另建修改任务。';
          }
          return;
        }
      }
      const avatar = await this.avatar(job.avatarHash);
      if (await this.matches(browser, job, avatar)) {
        job.status = 'applied';
        job.stage = 'done';
        job.detail = 'Bot 昵称和头像已读回一致。';
        return;
      }
      if (possiblySubmitted) {
        job.status = 'uncertain';
        job.detail =
          '上次资料提交结果仍未读回，已停止重复提交；请核对新版后台。';
        return;
      }
      job.stage = 'upload';
      job.detail = 'NAS 正在上传人格头像。';
      await this.persist(job);
      const upload = await browser.profileApi(
        '/cgi-bin/v2/resource/pre_upload',
        { type: 2, bot_appid: Number(this.options.appId) },
      );
      if (
        upload.status !== 200 ||
        upload.data.retcode !== 0 ||
        typeof upload.data.data?.upload_url !== 'string' ||
        typeof upload.data.data?.upload_id !== 'string'
      )
        throw new Error('头像预上传失败。');
      if (!(await browser.upload(upload.data.data.upload_url, avatar)))
        throw new Error('头像上传失败。');
      job.uploadId = upload.data.data.upload_id;
      job.stage = 'submit';
      job.detail = '正在提交 Bot 昵称和头像。';
      await this.persist(job);
      const submitted = await browser.profileApi('/cgi-bin/v2/info/modify', {
        bot_appid: Number(this.options.appId),
        filter: { name: 1, avatar: 1, desc: 0, feature_preview: 0 },
        name: job.name,
        avatar_id: job.uploadId,
        desc: '',
        preview_items: [],
      });
      if (
        submitted.status === 200 &&
        typeof submitted.data.retcode === 'number' &&
        submitted.data.retcode !== 0
      ) {
        job.status = 'failed';
        job.stage = 'done';
        job.detail =
          '新版平台拒绝资料修改（错误码 ' +
          submitted.data.retcode +
          '），请查看后台原因。';
        return;
      }
      if (submitted.status !== 200 || submitted.data.retcode !== 0) {
        job.status = 'uncertain';
        job.detail = '资料提交响应不确定，已停止重复提交。';
        return;
      }
      job.stage = 'verify';
      job.detail = '资料已提交，等待名称与头像读回。';
      await this.persist(job);
      for (let attempt = 0; attempt < 8; attempt++) {
        if (await this.matches(browser, job, avatar)) {
          job.status = 'applied';
          job.stage = 'done';
          job.detail = 'Bot 昵称和头像已读回一致。';
          return;
        }
        await pause(1500);
      }
      job.status = 'uncertain';
      job.detail = '资料已提交，暂未全部读回；需核对生效或审核状态。';
    } catch {
      if (['submit', 'verify'].includes(job.stage)) {
        job.status = 'uncertain';
        job.detail = '提交后核验中断，已保留原操作，禁止盲目重提。';
      } else {
        job.status = 'failed';
        job.detail = 'NAS 浏览器、Android 或图片读取失败，请检查执行器状态。';
      }
    } finally {
      try {
        await this.persist(job);
      } finally {
        await browser.close().catch(() => undefined);
        if (job.status === 'uncertain') this.unresolved = job.id;
        else if (this.unresolved === job.id) this.unresolved = null;
        this.active = null;
      }
    }
  }

  /**
   * 校验服务间凭据，避免未授权网络请求驱动真实 Bot 资料修改。
   * @param request - 当前内部 HTTP 请求。
   * @returns 令牌是否与私有配置匹配。
   */
  private authorized(request: IncomingMessage) {
    const actual = createHash('sha256')
      .update(request.headers.authorization || '')
      .digest();
    const expected = createHash('sha256')
      .update('Bearer ' + this.options.token)
      .digest();
    return timingSafeEqual(actual, expected);
  }

  /**
   * 限量读取 JSON 请求正文，不允许大载荷占满 NAS 内存。
   * @param request - 当前内部请求流。
   * @returns 已解析的结构化对象。
   * @throws 大小或 JSON 格式无效时拒绝处理。
   */
  private async body(
    request: IncomingMessage,
  ): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 3 * 1024 * 1024) throw new Error('请求过大。');
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new Error('请求格式无效。');
    return body;
  }

  /**
   * 向 API 返回有限状态，不返回 Cookie、图片字节或官方上传地址。
   * @param response - HTTP 响应对象。
   * @param status - HTTP 状态码。
   * @param value - 最小结构化结果。
   */
  private respond(response: ServerResponse, status: number, value: unknown) {
    response.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(value));
  }

  /**
   * 处理头像保存与幂等资料任务，既有操作身份不能绑定不同目标。
   * @param request - API 服务的内部请求。
   * @param response - 本次有界 HTTP 响应。
   * @throws 载荷、任务身份或头像无效时在本方法内捕获，并转换为失败响应。
   */
  async handle(request: IncomingMessage, response: ServerResponse) {
    try {
      if (!this.authorized(request)) {
        this.respond(response, 401, { error: 'unauthorized' });
        return;
      }
      if (this.storageFault) {
        this.respond(response, 503, { error: 'storage_unavailable' });
        return;
      }
      if (request.method === 'GET' && request.url === '/health') {
        this.respond(response, 200, {
          ready: true,
          busy: this.active !== null,
        });
        return;
      }
      if (request.method === 'GET' && request.url?.startsWith('/v1/jobs/')) {
        const job = await this.readJob(request.url.slice('/v1/jobs/'.length));
        if (!job) {
          this.respond(response, 404, { error: 'not_found' });
          return;
        }
        if (job.status === 'uncertain' && !this.active) {
          this.active = job.id;
          this.launch(job);
        }
        this.respond(response, 200, {
          id: job.id,
          status: job.status,
          detail: job.detail,
        });
        return;
      }
      if (request.method !== 'POST') {
        this.respond(response, 404, { error: 'not_found' });
        return;
      }
      const body = await this.body(request);
      if (request.url === '/v1/avatars') {
        if (
          typeof body.image !== 'string' ||
          !/^[A-Za-z0-9+/]+={0,2}$/u.test(body.image)
        )
          throw new Error('图片载荷无效。');
        const { png } = await normalizeAvatar(
          Buffer.from(body.image, 'base64'),
        );
        const hash = imageHash(png);
        await this.persistBytes(
          join(this.options.root, 'avatars', hash + '.png'),
          png,
        );
        this.respond(response, 200, { hash });
        return;
      }
      if (request.url === '/v1/jobs') {
        if (
          typeof body.id !== 'string' ||
          !JOB_ID.test(body.id) ||
          !isPersonaName(body.name) ||
          typeof body.avatarHash !== 'string' ||
          !HASH.test(body.avatarHash)
        )
          throw new Error('任务格式无效。');
        const existing = await this.readJob(body.id);
        if (existing) {
          if (
            existing.name !== body.name ||
            existing.avatarHash !== body.avatarHash
          ) {
            this.respond(response, 409, { error: 'identity_conflict' });
            return;
          }
          this.respond(response, 200, {
            id: existing.id,
            status: existing.status,
            detail: existing.detail,
          });
          return;
        }
        if (this.active || this.unresolved) {
          this.respond(response, 409, { error: 'busy' });
          return;
        }
        this.active = body.id;
        try {
          await this.avatar(body.avatarHash);
          const job: Job = {
            id: body.id,
            name: body.name,
            avatarHash: body.avatarHash,
            status: 'queued',
            stage: 'queued',
            detail: '等待 NAS 执行资料同步。',
          };
          await this.persist(job);
          this.respond(response, 202, {
            id: job.id,
            status: job.status,
            detail: job.detail,
          });
          this.launch(job);
        } catch (error) {
          this.active = null;
          throw error;
        }
        return;
      }
      this.respond(response, 404, { error: 'not_found' });
    } catch {
      this.respond(response, 400, { error: 'request_failed' });
    }
  }
}

/**
 * 启动仅由 NAS 服务配置驱动的执行器，不读取桌面凭据或聊天指定的连接目标。
 */
async function main() {
  const executor = new PersonaExecutor({
    root: process.env.PERSONA_EXECUTOR_DATA || '/data',
    token: process.env.PERSONA_EXECUTOR_TOKEN || '',
    appId: process.env.PERSONA_BOT_APP_ID || '',
    adminQq: process.env.PERSONA_ADMIN_QQ || '',
    androidSerial: process.env.PERSONA_ANDROID_SERIAL || '',
  });
  await executor.initialize();
  const server = createServer(
    (request, response) => void executor.handle(request, response),
  );
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.listen(8643, '0.0.0.0');
}

if (require.main === module)
  void main().catch(() => {
    process.stderr.write('NAS 人格执行器启动失败，请核对配置与记录。\n');
    process.exitCode = 1;
  });
