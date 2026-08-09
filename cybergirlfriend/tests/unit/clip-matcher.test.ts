/**
 * 单元测试：素材匹配引擎（server/avatar/clip-matcher.ts）
 * 覆盖：正常流程（情绪选片/队列时长覆盖）、异常（空库）、边界（全部播过/超长目标）
 */
import { describe, it, expect } from 'vitest';
import {
  clipsByEmotion,
  pickClip,
  buildQueue,
  type AvatarClip,
  type ClipLibrary,
} from '../../server/avatar/clip-matcher';

function makeLibrary(clips: AvatarClip[]): ClipLibrary {
  return { clips };
}

const library: ClipLibrary = makeLibrary([
  { id: 'h1', emotion: 'happy', durationSec: 4, src: '/clips/h1.mp4' },
  { id: 'h2', emotion: 'happy', durationSec: 6, src: '/clips/h2.mp4' },
  { id: 'g1', emotion: 'gentle', durationSec: 5, src: '/clips/g1.mp4' },
  { id: 'n1', emotion: 'neutral', durationSec: 3, src: '/clips/n1.mp4' },
]);

describe('素材匹配引擎', () => {
  describe('clipsByEmotion 情绪过滤', () => {
    it('应只返回指定情绪的片段', () => {
      const happy = clipsByEmotion(library, 'happy');
      expect(happy.map((c) => c.id)).toEqual(['h1', 'h2']);
    });

    it('应返回空数组（无该情绪的素材，边界）', () => {
      expect(clipsByEmotion(library, 'surprise')).toEqual([]);
    });

    it('应返回空数组（素材库为空，边界）', () => {
      expect(clipsByEmotion(makeLibrary([]), 'neutral')).toEqual([]);
    });
  });

  describe('pickClip 选片', () => {
    it('应返回指定情绪的片段', () => {
      const clip = pickClip(library, 'gentle');
      expect(clip?.id).toBe('g1');
    });

    it('应避开最近播过的片段（避免重复感）', () => {
      const clip = pickClip(library, 'happy', ['h1']);
      expect(clip?.id).toBe('h2');
    });

    it('全部播过后应回退到全池（不返回 null，边界）', () => {
      const clip = pickClip(library, 'happy', ['h1', 'h2']);
      expect(['h1', 'h2']).toContain(clip?.id);
    });

    it('应返回 null（无该情绪素材，异常流程）', () => {
      expect(pickClip(library, 'surprise')).toBeNull();
    });

    it('应返回 null（素材库为空，异常流程）', () => {
      expect(pickClip(makeLibrary([]), 'neutral')).toBeNull();
    });
  });

  describe('buildQueue 播放队列', () => {
    it('队列总时长应覆盖目标时长', () => {
      const queue = buildQueue(library, 'happy', 10);
      const total = queue.reduce((sum, c) => sum + c.durationSec, 0);
      expect(total).toBeGreaterThanOrEqual(10);
      expect(queue.length).toBeGreaterThan(0);
    });

    it('队列内片段不应重复', () => {
      const queue = buildQueue(library, 'happy', 30);
      const ids = queue.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('队列应只包含目标情绪的片段', () => {
      const queue = buildQueue(library, 'gentle', 20);
      expect(queue.every((c) => c.emotion === 'gentle')).toBe(true);
    });

    it('应返回空队列（素材库为空，边界）', () => {
      expect(buildQueue(makeLibrary([]), 'happy', 10)).toEqual([]);
    });

    it('短目标时长只取一个片段（边界）', () => {
      const queue = buildQueue(library, 'neutral', 1);
      expect(queue.length).toBe(1);
      expect(queue[0].id).toBe('n1');
    });
  });
});
