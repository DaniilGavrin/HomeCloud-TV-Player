import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesPlaybackIdentity } from '../src/lib/playbackIdentity.ts';
import { attachRoomStream, getStreamState, resetStream } from '../src/lib/mediaStream.ts';

class MockWebSocket {
  static instances = [];
  static OPEN = 1;
  constructor(url) { this.url = url; this.closed = false; this.readyState = 1; this.sent = []; MockWebSocket.instances.push(this); }
  close() { this.closed = true; this.readyState = 3; }
  send(data) { this.sent.push(data); }
}
globalThis.WebSocket = MockWebSocket;

const gateway = 'ws://192.168.0.147:8091/ws/stream';
function offer(generation, playback, ticket) {
  return {
    room_id: 'room-test', playback_id: playback, generation,
    gateway_ws_url: gateway, attach_ticket: ticket,
    target: { device_id: 'tv-1' },
  };
}
function ready(playback, generation) {
  return {
    type: 'media.ready', room_id: 'room-test', playback_id: playback,
    generation, media_kind: 'video',
    http_media_path: '/media/session/' + 'f'.repeat(64),
  };
}

test('decoder events belong only to the matching room/playback/generation', () => {
  const old = { roomId:'room-test', playbackId:'mp3', generation:'1' };
  const next = { room_id:'room-test', playback_id:'mkv', generation:2 };
  assert.equal(matchesPlaybackIdentity(old, next), false);
  assert.equal(matchesPlaybackIdentity({...old, playbackId:'mkv', generation:'2'}, next), true);
  assert.equal(matchesPlaybackIdentity({...old, roomId:'another'}, next), false);
});

test('delayed old WS offer cannot replace a new playback', () => {
  resetStream();
  MockWebSocket.instances.length = 0;
  assert.equal(attachRoomStream(offer(1, 'mp3', 'a'.repeat(64)), 'tv-1'), true);
  const oldSocket = MockWebSocket.instances.at(-1);
  oldSocket.onopen();
  assert.equal(attachRoomStream(offer(2, 'mkv', 'b'.repeat(64)), 'tv-1'), true);
  const newSocket = MockWebSocket.instances.at(-1);
  assert.equal(oldSocket.closed, true);
  assert.equal(attachRoomStream(offer(1, 'mp3', 'c'.repeat(64)), 'tv-1'), false);
  assert.equal(MockWebSocket.instances.length, 2);
  oldSocket.onmessage?.({ data: JSON.stringify(ready('mp3', 1)) });
  assert.equal(getStreamState().playback_id, 'mkv');
  newSocket.onopen();
  newSocket.onmessage({ data: JSON.stringify(ready('mkv', 2)) });
  assert.equal(getStreamState().phase, 'ready');
  assert.equal(getStreamState().playback_id, 'mkv');
  resetStream();
});

test('untrusted TV identity cannot attach', () => {
  resetStream();
  assert.equal(attachRoomStream(offer(1, 'mp3', 'a'.repeat(64)), 'another-tv'), false);
  assert.equal(getStreamState(), null);
});

test('KAN-55 opted-in HTTP switch reuses one direct Gateway websocket', () => {
  resetStream();
  MockWebSocket.instances.length = 0;
  assert.equal(attachRoomStream(offer(1, 'mp3', 'a'.repeat(64)), 'tv-1'), true);
  const control = MockWebSocket.instances[0];
  control.onopen();
  const firstHello = JSON.parse(control.sent[0]);
  assert.equal(firstHello.capabilities.http_switch, true);
  control.onmessage({data:JSON.stringify({...ready('mp3',1), http_switch:true})});
  assert.equal(getStreamState().phase, 'ready');

  assert.equal(attachRoomStream(offer(2, 'mkv', 'b'.repeat(64)), 'tv-1'), true);
  assert.equal(control.closed, false);
  assert.equal(MockWebSocket.instances.length, 1, 'unexpected WS reconnect');
  const secondHello = JSON.parse(control.sent[1]);
  assert.equal(secondHello.generation, 2);
  assert.equal(secondHello.playback_id, 'mkv');
  control.onmessage({data:JSON.stringify({...ready('mp3',1), http_switch:true})});
  assert.equal(getStreamState().phase, 'connecting', 'stale ready rewrote new stream');
  control.onmessage({data:JSON.stringify({...ready('mkv',2), http_switch:true})});
  assert.equal(getStreamState().phase, 'ready');
  assert.equal(getStreamState().playback_id, 'mkv');
  resetStream();
});
