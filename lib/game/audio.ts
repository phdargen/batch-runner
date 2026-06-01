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

type ClipName = keyof typeof SOUND_PATHS;

/**
 * Web Audio playback. Clips are fetched and decoded once into AudioBuffers, then
 * played via short-lived buffer source nodes. This avoids the main-thread hitches
 * that HTMLAudioElement.play()/currentTime cause on mobile browsers (notably on
 * landing/jump), which showed up as frame stutter during gameplay.
 */
class GameAudio {
  private ctx: AudioContext | null = null;
  private buffers: Partial<Record<ClipName, AudioBuffer>> = {};
  private loopSource: AudioBufferSourceNode | null = null;
  private unlocked = false;
  private loopPlaying = false;
  private loading = false;

  unlock() {
    if (this.unlocked) return;
    if (typeof window === "undefined") return;

    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    this.ctx = new Ctor();
    this.unlocked = true;
    void this.ctx.resume();
    void this.loadAll();
  }

  private async loadAll() {
    if (this.loading || !this.ctx) return;
    this.loading = true;

    await Promise.all(
      (Object.keys(SOUND_PATHS) as ClipName[]).map(async name => {
        try {
          const response = await fetch(SOUND_PATHS[name]);
          const data = await response.arrayBuffer();
          this.buffers[name] = await this.ctx!.decodeAudioData(data);
        } catch {
          // A missing clip simply stays silent rather than breaking gameplay.
        }
      }),
    );
  }

  private playClip(name: ClipName, volume: number) {
    const ctx = this.ctx;
    const buffer = this.buffers[name];
    if (!this.unlocked || !ctx || !buffer) return;

    if (ctx.state === "suspended") void ctx.resume();

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(ctx.destination);
    source.start();
  }

  playJump() {
    this.playClip("jump", VOLUME.jump);
  }

  playLanding() {
    this.playClip("landing", VOLUME.landing);
  }

  playGameOver() {
    this.stopLoop();
    this.playClip("gameOver", VOLUME.gameOver);
  }

  startLoop() {
    const ctx = this.ctx;
    const buffer = this.buffers.loop;
    if (!this.unlocked || !ctx || !buffer || this.loopPlaying) return;

    if (ctx.state === "suspended") void ctx.resume();

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = VOLUME.loop;
    source.connect(gain).connect(ctx.destination);
    source.start();

    this.loopSource = source;
    this.loopPlaying = true;
  }

  stopLoop() {
    if (this.loopSource) {
      try {
        this.loopSource.stop();
      } catch {
        // Already stopped.
      }
      this.loopSource.disconnect();
      this.loopSource = null;
    }
    this.loopPlaying = false;
  }

  dispose() {
    this.stopLoop();
    void this.ctx?.close();
    this.ctx = null;
    this.buffers = {};
    this.unlocked = false;
    this.loading = false;
  }
}

export const gameAudio = new GameAudio();
