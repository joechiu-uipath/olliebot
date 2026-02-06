import { useState } from 'react';
import { playAudioData } from '../utils/audio';

/**
 * Audio player component - play button for on-demand playback
 */
export function AudioPlayer({ audioBase64, mimeType }) {
  const [isPlaying, setIsPlaying] = useState(false);

  const handlePlay = async () => {
    setIsPlaying(true);
    await playAudioData(audioBase64, mimeType);
    setIsPlaying(false);
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
