import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError, ToolsService } from '@/common';
import { WordpressService } from '@/modules/wordpress/application/wordpress.service';
import type { WordpressArgonThemeConfig } from '@/modules/wordpress/domain/wordpress.types';
import { BlogThemeConfigBodyDto } from '../contract/blog-theme-config.dto';
import { BlogThemeConfig } from '../infrastructure/persistence/blog-theme-config.entity';

const DEFAULT_THEME_ID = 'argon';

@Injectable()
export class BlogThemeConfigService {
  /**
   * 初始化 BlogThemeConfigService 实例。
   * @param themeRepository - 博客仓库依赖；影响 constructor 的返回值。
   * @param wordpressService - wordpressService 服务依赖；影响 constructor 的返回值。
   * @param toolsService - ToolsService 依赖；影响 constructor 的返回值。
   */
  constructor(
    @InjectRepository(BlogThemeConfig)
    private readonly themeRepository: Repository<BlogThemeConfig>,
    private readonly wordpressService: WordpressService,
    private readonly toolsService: ToolsService,
  ) {}

  /**
   * 执行 博客内容流程。
   */
  async publicConfig() {
    const localConfig = await this.themeRepository.findOne({
      where: {
        id: DEFAULT_THEME_ID,
      },
    });

    return localConfig?.config || this.getDefaultConfig();
  }

  /**
   * 保存数据。
   * @param body - 请求体 DTO；承载 博客新增、更新、导入或执行字段。
   */
  async save(body: BlogThemeConfigBodyDto) {
    if (!body.config) {
      throwVbenError('请提供主题配置', HttpStatus.BAD_REQUEST);
    }

    return this.upsertConfig(
      body.config,
      this.toolsService.toTrimmedString(body.source) || 'local',
    );
  }

  /**
   * 执行 博客内容流程。
   */
  async importFromWordpress() {
    const config = await this.wordpressService.themeConfig();

    return this.upsertConfig(config, 'wordpress');
  }

  /**
   * 执行 博客内容流程。
   * @param config - config 输入；影响 upsertConfig 的返回值。
   * @param source - source 输入；影响 upsertConfig 的返回值。
   */
  private async upsertConfig(
    config: WordpressArgonThemeConfig,
    source: string,
  ) {
    const existing = await this.themeRepository.findOne({
      where: {
        id: DEFAULT_THEME_ID,
      },
    });
    const saved = await this.themeRepository.save(
      existing
        ? Object.assign(existing, { config, source })
        : this.themeRepository.create({
            config,
            id: DEFAULT_THEME_ID,
            source,
          }),
    );

    return saved.config;
  }

  /**
   * 查询 博客内容数据。
   * @returns 博客内容查询结果。
   */
  private getDefaultConfig(): WordpressArgonThemeConfig {
    return {
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
      backgroundDarkImage: '/argon/theme/img-2-1200x1000.jpg',
      backgroundDarkOpacity: 1,
      backgroundImage: '/argon/theme/img-2-1200x1000.jpg',
      backgroundOpacity: 1,
      bodyClass: ['home', 'blog', 'wp-theme-argon'],
      darkmodeAutoSwitch: 'alwayson',
      enableCustomThemeColor: true,
      headerMenu: [
        {
          href: '/',
          label: '首页',
        },
        {
          href: '/archives',
          label: '归档',
        },
      ],
      htmlClass: [
        'triple-column',
        'immersion-color',
        'toolbar-blur',
        'article-header-style-default',
      ],
      site: {
        authorAvatar: '/argon/theme/profile.jpg',
        authorName: 'KwiTsukasa',
        description: '',
        home: '',
        title: 'KwiTsukasa的小站',
        url: '',
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
      themeColorRgb: '195,161,237',
      themeVersion: '1.3.5',
    };
  }
}
