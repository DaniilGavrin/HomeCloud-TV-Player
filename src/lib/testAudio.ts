/** Small generated WAV for the development-only TV Player audio probe.
 * No external URLs and no fixture binary in the release artifact.
 * Never use this source for a real Backend room or send decoder reports for it.
 */
export function createTestAudioUrl(): string {
  const sampleRate = 22050;
  const seconds = 8;
  const count = sampleRate * seconds;
  const size = count * 2;
  const buffer = new ArrayBuffer(44 + size);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + size, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, size, true);

  for (let i = 0; i < count; i++) {
    const t = i / sampleRate;
    const fade = Math.min(1, t * 12, (seconds - t) * 12);
    const volume = 0.09 * Math.max(0, fade);
    const tone = Math.sin(t * 2 * Math.PI * 330);
    view.setInt16(44 + i * 2, Math.round(volume * tone * 32767), true);
  }
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}
