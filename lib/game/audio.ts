const SOUND_PATHS = {
  jump: "/sounds/jetpack_jump.wav",
  landing: "/sounds/landing.wav",
  gameOver: "/sounds/game_over.wav",
  loop: "/sounds/runner_loop_45s.wav",
} as const;

const VOLUME = {
  jump: 0.55,
  landing: 0.5,
  gameOver: 0.65,
  loop: 0.35,
} as const;

function createClip(src: string, volume: number, loop = false): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  const audio = new Audio(src);
  audio.preload = "auto";
  audio.volume = volume;
  audio.loop = loop;
  return audio;
}

class GameAudio {
  private jump: HTMLAudioElement | null = null;
  private landing: HTMLAudioElement | null = null;
  private gameOver: HTMLAudioElement | null = null;
  private loop: HTMLAudioElement | null = null;
  private unlocked = false;
  private loopPlaying = false;

  private ensureLoaded() {
    if (this.jump) return;
    this.jump = createClip(SOUND_PATHS.jump, VOLUME.jump);
    this.landing = createClip(SOUND_PATHS.landing, VOLUME.landing);
    this.gameOver = createClip(SOUND_PATHS.gameOver, VOLUME.gameOver);
    this.loop = createClip(SOUND_PATHS.loop, VOLUME.loop, true);
  }

  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    this.ensureLoaded();
  }

  private playClip(audio: HTMLAudioElement | null) {
    if (!this.unlocked || !audio) return;
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  }

  playJump() {
    this.ensureLoaded();
    this.playClip(this.jump);
  }

  playLanding() {
    this.ensureLoaded();
    this.playClip(this.landing);
  }

  playGameOver() {
    this.stopLoop();
    this.ensureLoaded();
    this.playClip(this.gameOver);
  }

  startLoop() {
    if (!this.unlocked || !this.loop || this.loopPlaying) return;
    this.loopPlaying = true;
    void this.loop.play().catch(() => {
      this.loopPlaying = false;
    });
  }

  stopLoop() {
    if (!this.loop) return;
    this.loop.pause();
    this.loop.currentTime = 0;
    this.loopPlaying = false;
  }

  dispose() {
    this.stopLoop();
    for (const clip of [this.jump, this.landing, this.gameOver, this.loop]) {
      if (!clip) continue;
      clip.pause();
      clip.src = "";
    }
    this.jump = null;
    this.landing = null;
    this.gameOver = null;
    this.loop = null;
    this.unlocked = false;
  }
}

export const gameAudio = new GameAudio();
