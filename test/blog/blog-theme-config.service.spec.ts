import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { ToolsService } from '../../src/common';
import { BlogThemeConfig } from '../../src/blog/blog-theme-config.entity';
import { BlogThemeConfigService } from '../../src/blog/blog-theme-config.service';
import { WordpressService } from '../../src/wordpress/wordpress.service';

describe('BlogThemeConfigService', () => {
  let service: BlogThemeConfigService;
  let repository: {
    create: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
  };
  let wordpressService: {
    themeConfig: jest.Mock;
  };
  const wordpressThemeConfig = {
    argonConfig: {
      codeHighlight: {
        breakLine: false,
        enable: true,
        hideLinenumber: false,
        transparentLinenumber: false,
      },
      dateFormat: 'YMD',
      disablePjax: true,
      foldLongComments: false,
      foldLongShuoshuo: false,
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
    },
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
  };

  beforeEach(async () => {
    repository = {
      create: jest.fn((payload) => payload),
      findOne: jest.fn(),
      save: jest.fn(async (payload) => payload),
    };
    wordpressService = {
      themeConfig: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BlogThemeConfigService,
        ToolsService,
        {
          provide: getRepositoryToken(BlogThemeConfig),
          useValue: repository,
        },
        {
          provide: WordpressService,
          useValue: wordpressService,
        },
      ],
    }).compile();

    service = moduleRef.get(BlogThemeConfigService);
  });

  it('returns a local default config when no saved config exists', async () => {
    repository.findOne.mockResolvedValue(null);

    const config = await service.publicConfig();

    expect(config).toMatchObject({
      site: {
        authorAvatar: '/argon/theme/profile.jpg',
        authorName: 'KwiTsukasa',
        title: 'KwiTsukasa的小站',
      },
      sidebarMenu: [
        {
          href: '/',
          icon: 'fa-home',
          label: '首页',
        },
        {
          external: true,
          href: '/admin',
          icon: 'fa-user',
          label: '管理',
        },
      ],
      themeCardRadius: 4,
      themeColor: '#c3a1ed',
      backgroundDarkBrightness: 0.65,
      backgroundDarkImage: '/argon/theme/img-2-1200x1000.jpg',
      backgroundDarkOpacity: 1,
      backgroundImage: '/argon/theme/img-2-1200x1000.jpg',
      backgroundOpacity: 1,
    });
    expect(wordpressService.themeConfig).not.toHaveBeenCalled();
  });

  it('saves local theme config', async () => {
    repository.findOne.mockResolvedValue(null);

    const result = await service.save({
      config: wordpressThemeConfig,
      source: 'local-admin',
    });

    expect(repository.create).toHaveBeenCalledWith({
      config: wordpressThemeConfig,
      id: 'argon',
      source: 'local-admin',
    });
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        config: wordpressThemeConfig,
        id: 'argon',
        source: 'local-admin',
      }),
    );
    expect(result).toBe(wordpressThemeConfig);
  });

  it('imports WordPress theme config into local storage', async () => {
    repository.findOne.mockResolvedValue({
      id: 'argon',
      source: 'local',
    });
    wordpressService.themeConfig.mockResolvedValue(wordpressThemeConfig);

    const result = await service.importFromWordpress();

    expect(wordpressService.themeConfig).toHaveBeenCalledWith();
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        config: wordpressThemeConfig,
        id: 'argon',
        source: 'wordpress',
      }),
    );
    expect(result).toBe(wordpressThemeConfig);
  });
});
