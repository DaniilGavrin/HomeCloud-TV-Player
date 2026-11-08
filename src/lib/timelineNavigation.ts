/** Pure keyboard/tv-remote timeline arithmetic, independent from WebView. */
export function clampSeek(value:number,duration:number):number {
  if(!Number.isFinite(duration)||duration<=0)return 0;
  if(!Number.isFinite(value))return 0;
  return Math.min(duration,Math.max(0,value));
}
export function advanceSeekPreview(value:number,duration:number,direction:-1|1,repeat=false):number {
  if(!Number.isFinite(duration)||duration<=0)return 0;
  // One D-pad step: 5–60s depending on film length. Holding accelerates 5x.
  const step=Math.min(60,Math.max(5,duration/120))*(repeat?5:1);
  return clampSeek(value+direction*step,duration);
}
