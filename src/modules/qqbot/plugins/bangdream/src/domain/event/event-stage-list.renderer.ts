import {
  stageTypeList,
  stageTypeTextStrokeColor,
  stageTypeName,
  Stage,
} from '@/modules/qqbot/plugins/bangdream/src/domain/event/event-stage.model';
import { BangDreamEventStageType } from '@/modules/qqbot/plugins/bangdream/src/domain/common/bangdream-protocol';
import {
  Song,
  difficultyColorList,
} from '@/modules/qqbot/plugins/bangdream/src/domain/song/song.model';
import { Canvas, Image, FontLibrary } from 'skia-canvas';
import { assetsRootPath } from '@/modules/qqbot/plugins/bangdream/src/config/runtime-config';
import { formatTime } from '@/modules/qqbot/plugins/bangdream/src/domain/event/event-time.renderer';
import { setFontStyle } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-text';
import { stackImageHorizontal } from '@/modules/qqbot/plugins/bangdream/src/theme/image-stack';
import { loadImageFromPath } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-image';
import {
  BANGDREAM_EVENT_STAGE_SPEC,
  getEventStageSongCellHeight,
  getEventStageSongCellWidth,
  getEventStageSongJacketHeight,
  getEventStageSongRowSize,
} from '@/modules/qqbot/plugins/bangdream/src/domain/event/event-stage.layout';

FontLibrary.use('old', [`${assetsRootPath}/Fonts/old.ttf`]);

export const stageTypeTopImageList: { [type: string]: Image } = {};

/**
 * 通过 `loadImageFromPath` 加载绘制所需图片资源。
 * @param type - 决定阶段TypeTop图片内容、边界或目标的 `type` 值。
 * @returns 阶段TypeTop图片。
 */
async function loadStageTypeTopImage(type: string): Promise<Image> {
  //加载活动类型顶部图片
  if (stageTypeTopImageList[type]) {
    return stageTypeTopImageList[type];
  } else {
    stageTypeTopImageList[type] = await loadImageFromPath(
      assetsRootPath + `/EventStage/${type}.png`,
    );
    return stageTypeTopImageList[type];
  }
}

/**
 * 通过 `stageTypeList.indexOf` 遍历或定位集合元素。
 * @param stage - 用于事件阶段TypeTop的领域对象，包含 `type`、`startAt`、`endAt` 字段。
 * @returns 事件阶段TypeTop。
 */
export async function drawEventStageTypeTop(stage: Stage): Promise<Canvas> {
  //绘制活动类型顶部(时间+类型)
  let type = stage.type;
  const startAt = stage.startAt;
  const endAt = stage.endAt;

  if (stageTypeList.indexOf(type) == -1) {
    type = BangDreamEventStageType.unknown;
  }
  const eventStageTypeTopImage = await loadStageTypeTopImage(type);

  const typeName = stageTypeName[type];
  const timeText = `${formatTime(startAt)} - ${formatTime(endAt)}`;

  const canvas = new Canvas(
    eventStageTypeTopImage.width,
    eventStageTypeTopImage.height,
  );
  const ctx = canvas.getContext('2d');
  const typeTopSpec = BANGDREAM_EVENT_STAGE_SPEC.typeTop;
  ctx.drawImage(eventStageTypeTopImage, 0, 0);
  ctx.textBaseline = 'middle';
  setFontStyle(ctx, typeTopSpec.fontSize, 'old');
  ctx.textAlign = 'left';
  ctx.fillStyle = typeTopSpec.textColor;
  ctx.lineWidth = typeTopSpec.strokeWidth;
  ctx.strokeStyle = stageTypeTextStrokeColor[type];
  const textY = canvas.height / 2 + typeTopSpec.yOffset;
  ctx.strokeText(timeText, typeTopSpec.textX, textY);
  ctx.fillText(timeText, typeTopSpec.textX, textY);

  ctx.textAlign = 'right';
  const typeNameX = canvas.width - typeTopSpec.rightPadding;
  ctx.strokeText(typeName, typeNameX, textY);
  ctx.fillText(typeName, typeNameX, textY);

  //如果是当前进行中活动，额外画标志
  if (new Date() >= new Date(startAt) && new Date() <= new Date(endAt)) {
    const presentEventMark = await loadStageTypeTopImage('presentEventMark');
    ctx.drawImage(presentEventMark, 0, 0);
  }

  return canvas;
}

/**
 * 根据`song`、`meta`绘制或格式化歌曲事件阶段歌曲Horizontal；把图片、文本或图形按布局规格绘制到画布。
 * @param song - 用于歌曲事件阶段歌曲Horizontal的领域对象，包含 `getSongJacketImage`、`songId`、`calcMeta`、`difficulty` 字段。
 * @param meta - 决定歌曲事件阶段歌曲Horizontal内容、边界或目标的 `meta` 值。
 * @returns 歌曲事件阶段歌曲Horizontal。
 */
async function drawSongInEventStageSongHorizontal(
  song: Song,
  meta: boolean,
): Promise<Canvas> {
  //绘制活动中的每个歌曲(包括难度)
  const cellWidth = getEventStageSongCellWidth();
  const cellHeight = getEventStageSongCellHeight();
  const jacketImageHeight = getEventStageSongJacketHeight();
  const songRowSpec = BANGDREAM_EVENT_STAGE_SPEC.songRow;
  const canvas = new Canvas(cellWidth, cellHeight);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(
    await song.getSongJacketImage(),
    songRowSpec.jacketInsetX,
    songRowSpec.jacketY,
    jacketImageHeight,
    jacketImageHeight,
  );

  ctx.textAlign = 'start';
  ctx.textBaseline = 'middle';
  setFontStyle(ctx, songRowSpec.songId.fontSize, 'old');
  ctx.fillStyle = songRowSpec.songId.color;
  ctx.fillText(`ID:${song.songId}`, songRowSpec.songId.x, songRowSpec.songId.y);

  //难度，高度为meta*10像素
  /**
   * 根据`difficultyId`绘制或格式化难度文本行Graph；把图片、文本或图形按布局规格绘制到画布。
   * @param difficultyId - 用于精确定位难度的标识。
   * @returns 难度文本行Graph。
   */
  function drawDifficultyLineGraph(difficultyId: number): Canvas {
    const meta = song.calcMeta(true, difficultyId);
    const canvas = new Canvas(jacketImageHeight / 10, jacketImageHeight);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = difficultyColorList[difficultyId];
    ctx.fillRect(
      0,
      jacketImageHeight -
        meta * BANGDREAM_EVENT_STAGE_SPEC.songRow.difficultyHeightScale,
      jacketImageHeight,
      meta * BANGDREAM_EVENT_STAGE_SPEC.songRow.difficultyHeightScale,
    );
    return canvas;
  }

  if (meta) {
    const difficultyLineGraphList = [];
    for (const i in song.difficulty) {
      const difficultyId = parseInt(i);
      difficultyLineGraphList.push(drawDifficultyLineGraph(difficultyId));
    }

    const difficultyLineGraph = stackImageHorizontal(difficultyLineGraphList);
    ctx.drawImage(
      difficultyLineGraph,
      songRowSpec.jacketInsetX,
      songRowSpec.jacketY,
    );
  }

  return canvas;
}

/**
 * 根据`stage`、`meta`绘制或格式化事件阶段歌曲Horizontal；把图片、文本或图形按布局规格绘制到画布。
 * @param stage - 用于事件阶段歌曲Horizontal的领域对象，包含 `songIdList` 字段。
 * @param meta - 决定事件阶段歌曲Horizontal内容、边界或目标的 `meta` 值；省略时默认采用 `false`。
 * @returns 事件阶段歌曲Horizontal。
 */
export async function drawEventStageSongHorizontal(
  stage: Stage,
  meta: boolean = false,
): Promise<Canvas> {
  //绘制活动中的歌曲列表(横向)
  const songIdList = stage.songIdList;

  const songRowSize = getEventStageSongRowSize();
  const canvas = new Canvas(songRowSize.width, songRowSize.height);
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < songIdList.length; i++) {
    const song = new Song(songIdList[i]);
    ctx.drawImage(
      await drawSongInEventStageSongHorizontal(song, meta),
      getEventStageSongCellWidth() * i,
      0,
    );
  }

  return canvas;
}
