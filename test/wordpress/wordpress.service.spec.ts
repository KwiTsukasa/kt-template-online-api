import { createServer, type Server } from 'node:http';
import { ConfigService } from '@nestjs/config';
import { MarkdownService, ToolsService } from '../../src/common';
import { WordpressService } from '../../src/wordpress/wordpress.service';

describe('WordpressService theme config', () => {
  const rootPayload = {
    description: '',
    home: 'https://blog.kwitsukasa.top',
    name: 'KwiTsukasa的小站',
    url: 'https://blog.kwitsukasa.top',
  };
  const html = `
<!doctype html>
<html lang="zh-Hans" class="no-js triple-column immersion-color toolbar-blur article-header-style-default ">
<head>
  <meta name="theme-color" content="#c3a1ed">
  <meta name="theme-color-rgb" content="195,161,237">
  <meta name="argon-enable-custom-theme-color" content="true">
  <meta name="theme-card-radius" content="4">
  <meta name="theme-version" content="1.3.5">
</head>
<body class="home blog wp-theme-argon">
  <div id="leftbar_overview_author_image" style="background-image: url(http://s3.kwitsukasa.top/images/avatar-tsukasa-1.jpg)" class="rounded-circle shadow-sm" alt="avatar"></div>
  <h6 id="leftbar_overview_author_name">KwiTsukasa</h6>
  <ul id="leftbar_part1_menu" class="leftbar-menu">
    <li><a href="https://blog.kwitsukasa.top"><i class="fa fa-home"></i> 首页</a></li>
    <li><a href="http://blog.kwitsukasa.top/wp-admin/"><i class="fa fa-user"></i> 管理</a></li>
  </ul>
  <style>
    #content:before {
      background: url(https://s3.kwitsukasa.top/images/bg-%E5%86%AC%E6%BB%9A%E6%BB%9A.png);
      background-position: center;
      background-size: cover;
      opacity: 1;
    }
    html.darkmode #content:before {
      filter: brightness(0.65);
    }
    #content:after {
      background: url(https://s3.kwitsukasa.top/images/bg-%E5%86%AC%E6%BB%9A%E6%BB%9A.png);
      opacity: 0;
    }
    html.darkmode #content:after {
      opacity: 1;
    }
  </style>
  <script>
    var argonConfig = {
      wp_path: "/",
      language: "zh_CN",
      dateFormat: "YMD",
      zoomify: false,
      pangu: "article",
      lazyload: {
        threshold: 800,
        effect: "fadeIn"
      },
      fold_long_comments: false,
      fold_long_shuoshuo: false,
      disable_pjax: false,
      pjax_animation_durtion: 600,
      headroom: "false",
      waterflow_columns: "1",
      code_highlight: {
        enable: true,
        hide_linenumber: false,
        transparent_linenumber: false,
        break_line: false
      }
    };
    var darkmodeAutoSwitch = "alwayson";
  </script>
</body>
</html>
`;
  let service: WordpressService;
  let fetchSpy: jest.SpyInstance;
  let markdownService: MarkdownService;

  beforeEach(() => {
    markdownService = new MarkdownService();
    jest
      .spyOn(markdownService, 'renderToHtml')
      .mockResolvedValue('<h1>标题</h1>\n<p>正文</p>');
    service = new WordpressService(
      new ConfigService({
        WORDPRESS_BASE_URL: 'https://blog.kwitsukasa.top',
      }),
      markdownService,
      new ToolsService(),
    );
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url: URL | RequestInfo) => {
        const target = `${url}`;
        if (target.includes('rest_route=/')) {
          return new Response(JSON.stringify(rootPayload), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          });
        }

        return new Response(html, {
          headers: { 'Content-Type': 'text/html' },
          status: 200,
        });
      });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('extracts Argon theme config from WordPress REST root and homepage html', async () => {
    const config = await service.themeConfig();

    expect(config).toMatchObject({
      backgroundDarkBrightness: 0.65,
      backgroundDarkImage: 'https://s3.kwitsukasa.top/images/bg-冬滚滚.png',
      backgroundDarkOpacity: 1,
      backgroundImage: 'https://s3.kwitsukasa.top/images/bg-冬滚滚.png',
      backgroundOpacity: 1,
      bodyClass: ['home', 'blog', 'wp-theme-argon'],
      darkmodeAutoSwitch: 'alwayson',
      enableCustomThemeColor: true,
      htmlClass: [
        'triple-column',
        'immersion-color',
        'toolbar-blur',
        'article-header-style-default',
      ],
      sidebarMenu: [
        {
          external: true,
          href: 'https://blog.kwitsukasa.top',
          icon: 'fa-home',
          label: '首页',
        },
        {
          external: true,
          href: 'http://blog.kwitsukasa.top/wp-admin/',
          icon: 'fa-user',
          label: '管理',
        },
      ],
      site: {
        authorAvatar: 'http://s3.kwitsukasa.top/images/avatar-tsukasa-1.jpg',
        authorName: 'KwiTsukasa',
        description: '',
        home: 'https://blog.kwitsukasa.top',
        title: 'KwiTsukasa的小站',
        url: 'https://blog.kwitsukasa.top',
      },
      themeCardRadius: 4,
      themeColor: '#c3a1ed',
      themeColorRgb: '195,161,237',
      themeVersion: '1.3.5',
    });
    expect(config.argonConfig).toMatchObject({
      codeHighlight: {
        breakLine: false,
        enable: true,
        hideLinenumber: false,
        transparentLinenumber: false,
      },
      dateFormat: 'YMD',
      disablePjax: false,
      headroom: 'false',
      language: 'zh_CN',
      lazyload: {
        effect: 'fadeIn',
        threshold: 800,
      },
      pangu: 'article',
      pjaxAnimationDuration: 600,
      waterflowColumns: '1',
      wpPath: '/',
      zoomify: false,
    });
  });

  it('uses configured WordPress host header for raw theme html requests', async () => {
    const hosts: string[] = [];
    const server = await new Promise<Server>((resolve) => {
      const nextServer = createServer((request, response) => {
        hosts.push(request.headers.host || '');

        if (request.headers.host !== 'blog.kwitsukasa.top') {
          response.writeHead(301, {
            Location: 'http://127.0.0.1/',
          });
          response.end();
          return;
        }

        if (request.url?.includes('rest_route=')) {
          response.writeHead(200, {
            'Content-Type': 'application/json',
          });
          response.end(JSON.stringify(rootPayload));
          return;
        }

        response.writeHead(200, {
          'Content-Type': 'text/html',
        });
        response.end(html);
      });

      nextServer.listen(0, '127.0.0.1', () => resolve(nextServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('测试服务启动失败');
      }
      service = new WordpressService(
        new ConfigService({
          WORDPRESS_BASE_URL: `http://127.0.0.1:${address.port}`,
          WORDPRESS_HOST_HEADER: 'blog.kwitsukasa.top',
        }),
        markdownService,
        new ToolsService(),
      );

      const config = await service.themeConfig();

      expect(config.themeColor).toBe('#c3a1ed');
      expect(config.site.title).toBe('KwiTsukasa的小站');
      expect(hosts).toEqual([
        'blog.kwitsukasa.top',
        'blog.kwitsukasa.top',
      ]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('renders markdown article content before saving to WordPress', async () => {
    fetchSpy.mockImplementation(async (url: URL | RequestInfo, init?: any) => {
      const target = `${url}`;
      if (target.includes('/wp-json/wp/v2/posts')) {
        const body = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            content: { raw: body.content },
            id: 1,
            title: { raw: body.title },
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          },
        );
      }

      return new Response(JSON.stringify({ id: 1 }), { status: 200 });
    });

    const result = await service.articleSave(
      {
        content: '# 标题\n\n正文<script>alert(1)</script>',
        contentFormat: 'markdown',
        title: 'Markdown 文章',
      },
      {
        nonce: 'rest-nonce',
        cookie: 'wordpress_logged_in_demo=1',
      },
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/wp-json/wp/v2/posts'),
      expect.objectContaining({
        method: 'POST',
      }),
    );
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.content).toContain('<h1>标题</h1>');
    expect(body.content).not.toContain('<script>');
    expect(body.content).toContain('kt-markdown-source:');
    expect(markdownService.renderToHtml).toHaveBeenCalledWith(
      '# 标题\n\n正文<script>alert(1)</script>',
    );
    expect(result.contentMarkdown).toBe(
      '# 标题\n\n正文<script>alert(1)</script>',
    );
  });

  it('normalizes public article list from WordPress view responses', async () => {
    fetchSpy.mockImplementation(async (_url: URL | RequestInfo, init?: any) => {
      expect(init?.headers?.Authorization).toBeUndefined();
      expect(init?.headers?.Cookie).toBeUndefined();

      return new Response(
        JSON.stringify([
          {
            _embedded: {
              author: [{ name: '作者' }],
              'wp:featuredmedia': [{ source_url: 'https://img.demo/cover.jpg' }],
              'wp:term': [
                [
                  {
                    count: 2,
                    id: 10,
                    name: '技术',
                    slug: 'tech',
                    taxonomy: 'category',
                  },
                ],
                [
                  {
                    count: 1,
                    id: 20,
                    name: 'Milkdown',
                    slug: 'milkdown',
                    taxonomy: 'post_tag',
                  },
                ],
              ],
            },
            content: {
              rendered: '<h1>标题</h1>',
            },
            excerpt: {
              rendered: '<p>摘要</p>',
            },
            id: 1,
            slug: 'demo',
            title: {
              rendered: '公开文章',
            },
          },
        ]),
        {
          headers: {
            'Content-Type': 'application/json',
            'x-wp-total': '1',
          },
          status: 200,
        },
      );
    });

    const result = await service.publicArticleList({
      pageNo: 1,
      pageSize: 10,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/wp-json/wp/v2/posts'),
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(result.total).toBe(1);
    expect(result.list[0]).toMatchObject({
      authorName: '作者',
      contentHtml: '<h1>标题</h1>',
      cover: 'https://img.demo/cover.jpg',
      excerptText: '摘要',
      categoriesResolved: [{ id: 10, name: '技术', slug: 'tech' }],
      tagsResolved: [{ id: 20, name: 'Milkdown', slug: 'milkdown' }],
    });
  });
});
