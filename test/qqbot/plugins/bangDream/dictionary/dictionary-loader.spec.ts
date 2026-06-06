import {
  BangDreamDictionaryLoader,
  normalizeDictionaryLookupKey,
} from '@/qqbot/plugins/bangDream/dictionary/dictionary-loader';
import { BANGDREAM_DICTIONARY_CODES } from '@/qqbot/plugins/bangDream/dictionary/default-dictionary';
import {
  normalizeBangDreamBoolean,
  splitBangDreamOptionList,
} from '@/qqbot/plugins/bangDream/config/runtime-options';
import { BangDreamDifficultyId } from '@/qqbot/plugins/bangDream/shared/bangdream-protocol';

describe('BangDreamDictionaryLoader', () => {
  it('resolves server and difficulty from default dictionary without DB', () => {
    const loader = new BangDreamDictionaryLoader();

    expect(loader.resolveServer('国服')).toBe(3);
    expect(loader.resolveServer('jp')).toBe(0);
    expect(loader.resolveServer('4')).toBe(4);
    expect(loader.resolveDifficulty('专家')).toBe(BangDreamDifficultyId.expert);
    expect(loader.resolveDifficulty('sp')).toBe(BangDreamDifficultyId.special);
    expect(loader.resolveDifficulty('2')).toBe(BangDreamDifficultyId.hard);
  });

  it('merges API dictionary aliases into the default dictionary cache', async () => {
    const loader = new BangDreamDictionaryLoader();

    await loader.refresh(async (dictCode) => {
      if (dictCode === BANGDREAM_DICTIONARY_CODES.serverAlias) {
        return [
          { label: '主服', value: 'jp' },
          { label: '韩', value: '4' },
        ];
      }
      if (dictCode === BANGDREAM_DICTIONARY_CODES.difficultyAlias) {
        return [
          { label: '大师', value: 'special' },
          { label: '红', value: '3' },
        ];
      }
      return [];
    });

    expect(loader.resolveServer('主服')).toBe(0);
    expect(loader.resolveServer('韩')).toBe(4);
    expect(loader.resolveServer('国服')).toBe(3);
    expect(loader.resolveDifficulty('大师')).toBe(
      BangDreamDifficultyId.special,
    );
    expect(loader.resolveDifficulty('红')).toBe(BangDreamDifficultyId.expert);
    expect(loader.resolveDifficulty('ex')).toBe(BangDreamDifficultyId.expert);
  });

  it('falls back to default dictionary when API dictionary loading fails', async () => {
    const loader = new BangDreamDictionaryLoader();

    await loader.refresh(async () => {
      throw new Error('DB unavailable');
    });

    expect(loader.resolveServer('台服')).toBe(2);
    expect(loader.resolveDifficulty('普通')).toBe(
      BangDreamDifficultyId.normal,
    );
  });
});

describe('BangDream runtime option helpers', () => {
  it('normalizes user-facing boolean values', () => {
    expect(normalizeBangDreamBoolean(undefined, true)).toBe(true);
    expect(normalizeBangDreamBoolean('开启', false)).toBe(true);
    expect(normalizeBangDreamBoolean('off', true)).toBe(false);
  });

  it('splits array, whitespace and comma option lists', () => {
    expect(splitBangDreamOptionList(['cn', ' jp '])).toEqual(['cn', 'jp']);
    expect(splitBangDreamOptionList('cn jp，tw,en')).toEqual([
      'cn',
      'jp',
      'tw',
      'en',
    ]);
  });

  it('normalizes dictionary lookup keys consistently', () => {
    expect(normalizeDictionaryLookupKey(' JP ')).toBe('jp');
    expect(normalizeDictionaryLookupKey(' 国服 ')).toBe('国服');
  });
});
