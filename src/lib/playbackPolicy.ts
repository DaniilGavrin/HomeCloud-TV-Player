import type { MediaInspection, MediaTrack } from './mediaStream.ts';

// The Gateway verifies output codec compatibility again before remux.
// Preserve Direct Play when the inspected source is already compatible.
const needsAAC=new Set(['ac3','eac3','dts','dts_hd','truehd','wma','wmapro','pcm_s24le']);
export function preferredAudioTrack(report:MediaInspection):MediaTrack|null {
 const audios=report.media?.tracks?.filter(t=>t.kind==='audio'&&Number.isInteger(t.index))??[];
 return audios.find(t=>t.index===report.decision?.audio_stream_index)??
   audios.find(t=>t.default)??audios[0]??null;
}
export function automaticAudioIndex(report:MediaInspection):number|null {
 if(report.status!=='READY'||report.decision?.mode==='DIRECT')return null;
 const audio=preferredAudioTrack(report);
 if(!audio)return null;
 if(needsAAC.has(audio.codec.toLowerCase())||report.decision?.mode==='ADAPTIVE')return audio.index;
 return null;
}
export function stableDuration(nativeSeconds:number,inspectedMs?:number):number {
 if(typeof inspectedMs==='number'&&Number.isFinite(inspectedMs)&&inspectedMs>0&&inspectedMs<604800000)
  return inspectedMs/1000;
 return Number.isFinite(nativeSeconds)&&nativeSeconds>0?nativeSeconds:0;
}