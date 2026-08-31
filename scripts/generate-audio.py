#!/usr/bin/env python3
"""Generate the original BGM and sound-effect pack used by the game.

The synthesizer intentionally depends only on Python's standard library.  It
does not read samples, sound fonts, or network resources.  Source PCM for the
two music loops is written to an operating-system temporary directory and is
converted to AAC/M4A with macOS ``afconvert``.
"""

from __future__ import annotations

import argparse
from array import array
from dataclasses import dataclass
import json
import math
from pathlib import Path
import random
import struct
import subprocess
import sys
import tempfile
import wave


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "assets" / "audio"
MANIFEST_PATH = OUTPUT_DIR / "manifest.json"
SAMPLE_RATE = 44_100
TAU = math.tau
SEED = 0x51A1_2026
AFCONVERT = Path("/usr/bin/afconvert")
AFINFO = Path("/usr/bin/afinfo")


@dataclass(frozen=True)
class Asset:
    id: str
    kind: str
    filename: str
    loop: bool
    volume: float

    @property
    def path(self) -> Path:
        return OUTPUT_DIR / self.filename

    def manifest_entry(self) -> dict[str, object]:
        return {
            "id": self.id,
            "kind": self.kind,
            "path": f"assets/audio/{self.filename}",
            "loop": self.loop,
            "volume": self.volume,
        }


ASSETS = (
    Asset("bgm-menu", "bgm", "bgm-menu.m4a", True, 0.42),
    Asset("bgm-battle", "bgm", "bgm-battle.m4a", True, 0.38),
    Asset("sfx-ui-tap", "sfx", "sfx-ui-tap.wav", False, 0.52),
    Asset("sfx-deploy-gel", "sfx", "sfx-deploy-gel.wav", False, 0.64),
    Asset("sfx-turret-build", "sfx", "sfx-turret-build.wav", False, 0.66),
    Asset("sfx-wave-start", "sfx", "sfx-wave-start.wav", False, 0.68),
    Asset("sfx-attack-plop", "sfx", "sfx-attack-plop.wav", False, 0.48),
    Asset("sfx-turret-shot", "sfx", "sfx-turret-shot.wav", False, 0.52),
    Asset("sfx-hit-soft", "sfx", "sfx-hit-soft.wav", False, 0.46),
    Asset("sfx-enemy-pop", "sfx", "sfx-enemy-pop.wav", False, 0.56),
    Asset("sfx-hero-skill", "sfx", "sfx-hero-skill.wav", False, 0.72),
    Asset("sfx-core-hit", "sfx", "sfx-core-hit.wav", False, 0.70),
    Asset("sfx-wave-clear", "sfx", "sfx-wave-clear.wav", False, 0.68),
    Asset("sfx-victory", "sfx", "sfx-victory.wav", False, 0.72),
    Asset("sfx-defeat", "sfx", "sfx-defeat.wav", False, 0.62),
    Asset("sfx-summon", "sfx", "sfx-summon.wav", False, 0.70),
)


class Buffer:
    """Small float mixer supporting mono effects and stereo music."""

    def __init__(self, seconds: float, channels: int) -> None:
        self.channels = channels
        self.frames = max(1, round(seconds * SAMPLE_RATE))
        self.data = [array("f", [0.0]) * self.frames for _ in range(channels)]

    @property
    def seconds(self) -> float:
        return self.frames / SAMPLE_RATE


def midi(note: int) -> float:
    return 440.0 * (2.0 ** ((note - 69) / 12.0))


def smooth_edge(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def envelope(t: float, duration: float, attack: float, release: float) -> float:
    if t < 0.0 or t >= duration:
        return 0.0
    gain = smooth_edge(t / max(attack, 1e-6)) if t < attack else 1.0
    remaining = duration - t
    if remaining < release:
        gain *= smooth_edge(remaining / max(release, 1e-6))
    return gain


def pan_gains(channels: int, pan: float) -> tuple[float, ...]:
    if channels == 1:
        return (1.0,)
    angle = (max(-1.0, min(1.0, pan)) + 1.0) * math.pi / 4.0
    return (math.cos(angle), math.sin(angle))


def waveform(phase: float, voice: str) -> float:
    sine = math.sin(phase)
    if voice == "sine":
        return sine
    if voice == "triangle":
        return (2.0 / math.pi) * math.asin(sine)
    if voice == "gel":
        return 0.78 * sine + 0.17 * math.sin(phase * 2.0) + 0.05 * math.sin(phase * 3.0)
    if voice == "bell":
        return 0.68 * sine + 0.22 * math.sin(phase * 2.01) + 0.10 * math.sin(phase * 3.98)
    if voice == "reed":
        return 0.72 * sine + 0.19 * math.sin(phase * 3.0) + 0.09 * math.sin(phase * 5.0)
    raise ValueError(f"Unknown voice: {voice}")


def add_tone(
    target: Buffer,
    start: float,
    duration: float,
    frequency: float,
    amplitude: float,
    *,
    voice: str = "sine",
    attack: float = 0.008,
    release: float = 0.06,
    decay: float = 0.0,
    pan: float = 0.0,
    glide_to: float | None = None,
    vibrato: float = 0.0,
    vibrato_rate: float = 5.0,
) -> None:
    first = max(0, round(start * SAMPLE_RATE))
    last = min(target.frames, round((start + duration) * SAMPLE_RATE))
    if first >= last:
        return
    gains = pan_gains(target.channels, pan)
    phase = 0.0
    for frame in range(first, last):
        t = (frame - first) / SAMPLE_RATE
        progress = t / max(duration, 1e-9)
        current_frequency = frequency
        if glide_to is not None:
            current_frequency *= (glide_to / frequency) ** progress
        if vibrato:
            current_frequency *= 1.0 + vibrato * math.sin(TAU * vibrato_rate * t)
        phase += TAU * current_frequency / SAMPLE_RATE
        env = envelope(t, duration, attack, release)
        if decay:
            env *= math.exp(-decay * progress)
        sample = waveform(phase, voice) * amplitude * env
        for channel, gain in enumerate(gains):
            target.data[channel][frame] += sample * gain


def add_noise(
    target: Buffer,
    rng: random.Random,
    start: float,
    duration: float,
    amplitude: float,
    *,
    attack: float = 0.001,
    release: float = 0.05,
    decay: float = 2.5,
    color: float = 0.35,
    pan: float = 0.0,
) -> None:
    first = max(0, round(start * SAMPLE_RATE))
    last = min(target.frames, round((start + duration) * SAMPLE_RATE))
    gains = pan_gains(target.channels, pan)
    state = 0.0
    for frame in range(first, last):
        t = (frame - first) / SAMPLE_RATE
        white = rng.uniform(-1.0, 1.0)
        state = state * color + white * (1.0 - color)
        env = envelope(t, duration, attack, release)
        env *= math.exp(-decay * t / max(duration, 1e-9))
        sample = state * amplitude * env
        for channel, gain in enumerate(gains):
            target.data[channel][frame] += sample * gain


def add_pluck(
    target: Buffer,
    start: float,
    duration: float,
    note: int,
    amplitude: float,
    pan: float = 0.0,
) -> None:
    frequency = midi(note)
    add_tone(target, start, duration, frequency, amplitude, voice="gel",
             attack=0.005, release=min(0.11, duration * 0.38), decay=2.4, pan=pan)
    add_tone(target, start, duration * 0.72, frequency * 2.0, amplitude * 0.18,
             voice="bell", attack=0.003, release=min(0.08, duration * 0.3),
             decay=4.2, pan=pan)


def add_gel_kick(target: Buffer, rng: random.Random, start: float, amplitude: float, pan: float = 0.0) -> None:
    add_tone(target, start, 0.19, 105.0, amplitude, voice="sine", attack=0.002,
             release=0.085, decay=3.4, pan=pan, glide_to=43.0)
    add_noise(target, rng, start, 0.035, amplitude * 0.18, release=0.025,
              decay=4.0, color=0.18, pan=pan)


def add_tick(target: Buffer, rng: random.Random, start: float, amplitude: float, pan: float = 0.0) -> None:
    add_noise(target, rng, start, 0.055, amplitude, attack=0.001, release=0.04,
              decay=5.0, color=-0.18, pan=pan)
    add_tone(target, start, 0.045, 1900.0, amplitude * 0.22, voice="bell",
             attack=0.001, release=0.035, decay=4.0, pan=pan)


def build_menu_bgm() -> Buffer:
    """Warm, toy-like base-building loop in C major pentatonic."""

    rng = random.Random(SEED + 101)
    bpm = 105
    beat = 60.0 / bpm
    bars = 8
    target = Buffer(bars * 4 * beat, 2)
    chords = (
        (48, (60, 64, 67)),
        (45, (57, 60, 64)),
        (41, (53, 57, 60)),
        (43, (55, 59, 62)),
        (48, (60, 64, 67)),
        (45, (57, 60, 64)),
        (50, (62, 65, 69)),
        (43, (55, 59, 62)),
    )
    melody = (
        (72, 74, 76, 79, 76, 74, 72, 67),
        (69, 72, 76, 72, 69, 67, 64, 67),
        (69, 72, 77, 76, 72, 69, 67, 65),
        (67, 71, 74, 79, 74, 71, 69, 67),
        (72, 76, 79, 81, 79, 76, 74, 72),
        (69, 72, 76, 81, 76, 72, 69, 67),
        (74, 77, 81, 84, 81, 77, 76, 74),
        (71, 74, 79, 83, 79, 74, 71, 67),
    )
    arp_order = (0, 1, 2, 1, 0, 2, 1, 2)

    for bar, ((root, chord), tune) in enumerate(zip(chords, melody)):
        bar_start = bar * 4 * beat
        for index, note in enumerate(chord):
            add_tone(target, bar_start, beat * 3.88, midi(note - 12), 0.042,
                     voice="triangle", attack=0.13, release=0.24,
                     pan=(-0.35 + index * 0.35))
        for step in range(8):
            note = chord[arp_order[step]] + 12
            add_pluck(target, bar_start + step * beat / 2, beat * 0.42,
                      note, 0.052, -0.34 if step % 2 == 0 else 0.34)
            add_pluck(target, bar_start + step * beat / 2 + beat * 0.25,
                      beat * 0.20, tune[step], 0.031,
                      -0.15 + 0.3 * (step % 2))
        for pulse in range(4):
            pulse_start = bar_start + pulse * beat
            add_tone(target, pulse_start, beat * 0.48, midi(root), 0.078,
                     voice="gel", attack=0.008, release=0.11, decay=1.8, pan=-0.08)
            if pulse in (0, 2):
                add_gel_kick(target, rng, pulse_start, 0.075, pan=-0.06)
            add_tick(target, rng, pulse_start + beat * 0.5, 0.021,
                     pan=0.28 if pulse % 2 else -0.28)
    return target


def build_battle_bgm() -> Buffer:
    """Energetic but light battle loop with elastic percussion."""

    rng = random.Random(SEED + 202)
    bpm = 140
    beat = 60.0 / bpm
    bars = 16
    target = Buffer(bars * 4 * beat, 2)
    progression = (
        (38, (50, 53, 57)), (34, (46, 50, 53)),
        (41, (53, 57, 60)), (36, (48, 52, 55)),
    )
    motifs = (
        (74, 77, 81, 77, 76, 74, 69, 72),
        (70, 74, 77, 82, 77, 74, 72, 70),
        (77, 81, 84, 81, 79, 77, 72, 76),
        (72, 76, 79, 84, 79, 76, 74, 72),
    )
    arp_order = (0, 2, 1, 2, 0, 1, 2, 1)

    for bar in range(bars):
        root, chord = progression[bar % len(progression)]
        motif = motifs[(bar + bar // 4) % len(motifs)]
        bar_start = bar * 4 * beat
        for index, note in enumerate(chord):
            add_tone(target, bar_start, beat * 3.82, midi(note - 12), 0.034,
                     voice="reed", attack=0.08, release=0.16,
                     pan=-0.32 + index * 0.32)
        for step in range(8):
            t = bar_start + step * beat / 2
            add_pluck(target, t, beat * 0.38, chord[arp_order[step]] + 12,
                      0.061, -0.38 if step % 2 == 0 else 0.38)
            if step % 2 == 0 or bar % 4 == 3:
                add_tone(target, t + beat * 0.12, beat * 0.34, midi(motif[step]),
                         0.036, voice="bell", attack=0.004, release=0.07,
                         decay=2.6, pan=0.18 if step % 2 else -0.18)
        for pulse in range(4):
            t = bar_start + pulse * beat
            add_tone(target, t, beat * 0.58, midi(root), 0.095, voice="gel",
                     attack=0.004, release=0.08, decay=2.0, pan=-0.08)
            if pulse in (0, 2):
                add_gel_kick(target, rng, t, 0.105, pan=-0.1)
            if pulse in (1, 3):
                add_noise(target, rng, t, 0.105, 0.040, release=0.065,
                          decay=3.8, color=0.44, pan=0.08)
            add_tick(target, rng, t + beat * 0.5, 0.034,
                     pan=0.42 if pulse % 2 else -0.42)
    return target


SFX_DURATIONS = {
    "sfx-ui-tap": 0.16,
    "sfx-deploy-gel": 0.46,
    "sfx-turret-build": 0.72,
    "sfx-wave-start": 0.92,
    "sfx-attack-plop": 0.27,
    "sfx-turret-shot": 0.24,
    "sfx-hit-soft": 0.22,
    "sfx-enemy-pop": 0.36,
    "sfx-hero-skill": 1.18,
    "sfx-core-hit": 0.62,
    "sfx-wave-clear": 1.02,
    "sfx-victory": 1.72,
    "sfx-defeat": 1.58,
    "sfx-summon": 1.44,
}


def build_sfx(asset_id: str, seed_offset: int) -> Buffer:
    target = Buffer(SFX_DURATIONS[asset_id], 1)
    rng = random.Random(SEED + 1_000 + seed_offset)

    if asset_id == "sfx-ui-tap":
        add_tone(target, 0.0, 0.11, 660, 0.42, voice="bell", attack=0.002,
                 release=0.07, decay=2.2, glide_to=920)
        add_tone(target, 0.018, 0.10, 1320, 0.14, voice="sine", attack=0.002,
                 release=0.07, decay=3.0)
    elif asset_id == "sfx-deploy-gel":
        add_tone(target, 0.0, 0.31, 250, 0.50, voice="gel", attack=0.004,
                 release=0.13, decay=1.2, glide_to=92)
        add_tone(target, 0.15, 0.24, 170, 0.32, voice="sine", attack=0.006,
                 release=0.14, decay=1.8, glide_to=320)
        add_noise(target, rng, 0.0, 0.09, 0.10, release=0.06, decay=4.0)
    elif asset_id == "sfx-turret-build":
        for index, note in enumerate((60, 67, 72)):
            add_pluck(target, 0.08 * index, 0.28, note, 0.25)
        add_noise(target, rng, 0.01, 0.12, 0.12, release=0.08, color=0.12)
        add_tone(target, 0.29, 0.33, midi(79), 0.24, voice="bell",
                 attack=0.005, release=0.20, decay=1.5)
    elif asset_id == "sfx-wave-start":
        for index, note in enumerate((60, 67, 72, 79)):
            add_tone(target, 0.11 * index, 0.36, midi(note), 0.28,
                     voice="reed", attack=0.008, release=0.15, decay=1.4)
        add_tone(target, 0.47, 0.34, midi(84), 0.24, voice="bell",
                 attack=0.005, release=0.22, decay=1.2)
    elif asset_id == "sfx-attack-plop":
        add_tone(target, 0.0, 0.22, 310, 0.60, voice="gel", attack=0.002,
                 release=0.09, decay=2.2, glide_to=105)
        add_noise(target, rng, 0.0, 0.045, 0.16, release=0.03, decay=5.0)
    elif asset_id == "sfx-turret-shot":
        add_tone(target, 0.0, 0.18, 1120, 0.46, voice="reed", attack=0.001,
                 release=0.07, decay=2.4, glide_to=360)
        add_noise(target, rng, 0.0, 0.055, 0.20, release=0.038,
                  decay=4.5, color=-0.2)
    elif asset_id == "sfx-hit-soft":
        add_noise(target, rng, 0.0, 0.14, 0.34, release=0.08,
                  decay=3.4, color=0.68)
        add_tone(target, 0.0, 0.18, 145, 0.40, voice="sine", attack=0.002,
                 release=0.10, decay=2.8, glide_to=82)
    elif asset_id == "sfx-enemy-pop":
        add_tone(target, 0.0, 0.25, 210, 0.48, voice="gel", attack=0.003,
                 release=0.10, decay=1.4, glide_to=760)
        add_noise(target, rng, 0.08, 0.11, 0.22, release=0.07,
                  decay=3.8, color=0.10)
    elif asset_id == "sfx-hero-skill":
        add_tone(target, 0.0, 0.90, 180, 0.18, voice="sine", attack=0.03,
                 release=0.30, glide_to=720, vibrato=0.012, vibrato_rate=7)
        for index, note in enumerate((60, 64, 67, 72, 76, 79, 84)):
            add_pluck(target, 0.075 * index, 0.42, note, 0.20,
                      -0.6 + index * 0.2)
        add_noise(target, rng, 0.38, 0.42, 0.10, attack=0.04,
                  release=0.24, decay=1.4, color=0.55)
    elif asset_id == "sfx-core-hit":
        add_tone(target, 0.0, 0.52, 96, 0.55, voice="sine", attack=0.002,
                 release=0.23, decay=2.0, glide_to=47)
        add_noise(target, rng, 0.0, 0.24, 0.31, release=0.14,
                  decay=3.0, color=0.70)
        add_tone(target, 0.13, 0.36, 420, 0.17, voice="reed", attack=0.004,
                 release=0.18, decay=2.0, glide_to=290)
    elif asset_id == "sfx-wave-clear":
        for index, note in enumerate((67, 72, 76, 79)):
            add_pluck(target, 0.115 * index, 0.46, note, 0.29)
        add_tone(target, 0.48, 0.43, midi(84), 0.22, voice="bell",
                 attack=0.005, release=0.28, decay=1.2)
    elif asset_id == "sfx-victory":
        for index, note in enumerate((60, 64, 67, 72, 76, 79, 84)):
            start = (0.12 * index) if index < 4 else 0.54 + 0.08 * (index - 4)
            add_pluck(target, start, 0.58, note, 0.25)
        for note in (72, 76, 79):
            add_tone(target, 0.78, 0.78, midi(note), 0.15, voice="bell",
                     attack=0.025, release=0.42, decay=0.8)
    elif asset_id == "sfx-defeat":
        for index, note in enumerate((67, 63, 60, 55, 48)):
            add_tone(target, 0.18 * index, 0.58, midi(note), 0.26,
                     voice="triangle", attack=0.012, release=0.30,
                     decay=1.1, vibrato=0.008, vibrato_rate=4.2)
        add_tone(target, 0.72, 0.70, midi(36), 0.20, voice="sine",
                 attack=0.02, release=0.40, decay=1.4, glide_to=midi(34))
    elif asset_id == "sfx-summon":
        add_tone(target, 0.0, 1.20, 120, 0.19, voice="sine", attack=0.10,
                 release=0.42, glide_to=780, vibrato=0.018, vibrato_rate=8)
        for index, note in enumerate((55, 62, 67, 74, 79, 86)):
            add_tone(target, 0.09 * index, 0.56, midi(note), 0.21,
                     voice="bell", attack=0.006, release=0.27, decay=1.5)
        add_noise(target, rng, 0.14, 0.76, 0.075, attack=0.08,
                  release=0.33, decay=1.2, color=0.60)
        add_tone(target, 0.72, 0.56, midi(91), 0.18, voice="bell",
                 attack=0.006, release=0.34, decay=1.0)
    else:
        raise ValueError(f"Unknown SFX id: {asset_id}")
    return target


def remove_dc_and_normalize(target: Buffer, peak: float) -> None:
    for channel in target.data:
        average = sum(channel) / len(channel)
        if abs(average) > 1e-8:
            for index in range(len(channel)):
                channel[index] -= average
    current_peak = max(abs(sample) for channel in target.data for sample in channel)
    if current_peak <= 0.0:
        raise ValueError("Generated audio is silent")
    gain = peak / current_peak
    for channel in target.data:
        for index in range(len(channel)):
            channel[index] *= gain


def write_wav(path: Path, target: Buffer, peak: float) -> None:
    remove_dc_and_normalize(target, peak)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as output:
        output.setnchannels(target.channels)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        chunk_frames = 4096
        for first in range(0, target.frames, chunk_frames):
            last = min(target.frames, first + chunk_frames)
            block = bytearray((last - first) * target.channels * 2)
            cursor = 0
            for frame in range(first, last):
                for channel in range(target.channels):
                    sample = max(-1.0, min(1.0, target.data[channel][frame]))
                    quantized = round(sample * 32767.0)
                    struct.pack_into("<h", block, cursor, quantized)
                    cursor += 2
            output.writeframesraw(block)


def convert_m4a(source: Path, destination: Path) -> None:
    if not AFCONVERT.is_file():
        raise FileNotFoundError(f"Required converter not found: {AFCONVERT}")
    destination.unlink(missing_ok=True)
    subprocess.run(
        [
            str(AFCONVERT), "-f", "m4af", "-d", "aac ",
            "-b", "128000", "-q", "96", "-s", "2",
            str(source), str(destination),
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    normalize_m4a_timestamps(destination)


def normalize_m4a_timestamps(path: Path) -> None:
    """Remove afconvert's wall-clock metadata while preserving encoded audio.

    Core Audio writes the current Mac-epoch time into the movie, track, and
    media headers.  Normalizing those fields makes fixed-seed regeneration
    byte-for-byte reproducible without touching any AAC packets.
    """

    contents = bytearray(path.read_bytes())
    normalized = 0
    for box_type in (b"mvhd", b"tkhd", b"mdhd"):
        cursor = 0
        while True:
            type_offset = contents.find(box_type, cursor)
            if type_offset < 0:
                break
            cursor = type_offset + 4
            box_start = type_offset - 4
            if box_start < 0:
                continue
            box_size = int.from_bytes(contents[box_start:type_offset], "big")
            payload_start = type_offset + 4
            box_end = box_start + box_size
            if box_size < 20 or box_end > len(contents) or payload_start + 20 > box_end:
                continue
            version = contents[payload_start]
            timestamp_bytes = 8 if version == 1 else 4 if version == 0 else 0
            if timestamp_bytes == 0:
                continue
            timestamps_start = payload_start + 4
            timestamps_end = timestamps_start + timestamp_bytes * 2
            if timestamps_end > box_end:
                continue
            contents[timestamps_start:timestamps_end] = bytes(timestamp_bytes * 2)
            normalized += 1
    if normalized != 3:
        raise ValueError(f"Expected three timestamped M4A headers in {path}, found {normalized}")
    path.write_bytes(contents)


def expected_manifest() -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "assets": [asset.manifest_entry() for asset in ASSETS],
    }


def write_manifest() -> None:
    MANIFEST_PATH.write_text(
        json.dumps(expected_manifest(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def validate_wav(path: Path) -> None:
    header = path.read_bytes()[:12]
    if len(header) != 12 or header[:4] != b"RIFF" or header[8:] != b"WAVE":
        raise ValueError(f"Invalid WAV header: {path}")
    with wave.open(str(path), "rb") as source:
        if source.getnchannels() != 1:
            raise ValueError(f"SFX must be mono: {path}")
        if source.getsampwidth() != 2 or source.getframerate() != SAMPLE_RATE:
            raise ValueError(f"Unexpected WAV format: {path}")
        if source.getnframes() <= 0:
            raise ValueError(f"Empty WAV: {path}")


def validate_m4a(path: Path) -> None:
    contents = path.read_bytes()
    if (
        len(contents) < 64
        or contents[4:8] != b"ftyp"
        or b"moov" not in contents
        or b"mdat" not in contents
    ):
        raise ValueError(f"Invalid M4A container: {path}")
    if not AFINFO.is_file():
        # Linux CI does not ship Apple's inspector; container validation still
        # protects the committed build while generation remains macOS-only.
        return
    result = subprocess.run(
        [str(AFINFO), str(path)],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    if result.returncode != 0 or "estimated duration" not in result.stdout:
        raise ValueError(f"afinfo could not read {path}:\n{result.stdout}")


def self_check() -> None:
    if json.loads(MANIFEST_PATH.read_text(encoding="utf-8")) != expected_manifest():
        raise ValueError(f"Manifest does not match generator contract: {MANIFEST_PATH}")
    seen_ids: set[str] = set()
    for asset in ASSETS:
        if asset.id in seen_ids:
            raise ValueError(f"Duplicate audio id: {asset.id}")
        seen_ids.add(asset.id)
        resolved = asset.path.resolve()
        if resolved.parent != OUTPUT_DIR.resolve():
            raise ValueError(f"Audio path escapes assets/audio: {asset.path}")
        if not asset.path.is_file() or asset.path.stat().st_size <= 0:
            raise ValueError(f"Missing or empty audio file: {asset.path}")
        if asset.kind == "bgm":
            validate_m4a(asset.path)
        else:
            validate_wav(asset.path)


def generate() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    bgm_builders = {
        "bgm-menu": build_menu_bgm,
        "bgm-battle": build_battle_bgm,
    }
    with tempfile.TemporaryDirectory(prefix="slime-audio-") as temp_name:
        temp_dir = Path(temp_name)
        for asset in ASSETS:
            if asset.kind == "bgm":
                source = temp_dir / f"{asset.id}.wav"
                write_wav(source, bgm_builders[asset.id](), peak=0.88)
                convert_m4a(source, asset.path)
            else:
                index = next(i for i, candidate in enumerate(ASSETS) if candidate == asset)
                write_wav(asset.path, build_sfx(asset.id, index), peak=0.90)
    write_manifest()
    self_check()


def print_report() -> None:
    print("Generated audio assets:")
    for asset in ASSETS:
        size = asset.path.stat().st_size
        print(f"  {asset.id:18} {asset.kind:3} {size:8,d} bytes  {asset.path.relative_to(ROOT)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="validate committed audio and manifest without regenerating them",
    )
    arguments = parser.parse_args()
    if arguments.check:
        self_check()
    else:
        generate()
    print_report()


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"audio generation failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
