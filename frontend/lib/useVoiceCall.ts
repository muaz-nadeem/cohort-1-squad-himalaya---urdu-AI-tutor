"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CallStatus = "idle" | "listening" | "processing" | "speaking";

export interface VoiceCallResult {
  audio?: string | null;
  /** Stream narration from the backend instead of waiting for base64 audio. */
  speechUrl?: string | null;
  noSpeech?: boolean;
}

interface UseVoiceCallOptions {
  /** Send the recorded clip to the backend and return the audio to play back. */
  onClip: (blob: Blob, signal: AbortSignal) => Promise<VoiceCallResult | void>;
  /** Silence (ms) after speech before the clip is auto-submitted. */
  silenceMs?: number;
  /** Hard cap on a single utterance. */
  maxUtteranceMs?: number;
  /** Volume threshold (0-1 RMS) treated as speech. */
  threshold?: number;
}

type ListenMode = "utterance" | "bargein";

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

export function useVoiceCall({
  onClip,
  silenceMs = 900,
  maxUtteranceMs = 20000,
  threshold = 0.015,
}: UseVoiceCallOptions) {
  const [inCall, setInCall] = useState(false);
  const [status, setStatus] = useState<CallStatus>("idle");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const playResolveRef = useRef<(() => void) | null>(null);
  const inCallRef = useRef(false);
  const cycleRef = useRef(0);
  const listenIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const noSpeechStreakRef = useRef(0);

  const ensureAudioReady = useCallback(async (ctx: AudioContext) => {
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    // Unlock HTML5 audio for later async TTS playback in the same call.
    try {
      const silent = new Audio(
        "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkZXNj"
      );
      silent.volume = 0.001;
      await silent.play();
      silent.pause();
    } catch {
      /* ignore — resume above is the critical part */
    }
  }, []);

  const cleanupAudioGraph = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    analyserRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  const stopCurrentRecorder = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const interruptPlayback = useCallback(() => {
    if (playerRef.current) {
      try {
        playerRef.current.pause();
        playerRef.current.removeAttribute("src");
        playerRef.current.load();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
    }
    const resolve = playResolveRef.current;
    playResolveRef.current = null;
    resolve?.();
  }, []);

  const stopEverything = useCallback(() => {
    inCallRef.current = false;
    cycleRef.current += 1;
    listenIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;

    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
    }

    interruptPlayback();
    cleanupAudioGraph();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, [cleanupAudioGraph, interruptPlayback]);

  const endCall = useCallback(() => {
    stopEverything();
    setInCall(false);
    setStatus("idle");
    setLevel(0);
  }, [stopEverything]);

  const playAudio = useCallback(
    (base64: string) => {
      return new Promise<void>((resolve) => {
        interruptPlayback();
        playResolveRef.current = resolve;
        try {
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          const blob = new Blob([bytes], { type: "audio/mpeg" });
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          playerRef.current = audio;
          const done = () => {
            URL.revokeObjectURL(url);
            if (playerRef.current === audio) playerRef.current = null;
            const r = playResolveRef.current;
            playResolveRef.current = null;
            r?.();
          };
          audio.onended = done;
          audio.onerror = done;
          audio.play().catch(done);
        } catch {
          playResolveRef.current = null;
          resolve();
        }
      });
    },
    [interruptPlayback]
  );

  /**
   * Play narration straight from a URL. The browser starts playback as soon as
   * the first MP3 chunks arrive, so we never wait for full synthesis.
   */
  const playStream = useCallback(
    (url: string) => {
      return new Promise<void>((resolve) => {
        interruptPlayback();
        playResolveRef.current = resolve;
        try {
          const audio = new Audio();
          audio.preload = "auto";
          audio.crossOrigin = "anonymous";
          playerRef.current = audio;
          const done = () => {
            if (playerRef.current === audio) playerRef.current = null;
            const r = playResolveRef.current;
            playResolveRef.current = null;
            r?.();
          };
          audio.onended = done;
          audio.onerror = () => {
            setError("Could not play the tutor's voice. Try ending the call and starting again.");
            done();
          };
          audio.src = url;
          void audio.play().catch(() => {
            setError("Could not play the tutor's voice. Check your browser audio settings.");
            done();
          });
        } catch {
          setError("Could not play the tutor's voice.");
          playResolveRef.current = null;
          resolve();
        }
      });
    },
    [interruptPlayback]
  );

  /** Record one utterance, auto-stopping after trailing silence. */
  const recordUtterance = useCallback(
    (
      stream: MediaStream,
      myCycle: number,
      listenId: number,
      opts: {
        mode: ListenMode;
        threshold: number;
        minSpeechMs?: number;
        ignoreMs?: number;
      }
    ): Promise<Blob | null> => {
      return new Promise((resolve) => {
        const mimeType = pickMimeType();
        let recorder: MediaRecorder;
        try {
          recorder = mimeType
            ? new MediaRecorder(stream, { mimeType })
            : new MediaRecorder(stream);
        } catch {
          resolve(null);
          return;
        }

        recorderRef.current = recorder;
        chunksRef.current = [];

        let settled = false;
        let hadSpeech = false;
        const finish = (blob: Blob | null) => {
          if (settled) return;
          settled = true;
          if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
          }
          resolve(blob);
        };

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onstop = () => {
          if (!hadSpeech) {
            chunksRef.current = [];
            finish(null);
            return;
          }
          const type = recorder.mimeType || mimeType || "audio/webm";
          const blob = new Blob(chunksRef.current, { type });
          chunksRef.current = [];
          finish(blob.size >= 1200 ? blob : null);
        };
        recorder.onerror = () => finish(null);

        try {
          recorder.start(200);
        } catch {
          finish(null);
          return;
        }

        const analyser = analyserRef.current;
        const startedAt = Date.now();
        let speechDetected = false;
        let speechStartedAt = 0;
        let lastLoudAt = Date.now();
        const data = analyser ? new Uint8Array(analyser.fftSize) : null;
        const minSpeechMs = opts.minSpeechMs ?? 0;
        const ignoreMs = opts.ignoreMs ?? 0;

        const stopRecorder = () => {
          if (recorder.state !== "inactive") {
            try {
              recorder.requestData();
            } catch {
              /* ignore */
            }
            try {
              recorder.stop();
            } catch {
              finish(null);
            }
          }
        };

        const tick = () => {
          if (
            cycleRef.current !== myCycle ||
            !inCallRef.current ||
            listenIdRef.current !== listenId
          ) {
            stopRecorder();
            return;
          }

          const now = Date.now();
          let rms = 0;
          if (analyser && data) {
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) {
              const v = (data[i] - 128) / 128;
              sum += v * v;
            }
            rms = Math.sqrt(sum / data.length);
            setLevel(rms);
          }

          const elapsed = now - startedAt;
          if (elapsed >= ignoreMs && rms > opts.threshold) {
            if (!speechStartedAt) speechStartedAt = now;
            if (now - speechStartedAt >= minSpeechMs) {
              speechDetected = true;
              hadSpeech = true;
              lastLoudAt = now;
            }
          } else if (!speechDetected) {
            speechStartedAt = 0;
          }

          const quietFor = now - lastLoudAt;

          if (speechDetected && quietFor > silenceMs) {
            stopRecorder();
            return;
          }
          if (opts.mode === "utterance") {
            // Nobody spoke at all — recycle the listener so we don't record silence forever
            if (!speechDetected && elapsed > 10000) {
              stopRecorder();
              return;
            }
            if (elapsed > maxUtteranceMs) {
              stopRecorder();
              return;
            }
          }

          rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
      });
    },
    [maxUtteranceMs, silenceMs]
  );

  const raceBargeOrWork = useCallback(
    async <T,>(
      work: Promise<T>,
      stream: MediaStream,
      myCycle: number,
      opts: { threshold: number; minSpeechMs: number; ignoreMs: number }
    ): Promise<
      { kind: "barge"; blob: Blob } | { kind: "work"; result: T }
    > => {
      const listenId = ++listenIdRef.current;
      let workFinished = false;

      const bargeP = recordUtterance(stream, myCycle, listenId, {
        mode: "bargein",
        threshold: opts.threshold,
        minSpeechMs: opts.minSpeechMs,
        ignoreMs: opts.ignoreMs,
      }).then((blob) => {
        if (workFinished) return { kind: "late" as const };
        if (blob && blob.size >= 1200) return { kind: "barge" as const, blob };
        return { kind: "empty" as const };
      });

      const workP = work.then((result) => {
        workFinished = true;
        if (listenIdRef.current === listenId) {
          listenIdRef.current += 1;
          stopCurrentRecorder();
        }
        return { kind: "work" as const, result };
      });

      const first = await Promise.race([bargeP, workP]);
      if (first.kind === "barge") return first;
      if (first.kind === "work") return first;
      return workP;
    },
    [recordUtterance, stopCurrentRecorder]
  );

  /** Main conversation loop: listen -> send -> speak -> listen again.
   *  A new utterance during processing or speaking cancels the old reply. */
  const runLoop = useCallback(
    async (stream: MediaStream, myCycle: number) => {
      let pending: Blob | null = null;

      while (inCallRef.current && cycleRef.current === myCycle) {
        let blob: Blob | null = pending;
        pending = null;

        if (!blob) {
          setStatus("listening");
          const listenId = ++listenIdRef.current;
          blob = await recordUtterance(stream, myCycle, listenId, {
            mode: "utterance",
            threshold,
          });
        }
        if (!inCallRef.current || cycleRef.current !== myCycle) break;

        setLevel(0);

        if (!blob || blob.size < 1200) {
          noSpeechStreakRef.current += 1;
          if (noSpeechStreakRef.current >= 3) {
            setError(
              "Couldn't hear you. Speak clearly for 2 seconds, or check mic permission."
            );
            noSpeechStreakRef.current = 0;
          }
          continue;
        }
        noSpeechStreakRef.current = 0;
        setError("");

        abortRef.current?.abort();
        interruptPlayback();
        const ac = new AbortController();
        abortRef.current = ac;

        setStatus("processing");
        const work: Promise<VoiceCallResult | void> = onClip(
          blob,
          ac.signal
        ).catch((e: unknown) => {
          if ((e as Error)?.name === "AbortError" || ac.signal.aborted) {
            return undefined;
          }
          setError("Could not reach the tutor. Retrying...");
          return undefined;
        });

        const duringProcess:
          | { kind: "barge"; blob: Blob }
          | { kind: "work"; result: VoiceCallResult | void } = await raceBargeOrWork(
          work,
          stream,
          myCycle,
          {
            threshold: Math.max(threshold * 2.2, 0.035),
            minSpeechMs: 320,
            ignoreMs: 350,
          }
        );

        if (!inCallRef.current || cycleRef.current !== myCycle) {
          ac.abort();
          break;
        }

        if (duringProcess.kind === "barge") {
          ac.abort();
          interruptPlayback();
          pending = duringProcess.blob;
          continue;
        }

        const result = duringProcess.result;
        const speechUrl =
          result && "speechUrl" in result ? result.speechUrl : null;
        const audio = result && "audio" in result ? result.audio : null;
        if (speechUrl || audio) {
          setStatus("speaking");
          const playP = speechUrl
            ? playStream(speechUrl)
            : playAudio(audio as string);
          const duringSpeak = await raceBargeOrWork(playP, stream, myCycle, {
            threshold: Math.max(threshold * 2.8, 0.045),
            minSpeechMs: 420,
            ignoreMs: 500,
          });
          if (!inCallRef.current || cycleRef.current !== myCycle) break;
          if (duringSpeak.kind === "barge") {
            interruptPlayback();
            pending = duringSpeak.blob;
            continue;
          }
        } else if (result && "noSpeech" in result && result.noSpeech) {
          continue;
        }
      }
    },
    [
      interruptPlayback,
      onClip,
      playAudio,
      playStream,
      raceBargeOrWork,
      recordUtterance,
      threshold,
    ]
  );

  const startCall = useCallback(async () => {
    if (inCallRef.current) return;
    setError("");
    noSpeechStreakRef.current = 0;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      streamRef.current = stream;

      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      await ensureAudioReady(ctx);
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyserRef.current = analyser;

      inCallRef.current = true;
      cycleRef.current += 1;
      const myCycle = cycleRef.current;
      setInCall(true);
      setStatus("listening");

      runLoop(stream, myCycle).finally(() => {
        if (cycleRef.current === myCycle) {
          stopEverything();
          setInCall(false);
          setStatus("idle");
        }
      });
    } catch {
      setError("Microphone access denied. Allow mic permission and try again.");
      setStatus("idle");
      setInCall(false);
    }
  }, [ensureAudioReady, runLoop, stopEverything]);

  useEffect(() => stopEverything, [stopEverything]);

  return { inCall, status, level, error, startCall, endCall, setError, playStream };
}
