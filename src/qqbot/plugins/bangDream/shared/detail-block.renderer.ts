import { Card } from '@/qqbot/plugins/bangDream/card/card.model';
import { Character } from '@/qqbot/plugins/bangDream/character/character.model';
import { Degree } from '@/qqbot/plugins/bangDream/catalog/degree.model';
import { Event } from '@/qqbot/plugins/bangDream/event/event.model';
import { Gacha } from '@/qqbot/plugins/bangDream/gacha/gacha.model';
import { Player } from '@/qqbot/plugins/bangDream/player/player.model';
import {
  Server,
  getIcon,
  getServerByPriority,
} from '@/qqbot/plugins/bangDream/catalog/server.model';
import {
  Song,
  getMetaRanking,
  SongInRank,
} from '@/qqbot/plugins/bangDream/song/song.model';
import { drawDottedLine } from '@/qqbot/plugins/bangDream/theme/canvas-dotted-line';
import {
  drawText,
  drawTextWithImages,
} from '@/qqbot/plugins/bangDream/theme/canvas-text';
import { drawRoundedRect } from '@/qqbot/plugins/bangDream/theme/canvas-rect';
import {
  drawBannerImageCanvas,
  drawDataBlock,
} from '@/qqbot/plugins/bangDream/shared/data-block.renderer';
import { drawDegree } from '@/qqbot/plugins/bangDream/catalog/degree-badge.renderer';
import {
  drawImageListCenter,
  drawList,
  drawListWithLine,
} from '@/qqbot/plugins/bangDream/shared/list-frame.renderer';
import { drawAttributeInList } from '@/qqbot/plugins/bangDream/catalog/attribute-list.renderer';
import { drawCharacterInList } from '@/qqbot/plugins/bangDream/character/character-list.renderer';
import { drawDifficultyList } from '@/qqbot/plugins/bangDream/song/song-difficulty.renderer';
import { drawTimeInList } from '@/qqbot/plugins/bangDream/event/event-time.renderer';
import { drawSongInList } from '@/qqbot/plugins/bangDream/song/song-list.renderer';
import { drawTitle } from '@/qqbot/plugins/bangDream/shared/title.renderer';
import {
  resizeImage,
  stackImage,
  stackImageHorizontal,
} from '@/qqbot/plugins/bangDream/shared/image-stack';
import {
  globalDefaultServer,
  serverNameFullList,
} from '@/qqbot/plugins/bangDream/config/runtime-config';
import { Canvas, Image } from 'skia-canvas';
import { Band } from '@/qqbot/plugins/bangDream/catalog/band.model';
import { BANGDREAM_RENDER_THEME } from '@/qqbot/plugins/bangDream/theme/render-theme';
import { createHorizontalSeparatorSpec } from '@/qqbot/plugins/bangDream/theme/layout';
import {
  BANGDREAM_DETAIL_BLOCK_SPEC,
  getRelativeMetaPercent,
} from '@/qqbot/plugins/bangDream/shared/detail-block.layout';

const songDetailSeparator = drawDottedLine(
  createHorizontalSeparatorSpec({
    width: BANGDREAM_DETAIL_BLOCK_SPEC.songDetail.detailSeparator.width,
    height: BANGDREAM_DETAIL_BLOCK_SPEC.songDetail.detailSeparator.height,
    endX: BANGDREAM_DETAIL_BLOCK_SPEC.songDetail.detailSeparator.endX,
  }),
);

const songMetaSeparator = drawDottedLine(
  createHorizontalSeparatorSpec({
    height: BANGDREAM_DETAIL_BLOCK_SPEC.songDetail.metaSeparatorHeight,
  }),
);

/**
 * 在图片布局层中绘制横幅Info块。
 *
 * @param options1 - options1参数。
 */
async function drawBannerInfoBlock({
  banner,
  detailList,
  topLeftText,
}: {
  banner: Image;
  detailList: Canvas[];
  topLeftText?: string;
}) {
  return drawDataBlock({
    list: [drawBannerImageCanvas(banner), drawListWithLine(detailList)],
    topLeftText,
  });
}

/**
 * 在图片布局层中绘制活动数据块。
 *
 * @param event - 活动参数。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
 * @param topLeftText - 排名Left文本参数，未传入时使用默认值。
 */
export async function drawEventDataBlock(
  event: Event,
  displayedServerList: Server[] = globalDefaultServer,
  topLeftText?: string,
) {
  const detailList: Canvas[] = [
    drawList({
      text: `${event.getTypeName()}   ID: ${event.eventId}`,
    }),
  ];

  const attributeList = event.getAttributeList();
  for (const i in attributeList) {
    if (Object.prototype.hasOwnProperty.call(attributeList, i)) {
      detailList.push(
        await drawAttributeInList({
          content: attributeList[i],
          text: ` +${i}%`,
        }),
      );
    }
  }

  const characterList = event.getCharacterList();
  for (const i in characterList) {
    if (Object.prototype.hasOwnProperty.call(characterList, i)) {
      detailList.push(
        await drawCharacterInList({
          content: characterList[i],
          text: ` +${i}%`,
        }),
      );
    }
  }

  detailList.push(
    await drawTimeInList(
      {
        content: event.startAt,
        eventId: event.eventId,
        estimateCNTime: true,
      },
      displayedServerList,
    ),
  );

  return drawBannerInfoBlock({
    banner: await event.getBannerImage(),
    detailList,
    topLeftText,
  });
}

/**
 * 在图片布局层中绘制卡池数据块。
 *
 * @param gacha - 卡池参数。
 * @param topLeftText - 排名Left文本参数，未传入时使用默认值。
 */
export async function drawGachaDataBlock(gacha: Gacha, topLeftText?: string) {
  return drawBannerInfoBlock({
    banner: await gacha.getBannerImage(),
    detailList: [
      drawList({
        text: `${gacha.getTypeName()}   ID: ${gacha.gachaId}`,
      }),
    ],
    topLeftText,
  });
}

/**
 * 在图片布局层中绘制歌曲数据块。
 *
 * @param song - 歌曲参数。
 * @param text - 待绘制文本，未传入时使用默认值。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
 */
export async function drawSongDataBlock(
  song: Song,
  text?: string,
  displayedServerList: Server[] = globalDefaultServer,
) {
  const spec = BANGDREAM_DETAIL_BLOCK_SPEC.songDetail;
  const server = getServerByPriority(song.publishedAt, displayedServerList);
  const songJacketCanvas = resizeImage({
    image: await song.getSongJacketImage(),
    widthMax: spec.jacketMaxWidth,
  });
  const songName = song.musicTitle[server];
  const bandName = new Band(song.bandId).bandName[server];
  const songTipsName = song.getTagName();
  const songNameImage = drawText({
    text: songName,
    textSize: spec.titleTextSize,
    maxWidth: spec.textMaxWidth,
  });
  let songDetail = `${bandName}\n${songTipsName}\nID:${song.songId}`;
  if (text != undefined) {
    songDetail = `${songDetail}\n${text}`;
  }
  const songDetailImage = drawText({
    text: songDetail,
    textSize: spec.detailTextSize,
    maxWidth: spec.textMaxWidth,
  });
  const difficultyImage = drawDifficultyList(
    song,
    spec.difficultyHeight,
    spec.difficultyGap,
  );
  const rightCanvas = stackImage([
    songNameImage,
    songDetailSeparator,
    songDetailImage,
    new Canvas(1, spec.rightBottomGapHeight),
  ]);
  const canvas = stackImageHorizontal([
    songJacketCanvas,
    new Canvas(spec.horizontalGapWidth, 1),
    rightCanvas,
  ]);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    difficultyImage,
    spec.difficultyX,
    canvas.height - difficultyImage.height,
  );
  return drawDataBlock({ list: [canvas] });
}

/**
 * 在图片布局层中绘制歌曲Meta列表数据块。
 *
 * @param withFever - withFever参数。
 * @param song - 歌曲参数。
 * @param topLeftText - 排名Left文本参数，未传入时使用默认值。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
 */
export async function drawSongMetaListDataBlock(
  withFever: boolean,
  song: Song,
  topLeftText?: string,
  displayedServerList: Server[] = globalDefaultServer,
) {
  const metaRanking = {};
  for (const server of displayedServerList) {
    metaRanking[server] = {};
    metaRanking[server].data = getMetaRanking(withFever, server);
    metaRanking[server].maxMeta = metaRanking[server].data[0].meta;
  }
  const songMetaRanking = {};
  for (const server of displayedServerList) {
    songMetaRanking[server] = {};
    const tempMetaRanking = metaRanking[server].data;
    songMetaRanking[server].data = tempMetaRanking.filter(
      (value: SongInRank) => value.songId == song.songId,
    );
  }

  const list: Array<Image | Canvas> = [];
  for (const difficulty in song.difficulty) {
    const difficultyId = parseInt(difficulty);
    let text = '';
    for (const server of displayedServerList) {
      const tempSongMetaRanking = songMetaRanking[server].data;
      for (let j = 0; j < tempSongMetaRanking.length; j++) {
        if (tempSongMetaRanking[j].difficulty == difficultyId) {
          const percent = getRelativeMetaPercent(
            tempSongMetaRanking[j].meta,
            metaRanking[server].maxMeta,
          );
          text += `${serverNameFullList[server]}: ${percent}% #${tempSongMetaRanking[j].rank + 1} `;
        }
      }
    }
    list.push(await drawSongInList(song, difficultyId, text));
    list.push(songMetaSeparator);
  }

  list.pop();
  return drawDataBlock({ list, topLeftText });
}

/**
 * 在图片布局层中绘制Meta列表数据块。
 *
 * @param withFever - withFever参数。
 * @param server - 目标服务器。
 * @param topLeftText - 排名Left文本参数，未传入时使用默认值。
 */
export async function drawMetaListDataBlock(
  withFever: boolean,
  server: Server,
  topLeftText?: string,
) {
  const metaRanking = getMetaRanking(withFever, server);
  const maxMeta = metaRanking[0].meta;
  const list: Array<Image | Canvas> = [];
  const maxRows = BANGDREAM_DETAIL_BLOCK_SPEC.metaList.maxRows;
  for (let i = 0; i < maxRows; i++) {
    if (i >= metaRanking.length) {
      break;
    }
    const song = new Song(metaRanking[i].songId);
    const difficultyId = metaRanking[i].difficulty;
    const percent = getRelativeMetaPercent(metaRanking[i].meta, maxMeta);
    list.push(
      await drawSongInList(
        song,
        difficultyId,
        `相对分数: ${percent.toFixed(2)}% #${metaRanking[i].rank + 1}`,
      ),
    );
    list.push(songMetaSeparator);
  }
  list.pop();
  return drawDataBlock({ list, topLeftText });
}

/**
 * 在图片布局层中绘制角色Half块。
 *
 * @param character - 角色参数。
 * @param displayedServerList - 允许展示或下载资源的服务器优先级列表，未传入时使用默认值。
 * @returns 异步处理结果。
 */
export async function drawCharacterHalfBlock(
  character: Character,
  displayedServerList: Server[] = globalDefaultServer,
): Promise<Canvas> {
  const spec = BANGDREAM_DETAIL_BLOCK_SPEC.characterHalf;
  const width = spec.width;
  const height = spec.height;
  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext('2d');
  await character.initFull(false);
  const color = character.colorCode
    ? character.colorCode.toLowerCase()
    : BANGDREAM_RENDER_THEME.color.surface;
  ctx.drawImage(
    drawRoundedRect({
      width,
      height,
      radius: spec.radius,
      color,
      opacity: spec.overlayOpacity,
    }),
    0,
    0,
  );
  const characterIllustration = resizeImage({
    image: await character.getIllustration(),
    heightMax: height - spec.illustrationPaddingHeight,
  });

  ctx.drawImage(
    characterIllustration,
    width / 2 - characterIllustration.width / 2,
    spec.illustrationInsetY,
  );
  ctx.drawImage(
    drawRoundedRect({
      width,
      height,
      radius: spec.radius,
      opacity: spec.opaqueOpacity,
      color: color + '00',
      strokeColor: color,
      strokeWidth: spec.strokeWidth,
    }),
    0,
    0,
  );
  ctx.drawImage(
    drawRoundedRect({
      width,
      height: spec.footerHeight,
      radius: spec.radius,
      opacity: spec.opaqueOpacity,
      color,
    }),
    0,
    height - spec.footerHeight,
  );

  const list: Canvas[] = [];
  const server = getServerByPriority(
    character.characterName,
    displayedServerList,
  );
  const nameTextImage = drawText({
    text: character.characterName[server],
    textSize: spec.nameTextSize,
    color: BANGDREAM_RENDER_THEME.color.surface,
    maxWidth: width,
  });
  list.push(drawImageListCenter([nameTextImage], width));
  const idTextImage = drawText({
    text: `ID: ${character.characterId}`,
    textSize: spec.idTextSize,
    color: BANGDREAM_RENDER_THEME.color.surface,
    maxWidth: width,
  });
  list.push(drawImageListCenter([idTextImage], width));
  ctx.drawImage(stackImage(list), 0, height - spec.footerHeight);
  return canvas;
}

/**
 * 在图片布局层中绘制玩家详情块WithIllustration。
 *
 * @param player - 玩家参数。
 * @returns 异步处理结果。
 */
export async function drawPlayerDetailBlockWithIllustration(
  player: Player,
): Promise<Canvas> {
  const spec = BANGDREAM_DETAIL_BLOCK_SPEC.playerDetail;
  const list: Array<Canvas | Image> = [];
  const playerText = drawText({
    text: player.profile.userName,
    maxWidth: BANGDREAM_RENDER_THEME.layout.contentWidth,
    textSize: spec.nameTextSize,
  });
  list.push(drawImageListCenter([playerText]));
  const levelText = drawText({
    text: `等级 ${player.profile.rank}`,
    maxWidth: BANGDREAM_RENDER_THEME.layout.contentWidth,
    textSize: spec.infoTextSize,
  });
  list.push(drawImageListCenter([levelText]));
  list.push(new Canvas(1, spec.spacerHeight));

  const degreeImageList: Array<Canvas | Image> = [];
  const userProfileDegreeMap = player.profile.userProfileDegreeMap.entries;
  for (const i in userProfileDegreeMap) {
    const tempDegree = userProfileDegreeMap[i];
    degreeImageList.push(
      await drawDegree(new Degree(tempDegree.degreeId), player.server),
    );
    degreeImageList.push(new Canvas(spec.degreeGapWidth, 1));
  }
  degreeImageList.pop();
  list.push(drawImageListCenter(degreeImageList));
  list.push(new Canvas(1, spec.spacerHeight));

  const introductionText = drawText({
    text: player.profile.introduction,
    maxWidth: BANGDREAM_RENDER_THEME.layout.contentWidth,
    textSize: spec.infoTextSize,
  });
  list.push(drawImageListCenter([introductionText]));
  list.push(new Canvas(1, spec.spacerHeight));

  const userId = player.profile.publishUserIdFlg
    ? player.profile.userId.toString()
    : 'ID未公开';
  const idText = drawTextWithImages({
    content: [await getIcon(player.server), userId],
    maxWidth: BANGDREAM_RENDER_THEME.layout.contentWidth,
    textSize: spec.infoTextSize,
  });
  list.push(drawImageListCenter([idText]));
  const dataBlock = drawDataBlock({ list, opacity: spec.dataBlockOpacity });

  const userIllustrationData = player.profile.userIllustration;
  const illustrationCard = new Card(userIllustrationData.cardId);
  const illustrationImage = await illustrationCard.getCardTrimImage(
    userIllustrationData.trainingStatus,
  );
  const titleImage = drawTitle('查询', '玩家信息');
  const canvas = new Canvas(
    spec.illustrationWidth,
    spec.dataBlockY + dataBlock.height,
  );
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    illustrationImage,
    0,
    0,
    spec.illustrationWidth,
    spec.illustrationHeight,
  );
  ctx.drawImage(titleImage, 0, 0);
  ctx.drawImage(dataBlock, 0, spec.dataBlockY);
  return canvas;
}
