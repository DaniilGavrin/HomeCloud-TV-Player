import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesPlaybackIdentity } from '../src/lib/playbackIdentity.ts';
import { attachRoomStream, getStreamState, resetStream } from '../src/lib/mediaStream.ts';
import { detectDecoderCapabilities } from '../src/lib/mediaCapabilities.ts';
import { inspectExactDecoder } from '../src/lib/exactDecoder.ts';

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

test('KAN-61 decoder report never invents profiles or maximum resolution', () => {
  const report = detectDecoderCapabilities(
    mime => mime.includes('audio/mpeg') ? 'probably' : mime.includes('avc1.') ? 'maybe' : '',
    'ru-RU',
  );
  assert.equal(report.version, 1);
  assert.equal(report.preferred_audio_language, 'rus');
  const mp3 = report.formats.find(f => f.container === 'mp3');
  assert.equal(mp3.certainty, 'probably');
  const h264 = report.formats.find(f => f.video_codec === 'h264' && f.container === 'mp4');
  assert.equal(h264.certainty, 'maybe');
  assert.equal(h264.max_width, undefined);
  assert.equal(h264.video_profiles, undefined);
});

test('KAN-61 stale inspection cannot overwrite a different playback generation', () => {
  resetStream();
  MockWebSocket.instances.length = 0;
  attachRoomStream(offer(1, 'mp3', 'a'.repeat(64)), 'tv-1');
  let socket = MockWebSocket.instances.at(-1);
  socket.onopen();
  const hello = JSON.parse(socket.sent[0]);
  assert.equal(hello.capabilities.decoder.version, 1);
  socket.onmessage({ data: JSON.stringify(ready('mp3', 1)) });
  socket.onmessage({ data: JSON.stringify({ type:'media.inspection',room_id:'room-test',
    playback_id:'mp3',generation:1,report:{ status:'READY',
    media:{container:'mp3',tracks:[{index:0,kind:'audio',codec:'mp3'}]},
    decision:{mode:'DIRECT',reason:'DECLARED_DECODER_COMPATIBLE'}} }) });
  assert.equal(getStreamState().inspection.media.container, 'mp3');
  attachRoomStream(offer(2, 'mkv', 'b'.repeat(64)), 'tv-1');
  socket = MockWebSocket.instances.at(-1);
  socket.onmessage({ data: JSON.stringify({ type:'media.inspection',room_id:'room-test',
    playback_id:'mp3',generation:1,report:{status:'READY',
    media:{container:'mp3',tracks:[]}}}) });
  assert.equal(getStreamState().playback_id, 'mkv');
  assert.equal(getStreamState().inspection, undefined);
  resetStream();
});

test('KAN-61 exact MediaCapabilities honors H264 High profile and frame size', async () => {
  const inspected = {status:'READY',media:{container:'mp4',bit_rate:4500000,tracks:[
    {index:0,kind:'video',codec:'h264',profile:'High',level:40,
      width:1920,height:1080,frame_rate:'30/1',bit_rate:4000000},
    {index:1,kind:'audio',codec:'aac',channels:2,sample_rate:48000,
      bit_rate:160000,default:true},
  ]},decision:{mode:'UNKNOWN',reason:'LIMITS_UNCONFIRMED',audio_stream_index:1}};
  let calls = 0;
  const caps = await inspectExactDecoder(inspected, async config => {
    calls += 1;
    assert.equal(config.video.contentType, 'video/mp4; codecs="avc1.640028"');
    assert.equal(config.video.width, 1920);
    assert.equal(config.audio.contentType, 'audio/mp4; codecs="mp4a.40.2"');
    return {supported:true,smooth:true,powerEfficient:false};
  });
  assert.equal(calls, 1);
  assert.equal(caps.source, 'media_capabilities_api');
  assert.equal(caps.formats[0].certainty,'probably');
  assert.equal(caps.formats[0].max_width,1920);
  assert.equal(caps.formats[0].max_level,40);
  const nope = await inspectExactDecoder(inspected, async () =>
    ({supported:false,smooth:false,powerEfficient:false}));
  assert.equal(nope.formats[0].certainty,'unsupported');
});

test('KAN-61 uncertain or missing decoder measurements stay UNKNOWN', async () => {
  const info = {status:'READY',media:{container:'matroska',tracks:[
    {index:0,kind:'video',codec:'hevc',profile:'Main 10',level:120,
      width:3840,height:2160}, // no verified bitrate/framerate
  ]}};
  assert.equal(await inspectExactDecoder(info,async () =>
    ({supported:true,smooth:true,powerEfficient:true})), null);
  assert.equal(await inspectExactDecoder(info), null);
});
