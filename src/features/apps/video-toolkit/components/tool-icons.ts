import type { Component } from "svelte";
import ArchiveIcon from "@lucide/svelte/icons/archive";
import AudioWaveformIcon from "@lucide/svelte/icons/audio-waveform";
import CaptionsIcon from "@lucide/svelte/icons/captions";
import CropIcon from "@lucide/svelte/icons/crop";
import FilmIcon from "@lucide/svelte/icons/film";
import GaugeIcon from "@lucide/svelte/icons/gauge";
import ImageIcon from "@lucide/svelte/icons/image";
import ImagesIcon from "@lucide/svelte/icons/images";
import LayersIcon from "@lucide/svelte/icons/layers";
import Music2Icon from "@lucide/svelte/icons/music-2";
import MusicIcon from "@lucide/svelte/icons/music";
import PaletteIcon from "@lucide/svelte/icons/palette";
import RepeatIcon from "@lucide/svelte/icons/repeat";
import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
import RotateCwIcon from "@lucide/svelte/icons/rotate-cw";
import ScissorsIcon from "@lucide/svelte/icons/scissors";
import SlidersHorizontalIcon from "@lucide/svelte/icons/sliders-horizontal";
import StampIcon from "@lucide/svelte/icons/stamp";
import ClapperboardIcon from "@lucide/svelte/icons/clapperboard";

/** Keeps `@nd-os/video-engine` free of any Svelte or DOM dependency. */
const ICONS: Record<string, Component> = {
  archive: ArchiveIcon,
  "audio-waveform": AudioWaveformIcon,
  captions: CaptionsIcon,
  crop: CropIcon,
  film: FilmIcon,
  gauge: GaugeIcon,
  image: ImageIcon,
  images: ImagesIcon,
  layers: LayersIcon,
  music: MusicIcon,
  "music-2": Music2Icon,
  palette: PaletteIcon,
  repeat: RepeatIcon,
  "rotate-ccw": RotateCcwIcon,
  "rotate-cw": RotateCwIcon,
  scissors: ScissorsIcon,
  "sliders-horizontal": SlidersHorizontalIcon,
  stamp: StampIcon,
};

export function toolIcon(key: string): Component {
  return ICONS[key] ?? ClapperboardIcon;
}
