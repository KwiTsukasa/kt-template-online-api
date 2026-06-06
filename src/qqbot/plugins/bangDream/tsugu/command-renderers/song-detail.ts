import { getPresentEvent } from '@/qqbot/plugins/bangDream/tsugu/models/event';
import {
  drawList,
  line,
  drawListByServerList,
  drawListMerge,
} from '@/qqbot/plugins/bangDream/tsugu/render-blocks/list-frame';
import { drawDataBlock } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/data-block';
import { Image, Canvas } from 'skia-canvas';
import { drawTimeInList } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/list-time';
import { Server } from '@/qqbot/plugins/bangDream/tsugu/models/server';
import { drawTitle } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/title';
import { outputEasyImages } from '@/qqbot/plugins/bangDream/tsugu/canvas/output';
import { Song } from '@/qqbot/plugins/bangDream/tsugu/models/song';
import { drawSongDataBlock } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/detail-blocks';
import { Band } from '@/qqbot/plugins/bangDream/tsugu/models/band';
import { drawEventDataBlock } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/detail-blocks';
import { drawSongMetaListDataBlock } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/detail-blocks';
import {
  globalDefaultServer,
  serverNameFullList,
} from '@/qqbot/plugins/bangDream/tsugu/runtime/config';
import { formatSeconds } from '@/qqbot/plugins/bangDream/tsugu/render-blocks/list-time';

/**
 * 在QQBot 图片视图层中绘制歌曲详情。
 *
 * @param song - 歌曲参数。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
 * @param compress - compress参数。
 * @returns 异步处理结果。
 */
export async function drawSongDetail(
  song: Song,
  displayedServerList: Server[] = globalDefaultServer,
  compress: boolean,
): Promise<Array<Buffer | string>> {
  if (song.isExist == false) {
    return ['错误: 歌曲不存在'];
  }
  await song.initFull();
  const list: Array<Image | Canvas> = [];
  //标题
  list.push(await drawListByServerList(song.musicTitle, '歌曲名称'));
  list.push(line);

  //歌曲tag(类型)
  const typeImage = drawList({
    key: '类型',
    text: song.getTagName(),
  });
  //歌曲ID
  const idImage = drawList({
    key: 'ID',
    text: song.songId.toString(),
  });
  list.push(drawListMerge([typeImage, idImage]));
  list.push(line);

  //乐队
  const band = new Band(song.bandId);
  list.push(
    await drawListByServerList(band.bandName, '乐队', displayedServerList),
  );
  list.push(line);

  //作词
  list.push(
    await drawListByServerList(
      song.detail.lyricist,
      '作词',
      displayedServerList,
    ),
  );
  list.push(line);
  //作曲
  list.push(
    await drawListByServerList(
      song.detail.composer,
      '作曲',
      displayedServerList,
    ),
  );
  list.push(line);
  //编曲
  list.push(
    await drawListByServerList(
      song.detail.arranger,
      '编曲',
      displayedServerList,
    ),
  );
  list.push(line);
  //时长
  list.push(
    drawList({
      key: '时长',
      text: formatSeconds(song.length),
    }),
  );
  list.push(line);
  //bpm
  const bpmList: number[] = [];
  for (const difficulty in song.bpm) {
    for (let bpmId = 0; bpmId < song.bpm[difficulty].length; bpmId++) {
      const element = song.bpm[difficulty][bpmId];
      bpmList.push(element.bpm);
    }
  }
  let bpm = '';
  const bpmMax = Math.max(...bpmList);
  const bpmMin = Math.min(...bpmList);
  if (bpmMax == bpmMin) {
    bpm = bpmMax.toString();
  } else {
    bpm = `${bpmMin} ~ ${bpmMax}`;
  }
  list.push(
    drawList({
      key: 'bpm',
      text: bpm,
    }),
  );
  list.push(line);

  //发布时间
  list.push(
    await drawTimeInList(
      {
        key: '发布时间',
        content: song.publishedAt,
      },
      displayedServerList,
    ),
  );

  //special难度发布时间
  if (song.difficulty['4']?.publishedAt != undefined) {
    list.push(line);
    list.push(
      await drawTimeInList(
        {
          key: 'special难度发布时间',
          content: song.difficulty['4'].publishedAt,
        },
        displayedServerList,
      ),
    );
  }
  if (song.nickname != null) {
    list.push(line);
    list.push(
      drawList({
        key: '模糊搜索关键词',
        text: song.nickname,
      }),
    );
  }

  //创建最终输出数组
  const listImage = drawDataBlock({ list });
  const all = [];
  all.push(drawTitle('查询', '歌曲'));

  //顶部歌曲信息框
  const songDataBlockImage = await drawSongDataBlock(song);
  all.push(songDataBlockImage);

  all.push(listImage);

  //歌曲meta数据
  const feverStatusList = [true, false];
  for (let j = 0; j < feverStatusList.length; j++) {
    const feverStatus = feverStatusList[j];
    const songMetaListDataBlockImage = await drawSongMetaListDataBlock(
      feverStatus,
      song,
      `${feverStatus ? 'Fever' : '无Fever'}`,
      displayedServerList,
    );
    all.push(songMetaListDataBlockImage);
  }

  //相关活动
  const eventIdList = []; //防止重复
  for (let i = 0; i < displayedServerList.length; i++) {
    const server = displayedServerList[i];
    if (song.publishedAt[server] == null) {
      continue;
    }
    const event = getPresentEvent(server, song.publishedAt[server]);
    if (event != undefined && eventIdList.indexOf(event.eventId) == -1) {
      eventIdList.push(event.eventId);
      const eventDataBlockImage = await drawEventDataBlock(
        event,
        displayedServerList,
        `${serverNameFullList[server]}相关活动`,
      );
      all.push(eventDataBlockImage);
    }
  }

  return await outputEasyImages(all, { compress });
}
