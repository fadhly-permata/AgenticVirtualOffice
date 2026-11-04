const BLOCKS = {
  text: { type: 'text', prefix: 't', field: 'text', delta: 'text_delta', key: 'text' },
  thinking: { type: 'reasoning', prefix: 'r', field: 'reasoning', delta: 'thinking_delta', key: 'thinking' },
};

function attach(session, part) {
  const message = session.messages.find((entry) => entry.info.id === part.messageID);
  if (!message) return;
  message.parts.push(part);
}

/**
 * Sisi parsial stream-json Claude/Qoder: teks tumbuh token demi token alih-alih
 * muncul satu blok di akhir giliran. ID part sengaja sama dengan yang dihasilkan
 * assistantParts(), jadi peristiwa assistant final tinggal menegaskan isi — tidak
 * ada gelembung ganda.
 */
export function applyPartialStream(session, event, emit) {
  const inner = event?.event;
  const kind = typeof inner?.type === 'string' ? inner.type : '';
  if (!kind) return;
  const at = Date.parse(event.timestamp ?? '') || Date.now();

  if (kind === 'message_start') {
    const messageID = typeof inner.message?.id === 'string' ? inner.message.id : '';
    if (!messageID) return;
    session.partial = { messageID, blocks: new Map() };
    if (session.messages.some((entry) => entry.info.id === messageID)) return;
    const info = { id: messageID, sessionID: session.id, role: 'assistant', time: { created: at } };
    session.messages.push({ info, parts: [] });
    emit({ type: 'message.updated', properties: { sessionID: session.id, info } });
    return;
  }

  const partial = session.partial;
  if (!partial) return;

  if (kind === 'content_block_start') {
    const block = BLOCKS[inner.content_block?.type];
    if (!block || typeof inner.index !== 'number') return;
    const part = {
      id: `${partial.messageID}:${block.prefix}${inner.index}`,
      messageID: partial.messageID,
      sessionID: session.id,
      type: block.type,
      text: '',
      ...(block.type === 'reasoning' ? { time: { start: at } } : {}),
    };
    partial.blocks.set(inner.index, part);
    attach(session, part);
    emit({ type: 'message.part.updated', properties: { sessionID: session.id, part: { ...part } } });
    return;
  }

  if (kind === 'content_block_delta') {
    const part = partial.blocks.get(inner.index);
    const block = part ? BLOCKS[part.type === 'reasoning' ? 'thinking' : 'text'] : null;
    const chunk = inner.delta?.type === block?.delta ? inner.delta[block.key] : '';
    if (!part || typeof chunk !== 'string' || !chunk) return;
    part.text += chunk;
    emit({
      type: 'message.part.delta',
      properties: {
        sessionID: session.id,
        messageID: part.messageID,
        partID: part.id,
        field: block.field,
        delta: chunk,
      },
    });
    return;
  }

  if (kind === 'content_block_stop') {
    const part = partial.blocks.get(inner.index);
    if (!part) return;
    partial.blocks.delete(inner.index);
    if (part.type === 'reasoning') part.time = { ...part.time, end: at };
    emit({ type: 'message.part.updated', properties: { sessionID: session.id, part: { ...part } } });
    return;
  }

  if (kind === 'message_stop') session.partial = null;
}
