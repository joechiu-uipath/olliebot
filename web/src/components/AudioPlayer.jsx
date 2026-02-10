import { useState } from 'react';
import { playAudioData } from '../utils/audio';

/**
 * Audio player component - play button for on-demand playback
 * Accepts either audioDataUrl (data:audio/...;base64,...) or audioBase64 + mimeType
 */
export function AudioPlayer({ audioDataUrl, audioBase64, mimeType }) {
  const [isPlaying, setIsPlaying] = useState(false);

  const handlePlay = async () => {
    setIsPlaying(true);
    try {
      // Extract base64 and mimeType from dataUrl if provided
      let base64 = audioBase64;
      let mime = mimeType;
      if (audioDataUrl) {
        // Handle MIME types with parameters like "audio/pcm;rate=24000"
        // Format: data:<mime>[;param=value]*;base64,<data>
        const match = audioDataUrl.match(/^data:([^;,]+(?:;[^;,]+)*);base64,(.+)$/);
        if (match) {
          mime = match[1];  // Full MIME with params, e.g., "audio/pcm;rate=24000"
          base64 = match[2];
        }
      }
      if (base64) {
        await playAudioData(base64, mime);
      }
    } catch (error) {
      // Log playback errors so they can be diagnosed, but always reset isPlaying
      console.error('Failed to play audio data:', error);
    } finally {
      setIsPlaying(false);
    }
  };

  return (
    <button
      className={`audio-play-button ${isPlaying ? 'playing' : ''}`}
      onClick={handlePlay}
      disabled={isPlaying}
    >
      {isPlaying ? '🔊 Playing...' : '▶️ Play'}
    </button>
  );
}

export default AudioPlayer;
