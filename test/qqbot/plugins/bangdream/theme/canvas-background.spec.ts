import { drawScaledTextureTile } from '@/modules/qqbot/plugins/bangdream/src/theme/canvas-background';

describe('BangDream easy background rendering', () => {
  it('keeps Tsugu texture scale while avoiding scaled drawImage overload', () => {
    const calls: string[] = [];
    const context = {
      drawImage: jest.fn((_image, x, y, width, height) => {
        calls.push(
          ['drawImage', x, y, width ?? 'none', height ?? 'none'].join(':'),
        );
      }),
      restore: jest.fn(() => calls.push('restore')),
      save: jest.fn(() => calls.push('save')),
      scale: jest.fn((x, y) => calls.push(`scale:${x}:${y}`)),
      translate: jest.fn((x, y) => calls.push(`translate:${x}:${y}`)),
    };
    const texture = {
      height: 1002,
      width: 1334,
    };

    drawScaledTextureTile(context as any, texture as any, {
      ratio: 1.334,
      x: -12,
      y: 34,
    });

    expect(calls).toEqual([
      'save',
      'translate:-12:34',
      'scale:1.334:1.334',
      'drawImage:0:0:none:none',
      'restore',
    ]);
    expect(context.drawImage).not.toHaveBeenCalledWith(
      texture,
      -12,
      34,
      texture.width * 1.334,
      texture.height * 1.334,
    );
  });
});
