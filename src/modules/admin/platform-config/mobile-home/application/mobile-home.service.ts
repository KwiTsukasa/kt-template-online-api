import { Injectable } from '@nestjs/common';
import { EnvironmentDashboardService } from '../../environment-dashboard/application/environment-dashboard.service';
import { AdminNoticeService } from '../../notice/admin-notice.service';
import type {
  MobileHomeBootstrapResponse,
  MobileHomeNoticeItem,
} from '../domain/mobile-home.types';

const MOBILE_HOME_NOTICE_PAGE_SIZE = 40;

type AdminNoticePageItem = Awaited<
  ReturnType<AdminNoticeService['page']>
>['items'][number];

@Injectable()
export class MobileHomeService {
  constructor(
    private readonly environmentDashboard: EnvironmentDashboardService,
    private readonly adminNotices: AdminNoticeService,
  ) {}

  /**
   * 并行读取环境快照、最新站内信和未读数，任一权威来源失败时拒绝返回部分聚合结果。
   * @returns 供 KwiCore 概览、智能家居和游戏页面共享的只读启动快照。
   */
  async getBootstrap(): Promise<MobileHomeBootstrapResponse> {
    const [environment, noticePage, unreadCount] = await Promise.all([
      this.environmentDashboard.getDashboard(),
      this.adminNotices.page({
        pageNo: 1,
        pageSize: MOBILE_HOME_NOTICE_PAGE_SIZE,
      }),
      this.adminNotices.getUnreadCount(),
    ]);

    return {
      environment,
      notices: {
        items: noticePage.items.map((notice) => this.projectNotice(notice)),
        total: noticePage.total,
        unreadCount,
      },
    };
  }

  /**
   * 把站内信管理对象收敛为移动端所需白名单，排除去重键、接收人和内部元数据。
   * @param notice - 站内信服务返回的单条管理对象。
   * @returns 只含移动端展示字段和显式时间字段的通知投影。
   */
  private projectNotice(notice: AdminNoticePageItem): MobileHomeNoticeItem {
    return {
      content: notice.content,
      createTime: notice.createTime,
      eventType: notice.eventType,
      id: notice.id,
      isTop: notice.isTop,
      lastSeenAt: notice.lastSeenAt,
      occurrenceCount: notice.occurrenceCount,
      severity: notice.severity,
      source: notice.source,
      status: notice.status,
      summary: notice.summary,
      title: notice.title,
    };
  }
}
