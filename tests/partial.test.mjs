import { describe, expect, it } from 'vitest';
import { applyPartialStream } from '../server/partial.mjs';
import { assistantParts as claudeParts } from '../server/claude.mjs';
import { assistantParts as qoderParts } from '../server/qoder.mjs';

const SESSION_ID = 'ses_1';
const MESSAGE_ID = 'msg_1';

function harness() {
  const session = { id: SESSION_ID, directory: 'D:/x', messages: [], partial: null };
  const frames = [];
  const feed = (inner, extra = {}) => applyPartialStream(session, { event: inner, timestamp: '2026-11-04T10:00:00.000Z', ...extra }, (frame) => frames.push(frame));
  return { session, frames, feed };
}

const textStream = (feed) => {
  feed({ type: 'message_start', message: { id: MESSAGE_ID, role: 'assistant' } });
  feed({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  feed({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hal' } });
  feed({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'o' } });
  feed({ type: 'content_block_stop', index: 0 });
};

describe('applyPartialStream', () => {
  it('announces the answer bubble before the first token', () => {
    const { frames, feed } = harness();
    textStream(feed);
    expect(frames[0].type).toBe('message.updated');
    expect(frames[0].properties.info).toMatchObject({ id: MESSAGE_ID, sessionID: SESSION_ID, role: 'assistant' });
  });

  it('emits one delta per token and a final part frame', () => {
    const { frames, feed } = harness();
    textStream(feed);
    const deltas = frames.filter((frame) => frame.type === 'message.part.delta');
    expect(deltas.map((frame) => frame.properties.delta)).toEqual(['Hal', 'o']);
    expect(deltas[0].properties).toMatchObject({
      sessionID: SESSION_ID,
      messageID: MESSAGE_ID,
      partID: `${MESSAGE_ID}:t0`,
      field: 'text',
    });
    const announced = frames.find((frame) => frame.type === 'message.part.updated');
    expect(announced.properties.part).toMatchObject({ id: `${MESSAGE_ID}:t0`, type: 'text', text: '' });
    const stopped = frames.filter((frame) => frame.type === 'message.part.updated').at(-1);
    expect(stopped.properties.part.text).toBe('Halo');
  });

  it('keeps the streamed text in the session so a history reload is complete', () => {
    const { session, feed } = harness();
    textStream(feed);
    expect(session.messages[0].parts).toHaveLength(1);
    expect(session.messages[0].parts[0].text).toBe('Halo');
  });

  it('uses the same part id the final assistant event will produce', () => {
    const { session, feed } = harness();
    textStream(feed);
    const content = [{ type: 'text', text: 'Halo' }];
    for (const parts of [claudeParts(content, MESSAGE_ID, SESSION_ID, 1), qoderParts(content, MESSAGE_ID, SESSION_ID, 1)]) {
      expect(parts.map((part) => part.id)).toEqual(session.messages[0].parts.map((part) => part.id));
    }
  });

  it('streams thinking as reasoning and closes its clock at the block stop', () => {
    const { frames, session, feed } = harness();
    feed({ type: 'message_start', message: { id: MESSAGE_ID, role: 'assistant' } });
    feed({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } });
    feed({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'mikir' } });
    feed({ type: 'content_block_stop', index: 0 });
    expect(frames.at(-1).properties.part).toMatchObject({ id: `${MESSAGE_ID}:r0`, type: 'reasoning', text: 'mikir' });
    expect(frames.at(-1).properties.part.time.end).toBeTypeOf('number');
    expect(frames.filter((frame) => frame.type === 'message.part.delta')[0].properties.field).toBe('reasoning');
    expect(session.messages[0].parts[0].type).toBe('reasoning');
  });

  it('ignores tool input deltas and tokens that arrive before message_start', () => {
    const { frames, session, feed } = harness();
    feed({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'yatim' } });
    feed({ type: 'message_start', message: { id: MESSAGE_ID, role: 'assistant' } });
    feed({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_1', name: 'Read', input: {} } });
    feed({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"file"' } });
    expect(frames).toHaveLength(1);
    expect(frames[0].type).toBe('message.updated');
    expect(session.messages[0].parts).toHaveLength(0);
  });

  it('forgets the stream once the message stops', () => {
    const { session, feed } = harness();
    textStream(feed);
    feed({ type: 'message_stop' });
    expect(session.partial).toBeNull();
    feed({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'terlambat' } });
    expect(session.messages[0].parts[0].text).toBe('Halo');
  });
});
