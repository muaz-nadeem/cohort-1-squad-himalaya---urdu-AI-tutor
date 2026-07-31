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
  onClip: (blob: Blob) => Promise<VoiceCallResult | void>;
  /** Silence (ms) after speech before the clip is auto-submitted. */
  silenceMs?: number;
  /** Hard cap on a single utterance. */
  maxUtteranceMs?: number;
  /** Volume threshold (0-1 RMS) treated as speech. */
  threshold?: number;
}

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
  const inCallRef = useRef(false);
  const cycleRef = useRef(0);

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

  const stopEverything = useCallback(() => {
    inCallRef.current = false;
    cycleRef.current += 1;

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

    if (playerRef.current) {
      playerRef.current.pause();
      playerRef.current = null;
    }

    cleanupAudioGraph();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, [cleanupAudioGraph]);

  const endCall = useCallback(() => {
    stopEverything();
    setInCall(false);
    setStatus("idle");
    setLevel(0);
  }, [stopEverything]);

  const playAudio = useCallback((base64: string) => {
    return new Promise<void>((resolve) => {
      try {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "audio/mpeg" });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        playerRef.current = audio;
        const done = () => {
          URL.revokeObjectURL(url);
          playerRef.current = null;
          resolve();
        };
        audio.onended = done;
        audio.onerror = done;
        audio.play().catch(done);
      } catch {
        resolve();
      }
    });
  }, []);

  /**
   * Play narration straight from a URL. The browser starts playback as soon as
   * the first MP3 chunks arrive, so we never wait for full synthesis.
   */
  const playStream = useCallback((url: string) => {
    return new Promise<void>((resolve) => {
      try {
        const audio = new Audio();
        audio.preload = "auto";
        audio.src = url;
        playerRef.current = audio;
        const done = () => {
          playerRef.current = null;
          resolve();
        };
        audio.onended = done;
        audio.onerror = done;
        audio.play().catch(done);
      } catch {
        resolve();
      }
    });
  }, []);

  /** Record one utterance, auto-stopping after trailing silence. */
  const recordUtterance = useCallback(
    (stream: MediaStream, myCycle: number): Promise<Blob | null> => {
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
          const type = recorder.mimeType || mimeType || "audio/webm";
          const blob = new Blob(chunksRef.current, { type });
          chunksRef.current = [];
          finish(blob);
        };
        recorder.onerror = () => finish(null);

        try {
          recorder.start(200);
        } catch {
          finish(null);
          return;
        }

        // ---- voice activity detection ----
        const analyser = analyserRef.current;
        const startedAt = Date.now();
        let speechDetected = false;
        let lastLoudAt = Date.now();
        const data = analyser ? new Uint8Array(analyser.fftSize) : null;

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
          if (cycleRef.current !== myCycle || !inCallRef.current) {
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

          if (rms > threshold) {
            speechDetected = true;
            lastLoudAt = now;
          }

          const elapsed = now - startedAt;
          const quietFor = now - lastLoudAt;

          // Auto-submit once the student stops talking
          if (speechDetected && quietFor > silenceMs) {
            stopRecorder();
            return;
          }
          // Nobody spoke at all — recycle the listener so we don't record silence forever
          if (!speechDetected && elapsed > 10000) {
            stopRecorder();
            return;
          }
          if (elapsed > maxUtteranceMs) {
            stopRecorder();
            return;
          }

          rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
      });
    },
    [maxUtteranceMs, silenceMs, threshold]
  );

  /** Main conversation loop: listen -> send -> speak -> listen again. */
  const runLoop = useCallback(
    async (stream: MediaStream, myCycle: number) => {
      while (inCallRef.current && cycleRef.current === myCycle) {
        setStatus("listening");
        const blob = await recordUtterance(stream, myCycle);
        if (!inCallRef.current || cycleRef.current !== myCycle) break;

        setLevel(0);

        // Too short / silence — just listen again
        if (!blob || blob.size < 1200) continue;

        setStatus("processing");
        let result: VoiceCallResult | void;
        try {
          result = await onClip(blob);
        } catch {
          setError("Could not reach the tutor. Retrying...");
          result = undefined;
        }

        if (!inCallRef.current || cycleRef.current !== myCycle) break;

        const speechUrl = result && "speechUrl" in result ? result.speechUrl : null;
        const audio = result && "audio" in result ? result.audio : null;
        if (speechUrl) {
          setStatus("speaking");
          await playStream(speechUrl);
        } else if (audio) {
          setStatus("speaking");
          await playAudio(audio);
        }
        if (!inCallRef.current || cycleRef.current !== myCycle) break;
      }
    },
    [onClip, playAudio, playStream, recordUtterance]
  );

  const startCall = useCallback(async () => {
    if (inCallRef.current) return;
    setError("");
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
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyserRef.current = analyser;

      inCallRef.current = true;
      cycleRef.current += 1;
      const myCycle = cycleRef.current;
      setInCall(true);

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
  }, [runLoop, stopEverything]);

  useEffect(() => stopEverything, [stopEverything]);

  return { inCall, status, level, error, startCall, endCall, setError, playStream };
}
