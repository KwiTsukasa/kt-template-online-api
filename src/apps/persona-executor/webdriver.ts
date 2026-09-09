type Element = { 'element-6066-11e4-a52e-4f735466cecf': string };

export class BrowserSession {
  private session = '';

  /**
   * 在 NAS 本机驱动端建立独立持久浏览器，不连接桌面浏览器或复制其 Cookie。
   * @throws 回环驱动在就绪期限内仍不可用时停止创建会话。
   */
  async start() {
    const deadline = Date.now() + 5000;
    while (true) {
      try {
        await this.call('GET', '/status');
        break;
      } catch (error) {
        if (Date.now() >= deadline) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, 300));
      }
    }
    const result = (await this.call('POST', '/session', {
      capabilities: {
        alwaysMatch: {
          browserName: 'chrome',
          'goog:chromeOptions': {
            binary: '/usr/bin/chromium',
            args: [
              '--headless=new',
              '--no-sandbox',
              '--disable-dev-shm-usage',
              '--window-size=1280,900',
              '--user-data-dir=/data/browser',
            ],
          },
        },
      },
    })) as { sessionId: string };
    this.session = result.sessionId;
    await this.command('POST', '/timeouts', {
      script: 20000,
      pageLoad: 25000,
      implicit: 0,
    });
  }

  /**
   * 向仅绑定回环地址的驱动发送有时限的协议请求。
   * @param method - 固定协议方法。
   * @param path - 已构造的协议路径。
   * @param body - 可选结构化命令参数。
   * @returns 驱动响应值。
   * @throws 协议拒绝或请求超时时返回不含页面凭据的错误。
   */
  private async call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const response = await fetch('http://127.0.0.1:9515' + path, {
      method,
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(28000),
    });
    const result = (await response.json()) as { value?: { error?: string } };
    if (!response.ok || result.value?.error)
      throw new Error('浏览器驱动操作失败。');
    return result.value;
  }

  /**
   * 将命令绑定当前浏览器会话，避免跨任务操作其他窗口。
   * @param method - 协议方法。
   * @param path - 会话内路径。
   * @param body - 命令参数。
   * @returns 当前会话命令结果。
   * @throws 未建立会话时拒绝操作。
   */
  private command(method: string, path: string, body?: unknown) {
    if (!this.session) throw new Error('NAS 浏览器尚未启动。');
    return this.call(method, '/session/' + this.session + path, body);
  }

  /**
   * 导航到预先固定的 QQ 站点，禁止任务输入指定其他站点。
   * @param url - QQ 开放平台页面。
   * @throws URL 不属于 QQ 开放平台时停止导航。
   */
  async navigate(url: string) {
    if (new URL(url).origin !== 'https://q.qq.com')
      throw new Error('浏览器导航目标无效。');
    await this.command('POST', '/url', { url });
  }

  /**
   * 按已知语义选择器找可交互元素，未出现时允许调用方决定下一阶段。
   * @param selector - 固定 CSS 选择器。
   * @returns 第一个匹配元素，缺失时为空。
   */
  async find(selector: string): Promise<Element | undefined> {
    const matches = (await this.command('POST', '/elements', {
      using: 'css selector',
      value: selector,
    })) as Element[];
    return matches[0];
  }

  /**
   * 切换到二维码所属登录框架或返回顶层页面。
   * @param frame - 已定位框架；空值表示顶层。
   */
  async frame(frame: Element | null) {
    await this.command('POST', '/frame', { id: frame });
  }

  /**
   * 等待二维码图片完成解码，避免把尚未加载的空白元素送入摄像头。
   * @param element - 当前登录框架中的二维码图片。
   * @returns 图片已加载且具有有效尺寸时为真。
   */
  async imageReady(element: Element): Promise<boolean> {
    return (await this.command('POST', '/execute/sync', {
      script:
        'const image=arguments[0]; return image.complete && image.naturalWidth>0 && image.naturalHeight>0;',
      args: [element],
    })) as boolean;
  }

  /**
   * 仅在当前 QQ 身份相符且只有一个开发者主体时完成新版登录选择。
   * @param adminQq - NAS 配置中固定的管理员 QQ 号。
   * @returns 是否已选择唯一主体并点击确认登录；多主体或注册页面保持待处理。
   */
  async confirmDeveloper(adminQq: string): Promise<boolean> {
    const selected = (await this.command('POST', '/execute/sync', {
      script:
        "const cookies=Object.fromEntries(document.cookie.split(';').map(s=>s.trim().split('='))); const uin=String(parseInt((cookies.p_uin||cookies.uin||'').replace(/^o/,''),10)); if(uin!==arguments[0])return false; const items=[...document.querySelectorAll('.entity-picker-dialog .picker__item')].filter(e=>e.getClientRects().length); if(items.length!==1)return false; items[0].click(); return true;",
      args: [adminQq],
    })) as boolean;
    if (!selected) return false;
    return this.clickText('确认登录');
  }

  /**
   * 截取当前二维码元素，保持授权码与当前浏览器会话绑定。
   * @param element - 当前页面的二维码图片。
   * @returns PNG 字节，仅供 NAS 虚拟摄像头使用。
   */
  async screenshot(element: Element): Promise<Buffer> {
    const encoded = (await this.command(
      'GET',
      '/element/' +
        element['element-6066-11e4-a52e-4f735466cecf'] +
        '/screenshot',
    )) as string;
    return Buffer.from(encoded, 'base64');
  }

  /**
   * 点击匹配完整文字的唯一可见按钮，不按模糊文案确认未知业务。
   * @param label - 登录流程中的固定按钮文案。
   * @returns 是否点击了唯一匹配按钮。
   */
  async clickText(label: string): Promise<boolean> {
    return (await this.command('POST', '/execute/sync', {
      script:
        "const label=arguments[0]; const nodes=[...document.querySelectorAll('button,a,[role=button],label')].filter(e=>e.getClientRects().length&&e.textContent.trim()===label); if(nodes.length!==1)return false; nodes[0].click(); return true;",
      args: [label],
    })) as boolean;
  }

  /**
   * 使用浏览器自己的登录态调用新版页面正在使用的有限资料接口。
   * @param path - 已核验的新后台查询、预上传或修改路由。
   * @param body - 当前操作的最小字段。
   * @returns HTTP 状态和业务响应，调用方负责验证身份及成功码。
   * @throws 非资料路由时拒绝执行。
   */
  async profileApi(
    path: string,
    body: unknown,
  ): Promise<{ status: number; data: Record<string, any> }> {
    if (
      ![
        '/cgi-bin/v2/info/query',
        '/cgi-bin/v2/resource/pre_upload',
        '/cgi-bin/v2/info/modify',
      ].includes(path)
    )
      throw new Error('资料路由不允许。');
    return (await this.command('POST', '/execute/async', {
      script:
        "const done=arguments[arguments.length-1]; fetch('https://bot.q.qq.com'+arguments[0],{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(arguments[1]),signal:AbortSignal.timeout(15000)}).then(async r=>done({status:r.status,data:await r.json()})).catch(()=>done({status:0,data:{}}));",
      args: [path, body],
    })) as { status: number; data: Record<string, any> };
  }

  /**
   * 将头像上传到官方签发的 COS 地址，不携带平台登录凭据。
   * @param url - 资料预上传响应中的限时地址。
   * @param image - NAS 已校验的 PNG 字节。
   * @returns COS 是否确认写入成功。
   * @throws 非 HTTPS COS 目标时拒绝发送图片。
   */
  async upload(url: string, image: Buffer): Promise<boolean> {
    const target = new URL(url);
    if (
      target.protocol !== 'https:' ||
      !target.hostname.endsWith('.myqcloud.com') ||
      target.username ||
      target.password
    )
      throw new Error('官方头像上传目标无效。');
    return (await this.command('POST', '/execute/async', {
      script:
        "const done=arguments[arguments.length-1]; const bytes=Uint8Array.from(atob(arguments[1]),c=>c.charCodeAt(0)); fetch(arguments[0],{method:'PUT',credentials:'omit',body:bytes,headers:{'Content-Type':'image/png','x-cos-forbid-overwrite':'true'},signal:AbortSignal.timeout(15000)}).then(r=>done(r.ok)).catch(()=>done(false));",
      args: [url, image.toString('base64')],
    })) as boolean;
  }

  /**
   * 关闭本执行器创建的会话并保留磁盘登录态。
   */
  async close() {
    if (this.session) await this.command('DELETE', '');
    this.session = '';
  }
}
