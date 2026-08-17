import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError, ToolsService } from '@/common';
import { BlogThemeConfigBodyDto } from '../contract/blog-theme-config.dto';
import type { BlogArgonThemeConfig } from '../domain/blog-argon-theme.types';
import { BlogThemeConfig } from '../infrastructure/persistence/blog-theme-config.entity';

const DEFAULT_THEME_ID = 'argon';

@Injectable()
export class BlogThemeConfigService {
  constructor(
    @InjectRepository(BlogThemeConfig)
    private readonly themeRepository: Repository<BlogThemeConfig>,
    private readonly toolsService: ToolsService,
  ) {}

  /**
   * 根据当前运行态处理针对博客内容；从 `themeRepository.findOne` 读取针对博客内容。
   * @returns 规范化后的针对博客内容；主值为空时采用 `this.getDefaultConfig()` 兜底。
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
   * 根据`body`更新`save` 对应结果。
   * @param body - 用于`save` 对应结果的结构化输入，包含 `config`、`source` 字段。
   * @returns `save` 对应。
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
   * 根据`config`、`source`处理针对博客内容；把变更持久化到当前存储（`themeRepository.save`）。
   * @param config - 限定针对博客内容边界、地址与开关的运行配置。
   * @param source - 决定针对博客内容、边界或目标的 `source` 值。
   * @returns 针对博客内容。
   */
  private async upsertConfig(config: BlogArgonThemeConfig, source: string) {
    const existing = await this.themeRepository.findOne({
      where: {
        id: DEFAULT_THEME_ID,
      },
    });
    const saved = await this.themeRepository.save(
      (() => {
        if (existing) {
          return Object.assign(existing, { config, source });
        }
        return this.themeRepository.create({
            config,
            id: DEFAULT_THEME_ID,
            source,
          });
      })(),
    );

    return saved.config;
  }

  /**
   * 按当前运行态读取配置。
   * @returns 包含 `argonConfig`、`backgroundDarkBrightness`、`backgroundDarkImage`、`backgroundDarkOpacity`、`backgroundImage` 字段的配置。
   */
  private getDefaultConfig(): BlogArgonThemeConfig {
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
